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
  `);

  const row2world = (r: any, userId?: string, full = true): World => ({
    id: r.id, title: r.title, icon: r.icon, genre: r.genre, description: r.description,
    visibility: r.visibility, version: r.version, plays: r.plays, updated_at: r.updated_at,
    author: r.author || undefined, mine: !!userId && r.owner_id === userId,
    data: full ? JSON.parse(r.data) : (() => { const d = JSON.parse(r.data); return { ...d, cards: [], core: "", counts: { cards: d.cards?.length || 0, locations: d.locations?.length || 0, scenarios: d.scenarios?.length || 0 } }; })(),
  });

  const SELECT = "SELECT w.*, u.name AS author FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";

  /** Мир, доступный пользователю для игры: свой, по ссылке или из каталога. */
  const getForPlay = (userId: string, id: string): World | null => {
    const r = db.prepare(`${SELECT} WHERE w.id = ?`).get(id) as any;
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

  const register = (app: Express, requireUser: any) => {
    app.get("/api/worlds", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const scope = req.query.scope === "public" ? "public" : "mine";
      const rows = scope === "mine"
        ? db.prepare(`${SELECT} WHERE w.owner_id = ? ORDER BY w.updated_at DESC`).all(uid)
        : db.prepare(`${SELECT} WHERE w.visibility = 'public' ORDER BY w.plays DESC, w.updated_at DESC LIMIT 100`).all();
      res.json((rows as any[]).map(r => row2world(r, uid, false)));
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
      db.prepare("UPDATE worlds SET title=?, icon=?, genre=?, description=?, visibility=?, data=?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(f.title, f.icon, f.genre, f.description, f.visibility, JSON.stringify(data), r.id);
      res.json(getForPlay(uid, r.id));
    });

    app.delete("/api/worlds/:wid", requireUser, (req: any, res) => {
      db.prepare("DELETE FROM worlds WHERE id = ? AND owner_id = ?").run(req.params.wid, req.auth.user.id);
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
