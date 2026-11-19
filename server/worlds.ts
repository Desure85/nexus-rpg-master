// Миры игроков: создание, правка, доступ по ссылке и в каталоге, копия-ремикс.
import crypto from "crypto";
import type { Express } from "express";
import type { DB } from "./db";
import { normalizeWorldData, WORLD_GENRES, type World } from "../shared/world";

const MAX_WORLDS_PER_USER = 50;
const VIS = ["private", "link", "public"] as const;

const str = (v: unknown, max: number) => (typeof v === "string" ? v : "").trim().slice(0, max);

export function createWorlds(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS worlds (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '🌍',
      genre TEXT NOT NULL DEFAULT 'fantasy',
      description TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'private',
      version INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL,
      remixed_from TEXT,
      plays INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id);
    CREATE INDEX IF NOT EXISTS idx_worlds_public ON worlds(visibility, plays);
    CREATE TABLE IF NOT EXISTS world_likes (world_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (world_id, user_id));
    CREATE TABLE IF NOT EXISTS world_reports (
      world_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (world_id, user_id)
    );
  `);
  const cols = (db.prepare("PRAGMA table_info(worlds)").all() as { name: string }[]).map(c => c.name);
  if (!cols.includes("likes")) db.exec("ALTER TABLE worlds ADD COLUMN likes INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("hidden")) db.exec("ALTER TABLE worlds ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  /** Сколько жалоб скрывают мир из каталога до решения модератора */
  const REPORTS_TO_HIDE = 3;

  const row2world = (r: any, userId?: string, full = true): World => ({
    id: r.id, title: r.title, icon: r.icon, genre: r.genre, description: r.description,
    visibility: r.visibility, version: r.version, plays: r.plays, likes: r.likes || 0, liked: !!r.liked, hidden: !!r.hidden, updated_at: r.updated_at,
    author: r.author || undefined, mine: !!userId && r.owner_id === userId,
    data: full ? JSON.parse(r.data) : (() => { const d = JSON.parse(r.data); return { ...d, cards: [], core: "", counts: { cards: d.cards?.length || 0, locations: d.locations?.length || 0, scenarios: d.scenarios?.length || 0 } }; })(),
  });

  const SELECT = "SELECT w.*, u.name AS author FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
  /** Первый параметр запроса — id пользователя (для отметки «нравится») */
  const SELECT_FOR = "SELECT w.*, u.name AS author, EXISTS(SELECT 1 FROM world_likes l WHERE l.world_id = w.id AND l.user_id = ?) AS liked FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
  const lc = (v: string) => v.toLowerCase().replace(/ё/g, "е");

  /** Мир, доступный пользователю для игры: свой, по ссылке или из каталога. */
  const getForPlay = (userId: string, id: string): World | null => {
    const r = db.prepare(`${SELECT_FOR} WHERE w.id = ?`).get(userId, id) as any;
    if (!r) return null;
    if (r.owner_id !== userId && r.visibility === "private") return null;
    return row2world(r, userId);
  };

  const countPlay = (id: string) => db.prepare("UPDATE worlds SET plays = plays + 1 WHERE id = ?").run(id);

  const fields = (b: any) => ({
    title: str(b?.title, 80) || "Новый мир",
    icon: str(b?.icon, 8) || "🌍",
    genre: WORLD_GENRES.some(g => g.id === b?.genre) ? b.genre : "fantasy",
    description: str(b?.description, 600),
    visibility: (VIS as readonly string[]).includes(b?.visibility) ? b.visibility : "private",
  });

  /** В каталог — только мир, в который можно сыграть: описание и хоть какой-то лор. */
  const publishProblem = (f: { visibility: string; description: string }, d: ReturnType<typeof normalizeWorldData>) => {
    if (f.visibility !== "public") return "";
    if (!f.description) return "Для каталога добавьте описание для игроков";
    if (!d.core && !d.cards.length && !d.setting) return "Для каталога заполните сеттинг, канон или хотя бы одну карточку лора";
    return "";
  };

  const register = (app: Express, requireUser: any) => {
    app.get("/api/worlds", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const scope = req.query.scope === "public" ? "public" : "mine";
      if (scope === "mine") {
        const rows = db.prepare(`${SELECT_FOR} WHERE w.owner_id = ? ORDER BY w.updated_at DESC`).all(uid, uid);
        return res.json((rows as any[]).map(r => row2world(r, uid, false)));
      }
      // каталог: поиск по названию/описанию/автору, жанр, сортировка; скрытые модерацией не показываем
      const q = lc(str(req.query.q, 80));
      const genre = str(req.query.genre, 20);
      const sort = ["new", "likes"].includes(String(req.query.sort)) ? String(req.query.sort) : "popular";
      const order = sort === "new" ? "w.created_at DESC" : sort === "likes" ? "w.likes DESC, w.plays DESC" : "w.plays DESC, w.likes DESC";
      let rows = db.prepare(`${SELECT_FOR} WHERE w.visibility = 'public' AND w.hidden = 0 ${genre ? "AND w.genre = ?" : ""} ORDER BY ${order}, w.updated_at DESC LIMIT 500`).all(uid, ...(genre ? [genre] : [])) as any[];
      if (q) rows = rows.filter(r => lc(`${r.title} ${r.description} ${r.author || ""}`).includes(q));
      res.json(rows.slice(0, 60).map(r => row2world(r, uid, false)));
    });

    app.get("/api/worlds/:wid", requireUser, (req: any, res) => {
      const w = getForPlay(req.auth.user.id, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found", message: "Мир не найден или автор закрыл к нему доступ" });
      res.json(w);
    });

    app.post("/api/worlds", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const n = (db.prepare("SELECT COUNT(*) AS n FROM worlds WHERE owner_id = ?").get(uid) as any).n;
      if (n >= MAX_WORLDS_PER_USER) return res.status(402).json({ error: "limit", message: `Не больше ${MAX_WORLDS_PER_USER} миров` });
      const f = fields(req.body);
      const bad = publishProblem(f, normalizeWorldData(req.body?.data));
      if (bad) return res.status(400).json({ error: "not_ready", message: bad });
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO worlds (id, owner_id, title, icon, genre, description, visibility, data) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, uid, f.title, f.icon, f.genre, f.description, f.visibility, JSON.stringify(normalizeWorldData(req.body?.data)));
      res.status(201).json(getForPlay(uid, id));
    });

    app.patch("/api/worlds/:wid", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const r = db.prepare("SELECT * FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, uid) as any;
      if (!r) return res.status(404).json({ error: "world_not_found" });
      const f = fields({ ...r, ...req.body });
      const data = req.body?.data !== undefined ? normalizeWorldData(req.body.data) : JSON.parse(r.data);
      const bad = publishProblem(f, data);
      if (bad) return res.status(400).json({ error: "not_ready", message: bad });
      db.prepare("UPDATE worlds SET title=?, icon=?, genre=?, description=?, visibility=?, data=?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(f.title, f.icon, f.genre, f.description, f.visibility, JSON.stringify(data), r.id);
      res.json(getForPlay(uid, r.id));
    });

    app.post("/api/worlds/:wid/like", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      const had = db.prepare("SELECT 1 FROM world_likes WHERE world_id = ? AND user_id = ?").get(w.id, uid);
      if (had) db.prepare("DELETE FROM world_likes WHERE world_id = ? AND user_id = ?").run(w.id, uid);
      else db.prepare("INSERT INTO world_likes (world_id, user_id) VALUES (?, ?)").run(w.id, uid);
      const likes = (db.prepare("SELECT COUNT(*) AS n FROM world_likes WHERE world_id = ?").get(w.id) as any).n;
      db.prepare("UPDATE worlds SET likes = ? WHERE id = ?").run(likes, w.id);
      res.json({ likes, liked: !had });
    });

    // Жалоба: после нескольких разных жалоб мир скрывается из каталога до решения модератора (по ссылке играть можно)
    app.post("/api/worlds/:wid/report", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      if (w.mine) return res.status(400).json({ error: "own_world", message: "На свой мир жаловаться нельзя" });
      db.prepare("INSERT OR REPLACE INTO world_reports (world_id, user_id, reason) VALUES (?, ?, ?)").run(w.id, uid, str(req.body?.reason, 500));
      const n = (db.prepare("SELECT COUNT(*) AS n FROM world_reports WHERE world_id = ?").get(w.id) as any).n;
      if (n >= REPORTS_TO_HIDE) db.prepare("UPDATE worlds SET hidden = 1 WHERE id = ? AND hidden = 0").run(w.id);
      res.json({ status: "ok" });
    });

    // Модерация (суперадмин): жалобы и скрытие
    app.get("/api/admin/worlds/reports", requireUser, (req: any, res) => {
      if (!req.auth.user.isSuperadmin) return res.status(403).json({ error: "forbidden" });
      res.json(db.prepare(`SELECT w.id, w.title, w.hidden, w.visibility, COUNT(r.user_id) AS reports, GROUP_CONCAT(r.reason, ' | ') AS reasons
        FROM world_reports r JOIN worlds w ON w.id = r.world_id GROUP BY w.id ORDER BY reports DESC`).all());
    });
    app.post("/api/admin/worlds/:wid/moderate", requireUser, (req: any, res) => {
      if (!req.auth.user.isSuperadmin) return res.status(403).json({ error: "forbidden" });
      const hidden = req.body?.hidden ? 1 : 0;
      db.prepare("UPDATE worlds SET hidden = ? WHERE id = ?").run(hidden, req.params.wid);
      if (!hidden) db.prepare("DELETE FROM world_reports WHERE world_id = ?").run(req.params.wid);
      res.json({ status: "ok", hidden: !!hidden });
    });

    app.delete("/api/worlds/:wid", requireUser, (req: any, res) => {
      const del = db.prepare("DELETE FROM worlds WHERE id = ? AND owner_id = ?").run(req.params.wid, req.auth.user.id);
      if (del.changes) { db.prepare("DELETE FROM world_likes WHERE world_id = ?").run(req.params.wid); db.prepare("DELETE FROM world_reports WHERE world_id = ?").run(req.params.wid); }
      res.json({ status: "ok" });
    });

    // Ремикс: копия чужого (или своего) мира в свои — приватная, можно переделать под себя
    app.post("/api/worlds/:wid/copy", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      const n = (db.prepare("SELECT COUNT(*) AS n FROM worlds WHERE owner_id = ?").get(uid) as any).n;
      if (n >= MAX_WORLDS_PER_USER) return res.status(402).json({ error: "limit", message: `Не больше ${MAX_WORLDS_PER_USER} миров` });
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO worlds (id, owner_id, title, icon, genre, description, visibility, data, remixed_from) VALUES (?,?,?,?,?,?,'private',?,?)")
        .run(id, uid, `${w.title}${w.mine ? " (копия)" : ""}`.slice(0, 80), w.icon, w.genre, w.description, JSON.stringify(w.data), w.id);
      res.status(201).json(getForPlay(uid, id));
    });
  };

  return { register, getForPlay, countPlay };
}
