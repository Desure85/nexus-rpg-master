// Миры игроков: создание, правка, доступ по ссылке и в каталоге, копия-ремикс.
import crypto from "crypto";
import type { Express } from "express";
import type { DB } from "./db";
import { normalizeWorldData, WORLD_GENRES, worldState, npcKey, type World, type WorldDelta, type NpcMemory } from "../shared/world";
import { loadSession, lastDashboard } from "./store";

import { STARTER_WORLDS } from "./starter-worlds";
import { createBilling } from "./billing";

const MAX_WORLDS_PER_USER = 50;
/** Цена мира в кредитах и доля автора с продажи */
export const WORLD_MAX_PRICE = 5000;
export const authorShare = () => Math.min(1, Math.max(0, Number(process.env.WORLD_AUTHOR_SHARE ?? 0.7)));
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
  if (!cols.includes("price")) db.exec("ALTER TABLE worlds ADD COLUMN price INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("cover_v")) db.exec("ALTER TABLE worlds ADD COLUMN cover_v INTEGER NOT NULL DEFAULT 0");
  db.exec("CREATE TABLE IF NOT EXISTS world_covers (world_id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  if (!cols.includes("rating_sum")) db.exec("ALTER TABLE worlds ADD COLUMN rating_sum INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("rating_n")) db.exec("ALTER TABLE worlds ADD COLUMN rating_n INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_purchases (
      world_id TEXT NOT NULL, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      price INTEGER NOT NULL, author_share INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (world_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS world_plays (world_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (world_id, user_id));
    CREATE TABLE IF NOT EXISTS world_reviews (
      world_id TEXT NOT NULL, user_id TEXT NOT NULL, rating INTEGER NOT NULL, text TEXT NOT NULL DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (world_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_world_reviews ON world_reviews(world_id, updated_at);
  `);
  const billing = createBilling(db);
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
    ...market(r, userId),
    ...(full && !locked(r, userId) ? { state: worldState(JSON.parse(r.data), r.state ? JSON.parse(r.state) : null) } : {}),
    data: full && !locked(r, userId) ? JSON.parse(r.data) : preview(JSON.parse(r.data)),
  });
  /** Каталог и закрытый платный мир: без лора и канона, сюжеты и герои видны как витрина */
  const preview = (d: any) => ({ ...d, cards: [], core: "", tone: undefined, enemies: [], items: [], counts: { cards: d.cards?.length || 0, locations: d.locations?.length || 0, scenarios: d.scenarios?.length || 0, enemies: d.enemies?.length || 0, items: d.items?.length || 0 } });
  const locked = (r: any, userId?: string) => (r.price || 0) > 0 && r.owner_id !== userId && !r.owned;
  const market = (r: any, userId?: string) => ({
    price: r.price || 0,
    ...(r.cover_v ? { cover: `/api/worlds/${r.id}/cover?v=${r.cover_v}` } : {}),
    ...((r.price || 0) > 0 ? { owned: r.owner_id === userId || !!r.owned } : {}),
    ...(locked(r, userId) ? { locked: true } : {}),
    rating: r.rating_n ? Math.round((r.rating_sum / r.rating_n) * 10) / 10 : 0,
    reviews: r.rating_n || 0,
    ...(r.my_rating ? { myRating: r.my_rating } : {}),
    ...(r.played ? { played: true } : {}),
    ...(userId && r.owner_id === userId ? { sales: r.sales || 0, earned: r.earned || 0, ...(r.paid_copy ? { paidCopy: true } : {}) } : {}),
  });

  const SELECT = "SELECT w.*, u.name AS author FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
  /** Первый параметр запроса — id пользователя (для отметки «нравится») */
  const SELECT_FOR = "SELECT w.*, u.name AS author, (SELECT COUNT(*) FROM world_chronicle c WHERE c.world_id = w.id AND c.status = 'canon') AS chronicle, (SELECT COUNT(*) FROM world_chronicle c WHERE c.world_id = w.id AND c.status = 'new') AS chronicle_new, EXISTS(SELECT 1 FROM world_likes l WHERE l.world_id = w.id AND l.user_id = ?) AS liked, EXISTS(SELECT 1 FROM world_purchases p WHERE p.world_id = w.id AND p.user_id = ?) AS owned, EXISTS(SELECT 1 FROM world_plays pl WHERE pl.world_id = w.id AND pl.user_id = ?) AS played, (SELECT rating FROM world_reviews rv WHERE rv.world_id = w.id AND rv.user_id = ?) AS my_rating, (SELECT COUNT(*) FROM world_purchases p WHERE p.world_id = w.id) AS sales, (SELECT COALESCE(SUM(author_share), 0) FROM world_purchases p WHERE p.world_id = w.id) AS earned, (SELECT s.price > 0 AND s.owner_id != w.owner_id FROM worlds s WHERE s.id = w.remixed_from) AS paid_copy FROM worlds w LEFT JOIN users u ON u.id = w.owner_id";
  const U = (uid: string) => [uid, uid, uid, uid];
  const lc = (v: string) => v.toLowerCase().replace(/ё/g, "е");

  /** Мир, доступный пользователю для игры: свой, по ссылке или из каталога. */
  const getForPlay = (userId: string, id: string): World | null => {
    const r = db.prepare(`${SELECT_FOR} WHERE w.id = ?`).get(...U(userId), id) as any;
    if (!r) return null;
    if (r.owner_id !== userId && r.visibility === "private" && !r.owned) return null;
    return row2world(r, userId);
  };

  const countPlay = (id: string, userId?: string) => {
    db.prepare("UPDATE worlds SET plays = plays + 1 WHERE id = ?").run(id);
    if (userId) db.prepare("INSERT OR IGNORE INTO world_plays (world_id, user_id) VALUES (?, ?)").run(id, userId);
  };

  const fields = (b: any) => ({
    title: str(b?.title, 80) || "Новый мир",
    icon: str(b?.icon, 8) || "🌍",
    genre: WORLD_GENRES.some(g => g.id === b?.genre) ? b.genre : "fantasy",
    description: str(b?.description, 600),
    visibility: (VIS as readonly string[]).includes(b?.visibility) ? b.visibility : "private",
    price: Math.max(0, Math.min(WORLD_MAX_PRICE, Math.round(Number(b?.price) || 0))),
  });
  /** Копия чужого платного мира — только для себя: без публикации и без цены */
  const paidSource = (remixedFrom: string | null, ownerId: string) => {
    if (!remixedFrom) return false;
    const src = db.prepare("SELECT owner_id, price FROM worlds WHERE id = ?").get(remixedFrom) as any;
    return !!src && src.price > 0 && src.owner_id !== ownerId;
  };

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
        const rows = db.prepare(`${SELECT_FOR} WHERE w.owner_id = ? ORDER BY w.updated_at DESC`).all(...U(uid), uid);
        return res.json((rows as any[]).map(r => row2world(r, uid, false)));
      }
      // каталог: поиск по названию/описанию/автору, жанр, сортировка; скрытые модерацией не показываем
      const q = lc(str(req.query.q, 80));
      const genre = str(req.query.genre, 20);
      const sort = ["new", "likes", "rating"].includes(String(req.query.sort)) ? String(req.query.sort) : "popular";
      const order = sort === "new" ? "w.created_at DESC" : sort === "likes" ? "w.likes DESC, w.plays DESC"
        // по оценке: среднее с поправкой на число отзывов (3 «средних» голоса), чтобы одна пятёрка не обгоняла сотню четвёрок
        : sort === "rating" ? "(w.rating_sum + 3 * 3.5) / (w.rating_n + 3.0) DESC, w.plays DESC"
        : `(w.owner_id = '${SYSTEM_AUTHOR}') DESC, w.plays DESC, w.likes DESC`;
      const price = String(req.query.price || "");
      const priceSql = price === "free" ? "AND w.price = 0" : price === "paid" ? "AND w.price > 0" : price === "owned" ? "AND w.price > 0 AND EXISTS(SELECT 1 FROM world_purchases p WHERE p.world_id = w.id AND p.user_id = ?)" : "";
      let rows = db.prepare(`${SELECT_FOR} WHERE w.visibility = 'public' AND w.hidden = 0 ${genre ? "AND w.genre = ?" : ""} ${priceSql} ORDER BY ${order}, w.updated_at DESC LIMIT 500`).all(...U(uid), ...(genre ? [genre] : []), ...(price === "owned" ? [uid] : [])) as any[];
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
      if (f.price > 0 && f.visibility === "private") return res.status(400).json({ error: "not_ready", message: "Платный мир должен быть в каталоге или по ссылке" });
      db.prepare("INSERT INTO worlds (id, owner_id, title, icon, genre, description, visibility, price, data) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, uid, f.title, f.icon, f.genre, f.description, f.visibility, f.price, JSON.stringify(normalizeWorldData(req.body?.data)));
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
      if (paidSource(r.remixed_from, uid) && (f.visibility !== "private" || f.price > 0)) return res.status(400).json({ error: "paid_remix", message: "Это копия купленного мира — играть в ней можно, а публиковать и продавать нельзя" });
      if (f.price > 0 && f.visibility === "private" && !(db.prepare("SELECT 1 FROM world_purchases WHERE world_id = ?").get(r.id))) return res.status(400).json({ error: "not_ready", message: "Платный мир должен быть в каталоге или по ссылке" });
      db.prepare("UPDATE worlds SET title=?, icon=?, genre=?, description=?, visibility=?, price=?, data=?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(f.title, f.icon, f.genre, f.description, f.visibility, f.price, JSON.stringify(data), r.id);
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
      const sold = (db.prepare("SELECT COUNT(*) AS n FROM world_purchases p JOIN worlds w ON w.id = p.world_id WHERE w.id = ? AND w.owner_id = ?").get(req.params.wid, req.auth.user.id) as any).n;
      if (sold) return res.status(409).json({ error: "world_sold", message: `Этот мир купили игроки (${sold}) — удалить его нельзя. Можно убрать из каталога: доступ «По ссылке» или «Только я», купившие сохранят доступ.` });
      const del = db.prepare("DELETE FROM worlds WHERE id = ? AND owner_id = ?").run(req.params.wid, req.auth.user.id);
      if (del.changes) { db.prepare("DELETE FROM world_likes WHERE world_id = ?").run(req.params.wid); db.prepare("DELETE FROM world_reports WHERE world_id = ?").run(req.params.wid); db.prepare("DELETE FROM world_covers WHERE world_id = ?").run(req.params.wid); }
      res.json({ status: "ok" });
    });

    // Ремикс: копия чужого (или своего) мира в свои — приватная, можно переделать под себя
    /* ---------- маркетплейс: покупка за кредиты пространства, доля автору, отзывы ---------- */
    app.post("/api/worlds/:wid/buy", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w || (w.hidden && !w.mine)) return res.status(404).json({ error: "world_not_found" });
      if (!w.locked) return res.json(w); // свой, бесплатный или уже купленный
      const wsId = str(req.body?.workspaceId, 64);
      const m = db.prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?").get(wsId, uid) as any;
      if (!m || !["owner", "admin", "gm"].includes(m.role)) return res.status(403).json({ error: "forbidden", message: "Покупать можно за кредиты своего пространства" });
      const price = w.price!;
      const owner = (db.prepare("SELECT owner_id FROM worlds WHERE id = ?").get(w.id) as any).owner_id;
      // кошелёк автора — его личное пространство (где он владелец, самое старое)
      const authorWs = owner === SYSTEM_AUTHOR ? null : (db.prepare("SELECT workspace_id FROM memberships WHERE user_id = ? AND role = 'owner' ORDER BY created_at LIMIT 1").get(owner) as any)?.workspace_id;
      // защита от накрутки: доля автору — только с покупок пространств, которые хоть раз платили (не с приветственных кредитов фейков)
      const paidBuyer = !!db.prepare("SELECT 1 FROM payments WHERE workspace_id = ? AND status = 'succeeded' LIMIT 1").get(wsId);
      const share = authorWs && paidBuyer ? Math.floor(price * authorShare()) : 0;
      try {
        db.transaction(() => {
          const bal = (db.prepare("SELECT credits FROM workspaces WHERE id = ?").get(wsId) as any)?.credits ?? 0;
          if (bal < price) throw Object.assign(new Error("Не хватает кредитов"), { status: 402, code: "insufficient_credits" });
          db.prepare("INSERT INTO world_purchases (world_id, user_id, workspace_id, price, author_share) VALUES (?,?,?,?,?)").run(w.id, uid, wsId, price, share);
          billing.adjustCredits(wsId, -price, "world:buy", w.id);
          if (share) billing.adjustCredits(authorWs, share, "world:sale", w.id);
        })();
      } catch (e: any) {
        if (e?.code === "insufficient_credits") return res.status(402).json({ error: "insufficient_credits", message: `Не хватает кредитов: мир стоит ${price}` });
        if (/UNIQUE|PRIMARY/i.test(String(e?.message))) return res.json(getForPlay(uid, w.id));
        throw e;
      }
      res.json(getForPlay(uid, w.id));
    });

    app.get("/api/worlds/:wid/reviews", requireUser, (req: any, res) => {
      const w = getForPlay(req.auth.user.id, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      res.json(db.prepare(`SELECT r.user_id AS userId, u.name AS author, r.rating, r.text, r.updated_at,
          EXISTS(SELECT 1 FROM world_purchases p WHERE p.world_id = r.world_id AND p.user_id = r.user_id) AS bought
        FROM world_reviews r LEFT JOIN users u ON u.id = r.user_id WHERE r.world_id = ? ORDER BY (r.user_id = ?) DESC, r.updated_at DESC LIMIT 50`)
        .all(w.id, req.auth.user.id).map((r: any) => ({ ...r, bought: !!r.bought, mine: r.userId === req.auth.user.id })));
    });

    const recountRating = (wid: string) => db.prepare("UPDATE worlds SET rating_sum = (SELECT COALESCE(SUM(rating), 0) FROM world_reviews WHERE world_id = ?), rating_n = (SELECT COUNT(*) FROM world_reviews WHERE world_id = ?) WHERE id = ?").run(wid, wid, wid);

    app.put("/api/worlds/:wid/review", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      if (w.mine) return res.status(400).json({ error: "own_world", message: "Свой мир оценивать нельзя" });
      if (!w.played) return res.status(403).json({ error: "not_played", message: "Оставить отзыв можно после игры в этом мире" });
      const rating = Math.round(Number(req.body?.rating));
      if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: "bad_rating", message: "Оценка — от 1 до 5" });
      const text = str(req.body?.text, 500);
      db.prepare(`INSERT INTO world_reviews (world_id, user_id, rating, text) VALUES (?,?,?,?)
        ON CONFLICT(world_id, user_id) DO UPDATE SET rating = excluded.rating, text = excluded.text, updated_at = CURRENT_TIMESTAMP`).run(w.id, uid, rating, text);
      recountRating(w.id);
      res.json(getForPlay(uid, w.id));
    });

    // свой отзыв удаляет автор отзыва, любой — суперадмин (модерация)
    app.delete("/api/worlds/:wid/reviews/:uid", requireUser, (req: any, res) => {
      const me = req.auth.user;
      if (req.params.uid !== me.id && !me.isSuperadmin) return res.status(403).json({ error: "forbidden" });
      db.prepare("DELETE FROM world_reviews WHERE world_id = ? AND user_id = ?").run(req.params.wid, req.params.uid);
      recountRating(req.params.wid);
      res.json({ ok: true });
    });

    /* ---------- обложка: JPEG/PNG/WebP до 400 КБ, клиент заранее ужимает до 1280×720 ---------- */
    const COVER_MAX = 400 * 1024;
    const sniff = (b: Uint8Array) =>
      b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? "image/jpeg"
      : b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? "image/png"
      : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 ? "image/webp"
      : null;
    app.get("/api/worlds/:wid/cover", requireUser, (req: any, res) => {
      const w = getForPlay(req.auth.user.id, req.params.wid); // обложку видит тот, кто видит мир (и витрину платного)
      const row = w ? db.prepare("SELECT mime, data FROM world_covers WHERE world_id = ?").get(w.id) as any : null;
      if (!row) return res.status(404).json({ error: "no_cover" });
      res.setHeader("Content-Type", row.mime);
      res.setHeader("Cache-Control", "private, max-age=86400"); // в адресе ?v= — новая обложка придёт по новому адресу
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.end(row.data);
    });
    app.put("/api/worlds/:wid/cover", requireUser, (req: any, res) => {
      const r = db.prepare("SELECT id FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, req.auth.user.id) as any;
      if (!r) return res.status(404).json({ error: "world_not_found" });
      const m = String(req.body?.data || "").match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || typeof Buffer === "undefined") return res.status(400).json({ error: "bad_image", message: "Нужна картинка JPEG, PNG или WebP" });
      const bytes = Buffer.from(m[1], "base64");
      if (bytes.length > COVER_MAX) return res.status(413).json({ error: "too_large", message: "Обложка больше 400 КБ — выберите картинку поменьше" });
      const mime = sniff(bytes); // доверяем байтам, а не заявленному типу
      if (!mime) return res.status(400).json({ error: "bad_image", message: "Нужна картинка JPEG, PNG или WebP" });
      db.prepare("INSERT INTO world_covers (world_id, mime, data) VALUES (?,?,?) ON CONFLICT(world_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = CURRENT_TIMESTAMP").run(r.id, mime, bytes);
      db.prepare("UPDATE worlds SET cover_v = cover_v + 1 WHERE id = ?").run(r.id);
      res.json(getForPlay(req.auth.user.id, r.id));
    });
    app.delete("/api/worlds/:wid/cover", requireUser, (req: any, res) => {
      const r = db.prepare("SELECT id FROM worlds WHERE id = ? AND owner_id = ?").get(req.params.wid, req.auth.user.id) as any;
      if (!r) return res.status(404).json({ error: "world_not_found" });
      db.prepare("DELETE FROM world_covers WHERE world_id = ?").run(r.id);
      db.prepare("UPDATE worlds SET cover_v = 0 WHERE id = ?").run(r.id);
      res.json(getForPlay(req.auth.user.id, r.id));
    });

    app.post("/api/worlds/:wid/copy", requireUser, (req: any, res) => {
      const uid = req.auth.user.id;
      const w = getForPlay(uid, req.params.wid);
      if (!w) return res.status(404).json({ error: "world_not_found" });
      if (w.locked) return res.status(402).json({ error: "world_locked", message: "Сначала купите мир" });
      const n = (db.prepare("SELECT COUNT(*) AS n FROM worlds WHERE owner_id = ?").get(uid) as any).n;
      if (n >= MAX_WORLDS_PER_USER) return res.status(402).json({ error: "limit", message: `Не больше ${MAX_WORLDS_PER_USER} миров` });
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO worlds (id, owner_id, title, icon, genre, description, visibility, data, remixed_from) VALUES (?,?,?,?,?,?,'private',?,?)")
        .run(id, uid, `${w.title}${w.mine ? " (копия)" : ""}`.slice(0, 80), w.icon, w.genre, w.description, JSON.stringify(w.data), w.id);
      if (db.prepare("INSERT INTO world_covers (world_id, mime, data) SELECT ?, mime, data FROM world_covers WHERE world_id = ?").run(id, w.id).changes)
        db.prepare("UPDATE worlds SET cover_v = 1 WHERE id = ?").run(id);
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

  /* ---------- память NPC: кого игрок встречал в мире, что с ними и как они относятся к героям ---------- */
  db.exec(`CREATE TABLE IF NOT EXISTS world_npc_memory (
    world_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', level INTEGER NOT NULL DEFAULT 0, hero TEXT NOT NULL DEFAULT '',
    sessions INTEGER NOT NULL DEFAULT 1, last_session TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (world_id, user_id, key)
  )`);
  const NPC_MEMORY_LIMIT = 40;

  /** После хода: NPC из кодекса и отношения героев попадают в память игрока о мире. Без вызова ИИ. */
  const rememberSession = (sessionId: string) => {
    const s = loadSession(db, sessionId);
    const wid = s?.config.world?.id;
    const uid = (db.prepare("SELECT created_by FROM sessions WHERE id = ?").get(sessionId) as any)?.created_by;
    if (!s || !wid || !uid || s.config.tutorial) return 0;
    const dash = lastDashboard(s.history);
    const found = new Map<string, { name: string; description: string; status: string; level: number; hero: string }>();
    for (const c of s.codex || []) {
      if (c.type !== "npc" || !npcKey(c.name)) continue;
      found.set(npcKey(c.name), { name: c.name.slice(0, 60), description: String(c.description || "").slice(0, 300), status: String(c.status || "").slice(0, 160), level: 0, hero: "" });
    }
    for (const ch of dash.characters || []) for (const r of ch.relationships || []) {
      const k = npcKey(r.target);
      if (!k || Number.isNaN(Number(r.level))) continue;
      const lvl = Math.max(-10, Math.min(10, Math.round(Number(r.level))));
      const cur = found.get(k) || { name: String(r.target).slice(0, 60), description: "", status: "", level: 0, hero: "" };
      if (Math.abs(lvl) >= Math.abs(cur.level)) { cur.level = lvl; cur.hero = ch.name; }
      if (r.status && !cur.status.includes(String(r.status))) cur.status = [cur.status, String(r.status)].filter(Boolean).join("; ").slice(0, 160);
      found.set(k, cur);
    }
    if (!found.size) return 0;
    const existing = db.prepare("SELECT key FROM world_npc_memory WHERE world_id = ? AND user_id = ?").all(wid, uid) as { key: string }[];
    // «Борн» и «Борн Медяк» — один NPC: короткое имя прилипает к уже известному полному и наоборот
    const match = (k: string) => existing.find(e => e.key === k || e.key.startsWith(k + " ") || k.startsWith(e.key + " "))?.key || k;
    const up = db.prepare(`INSERT INTO world_npc_memory (world_id, user_id, key, name, description, status, level, hero, sessions, last_session) VALUES (?,?,?,?,?,?,?,?,1,?)
      ON CONFLICT(world_id, user_id, key) DO UPDATE SET
        name = CASE WHEN length(excluded.name) > length(name) THEN excluded.name ELSE name END,
        description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
        status = CASE WHEN excluded.status != '' THEN excluded.status ELSE status END,
        level = CASE WHEN excluded.hero != '' THEN excluded.level ELSE level END,
        hero = CASE WHEN excluded.hero != '' THEN excluded.hero ELSE hero END,
        sessions = sessions + (CASE WHEN last_session IS NOT excluded.last_session THEN 1 ELSE 0 END),
        last_session = excluded.last_session, updated_at = CURRENT_TIMESTAMP`);
    db.transaction(() => {
      for (const [k, n] of found) up.run(wid, uid, match(k), n.name, n.description, n.status, n.level, n.hero, sessionId);
      db.prepare(`DELETE FROM world_npc_memory WHERE world_id = ? AND user_id = ? AND key NOT IN (
        SELECT key FROM world_npc_memory WHERE world_id = ? AND user_id = ? ORDER BY updated_at DESC, abs(level) DESC LIMIT ${NPC_MEMORY_LIMIT})`).run(wid, uid, wid, uid);
    })();
    return found.size;
  };

  /** Знакомые NPC для новой партии: сначала сильные отношения, потом недавние. */
  const npcMemoryFor = (worldId: string, userId: string, limit = 8): NpcMemory[] =>
    (db.prepare(`SELECT name, description, status, level, hero, sessions, updated_at FROM world_npc_memory WHERE world_id = ? AND user_id = ?
      ORDER BY (abs(level) >= 3) DESC, updated_at DESC, abs(level) DESC LIMIT ?`).all(worldId, userId, limit) as any[])
      .map(r => ({ name: r.name, description: r.description, status: r.status, level: r.level, hero: r.hero, sessions: r.sessions, updatedAt: r.updated_at }));

  /** Канон хроники для промпта новой партии (последние события, кроме этой же партии). */
  const canonFor = (worldId: string, exceptSession?: string, limit = 6) =>
    db.prepare(`SELECT kind, title, summary, heroes, created_at FROM world_chronicle WHERE world_id = ? AND status = 'canon' AND (session_id IS NULL OR session_id != ?)
      ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(worldId, exceptSession || "", limit) as { kind: string; title: string; summary: string; heroes: string; created_at: string }[];

  const registerChronicle = (app: Express, requireUser: any) => {
    // Память игрока о мире: кого он встречал. Только своё — у каждого игрока своя память.
    app.get("/api/worlds/:wid/memory", requireUser, (req: any, res) => res.json(npcMemoryFor(req.params.wid, req.auth.user.id, NPC_MEMORY_LIMIT)));
    app.delete("/api/worlds/:wid/memory", requireUser, (req: any, res) => {
      const name = typeof req.query.name === "string" ? npcKey(req.query.name) : "";
      const r = name ? db.prepare("DELETE FROM world_npc_memory WHERE world_id = ? AND user_id = ? AND key = ?").run(req.params.wid, req.auth.user.id, name)
        : db.prepare("DELETE FROM world_npc_memory WHERE world_id = ? AND user_id = ?").run(req.params.wid, req.auth.user.id);
      res.json({ removed: r.changes });
    });

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

  return { register: (app: Express, requireUser: any) => { registerChronicle(app, requireUser); register(app, requireUser); }, getForPlay, countPlay, checkSession, canonFor, rememberSession, npcMemoryFor };
}
