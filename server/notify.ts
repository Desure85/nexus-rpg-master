/**
 * Уведомления: колокольчик в приложении + письма-дайджесты.
 * Письмо уходит, только если уведомление не прочитали в приложении за 10 минут, не чаще раза в 6 часов на человека,
 * и если человек не отписался от этого вида. Отписка — подписанной ссылкой из письма, без входа.
 */
import crypto from "crypto";
import type { Express } from "express";
import type { DB } from "./db";
import { requireUser } from "./security";
import { sendMail, mailConfigured } from "./mailer";
import { dailyChallenge, dailyKey } from "../shared/daily";

export type NotifyKind = "mp" | "worlds" | "comeback" | "daily";
export const NOTIFY_KINDS: { id: NotifyKind; name: string; email: boolean }[] = [
  { id: "mp", name: "Игроки ждут мастера (действия, заявки на героев)", email: true },
  { id: "worlds", name: "Мои миры: записи хроники, покупки, отзывы", email: true },
  { id: "comeback", name: "Незаконченная партия ждёт", email: true },
  { id: "daily", name: "Испытание дня", email: false },
];
type Prefs = Record<NotifyKind, boolean>;
const DEFAULT_PREFS: Prefs = Object.fromEntries(NOTIFY_KINDS.map(k => [k.id, k.email])) as Prefs;

const EMAIL_DELAY_MIN = 10;
const EMAIL_GAP_HOURS = 6;

