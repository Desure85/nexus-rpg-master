/**
 * Воронка: заход на лендинг → регистрация → начал игру → сыграл (3+ хода) → вернулся в другой день → оплатил.
 * Визиты считаем сами (анонимный id браузера, без cookie-трекеров и сторонних счётчиков), остальное — из своих таблиц.
 * Источник (utm_source / ref) запоминается на лендинге и пишется пользователю при регистрации.
 */
import type { Express, Request } from "express";
import type { DB } from "./db";
import { rateLimit, requireUser, requireSuperadmin } from "./security";

export const SOURCE_COOKIE = "nx_src";
const cleanSource = (v: unknown) => (typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40) : "");

/** Источник из cookie лендинга — для новых пользователей (регистрация по почте и через VK/Яндекс/Google). */
export const sourceFromRequest = (req: Request) => {
  const m = (req.header("cookie") || "").match(new RegExp(`(?:^|;\\s*)${SOURCE_COOKIE}=([^;]+)`));
  return m ? cleanSource(decodeURIComponent(m[1])) || null : null;
};

/** Записать источник новому пользователю (вызывается сразу после INSERT INTO users). */
export const recordSignupSource = (db: DB, userId: string, req: Request) => {
  const src = sourceFromRequest(req);
  if (!src) return;
  try { db.prepare("UPDATE users SET source = ? WHERE id = ? AND source IS NULL").run(src, userId); } catch { /* колонки ещё нет — не мешаем регистрации */ }
};

export function createFunnel(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS funnel_visits (anon_id TEXT NOT NULL, day TEXT NOT NULL, source TEXT, PRIMARY KEY (anon_id, day))`);
  const ucols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map(c => c.name);
  if (!ucols.includes("source")) db.exec("ALTER TABLE users ADD COLUMN source TEXT");

  /** Сводка по когорте зарегистрировавшихся за `days` дней (и визитам за тот же период). */
  const report = (days: number) => {
    const since = `-${days} days`;
    const visits = (db.prepare("SELECT COUNT(DISTINCT anon_id) AS n FROM funnel_visits WHERE day >= date('now', ?)").get(since) as any).n;
    const visitsBySource = db.prepare("SELECT COALESCE(source, '') AS source, COUNT(DISTINCT anon_id) AS n FROM funnel_visits WHERE day >= date('now', ?) GROUP BY 1").all(since) as { source: string; n: number }[];
    // по каждому новому пользователю: начал ли игру, сколько ходов, вернулся ли в другой день, платил ли
    const rows = db.prepare(`
      SELECT u.id, COALESCE(u.source, '') AS source, date(u.created_at) AS d0,
        (SELECT COUNT(*) FROM sessions s WHERE s.created_by = u.id) AS sessions,
        (SELECT COUNT(*) FROM usage x JOIN sessions s ON s.id = x.session_id WHERE s.created_by = u.id AND x.kind = 'turn') AS turns,
        (SELECT COUNT(DISTINCT date(x.created_at)) FROM usage x JOIN sessions s ON s.id = x.session_id WHERE s.created_by = u.id AND date(x.created_at) > date(u.created_at)) AS later_days,
        EXISTS(SELECT 1 FROM payments p JOIN memberships m ON m.workspace_id = p.workspace_id AND m.user_id = u.id WHERE p.status = 'succeeded') AS paid
      FROM users u WHERE u.created_at >= datetime('now', ?) AND u.id != 'system-nexus'`).all(since) as any[];
    const steps = (list: any[]) => ({
      signups: list.length,
      started: list.filter(r => r.sessions > 0).length,
      played: list.filter(r => r.turns >= 3).length,
      returned: list.filter(r => r.later_days > 0).length,
      paid: list.filter(r => r.paid).length,
    });
    const sources = [...new Set([...rows.map(r => r.source), ...visitsBySource.map(v => v.source)])];
    return {
      days, visits, ...steps(rows),
      bySource: sources.map(src => ({ source: src || "прямые", visits: visitsBySource.find(v => v.source === src)?.n || 0, ...steps(rows.filter(r => r.source === src)) }))
        .sort((a, b) => b.visits + b.signups - (a.visits + a.signups)),
    };
  };

  const register = (app: Express) => {
    // Визит лендинга: один раз в день на браузер; без входа
    app.post("/api/public/visit", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
      const anon = typeof req.body?.anonId === "string" && /^[a-z0-9-]{8,64}$/i.test(req.body.anonId) ? req.body.anonId : null;
      if (anon) db.prepare("INSERT OR IGNORE INTO funnel_visits (anon_id, day, source) VALUES (?, date('now'), ?)").run(anon, cleanSource(req.body?.source) || null);
      res.json({ ok: true });
    });
    app.get("/api/admin/funnel", requireUser, requireSuperadmin, (req, res) => {
      const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
      res.json(report(days));
    });
  };

  return { register, report };
}
