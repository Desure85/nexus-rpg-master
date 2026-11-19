// Миры игроков: создание, правка, доступ по ссылке и в каталоге, копия-ремикс.
import crypto from "crypto";
import type { Express } from "express";
import type { DB } from "./db";
import { normalizeWorldData, WORLD_GENRES, worldState, type World, type WorldDelta } from "../shared/world";

import { STARTER_WORLDS } from "./starter-worlds";

const MAX_WORLDS_PER_USER = 50;
/** Автор стартовых миров каталога */
export const SYSTEM_AUTHOR = "system-nexus";
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_chronicle (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      session_id TEXT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'game',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      heroes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_chronicle_world ON world_chronicle(world_id, status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_chronicle_session ON world_chronicle(session_id, title);
  `);
  const cols = (db.prepare("PRAGMA table_info(worlds)").all() as { name: string }[]).map(c => c.name);
  if (!cols.includes("likes")) db.exec("ALTER TABLE worlds ADD COLUMN likes INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("hidden")) db.exec("ALTER TABLE worlds ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("state")) db.exec("ALTER TABLE worlds ADD COLUMN state TEXT");
  const ccols = (db.prepare("PRAGMA table_info(world_chronicle)").all() as { name: string }[]).map(c => c.name);
  if (!ccols.includes("delta")) db.exec("ALTER TABLE world_chronicle ADD COLUMN delta TEXT");
  if (!ccols.includes("applied")) db.exec("ALTER TABLE world_chronicle ADD COLUMN applied INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("seed_hash")) db.exec("ALTER TABLE worlds ADD COLUMN seed_hash TEXT");
  // Стартовые миры каталога от автора «Nexus»: появляются при запуске, правка в коде обновляет данные (хроника и состояние остаются)
  if (process.env.STARTER_WORLDS !== "0") {
    db.prepare("INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, '')").run(SYSTEM_AUTHOR, "nexus@system.local", "Nexus");
    for (const w of STARTER_WORLDS) {
      const data = JSON.stringify(normalizeWorldData(w.data));
      const hash = crypto.createHash("sha1").update(JSON.stringify([w.title, w.icon, w.genre, w.description, data])).digest("hex");
      const cur = db.prepare("SELECT owner_id, seed_hash FROM worlds WHERE id = ?").get(w.id) as any;
      if (!cur) db.prepare("INSERT INTO worlds (id, owner_id, title, icon, genre, description, visibility, data, seed_hash) VALUES (?,?,?,?,?,?,'public',?,?)").run(w.id, SYSTEM_AUTHOR, w.title, w.icon, w.genre, w.description, data, hash);
      else if (cur.owner_id === SYSTEM_AUTHOR && cur.seed_hash !== hash) db.prepare("UPDATE worlds SET title=?, icon=?, genre=?, description=?, data=?, seed_hash=?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(w.title, w.icon, w.genre, w.description, data, hash, w.id);
    }
  }
  /** Сколько жалоб скрывают мир из каталога до решения модератора */
  const REPORTS_TO_HIDE = 3;

  const row2world = (r: any, userId?: string, full = true): World => ({
    id: r.id, title: r.title, icon: r.icon, genre: r.genre, description: r.description,
    visibility: r.visibility, version: r.version, plays: r.plays, likes: r.likes || 0, liked: !!r.liked, chronicle: r.chronicle || 0, ...(userId && r.owner_id === userId ? { chronicleNew: r.chronicle_new || 0 } : {}), hidden: !!r.hidden, updated_at: r.updated_at,
    author: r.author || undefined, ...(r.owner_id === SYSTEM_AUTHOR ? { official: true } : {}), mine: !!userId && r.owner_id === userId,
    ...(full ? { state: worldState(JSON.parse(r.data), r.state ? JSON.parse(r.state) : null) } : {}),
    data: full ? JSON.parse(r.data) : (() => { const d = JSON.parse(r.data); return { ...d, cards: [], core: "", counts: { cards: d.cards?.length || 0, locations: d.locations?.length || 0, scenarios: d.scenarios?.length || 0 } }; })(),
  });

  const SELECT = "SELECT w.*, u.name AS author FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
  /** Первый параметр запроса — id пользователя (для отметки «нравится») */
  const SELECT_FOR = "SELECT w.*, u.name AS author, (SELECT COUNT(*) FROM world_chronicle c WHERE c.world_id = w.id AND c.status = 'canon') AS chronicle, (SELECT COUNT(*) FROM world_chronicle c WHERE c.world_id = w.id AND c.status = 'new') AS chronicle_new, EXISTS(SELECT 1 FROM world_likes l WHERE l.world_id = w.id AND l.user_id = ?) AS liked FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
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
      const order = sort === "new" ? "w.created_at DESC" : sort === "likes" ? "w.likes DESC, w.plays DESC" : `(w.owner_id = '${SYSTEM_AUTHOR}') DESC, w.plays DESC, w.likes DESC`;
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

  /* ---------------------------------------- живой мир: хроника ---------------------------------------- */

  const livingMode = (worldId: string): "off" | "review" | "auto" => {
    const r = db.prepare("SELECT data FROM worlds WHERE id = ?").get(worldId) as any;
    if (!r) return "off";
    const m = JSON.parse(r.data).living;
    return m === "off" || m === "auto" ? m : "review";
  };

  /**
   * Запись хроники стала каноном → её сдвиги фракций и шкал применяются к общему состоянию мира (один раз).
   * Заполненная шкала даёт событие мира (по режиму мира — сразу канон или на проверку автору) и обнуляется.
   */
  const applyEntry = (entryId: string) => {
    const e = db.prepare("SELECT * FROM world_chronicle WHERE id = ?").get(entryId) as any;
    if (!e || e.applied || !e.delta || e.status !== "canon") return;
    const w = db.prepare("SELECT data, state FROM worlds WHERE id = ?").get(e.world_id) as any;
    if (!w) return;
    const data = JSON.parse(w.data);
    const st = worldState(data, w.state ? JSON.parse(w.state) : null);
    const delta: WorldDelta = JSON.parse(e.delta);
    for (const [k, v] of Object.entries(delta.factions || {})) if (k in st.factions) st.factions[k] = Math.max(-3, Math.min(3, st.factions[k] + Number(v)));
    const filled: string[] = [];
    for (const [k, v] of Object.entries(delta.clocks || {})) {
      const c = (data.clocks || []).find((x: any) => x.id === k);
      if (!c || !(k in st.clocks)) continue;
      st.clocks[k] = Math.max(0, st.clocks[k] + Number(v));
      if (st.clocks[k] >= c.max) { filled.push(k); st.clocks[k] = 0; }
    }
    db.prepare("UPDATE worlds SET state = ? WHERE id = ?").run(JSON.stringify(st), e.world_id);
    db.prepare("UPDATE world_chronicle SET applied = 1 WHERE id = ?").run(entryId);
    const mode = livingMode(e.world_id);
    for (const k of filled) {
      const c = (data.clocks || []).find((x: any) => x.id === k);
      db.prepare("INSERT INTO world_chronicle (id, world_id, session_id, user_id, kind, title, summary, status) VALUES (?, ?, NULL, ?, 'news', ?, ?, ?)")
        .run(crypto.randomUUID(), e.world_id, e.user_id, `Свершилось: ${c.name}`.slice(0, 120), (c.onFull || `Шкала «${c.name}» заполнилась — мир изменился.`).slice(0, 1200), mode === "auto" ? "canon" : "new");
    }
  };

  /**
   * После хода: партия в мире дошла до итогов (или сказка дописана) — событие в хронику мира.
   * Режим мира: off — не пишем, review — ждёт автора, auto — сразу канон.
   */
  const checkSession = (sessionId: string) => {
    const row = db.prepare("SELECT s.name, s.archive, s.config, s.mode, s.created_by, s.history FROM sessions s WHERE s.id = ?").get(sessionId) as any;
    if (!row) return null;
    const config = JSON.parse(row.config || "{}");
    const wid = config.world?.id;
    if (!wid || !row.archive) return null;
    const mode = livingMode(wid);
    if (mode === "off") return null;
    let title = "", summary = "";
    if (row.mode === "tale") {
      if (!config.tale?.finished) return null;
      title = `Сказка: ${row.archive.match(/^# (.+)$/m)?.[1] || row.name}`;
      summary = (row.archive.match(/\*([^*]{10,})\*\s*$/)?.[1] || row.archive.replace(/^#.*$/m, "")).trim();
    } else {
      const parts = String(row.archive).split(/# Итоги партии\s*/);
      if (parts.length < 2) return null;
      // короткая запись для летописи от мастера — если есть; иначе итоги целиком без разметки
      const chron = String(row.archive).split(/# Хроника мира\s*/);
      summary = (chron.length > 1 ? chron[chron.length - 1] : parts[parts.length - 1]).split(/\n---\n/)[0].trim();
      title = row.name;
    }
    summary = summary.replace(/^#+\s.*$/gm, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/^\s*\*\*?[^*\n]{0,80}\*\*?\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!summary) return null;
    const heroes = (config.heroes || []).map((h: any) => h.name).filter(Boolean).join(", ");
    const cid = crypto.randomUUID();
    const delta: WorldDelta | null = config.worldDelta && (Object.keys(config.worldDelta.factions || {}).length || Object.keys(config.worldDelta.clocks || {}).length) ? config.worldDelta : null;
    const res = db.prepare(`INSERT OR IGNORE INTO world_chronicle (id, world_id, session_id, user_id, kind, title, summary, heroes, status, delta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(cid, wid, sessionId, row.created_by || "", row.mode === "tale" ? "tale" : "game", title.slice(0, 120), summary.slice(0, 1200), heroes.slice(0, 200), mode === "auto" ? "canon" : "new", delta ? JSON.stringify(delta) : null);
    if (res.changes && mode === "auto") applyEntry(cid);
    return res.changes ? { worldId: wid, status: mode === "auto" ? "canon" : "new" } : null;
  };

  /** Канон хроники для промпта новой партии (последние события, кроме этой же партии). */
  const canonFor = (worldId: string, exceptSession?: string, limit = 6) =>
    db.prepare(`SELECT kind, title, summary, heroes, created_at FROM world_chronicle WHERE world_id = ? AND status = 'canon' AND (session_id IS NULL OR session_id != ?)
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(worldId, exceptSession || "", limit) as { kind: string; title: string; summary: string; heroes: string; created_at: string }[];

  const registerChronicle = (app: Express, requireUser: any) => {
    // Автор: ручная правка состояния мира (фракции −3..3, шкалы 0..max)
    app.patch("/api/worlds/:wid/state", requireUser, (req: any, res) => {
      const w = db.prepare("SELECT data, state FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, req.auth.user.id) as any;
      if (!w) return res.status(404).json({ error: "world_not_found" });
      const data = JSON.parse(w.data);
      const cur = worldState(data, w.state ? JSON.parse(w.state) : null);
      const next = worldState(data, { factions: { ...cur.factions, ...(req.body?.factions || {}) }, clocks: { ...cur.clocks, ...(req.body?.clocks || {}) } });
      db.prepare("UPDATE worlds SET state = ? WHERE id = ?").run(JSON.stringify(next), req.params.wid);
      res.json(next);
    });
    // Автору: сколько записей хроники ждут решения во всех его мирах
    app.get("/api/worlds/inbox", requireUser, (req: any, res) => {
      const n = (db.prepare("SELECT COUNT(*) AS n FROM world_chronicle c JOIN worlds w ON w.id = c.world_id WHERE w.owner_id = ? AND c.status = 'new'").get(req.auth.user.id) as any).n;
      res.json({ newEntries: n });
    });
    // Хроника: игроки видят канон и свои записи; автор — всё
    app.get("/api/worlds/:wid/chronicle", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      const rows = db.prepare(`SELECT c.id, c.kind, c.title, c.summary, c.heroes, c.status, c.created_at, c.user_id, c.delta, u.name AS player
        FROM world_chronicle c LEFT JOIN users u ON u.id = c.user_id WHERE c.world_id = ? ${w.mine ? "" : "AND (c.status = 'canon' OR c.user_id = ?)"} ORDER BY c.created_at DESC, c.rowid DESC LIMIT 100`)
        .all(...(w.mine ? [w.id] : [w.id, uid])) as any[];
      res.json(rows.map(({ user_id, delta, ...r }) => ({ ...r, mine: user_id === uid, ...(delta ? { delta: JSON.parse(delta) } : {}) })));
    });
    // Автор: принять в канон / скрыть
    app.patch("/api/worlds/:wid/chronicle/:cid", requireUser, (req: any, res) => {
      const own = db.prepare("SELECT 1 FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, req.auth.user.id);
      if (!own) return res.status(404).json({ error: "world_not_found" });
      const status = ["canon", "hidden", "new"].includes(req.body?.status) ? req.body.status : null;
      const summary = typeof req.body?.summary === "string" ? str(req.body.summary, 1200) : null;
      if (!status && summary === null) return res.status(400).json({ error: "nothing_to_change" });
      db.prepare(`UPDATE world_chronicle SET ${[status ? "status = @status" : "", summary !== null ? "summary = @summary" : ""].filter(Boolean).join(", ")} WHERE id = @id AND world_id = @wid`)
        .run({ status, summary, id: req.params.cid, wid: req.params.wid });
      if (status === "canon") applyEntry(req.params.cid);
      res.json({ status: "ok" });
    });
    // Автор: событие мира между партиями («Северный маяк снова горит») — сразу канон
    app.post("/api/worlds/:wid/chronicle", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const own = db.prepare("SELECT 1 FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, uid);
      if (!own) return res.status(404).json({ error: "world_not_found" });
      const title = str(req.body?.title, 120), summary = str(req.body?.summary, 1200);
      if (!title || !summary) return res.status(400).json({ error: "required", message: "Нужны заголовок и текст события" });
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO world_chronicle (id, world_id, session_id, user_id, kind, title, summary, status) VALUES (?, ?, NULL, ?, 'news', ?, ?, 'canon')").run(id, req.params.wid, uid, title, summary);
      res.status(201).json({ id });
    });
    app.delete("/api/worlds/:wid/chronicle/:cid", requireUser, (req: any, res) => {
      const own = db.prepare("SELECT 1 FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, req.auth.user.id);
      if (!own) return res.status(404).json({ error: "world_not_found" });
      db.prepare("DELETE FROM world_chronicle WHERE id = ? AND world_id = ?").run(req.params.cid, req.params.wid);
      res.json({ status: "ok" });
    });
  };

  return { register: (app: Express, requireUser: any) => { registerChronicle(app, requireUser); register(app, requireUser); }, getForPlay, countPlay, checkSession, canonFor };
}
