import express, { type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { openDatabase, deleteSessionCascade, type DB } from "./db";
import { registerGameRoutes } from "./game";
import { Engine } from "./engine";
import { completeWithUsage, describeProvider, LlmError } from "./llm";
import { authMiddleware, csrfGuard, requireUser, requireSuperadmin, rateLimit, securityHeaders } from "./security";
import { initSecret } from "./crypto";
import { createBilling, registerBillingRoutes, effectivePlan, PLANS, BillingError, paymentsProvider } from "./billing";
import { createTenancy, registerTenancyRoutes, registrationMode } from "./tenancy";
import { mailConfigured } from "./mailer";
import {
  loadSession, saveSession, publicSession, sessionSummary, lastDashboard, readSettings, settingsForClient, writeSettings, mergeMechanics,
  type SessionConfig, type StoredSession,
} from "./store";
import { buildGameStartPrompt, buildTaleStartPrompt, TALE_AGES, INITIAL_DASHBOARD, type TaleAge } from "../shared/rules";
import { rollTag, ROLL_TYPES, type RollType } from "../shared/dice";
import { tablesFor, MAX_ROWS as ORACLE_MAX_ROWS } from "./oracle";

export interface AppOptions {
  dbPath?: string;
  db?: DB;
  /** Каталог собранного фронтенда (prod). Если не задан и NODE_ENV!=production — подключается Vite dev-middleware. */
  staticDir?: string;
  vite?: boolean;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const MAX_CHARACTERS = 8;

export async function createApp(opts: AppOptions = {}) {
  const dbPath = opts.dbPath || process.env.DB_PATH || "game.db";
  const db = opts.db || openDatabase(dbPath);
  initSecret(opts.db ? ":memory:" : dbPath);
  const billing = createBilling(db);
  const tenancy = createTenancy(db, billing);
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
  const server: Server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  app.use(securityHeaders);
  app.use(express.json({ limit: "2mb" }));
  app.use(authMiddleware(db));
  app.use(csrfGuard);

  // ------------------------------- WebSocket -------------------------------
  const rooms = new Map<string, Set<WebSocket>>();
  const alive = new WeakMap<WebSocket, boolean>();

  const broadcast = (roomId: string, data: any) => {
    const clients = rooms.get(roomId);
    if (!clients) return;
    const msg = JSON.stringify(data);
    for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };

  wss.on("connection", ws => {
    let room: string | null = null;
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", raw => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data?.type === "join" && typeof data.sessionId === "string") {
        const exists = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(data.sessionId);
        if (!exists) return;
        if (room) rooms.get(room)?.delete(ws);
        room = data.sessionId;
        if (!rooms.has(room!)) rooms.set(room!, new Set());
        rooms.get(room!)!.add(ws);
        ws.send(JSON.stringify({ type: "joined", sessionId: room, busy: engine.isBusy(room!) }));
      }
    });
    ws.on("close", () => {
      if (room && rooms.has(room)) {
        rooms.get(room)!.delete(ws);
        if (rooms.get(room)!.size === 0) rooms.delete(room);
      }
    });
    ws.on("error", () => ws.terminate());
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();

  // ------------------------------- служебное -------------------------------
  app.get("/api/health", (_req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", uptime: Math.round(process.uptime()) });
    } catch (e) {
      res.status(503).json({ status: "db_error" });
    }
  });

  app.get("/api/config", (req, res) => {
    res.json({
      registration: registrationMode(),
      mail: mailConfigured(),
      disclaimer: { extra: process.env.DISCLAIMER_EXTRA || "", url: process.env.TERMS_URL || "" },
      payments: paymentsProvider(),
      llm: describeProvider(readSettings(db).llm),
      taleAges: TALE_AGES,
      user: req.auth.user || null,
    });
  });

  const byUser = (req: Request) => req.auth.user?.id || req.ip || "anon";
  const llmLimiter = rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN || 30), key: byUser });
  const createLimiter = rateLimit({ windowMs: 60 * 60_000, max: Number(process.env.SESSIONS_PER_HOUR || 30), key: byUser });

  registerTenancyRoutes(app, db, tenancy, billing);
  registerBillingRoutes(app, db, billing, tenancy.requireWsRole);

  // ------------------------------- сессии -------------------------------
  let engine!: Engine;

  app.get("/api/workspaces/:wid/sessions", requireUser, tenancy.requireWsRole("gm"), (req, res) => {
    const role = (req as any).wsRole;
    const mineOnly = req.query.mine === "1";
    const rows = db.prepare(`SELECT s.id, u.name AS author FROM sessions s LEFT JOIN users u ON u.id = s.created_by
      WHERE s.workspace_id = ? ${mineOnly ? "AND s.created_by = ?" : ""} ORDER BY s.updated_at DESC LIMIT 300`)
      .all(...(mineOnly ? [req.params.wid, req.auth.user!.id] : [req.params.wid])) as any[];
    res.json(rows.map(r => {
      const s = loadSession(db, r.id)!;
      const canManage = s.created_by === req.auth.user!.id || tenancy.roleAtLeast(role, "admin");
      return { ...sessionSummary(s, engine.isBusy(r.id)), author: r.author, canManage };
    }));
  });

  app.post("/api/sessions", requireUser, createLimiter, (req, res) => {
    const workspaceId = str(req.body?.workspaceId, 64);
    const m = tenancy.membership(workspaceId, req.auth.user!.id);
    if (!m && !req.auth.user!.isSuperadmin) return res.status(403).json({ error: "forbidden", message: "Нет доступа к пространству" });
    const ws = billing.getWs(workspaceId);
    if (!ws) return res.status(404).json({ error: "workspace_not_found" });
    const limits = PLANS[effectivePlan(ws)];
    const count = (db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?").get(workspaceId) as any).n;
    if (count >= limits.maxSessions) return res.status(402).json({ error: "plan_limit", message: `На тарифе «${limits.title}» не больше ${limits.maxSessions} сессий. Удалите старые или оформите подписку.` });
    try { billing.assertCanSpend(workspaceId, tenancy.resolveLlm(workspaceId).mode); }
    catch (e) { if (e instanceof BillingError) return res.status(e.status).json({ error: e.code, message: e.message }); throw e; }
    const setup = req.body?.setup || {};
    const mode: StoredSession["mode"] = ["short", "campaign", "tale"].includes(setup.mode) ? setup.mode : "short";
    const setting = str(setup.setting, 2000).trim();
    const plotHook = str(setup.plotHook, 2000).trim();
    const style = ["narrative", "balanced", "combat", "fairytale"].includes(setup.style) ? setup.style : mode === "tale" ? "fairytale" : "balanced";
    const characters = (Array.isArray(setup.characters) ? setup.characters : [])
      .map((c: any) => ({ name: str(c?.name, 60).trim(), concept: str(c?.concept, 300).trim(), gender: c?.gender === "Ж" ? "Ж" : "М" }))
      .filter((c: any) => c.name)
      .slice(0, MAX_CHARACTERS);
    if (characters.length > limits.maxHeroes) return res.status(402).json({ error: "plan_limit", message: `На тарифе «${limits.title}» — до ${limits.maxHeroes} героев` });
    if (!setting) return res.status(400).json({ error: "setting_required", message: "Укажите сеттинг" });
    if (!characters.length) return res.status(400).json({ error: "characters_required", message: "Добавьте хотя бы одного героя" });
    if (new Set(characters.map((c: any) => c.name)).size !== characters.length) return res.status(400).json({ error: "duplicate_names", message: "Имена героев должны различаться" });

    const cfgIn = req.body?.config || {};
    const config: SessionConfig = {
      mechanics: Array.isArray(cfgIn.mechanics) ? mergeMechanics(cfgIn.mechanics) : undefined,
      systemPrompt: typeof cfgIn.systemPrompt === "string" && cfgIn.systemPrompt.trim() ? cfgIn.systemPrompt.slice(0, 50_000) : undefined,
      idlePlayerAction: ["random", "skip", "gm"].includes(cfgIn.idlePlayerAction) ? cfgIn.idlePlayerAction : undefined,
      autoApprove: !!cfgIn.autoApprove,
    };
    if (mode === "tale") {
      const age: TaleAge = TALE_AGES.some(a => a.id === setup.tale?.age) ? setup.tale.age : "6-8";
      const chapters = Math.min(15, Math.max(3, Number(setup.tale?.chapters) || 6));
      config.tale = { age, chapters, moral: str(setup.tale?.moral, 200).trim() || undefined };
    }
    const id = crypto.randomUUID();
    const name = (mode === "tale" ? "Сказка: " : "") + (setting.split(/[.,;\n]/)[0].slice(0, 60) || "Новое приключение");
    const lore = mode === "tale" ? "" : `Сеттинг: ${setting}\nЗавязка: ${plotHook}\nСтиль: ${style}`;
    // В сказке нет игрового дашборда от ИИ — заводим героев сразу, чтобы друзья могли занять их по ссылке
    const initialHistory = mode === "tale"
      ? [{ role: "system", content: "Герои сказки", dashboard: { ...structuredClone(INITIAL_DASHBOARD), atmosphere: "", characters: characters.map((c: any) => ({ name: c.name, hp: "", stress: 0, tokens: 0, condition: "", goal: c.concept })) } }]
      : [];
    db.prepare(`INSERT INTO sessions (id, name, genre, setting, style, snapshot, history, lore, codex, archive, mode, workspace_id, created_by, config)
      VALUES (?, ?, 'Custom', ?, ?, '', ?, ?, '[]', '', ?, ?, ?, ?)`)
      .run(id, name, setting, style, JSON.stringify(initialHistory), lore, mode, workspaceId, req.auth.user!.id, JSON.stringify(config));
    const prompt = mode === "tale" ? buildTaleStartPrompt(setting, plotHook, characters) : buildGameStartPrompt(setting, plotHook, style, characters);
    engine.enqueueTurn(id, prompt);
    res.status(201).json(publicSession(loadSession(db, id)!, true, true));
  });

  app.post("/api/generate", requireUser, llmLimiter, async (req, res) => {
    const prompt = str(req.body?.prompt, 2000);
    const workspaceId = str(req.body?.workspaceId, 64);
    if (!prompt.trim()) return res.status(400).json({ error: "prompt_required" });
    if (!tenancy.membership(workspaceId, req.auth.user!.id) && !req.auth.user!.isSuperadmin) return res.status(403).json({ error: "forbidden" });
    const { llm, mode } = tenancy.resolveLlm(workspaceId);
    try {
      billing.assertCanSpend(workspaceId, mode);
      const r = await completeWithUsage(llm, {
        system: "Ты креативный помощник для настольных ролевых игр и сказок. Отвечай кратко, ёмко и атмосферно, на русском. Не используй markdown.",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.9,
        maxTokens: 400,
      });
      billing.recordUsage({ workspaceId, userId: req.auth.user!.id, kind: "generate", mode, llm, usage: r.usage });
      res.json({ text: r.text });
    } catch (e: any) {
      const status = e instanceof BillingError || e instanceof LlmError ? e.status : 502;
      res.status(status).json({ error: e?.code || "llm_error", message: e?.message });
    }
  });

  // Политика доступа к /api/sessions/:id/* :
  //  GET — по ссылке (UUID сессии — секрет приглашения);
  //  claim/actions/roll — игрок (секрет устройства);
  //  всё остальное — только мастер, и изменения истории идут через очередь сессии.
  const PLAYER_ROUTES = /^\/(claim|actions|use)\/?$/;
  const UNLOCKED_ROUTES = /^\/(turn|commit|travel|explore|oracle\/generate)\/?$/;
  app.use("/api/sessions/:id", (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id;
    const row = db.prepare("SELECT workspace_id, created_by FROM sessions WHERE id = ?").get(id) as { workspace_id: string | null; created_by: string | null } | undefined;
    if (!row) return res.status(404).json({ error: "session_not_found", message: "Сессия не найдена" });
    const user = req.auth.user;
    const role = user && row.workspace_id ? tenancy.membership(row.workspace_id, user.id)?.role : undefined;
    // мастер сессии — её автор, админ/владелец пространства или суперадмин
    (req as any).isOwner = !!user && (user.isSuperadmin || (!!role && (row.created_by === user.id || tenancy.roleAtLeast(role, "admin"))));
    if (req.method === "GET" || req.method === "HEAD" || PLAYER_ROUTES.test(req.path)) return next();
    if (!(req as any).isOwner) return res.status(403).json({ error: "owner_required", message: "Это действие доступно только мастеру сессии" });
    if (UNLOCKED_ROUTES.test(req.path)) return next();
    engine.withLock(id, () => new Promise<void>(resolve => {
      res.on("finish", resolve);
      res.on("close", resolve);
      next();
    }));
  });

  app.get("/api/sessions/:id", (req, res) => {
    const s = loadSession(db, req.params.id)!;
    res.json(publicSession(s, (req as any).isOwner, engine.isBusy(s.id)));
  });

  app.delete("/api/sessions/:id", (req, res) => {
    deleteSessionCascade(db, req.params.id);
    broadcast(req.params.id, { type: "deleted", sessionId: req.params.id });
    res.json({ status: "ok" });
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const s = loadSession(db, req.params.id)!;
    if (typeof req.body?.name === "string" && req.body.name.trim()) s.name = req.body.name.trim().slice(0, 120);
    const c = req.body?.config;
    if (c && typeof c === "object") {
      if (Array.isArray(c.mechanics)) s.config.mechanics = mergeMechanics(c.mechanics);
      if (typeof c.systemPrompt === "string") s.config.systemPrompt = c.systemPrompt.slice(0, 50_000) || undefined;
      if (["random", "skip", "gm"].includes(c.idlePlayerAction)) s.config.idlePlayerAction = c.idlePlayerAction;
      if (typeof c.autoApprove === "boolean") s.config.autoApprove = c.autoApprove;
    }
    saveSession(db, s);
    broadcast(s.id, { type: "update", sessionId: s.id });
    res.json(publicSession(s, true, engine.isBusy(s.id)));
  });

  // Ручная правка дашборда мастером: синхронизируем движковые числа, чтобы следующий ход их не откатил
  app.post("/api/sessions/:id/dashboard", (req, res) => {
    const dash = req.body?.dashboard;
    if (!dash || typeof dash !== "object" || !Array.isArray(dash.characters)) return res.status(400).json({ error: "dashboard_required" });
    const s = loadSession(db, req.params.id)!;
    let idx = -1;
    for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].dashboard) { idx = i; break; }
    if (idx >= 0) s.history[idx] = { ...s.history[idx], dashboard: dash };
    else s.history.push({ role: "system", content: "Manual Dashboard Update", dashboard: dash });
    const chars = gameApi.ensureEngineState(s.id);
    for (const c of dash.characters) {
      const m = String(c.hp || "").match(/(\d+)\s*\/\s*(\d+)/);
      const prev = chars[c.name] || { status: "active" };
      chars[c.name] = {
        ...prev,
        hp_cur: m ? +m[1] : prev.hp_cur ?? 0, hp_max: m ? +m[2] : prev.hp_max ?? 0,
        stress: parseInt(String(c.stress)) || 0, gold: Number(c.gold) || 0, xp: Number(c.xp) || 0, tokens: Number(c.tokens) || 0,
      };
    }
    for (const name of Object.keys(chars)) if (!dash.characters.some((c: any) => c.name === name)) delete chars[name];
    gameApi.saveEngineState(s.id, chars);
    saveSession(db, s);
    broadcast(s.id, { type: "update", sessionId: s.id });
    res.json({ status: "ok" });
  });

  app.post("/api/sessions/:id/turn", llmLimiter, (req, res) => {
    const s = loadSession(db, req.params.id)!;
    const content = str(req.body?.content, 8000);
    const rolls = (Array.isArray(req.body?.rolls) ? req.body.rolls : []).map((r: any) => str(r, 500)).filter(Boolean).slice(0, MAX_CHARACTERS);
    if (!content.trim() && !rolls.length && s.history[s.history.length - 1]?.role !== "user") {
      return res.status(400).json({ error: "empty_turn", message: "Пустой ход" });
    }
    if (s.mode === "tale" && s.config.tale?.finished) return res.status(409).json({ error: "tale_finished", message: "Сказка уже закончена" });
    engine.enqueueTurn(s.id, content, { rolls });
    res.status(202).json({ status: "queued" });
  });

  app.post("/api/sessions/:id/commit", llmLimiter, async (req, res) => {
    const count = (db.prepare("SELECT COUNT(*) AS n FROM pending_actions WHERE session_id = ?").get(req.params.id) as any).n;
    if (!count) return res.json({ status: "ok", committed: 0 });
    engine.commitRound(req.params.id);
    res.status(202).json({ status: "queued", committed: count });
  });

  // ------------------------------- мультиплеер -------------------------------
  const sanitizeClaim = (c: any, deviceId?: string) => ({
    id: c.id, char_name: c.char_name, player_name: c.player_name, status: c.status, created_at: c.created_at,
    mine: !!deviceId && c.device_id === deviceId,
  });

  app.post("/api/sessions/:id/claim", (req, res) => {
    const deviceId = req.auth.deviceId;
    const charName = str(req.body?.charName, 60);
    const playerName = str(req.body?.playerName, 40).trim();
    if (!deviceId) return res.status(400).json({ error: "device_required", message: "Нет идентификатора устройства" });
    if (!charName || !playerName) return res.status(400).json({ error: "charName/playerName required" });
    const s = loadSession(db, req.params.id)!;
    const dash = lastDashboard(s.history);
    if (!dash.characters?.some(c => c.name === charName)) return res.status(404).json({ error: "character_not_found", message: "Такого персонажа нет в сессии" });
    const claims = db.prepare("SELECT * FROM claims WHERE session_id = ? AND char_name = ? AND status IN ('approved','pending') ORDER BY created_at DESC").all(req.params.id, charName) as any[];
    const other = claims.find(c => c.status === "approved" && c.device_id !== deviceId);
    if (other) return res.status(409).json({ error: "claimed_by_other", claim: sanitizeClaim(other, deviceId) });
    const mine = claims.find(c => c.device_id === deviceId);
    if (mine) return res.json({ status: mine.status, claim: sanitizeClaim(mine, deviceId) });
    const id = crypto.randomUUID();
    const approvedCount = (db.prepare("SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND status = 'approved'").get(req.params.id) as any).n;
    const maxPlayers = PLANS[effectivePlan(billing.getWs(String(s.workspace_id)))].maxPlayers;
    const status = s.config.autoApprove && approvedCount < maxPlayers ? "approved" : "pending";
    db.prepare("INSERT INTO claims (id, session_id, char_name, player_name, device_id, status) VALUES (?,?,?,?,?,?)")
      .run(id, req.params.id, charName, playerName, deviceId, status);
    broadcast(req.params.id, { type: "claims_changed", sessionId: req.params.id });
    res.json({ status, claim: { id, char_name: charName, player_name: playerName, status, mine: true } });
  });

  app.get("/api/sessions/:id/claims", (req, res) => {
    const rows = db.prepare("SELECT * FROM claims WHERE session_id = ? ORDER BY created_at ASC").all(req.params.id) as any[];
    res.json(rows.map(c => sanitizeClaim(c, req.auth.deviceId)));
  });

  const setClaimStatus = (status: "approved" | "rejected" | "released") => (req: Request, res: Response) => {
    const c = db.prepare("SELECT * FROM claims WHERE id = ? AND session_id = ?").get(req.params.cid, req.params.id) as any;
    if (!c) return res.status(404).json({ error: "claim_not_found" });
    if (status === "approved") {
      const s = loadSession(db, c.session_id)!;
      const maxPlayers = PLANS[effectivePlan(billing.getWs(String(s.workspace_id)))].maxPlayers;
      const approved = (db.prepare("SELECT COUNT(*) AS n FROM claims WHERE session_id = ? AND status = 'approved' AND char_name != ?").get(c.session_id, c.char_name) as any).n;
      if (approved >= maxPlayers) return res.status(402).json({ error: "plan_limit", message: `На этом тарифе — до ${maxPlayers} игроков в сессии` });
      // одобрение одного — снимает другие одобренные заявки на того же персонажа
      db.prepare("UPDATE claims SET status = 'released' WHERE session_id = ? AND char_name = ? AND status = 'approved' AND id != ?").run(c.session_id, c.char_name, c.id);
    }
    db.prepare("UPDATE claims SET status = ? WHERE id = ?").run(status, c.id);
    if (status !== "approved") db.prepare("DELETE FROM pending_actions WHERE session_id = ? AND char_name = ? AND player_name = ?").run(c.session_id, c.char_name, c.player_name);
    broadcast(c.session_id, { type: "claims_changed", sessionId: c.session_id });
    res.json({ status: "ok" });
  };
  app.post("/api/sessions/:id/claims/:cid/approve", setClaimStatus("approved"));
  app.post("/api/sessions/:id/claims/:cid/reject", setClaimStatus("rejected"));
  app.post("/api/sessions/:id/claims/:cid/release", setClaimStatus("released"));

  app.get("/api/sessions/:id/pending", (req, res) => {
    const rows = db.prepare("SELECT id, char_name, player_name, action_text, created_at FROM pending_actions WHERE session_id = ? ORDER BY created_at ASC, rowid ASC").all(req.params.id);
    res.json(rows);
  });

  app.post("/api/sessions/:id/actions", rateLimit({ windowMs: 60_000, max: 20 }), (req, res) => {
    const deviceId = req.auth.deviceId;
    const charName = str(req.body?.charName, 60);
    let action = str(req.body?.action, 2000).trim();
    if (!deviceId || !charName || !action) return res.status(400).json({ error: "charName/action required" });
    const claim = db.prepare("SELECT * FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved' AND device_id = ?").get(req.params.id, charName, deviceId) as any;
    if (!claim) return res.status(403).json({ error: "not_your_character", message: "Персонаж не закреплён за этим устройством" });
    if (gameApi.ensureEngineState(req.params.id)[charName]?.status === "downed") {
      return res.status(409).json({ error: "downed", message: "Герой повержен и не может действовать, пока союзники его не стабилизируют" });
    }
    const existing = db.prepare("SELECT 1 FROM pending_actions WHERE session_id = ? AND char_name = ?").get(req.params.id, charName);
    if (existing) return res.status(409).json({ error: "already_acted", message: "Действие уже отправлено, ждём мастера" });
    const s = loadSession(db, req.params.id)!;
    const roll = req.body?.roll as RollType | undefined;
    if (roll && ROLL_TYPES.includes(roll) && s.mode !== "tale") {
      const dash = lastDashboard(s.history);
      const ch = dash.characters?.find(c => c.name === charName);
      const mech = s.config.mechanics || readSettings(db).mechanics;
      const enabled = (mid: string) => mech.find(m => m.id === mid)?.enabled ?? true;
      action += `\n${rollTag({ type: roll, bare: true, charName, actionName: action.slice(0, 80), stress: ch?.stress, threatLevel: dash.threatLevel, stressEnabled: enabled("stress"), threatEnabled: enabled("threat") })}`;
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pending_actions (id, session_id, char_name, player_name, action_text) VALUES (?,?,?,?,?)").run(id, req.params.id, charName, claim.player_name, action);
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", id, action });
  });

  app.delete("/api/sessions/:id/actions/:aid", (req, res) => {
    db.prepare("DELETE FROM pending_actions WHERE id = ? AND session_id = ?").run(req.params.aid, req.params.id);
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok" });
  });

  // Использовать расходник: мастер — за любого героя, игрок — только за своего. ИИ узнает в следующем ходе.
  app.post("/api/sessions/:id/use", (req, res) => {
    const charName = str(req.body?.charName, 60);
    const item = str(req.body?.item, 200);
    if (!charName || !item) return res.status(400).json({ error: "charName/item required" });
    if (!(req as any).isOwner) {
      const claim = req.auth.deviceId && db.prepare("SELECT 1 FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved' AND device_id = ?").get(req.params.id, charName, req.auth.deviceId);
      if (!claim) return res.status(403).json({ error: "not_your_character", message: "Персонаж не закреплён за этим устройством" });
    }
    engine.withLock(req.params.id, () => {
      const r = gameApi.useItem(req.params.id, charName, item);
      if (!r.ok) return res.status(400).json({ error: "cannot_use", message: r.tag.replace(/^\[ITEM: |\]$/g, "") || "Нельзя использовать" });
      gameApi.queueNews(req.params.id, r.tag);
      broadcast(req.params.id, { type: "update", sessionId: req.params.id });
      res.json({ status: "ok", tag: r.tag });
    });
  });

  // Путешествие: исход дороги бросает сервер (раньше — Math.random в браузере мастера)
  app.post("/api/sessions/:id/travel", llmLimiter, (req, res) => {
    const s = loadSession(db, req.params.id)!;
    const dash = lastDashboard(s.history);
    const loc = dash.locations?.find(l => l.id === req.body?.locationId);
    if (!loc) return res.status(404).json({ error: "location_not_found", message: "Локация не найдена" });
    if (loc.status === "locked") return res.status(400).json({ error: "locked", message: "Путь закрыт — сначала нужно выполнить условие" });
    if (loc.id === dash.currentLocationId) return res.status(400).json({ error: "already_here", message: "Вы уже здесь" });
    const danger = Math.min(5, Math.max(1, Number(loc.dangerLevel) || 1));
    const kids = s.style === "fairytale";
    const r = Math.random();
    const encounterChance = kids ? 0.2 : 0.12 + 0.07 * danger;
    const type: "encounter" | "discovery" | "safe" = r < encounterChance ? "encounter" : r < encounterChance + 0.3 ? "discovery" : "safe";
    const prompt = type === "encounter"
      ? `[TRAVEL ENCOUNTER] Партия отправляется в «${loc.name}», но в пути их перехватывают${kids ? " (забавное препятствие или загадка, без опасности)" : ""}.
1. Опиши дорогу и событие, подходящее сеттингу и уровню опасности ${danger}/5.
2. Партия ещё НЕ прибыла в «${loc.name}»: currentLocationId не меняй.
3. Останови сцену в момент выбора.`
      : type === "discovery"
        ? `[TRAVEL DISCOVERY] По пути в «${loc.name}» партия замечает что-то в стороне от дороги.
1. Опиши путь и находку — НОВУЮ локацию: добавь её в locations (status "known", dangerLevel по стилю игры, coordinates рядом, connections с текущей локацией и с "${loc.id}").
2. Затем опиши прибытие в «${loc.name}»: status "visited", currentLocationId = "${loc.id}".`
        : `[TRAVEL] Партия спокойно добирается до «${loc.name}».
1. Коротко опиши дорогу и смену пейзажа.
2. Опиши прибытие и первое впечатление: status "visited", currentLocationId = "${loc.id}".`;
    engine.enqueueTurn(s.id, prompt);
    res.status(202).json({ type, locationName: loc.name });
  });

  app.post("/api/sessions/:id/explore", llmLimiter, (req, res) => {
    const s = loadSession(db, req.params.id)!;
    const dash = lastDashboard(s.history);
    const loc = dash.locations?.find(l => l.id === (req.body?.locationId || dash.currentLocationId));
    if (!loc) return res.status(404).json({ error: "location_not_found", message: "Локация не найдена" });
    engine.enqueueTurn(s.id, `[EXPLORE] Партия исследует «${loc.name}».
1. Опиши, что они находят: детали, следы, NPC.
2. Открой 1–2 НОВЫЕ локации: добавь в locations (уникальный id, name, description, dangerLevel по стилю игры, status "known", coordinates рядом с текущей, connections ["${loc.id}"]) и допиши их id в connections «${loc.name}».`);
    res.status(202).json({ status: "queued" });
  });

  // ------------------------------- оракул сессии -------------------------------
  app.get("/api/sessions/:id/oracle", (req, res) => {
    // таблицы — спойлеры будущих поворотов: только мастеру
    if (!(req as any).isOwner) return res.status(403).json({ error: "owner_required", message: "Только мастер сессии" });
    const s = loadSession(db, req.params.id)!;
    const tables = engine.oracle.load(s.id);
    res.json({
      generating: engine.isOracleGenerating(s.id),
      maxRows: ORACLE_MAX_ROWS,
      tables: tablesFor(s).map(d => {
        const t = tables[d.id];
        return { id: d.id, title: d.title, hint: d.hint, rows: t?.rows || [], used: t?.used.length || 0, remaining: t ? t.rows.length - t.used.length : 0, updatedAt: t?.updatedAt || null };
      }),
    });
  });

  app.post("/api/sessions/:id/oracle/generate", llmLimiter, (req, res) => {
    const s = loadSession(db, req.params.id)!;
    const mode = req.body?.mode === "extend" ? "extend" : "replace";
    const ids = tablesFor(s).map(d => d.id);
    const tables = (Array.isArray(req.body?.tables) ? req.body.tables : []).filter((t: any) => ids.includes(t));
    const hint = str(req.body?.hint, 300).trim() || undefined;
    if (!s.workspace_id) return res.status(400).json({ error: "no_workspace" });
    try { billing.assertCanSpend(s.workspace_id, tenancy.resolveLlm(s.workspace_id).mode); }
    catch (e) { if (e instanceof BillingError) return res.status(e.status).json({ error: e.code, message: e.message }); throw e; }
    const queued = engine.scheduleOracle(s.id, mode, { tables, hint, reason: "manual" });
    res.status(202).json({ status: queued ? "queued" : "already_queued", mode, tables });
  });

  app.put("/api/sessions/:id/oracle/:tableId", (req, res) => {
    const s = loadSession(db, req.params.id)!;
    const def = tablesFor(s).find(d => d.id === req.params.tableId);
    if (!def) return res.status(404).json({ error: "table_not_found" });
    if (!Array.isArray(req.body?.rows)) return res.status(400).json({ error: "rows_required" });
    const rows = engine.oracle.setRows(s.id, def, req.body.rows.slice(0, 500));
    broadcast(s.id, { type: "oracle", sessionId: s.id, status: "ready", mode: "edit", changed: [def.id] });
    res.json({ id: def.id, rows });
  });

  // ГМ вписывает ход за персонажа (соло / игрок не успел)
  app.post("/api/sessions/:id/gm-action", (req, res) => {
    const charName = str(req.body?.charName, 60);
    const action = str(req.body?.action, 2000).trim();
    if (!charName || !action) return res.status(400).json({ error: "charName/action required" });
    db.prepare("DELETE FROM pending_actions WHERE session_id = ? AND char_name = ?").run(req.params.id, charName);
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pending_actions (id, session_id, char_name, player_name, action_text) VALUES (?,?,?,?,?)").run(id, req.params.id, charName, "ГМ", action);
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", id });
  });

  // ------------------------------- игровые сервисы -------------------------------
  const gameApi = registerGameRoutes(app, { db, broadcast });
  engine = new Engine(db, gameApi, broadcast, tenancy, billing);

  // ------------------------------- настройки (админ) -------------------------------
  // Глобальные настройки: дефолтные промпт и механики видны всем вошедшим, ИИ платформы — суперадмину
  app.get("/api/settings", requireUser, (req, res) => {
    const full = settingsForClient(db);
    if (req.auth.user!.isSuperadmin) return res.json({ ...full, canEdit: true });
    res.json({ systemPrompt: full.systemPrompt, mechanics: full.mechanics, idlePlayerAction: full.idlePlayerAction, canEdit: false });
  });

  app.post("/api/settings", requireUser, requireSuperadmin, (req, res) => {
    writeSettings(db, req.body || {});
    res.json({ ...settingsForClient(db), canEdit: true });
  });

  app.get("/api/logs", requireUser, requireSuperadmin, (_req, res) => {
    res.json(db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 100").all());
  });

  app.post("/api/llm/test", requireUser, requireSuperadmin, llmLimiter, async (req, res) => {
    // проверяем либо сохранённые настройки платформы, либо присланные (без сохранения)
    const current = readSettings(db).llm;
    const b = req.body || {};
    const llm = {
      ...current,
      ...(b.provider ? { provider: b.provider } : {}),
      ...(typeof b.modelUrl === "string" ? { modelUrl: b.modelUrl } : {}),
      ...(typeof b.modelName === "string" ? { modelName: b.modelName } : {}),
      ...(typeof b.openRouterModel === "string" ? { openRouterModel: b.openRouterModel } : {}),
      ...(typeof b.apiKey === "string" && !b.apiKey.startsWith("••••") ? { apiKey: b.apiKey } : {}),
      ...(typeof b.openRouterApiKey === "string" && !b.openRouterApiKey.startsWith("••••") ? { openRouterApiKey: b.openRouterApiKey } : {}),
    };
    const started = Date.now();
    try {
      const r = await completeWithUsage(llm, { system: "Ответь одним словом.", messages: [{ role: "user", content: "Скажи «готов»." }], maxTokens: 20 });
      res.json({ ok: true, ms: Date.now() - started, sample: r.text.slice(0, 80), ...describeProvider(llm) });
    } catch (e: any) {
      res.json({ ok: false, ms: Date.now() - started, error: e?.message, ...describeProvider(llm) });
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  // ------------------------------- фронтенд -------------------------------
  const staticDir = opts.staticDir ?? (process.env.NODE_ENV === "production" ? path.resolve(process.env.STATIC_DIR || "dist") : undefined);
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); } }));
    app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  } else if (opts.vite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
    app.use(vite.middlewares);
  }

  // ошибки обработчиков — JSON, без стектрейсов наружу
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[http]", err?.stack || err);
    if (res.headersSent) return;
    res.status(err?.status || 500).json({ error: "internal_error", message: err?.type === "entity.too.large" ? "Слишком большой запрос" : "Внутренняя ошибка сервера" });
  });

  const close = async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(r => wss.close(() => r()));
    await new Promise<void>(r => (server.listening ? server.close(() => r()) : r()));
    await Promise.race([engine.whenIdle(), new Promise(r => setTimeout(r, 10_000))]).catch(() => undefined);
    db.close();
  };

  return { app, server, wss, db, engine, billing, tenancy, close };
}
