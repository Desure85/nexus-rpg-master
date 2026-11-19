/**
 * Эксплуатация: события ходов (время, ошибки), ночные бэкапы базы, сводка здоровья для суперадмина
 * и алерты (почта ALERT_EMAIL и/или вебхук ALERT_WEBHOOK_URL — например, бот в Telegram или Slack).
 */
import fs from "fs";
import path from "path";
import type { Express } from "express";
import type { DB } from "./db";
import { requireUser, requireSuperadmin } from "./security";
import { sendMail, mailConfigured } from "./mailer";

/** Ошибки, которые не про сбой системы, а про пользователя: нет кредитов, лимит, занято. */
const USER_ERRORS = new Set(["insufficient_credits", "rate_limited", "busy", "forbidden", "plan_limit", "world_locked"]);

export interface OpsOptions { dbPath?: string; backupDir?: string; backupHours?: number; backupKeep?: number }

export function createOps(db: DB, opts: OpsOptions = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ops_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, ms INTEGER, ok INTEGER NOT NULL DEFAULT 1, detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ops_events ON ops_events(kind, ts);`);

  const dbPath = opts.dbPath && opts.dbPath !== ":memory:" ? opts.dbPath : null;
  const backupDir = opts.backupDir || process.env.BACKUP_DIR || (dbPath ? path.join(path.dirname(path.resolve(dbPath)), "backups") : "");
  const backupHours = opts.backupHours ?? Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);
  const backupKeep = opts.backupKeep ?? Number(process.env.BACKUP_KEEP ?? 7);

  const record = (kind: string, ms: number | null, ok: boolean, detail?: string) => {
    try { db.prepare("INSERT INTO ops_events (ts, kind, ms, ok, detail) VALUES (?,?,?,?,?)").run(Date.now(), kind, ms, ok ? 1 : 0, detail ? detail.slice(0, 300) : null); } catch { /* метрики не должны ронять игру */ }
  };

  /* ---------- ходы: старт → конец/ошибка ---------- */
  const started = new Map<string, number>();
  const onEvent = (data: any) => {
    if (!data?.sessionId) return;
    if (data.type === "turn_start") started.set(data.sessionId, Date.now());
    else if (data.type === "turn_end" || data.type === "turn_error") {
      const t0 = started.get(data.sessionId);
      started.delete(data.sessionId);
      if (data.type === "turn_error" && USER_ERRORS.has(data.code)) return;
      record("turn", t0 ? Date.now() - t0 : null, data.type === "turn_end", data.type === "turn_error" ? `${data.code || ""} ${data.error || ""}`.trim() : undefined);
    }
  };

  /* ---------- бэкапы ---------- */
  const listBackups = () => !backupDir || !fs.existsSync(backupDir) ? [] :
    fs.readdirSync(backupDir).filter(f => /^nexus-.*\.db$/.test(f)).sort().reverse()
      .map(f => { const st = fs.statSync(path.join(backupDir, f)); return { file: f, size: st.size, at: st.mtime.toISOString() }; });

  let backingUp: Promise<any> | null = null;
  const backup = async () => {
    if (!dbPath || !backupDir) throw Object.assign(new Error("Бэкап недоступен: база в памяти или не задан каталог"), { status: 400 });
    if (backingUp) return backingUp;
    backingUp = (async () => {
      const t0 = Date.now();
      fs.mkdirSync(backupDir, { recursive: true });
      const file = path.join(backupDir, `nexus-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      try {
        await (db as any).backup(file); // онлайн-бэкап SQLite: база работает дальше
        for (const old of listBackups().slice(Math.max(1, backupKeep))) fs.rmSync(path.join(backupDir, old.file), { force: true });
        record("backup", Date.now() - t0, true, path.basename(file));
        return { file: path.basename(file), size: fs.statSync(file).size, ms: Date.now() - t0 };
      } catch (e: any) {
        record("backup", Date.now() - t0, false, e?.message);
        throw e;
      }
    })().finally(() => { backingUp = null; });
    return backingUp;
  };

  /* ---------- сводка ---------- */
  const pct = (arr: number[], p: number) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : null;
  const window = (sinceMs: number) => {
    const rows = db.prepare("SELECT ms, ok, detail FROM ops_events WHERE kind = 'turn' AND ts >= ?").all(Date.now() - sinceMs) as { ms: number | null; ok: number; detail: string | null }[];
    const ms = rows.filter(r => r.ok && r.ms != null).map(r => r.ms!).sort((a, b) => a - b);
    const errors = rows.filter(r => !r.ok);
    return { turns: rows.length, errors: errors.length, errorRate: rows.length ? Math.round((errors.length / rows.length) * 1000) / 10 : 0, p50: pct(ms, 0.5), p95: pct(ms, 0.95), lastErrors: errors.slice(-5).map(e => e.detail || "") };
  };
  const summary = () => {
    const lastBackup = db.prepare("SELECT ts, ok, detail FROM ops_events WHERE kind = 'backup' ORDER BY ts DESC LIMIT 1").get() as any;
    const credits24 = (db.prepare("SELECT COALESCE(-SUM(delta), 0) AS n FROM credit_ledger WHERE delta < 0 AND reason NOT LIKE 'world:%' AND created_at >= datetime('now', '-1 day')").get() as any).n;
    const activeUsers24 = (db.prepare("SELECT COUNT(DISTINCT created_by) AS n FROM sessions WHERE updated_at >= datetime('now', '-1 day')").get() as any).n;
    const users = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n;
    const mem = typeof process.memoryUsage === "function" ? process.memoryUsage() : { rss: 0 };
    return {
      uptimeSec: typeof process.uptime === "function" ? Math.round(process.uptime()) : 0,
      memoryMb: Math.round(mem.rss / 1048576),
      // вместе с журналом WAL: свежие записи лежат там до чекпоинта
      dbSizeMb: dbPath && fs.existsSync(dbPath) ? Math.round([dbPath, `${dbPath}-wal`].reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0) / 10485.76) / 100 : null,
      hour: window(3600_000), day: window(86400_000),
      credits24, activeUsers24, users,
      backup: { enabled: !!(dbPath && backupDir && backupHours > 0), everyHours: backupHours, keep: backupKeep, last: lastBackup ? { at: new Date(lastBackup.ts).toISOString(), ok: !!lastBackup.ok, detail: lastBackup.detail } : null, files: listBackups().slice(0, 10) },
      alerts: { email: !!(process.env.ALERT_EMAIL && mailConfigured()), webhook: !!process.env.ALERT_WEBHOOK_URL },
    };
  };

  /* ---------- алерты ---------- */
  const lastAlert = new Map<string, number>();
  const alert = async (key: string, text: string) => {
    const now = Date.now();
    if (now - (lastAlert.get(key) || 0) < 3600_000) return false; // не чаще раза в час на тему
    lastAlert.set(key, now);
    record("alert", null, false, `${key}: ${text}`);
    console.warn(`[alert] ${text}`);
    const tasks: Promise<any>[] = [];
    if (process.env.ALERT_EMAIL && mailConfigured()) tasks.push(sendMail(process.env.ALERT_EMAIL, `Nexus: ${text.slice(0, 80)}`, text));
    if (process.env.ALERT_WEBHOOK_URL) tasks.push(fetch(process.env.ALERT_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `⚠️ Nexus: ${text}` }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined));
    await Promise.allSettled(tasks);
    return true;
  };
  const checkAlerts = async () => {
    const w = window(15 * 60_000);
    const maxRate = Number(process.env.ALERT_ERROR_RATE ?? 30);
    if (w.turns >= 5 && w.errorRate >= maxRate) await alert("errors", `за 15 минут ${w.errors} из ${w.turns} ходов с ошибкой (${w.errorRate}%). Последняя: ${w.lastErrors.at(-1) || "—"}`);
    const slowMs = Number(process.env.ALERT_P95_MS ?? 180_000);
    if (w.turns >= 5 && (w.p95 || 0) > slowMs) await alert("slow", `ходы медленные: p95 ${Math.round((w.p95 || 0) / 1000)} с за 15 минут`);
    const s = summary();
    if (s.backup.enabled) {
      const last = s.backup.last;
      if (last && !last.ok) await alert("backup", `бэкап базы не удался: ${last.detail || ""}`);
      else if (!last || Date.now() - Date.parse(last.at) > (backupHours * 1.5 + 1) * 3600_000) await alert("backup_stale", `нет свежего бэкапа больше ${Math.round(backupHours * 1.5)} ч`);
    }
  };

  /* ---------- расписание ---------- */
  const timers: NodeJS.Timeout[] = [];
  const start = () => {
    if (dbPath && backupDir && backupHours > 0) {
      const due = () => { const l = listBackups()[0]; return !l || Date.now() - Date.parse(l.at) >= backupHours * 3600_000; };
      // первый бэкап — через минуту после старта, если старый устарел; дальше проверка каждые 10 минут
      timers.push(setTimeout(() => { if (due()) backup().catch(e => console.error("[backup]", e)); }, 60_000));
      timers.push(setInterval(() => { if (due()) backup().catch(e => console.error("[backup]", e)); }, 10 * 60_000));
    }
    timers.push(setInterval(() => { checkAlerts().catch(e => console.error("[alerts]", e)); }, 5 * 60_000));
    timers.push(setInterval(() => { try { db.prepare("DELETE FROM ops_events WHERE ts < ?").run(Date.now() - 14 * 86400_000); } catch { /* */ } }, 6 * 3600_000));
    for (const t of timers) t.unref?.();
  };
  const stop = () => { for (const t of timers) clearTimeout(t); timers.length = 0; };

  const register = (app: Express) => {
    app.get("/api/admin/ops", requireUser, requireSuperadmin, (_req, res) => res.json(summary()));
    app.post("/api/admin/ops/backup", requireUser, requireSuperadmin, async (_req, res, next) => {
      try { res.json(await backup()); } catch (e: any) { if (e?.status) return res.status(e.status).json({ error: "backup_unavailable", message: e.message }); next(e); }
    });
    app.post("/api/admin/ops/alert-test", requireUser, requireSuperadmin, async (_req, res) => {
      lastAlert.delete("test");
      const sent = await alert("test", "проверка алертов — всё работает");
      res.json({ sent, ...summary().alerts });
    });
  };

  return { record, onEvent, backup, summary, checkAlerts, start, stop, register };
}