export function createNotify(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '/', dedupe TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, read_at DATETIME, emailed_at DATETIME,
    UNIQUE (user_id, dedupe)
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);`);
  const ucols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => c.name);
  if (!ucols.includes("notify_prefs")) db.exec("ALTER TABLE users ADD COLUMN notify_prefs TEXT");
  if (!ucols.includes("last_digest_at")) db.exec("ALTER TABLE users ADD COLUMN last_digest_at DATETIME");

  const prefsOf = (userId: string): Prefs => {
    const r = db.prepare("SELECT notify_prefs FROM users WHERE id = ?").get(userId) as any;
    try { return { ...DEFAULT_PREFS, ...(r?.notify_prefs ? JSON.parse(r.notify_prefs) : {}) }; } catch { return { ...DEFAULT_PREFS }; }
  };

  /** Создать уведомление; одинаковый dedupe у пользователя — не дублируем. Адрес — только путь своего сайта. */
  const notify = (userId: string | null | undefined, kind: NotifyKind, title: string, body = "", url = "/", dedupe?: string) => {
    if (!userId || userId === "system-nexus") return;
    try {
      db.prepare("INSERT OR IGNORE INTO notifications (user_id, kind, title, body, url, dedupe) VALUES (?,?,?,?,?,?)")
        .run(userId, kind, title.slice(0, 140), body.slice(0, 400), /^\/(?![/\\])/.test(url) ? url.slice(0, 300) : "/", dedupe ?? null);
    } catch (e) { console.error("[notify]", e); }
  };

  /* ---------- отписка без входа: подпись HMAC от APP_SECRET ---------- */
  const secret = () => process.env.APP_SECRET || "nexus-dev-secret";
  const sign = (userId: string, kind: string) => crypto.createHmac("sha256", secret()).update(`unsub:${userId}:${kind}`).digest("hex").slice(0, 32);
  const unsubLink = (userId: string, kind: string) => {
    const base = (process.env.APP_URL || "").replace(/\/$/, "");
    return base ? `${base}/api/notifications/unsubscribe?u=${encodeURIComponent(userId)}&k=${kind}&s=${sign(userId, kind)}` : "";
  };

  /* ---------- письма-дайджесты ---------- */
  const sendDigests = async () => {
    if (!mailConfigured() || !process.env.APP_URL) return 0;
    const users = db.prepare(`SELECT DISTINCT n.user_id AS id, u.email, u.name FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE n.read_at IS NULL AND n.emailed_at IS NULL AND n.created_at <= datetime('now', ?)
        AND (u.last_digest_at IS NULL OR u.last_digest_at <= datetime('now', ?)) AND u.email NOT LIKE '%@oauth.local' LIMIT 200`)
      .all(`-${EMAIL_DELAY_MIN} minutes`, `-${EMAIL_GAP_HOURS} hours`) as { id: string; email: string; name: string }[];
    let sent = 0;
    const base = process.env.APP_URL!.replace(/\/$/, "");
    for (const u of users) {
      const prefs = prefsOf(u.id);
      const items = (db.prepare("SELECT id, kind, title, body, url FROM notifications WHERE user_id = ? AND read_at IS NULL AND emailed_at IS NULL ORDER BY created_at DESC LIMIT 20").all(u.id) as any[]);
      const mailable = items.filter(n => prefs[n.kind as NotifyKind]);
      const ids = items.map(n => n.id);
      if (mailable.length) {
        const kinds = [...new Set(mailable.map(n => n.kind))];
        const text = `${u.name || "Мастер"}, пока вас не было:\n\n${mailable.map(n => `• ${n.title}${n.body ? `\n  ${n.body}` : ""}\n  ${base}${n.url}`).join("\n\n")}\n\n—\nFate & Dragons\nОтписаться: ${kinds.map(k => `${NOTIFY_KINDS.find(x => x.id === k)?.name}: ${unsubLink(u.id, k)}`).join("\n")}\nНастроить письма: ${base}/ → Настройки → Уведомления`;
        const subject = mailable.length === 1 ? mailable[0].title : `${mailable[0].title} и ещё ${mailable.length - 1}`;
        if (await sendMail(u.email, subject.slice(0, 120), text)) { sent++; db.prepare("UPDATE users SET last_digest_at = CURRENT_TIMESTAMP WHERE id = ?").run(u.id); }
        else continue; // не отправилось — попробуем в следующий раз
      }
      db.prepare(`UPDATE notifications SET emailed_at = CURRENT_TIMESTAMP WHERE id IN (${ids.map(() => "?").join(",") || "NULL"})`).run(...ids);
    }
    return sent;
  };

  /* ---------- «партия ждёт»: неделю без игры, а партия не закончена ---------- */
  const comebackScan = () => {
    const rows = db.prepare(`SELECT s.id, s.name, s.created_by FROM sessions s
      WHERE s.created_by IS NOT NULL AND s.mode != 'tale' AND s.updated_at <= datetime('now', '-7 days') AND s.updated_at > datetime('now', '-30 days')
        AND COALESCE(s.archive, '') NOT LIKE '%# Итоги партии%'
        AND (SELECT COUNT(*) FROM usage x WHERE x.session_id = s.id AND x.kind = 'turn') >= 3
        AND NOT EXISTS (SELECT 1 FROM sessions s2 WHERE s2.created_by = s.created_by AND s2.updated_at > datetime('now', '-7 days'))
      ORDER BY s.updated_at DESC LIMIT 500`).all() as any[];
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.created_by)) continue; // одна партия на человека
      seen.add(r.created_by);
      notify(r.created_by, "comeback", `Партия «${r.name}» ждёт вас`, "Герои остановились на полпути — мастер помнит, где вы были.", "/", `comeback:${r.id}`);
    }
    return seen.size;
  };

  /* ---------- испытание дня — только тем, кто включил ---------- */
  const dailyScan = () => {
    const key = dailyKey();
    const d = dailyChallenge(key);
    const users = db.prepare("SELECT id FROM users WHERE notify_prefs LIKE '%\"daily\":true%'").all() as { id: string }[];
    for (const u of users) notify(u.id, "daily", `Испытание дня: ${d.scenario.title}`, `Условие «${d.modifier.title}». ${d.twist}`.slice(0, 300), "/", `daily:${key}`);
    return users.length;
  };

  const timers: NodeJS.Timeout[] = [];
  const start = () => {
    timers.push(setInterval(() => { sendDigests().catch(e => console.error("[notify] digest", e)); }, 5 * 60_000));
    timers.push(setInterval(() => { try { comebackScan(); dailyScan(); db.prepare("DELETE FROM notifications WHERE created_at < datetime('now', '-60 days')").run(); } catch (e) { console.error("[notify] scan", e); } }, 6 * 3600_000));
    for (const t of timers) t.unref?.();
  };
  const stop = () => { for (const t of timers) clearInterval(t); timers.length = 0; };

  const register = (app: Express) => {
    app.get("/api/notifications", requireUser, (req, res) => {
      const uid = req.auth.user!.id;
      const items = db.prepare("SELECT id, kind, title, body, url, created_at, read_at IS NOT NULL AS read FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50").all(uid) as any[];
      const unread = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(uid) as any).n;
      res.json({ unread, items: items.map(i => ({ ...i, read: !!i.read })) });
    });
    app.post("/api/notifications/read", requireUser, (req, res) => {
      const uid = req.auth.user!.id;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite).slice(0, 100) : null;
      if (ids?.length) db.prepare(`UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`).run(uid, ...ids);
      else db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND read_at IS NULL").run(uid);
      res.json({ ok: true });
    });
    app.get("/api/notifications/prefs", requireUser, (req, res) => res.json({ prefs: prefsOf(req.auth.user!.id), kinds: NOTIFY_KINDS, mail: mailConfigured() }));
    app.put("/api/notifications/prefs", requireUser, (req, res) => {
      const cur = prefsOf(req.auth.user!.id);
      for (const k of NOTIFY_KINDS) if (typeof req.body?.prefs?.[k.id] === "boolean") cur[k.id] = req.body.prefs[k.id];
      db.prepare("UPDATE users SET notify_prefs = ? WHERE id = ?").run(JSON.stringify(cur), req.auth.user!.id);
      res.json({ prefs: cur });
    });
    // Отписка из письма: без входа, по подписи
    app.get("/api/notifications/unsubscribe", (req, res) => {
      const u = String(req.query.u || ""), k = String(req.query.k || "") as NotifyKind, sig = String(req.query.s || "");
      const ok = NOTIFY_KINDS.some(x => x.id === k) && sig.length === 32 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(u, k)));
      if (ok) {
        const prefs = prefsOf(u); prefs[k] = false;
        db.prepare("UPDATE users SET notify_prefs = ? WHERE id = ?").run(JSON.stringify(prefs), u);
      }
      res.type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;background:#0a0502;color:#eee;padding:40px;text-align:center">${ok ? `<h2>Готово</h2><p>Письма «${NOTIFY_KINDS.find(x => x.id === k)!.name}» больше не придут.</p>` : "<h2>Ссылка недействительна</h2>"}<p><a style="color:#f59e0b" href="/">Вернуться в игру</a></p></body>`);
    });
  };

  return { notify, register, start, stop, sendDigests, comebackScan, dailyScan, unsubLink };
}
