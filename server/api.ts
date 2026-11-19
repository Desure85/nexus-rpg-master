import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { deleteSessionCascade, type DB } from "./db";
import { registerGameRoutes } from "./game";
import { Engine } from "./engine";
import { completeWithUsage, describeProvider, LlmError } from "./llm";
import { createHeroes, veteranLine } from "./heroes";
import { createWorlds } from "./worlds";
import { WORLD_GEN_SYSTEM, parseGeneratedWorld, closeJson } from "../shared/world";
import { normalizeBlocks } from "../shared/parse";
import { archetypeById } from "../shared/archetypes";
import { authMiddleware, csrfGuard, requireUser, requireSuperadmin, rateLimit, securityHeaders } from "./security";
import { createBilling, registerBillingRoutes, effectivePlan, PLANS, BillingError, paymentsProvider } from "./billing";
import { createTenancy, registerTenancyRoutes, registrationMode } from "./tenancy";
import { mailConfigured } from "./mailer";
import {
  loadSession, saveSession, publicSession, sessionSummary, lastDashboard, readSettings, settingsForClient, writeSettings, mergeMechanics, cleanExtra,
  type SessionConfig, type StoredSession,
} from "./store";
import { dailyChallenge, isDailyKey } from "../shared/daily";
import { buildGameStartPrompt, buildTaleStartPrompt, TALE_AGES, INITIAL_DASHBOARD, type TaleAge } from "../shared/rules";
import { rollTag, ROLL_TYPES, type RollType } from "../shared/dice";
import { resolveRolls } from "../shared/resolve";
import { tablesFor, MAX_ROWS as ORACLE_MAX_ROWS } from "./oracle";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const MAX_CHARACTERS = 8;

/**
 * Весь HTTP API игры без привязки к Node-окружению (http, ws, файлы).
 * Используется настоящим сервером (server/app.ts) и браузерным демо (demo/).
 * Тело запроса к этому моменту уже должно быть разобрано в req.body.
 */
export function buildApi(app: Express, opts: { db: DB; broadcast: (roomId: string, data: any) => void }) {
  const { db, broadcast } = opts;
  const heroes = createHeroes(db, opts.broadcast);
  const worlds = createWorlds(db);
  // после каждого хода мастера — проверка достижений
  const broadcastWithHooks = (room: string, data: any) => {
    broadcast(room, data);
    if (data?.type === "turn_end") { try { heroes.checkSession(data.sessionId); } catch (e) { console.error("[achievements]", e); } }
  };
  const billing = createBilling(db);
  const tenancy = createTenancy(db, billing);

  app.use(securityHeaders);
  app.use(authMiddleware(db));
  app.use(csrfGuard);

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
    // игра в мире автора: сеттинг, завязка и лор берутся из мира (снимок версии)
    const world = setup.worldId ? worlds.getForPlay(req.auth.user!.id, str(setup.worldId, 64)) : null;
    if (setup.worldId && !world) return res.status(404).json({ error: "world_not_found", message: "Мир не найден или автор закрыл к нему доступ" });
    const worldScenario = world ? world.data.scenarios.find(x => x.id === setup.scenarioId) : undefined;
    const mode: StoredSession["mode"] = worldScenario ? worldScenario.mode : ["short", "campaign", "tale"].includes(setup.mode) ? setup.mode : "short";
    // испытание дня: сюжет и условие пересчитываем по ключу — клиент их не подменит
    const daily = !world && mode === "short" && isDailyKey(setup.daily) ? dailyChallenge(setup.daily) : null;
    const setting = world ? (world.data.setting || world.description || world.title) : daily ? daily.scenario.setting : str(setup.setting, 2000).trim();
    const plotHook = worldScenario ? worldScenario.hook : daily ? daily.plotHook : str(setup.plotHook, 2000).trim();
    const style = ["narrative", "balanced", "combat", "fairytale"].includes(setup.style) ? setup.style : mode === "tale" ? "fairytale" : "balanced";
    const characters = (Array.isArray(setup.characters) ? setup.characters : [])
      .map((c: any) => {
        const vet = c?.veteranId ? heroes.getHero(req.auth.user!.id, String(c.veteranId)) : null;
        return {
          name: vet?.name || str(c?.name, 60).trim(),
          concept: vet?.concept || str(c?.concept, 300).trim(),
          gender: (vet?.gender || c?.gender) === "Ж" ? "Ж" : "М",
          archetype: archetypeById(vet?.archetype || c?.archetype)?.id,
          veteranSheet: vet || undefined,
        };
      })
      .filter((c: any) => c.name)
      .slice(0, MAX_CHARACTERS);
    if (characters.length > limits.maxHeroes) return res.status(402).json({ error: "plan_limit", message: `На тарифе «${limits.title}» — до ${limits.maxHeroes} героев` });
    if (!setting) return res.status(400).json({ error: "setting_required", message: "Укажите сеттинг" });
    if (!characters.length) return res.status(400).json({ error: "characters_required", message: "Добавьте хотя бы одного героя" });
    if (new Set(characters.map((c: any) => c.name)).size !== characters.length) return res.status(400).json({ error: "duplicate_names", message: "Имена героев должны различаться" });

    const cfgIn = req.body?.config || {};
    const config: SessionConfig = {
      mechanics: Array.isArray(cfgIn.mechanics) ? mergeMechanics(cfgIn.mechanics) : undefined,
      extraInstructions: cleanExtra(cfgIn.extraInstructions) || undefined,
      idlePlayerAction: ["random", "skip", "gm"].includes(cfgIn.idlePlayerAction) ? cfgIn.idlePlayerAction : undefined,
      autoApprove: !!cfgIn.autoApprove,
    };
    if (mode === "tale") {
      const age: TaleAge = TALE_AGES.some(a => a.id === setup.tale?.age) ? setup.tale.age : "6-8";
      const chapters = Math.min(15, Math.max(3, Number(setup.tale?.chapters) || 6));
      config.tale = { age, chapters, moral: str(setup.tale?.moral, 200).trim() || undefined };
    }
    if (daily) config.daily = { key: daily.key, modifier: daily.modifier.id };
    if (world) {
      config.world = { id: world.id, title: world.title, version: world.version, genre: world.genre, startLocationId: worldScenario?.startLocationId, data: world.data };
      worlds.countPlay(world.id);
    }
    // герои из настройки: движок гарантирует их на старте, даже если модель забыла дашборд
    if (mode !== "tale") {
      config.heroes = characters.map((c: any) => ({ name: c.name, gender: c.gender, concept: c.concept, archetype: c.archetype, veteran: c.veteranSheet }));
    }
    const id = crypto.randomUUID();
    const title = str(setup.title, 80).trim() || (world ? `${world.title}${worldScenario ? `: ${worldScenario.title}` : ""}`.slice(0, 80) : "");
    const name = title ? (mode === "tale" ? `Сказка: ${title}` : title) : (mode === "tale" ? "Сказка: " : "") + (setting.split(/[.,;\n]/)[0].slice(0, 60) || "Новое приключение");
    const lore = mode === "tale" ? "" : `Сеттинг: ${setting}\nЗавязка: ${plotHook}\nСтиль: ${style}`;
    // В сказке нет игрового дашборда от ИИ — заводим героев сразу, чтобы друзья могли занять их по ссылке
    const initialHistory = mode === "tale"
      ? [{ role: "system", content: "Герои сказки", dashboard: { ...structuredClone(INITIAL_DASHBOARD), atmosphere: "", characters: characters.map((c: any) => ({ name: c.name, hp: "", stress: 0, tokens: 0, condition: "", goal: c.concept })) } }]
      : [];
    db.prepare(`INSERT INTO sessions (id, name, genre, setting, style, snapshot, history, lore, codex, archive, mode, workspace_id, created_by, config)
      VALUES (?, ?, ?, ?, ?, '', ?, ?, '[]', '', ?, ?, ?, ?)`)
      .run(id, name, world?.genre || "Custom", setting, style, JSON.stringify(initialHistory), lore, mode, workspaceId, req.auth.user!.id, JSON.stringify(config));
    const prompt = mode === "tale"
      ? buildTaleStartPrompt(setting, plotHook, characters)
      : buildGameStartPrompt(setting, plotHook, style, characters.map((c: any) => ({ ...c, veteran: c.veteranSheet ? veteranLine(c.veteranSheet) : undefined })));
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
        maxTokens: 2048, // с запасом: у моделей с рассуждениями лимит включает «мысли»
      });
      billing.recordUsage({ workspaceId, userId: req.auth.user!.id, kind: "generate", mode, llm, usage: r.usage });
      res.json({ text: r.text });
    } catch (e: any) {
      const status = e instanceof BillingError || e instanceof LlmError ? e.status : 502;
      res.status(status).json({ error: e?.code || "llm_error", message: e?.message });
    }
  });

  // ИИ-конструктор мира: черновик из абзаца описания (автор потом правит в редакторе)
  app.post("/api/worlds/generate", requireUser, llmLimiter, async (req, res) => {
    const idea = str(req.body?.prompt, 2000).trim();
    const workspaceId = str(req.body?.workspaceId, 64);
    if (idea.length < 10) return res.status(400).json({ error: "prompt_required", message: "Опишите мир хотя бы в паре предложений" });
    if (!tenancy.membership(workspaceId, req.auth.user!.id) && !req.auth.user!.isSuperadmin) return res.status(403).json({ error: "forbidden" });
    const { llm, mode } = tenancy.resolveLlm(workspaceId);
    try {
      billing.assertCanSpend(workspaceId, mode);
      // Мир — длинный JSON: модель может упереться в лимит или оборвать ответ. Просим продолжить с места обрыва (до 3 раз).
      const messages: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: `Описание мира от автора:\n${idea}${req.body?.genre ? `\nЖанр: ${str(req.body.genre, 20)}` : ""}` }];
      let acc = "";
      let world: ReturnType<typeof parseGeneratedWorld> | null = null;
      for (let attempt = 0; attempt < 4 && !world; attempt++) {
        const r = await completeWithUsage(llm, { system: WORLD_GEN_SYSTEM, messages, temperature: 0.9, maxTokens: 16000 });
        billing.recordUsage({ workspaceId, userId: req.auth.user!.id, kind: "generate", mode, llm, usage: r.usage });
        acc += attempt ? r.text.replace(/^\s*```(?:json)?\s*/, "") : r.text;
        try { world = parseGeneratedWorld(normalizeBlocks(acc)); } catch {
          console.warn(`[worlds] черновик мира не разобран (попытка ${attempt + 1}, ${acc.length} симв.), хвост: ${JSON.stringify(acc.slice(-120))}`);
          messages.splice(1, messages.length - 1, { role: "assistant", content: acc }, { role: "user", content: "Ответ оборвался. Продолжи JSON РОВНО с места обрыва — без повторов, пояснений и markdown." });
        }
      }
      if (!world) {
        // последний шанс: закрыть незакрытые строки и скобки и взять, что успело прийти
        try { world = parseGeneratedWorld(closeJson(acc)); } catch { /* ниже */ }
      }
      if (!world || !world.data.cards.length) return res.status(502).json({ error: "bad_world", message: "Модель не смогла собрать мир — попробуйте ещё раз или опишите короче" });
      res.json(world);
    } catch (e: any) {
      const status = e instanceof BillingError || e instanceof LlmError ? e.status : 502;
      res.status(status).json({ error: e?.code || "llm_error", message: e?.message });
    }
  });

  // Политика доступа к /api/sessions/:id/* :
  //  GET — по ссылке (UUID сессии — секрет приглашения);
  //  claim/actions/roll — игрок (секрет устройства);
  //  всё остальное — только мастер, и изменения истории идут через очередь сессии.
  const PLAYER_ROUTES = /^\/(claim|actions|use|loot\/take|actions\/[^/]+\/reroll)\/?$/;
  // заявки игроков не трогают историю — не ждут, пока ИИ допишет ход
  const UNLOCKED_ROUTES = /^\/(turn|commit|travel|explore|oracle\/generate|claims\/[^/]+\/(approve|reject|release))\/?$/;
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
      if (typeof c.extraInstructions === "string") s.config.extraInstructions = cleanExtra(c.extraInstructions) || undefined;
      delete s.config.systemPrompt;
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
      // ручная правка HP тоже меняет «Повержен»: 0 HP в партии — выбыл, выше 0 — в строю
      const e = chars[c.name];
      if (e.hp_cur === 0 && e.status !== "base") e.status = "downed";
      else if (e.hp_cur > 0 && e.status === "downed") e.status = "active";
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
    const deathSave = req.body?.deathSave === true;
    const kind = ["flashback", "narrative"].includes(req.body?.kind) ? req.body.kind as "flashback" | "narrative" : null;
    let action = deathSave ? "Спасбросок смерти" : str(req.body?.action, 2000).trim();
    if (!deviceId || !charName || !action) return res.status(400).json({ error: "charName/action required" });
    const claim = db.prepare("SELECT * FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved' AND device_id = ?").get(req.params.id, charName, deviceId) as any;
    if (!claim) return res.status(403).json({ error: "not_your_character", message: "Персонаж не закреплён за этим устройством" });
    const isDowned = gameApi.ensureEngineState(req.params.id)[charName]?.status === "downed";
    if (isDowned && !deathSave) {
      return res.status(409).json({ error: "downed", message: "Герой повержен: можно только бросить спасбросок или ждать помощи союзников" });
    }
    if (deathSave && !isDowned) return res.status(409).json({ error: "not_downed", message: "Спасбросок нужен только поверженному герою" });
    const existing = db.prepare("SELECT 1 FROM pending_actions WHERE session_id = ? AND char_name = ?").get(req.params.id, charName);
    if (existing) return res.status(409).json({ error: "already_acted", message: "Действие уже отправлено, ждём мастера" });
    const s = loadSession(db, req.params.id)!;
    // Жетон за флешбэк или «право на истину» списывается сразу; вернётся, если действие отменят
    let tokensSpent = 0;
    if (kind && s.mode !== "tale") {
      const chars = gameApi.ensureEngineState(req.params.id);
      if ((chars[charName]?.tokens || 0) < 1) return res.status(409).json({ error: "no_tokens", message: "Нет жетонов судьбы" });
      gameApi.applyStateChanges(chars, [{ field: "tokens", name: charName, delta: -1 }]);
      gameApi.saveEngineState(req.params.id, chars);
      tokensSpent = 1;
      action = kind === "flashback"
        ? `[FLASHBACK — жетон потрачен] ${action}`
        : `[NARRATIVE RIGHT — жетон потрачен] ${action}`;
    }
    const roll = (deathSave ? "classic" : req.body?.roll) as RollType | undefined;
    if (roll && ROLL_TYPES.includes(roll) && s.mode !== "tale") {
      const dash = lastDashboard(s.history);
      const ch = dash.characters?.find(c => c.name === charName);
      const mech = s.config.mechanics || readSettings(db).mechanics;
      const enabled = (mid: string) => mech.find(m => m.id === mid)?.enabled ?? true;
      action += `\n${rollTag({ type: roll, bare: true, charName, actionName: action.slice(0, 80), stress: ch?.stress, threatLevel: deathSave ? 0 : dash.threatLevel, stressEnabled: enabled("stress"), threatEnabled: enabled("threat") })}`;
    }
    // Исход броска считаем сразу: игрок видит результат и может перебросить за жетон до хода мастера
    if (action.includes("[ROLL:")) action = resolveRolls(`[PLAYER ACTION: ${charName}] ${action}`, engine.rollContext(s)).text.replace(/^\[PLAYER ACTION: [^\]]+\] /, "");
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pending_actions (id, session_id, char_name, player_name, action_text, tokens_spent) VALUES (?,?,?,?,?,?)").run(id, req.params.id, charName, claim.player_name, action, tokensSpent);
    syncTokensToDashboard(req.params.id);
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", id, action });
  });

  /** Числа движка → последний дашборд (жетоны видны сразу, без хода мастера). */
  const syncTokensToDashboard = (sessionId: string) => {
    const s = loadSession(db, sessionId);
    if (!s) return;
    let idx = -1;
    for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].dashboard) { idx = i; break; }
    if (idx < 0) return;
    s.history[idx] = { ...s.history[idx], dashboard: gameApi.mergeStateIntoDashboard(s.history[idx].dashboard, gameApi.ensureEngineState(sessionId)) };
    saveSession(db, s);
    broadcast(sessionId, { type: "update", sessionId });
  };

  // Переброс за жетон: только свой ещё не обработанный ход с броском
  app.post("/api/sessions/:id/actions/:aid/reroll", rateLimit({ windowMs: 60_000, max: 10 }), (req, res) => {
    const row = db.prepare("SELECT * FROM pending_actions WHERE id = ? AND session_id = ?").get(req.params.aid, req.params.id) as any;
    if (!row) return res.status(404).json({ error: "not_found", message: "Ход уже обработан" });
    const claim = db.prepare("SELECT 1 FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved' AND device_id = ?").get(req.params.id, row.char_name, req.auth.deviceId || "");
    if (!claim) return res.status(403).json({ error: "not_your_character", message: "Персонаж не закреплён за этим устройством" });
    const tag = String(row.action_text).match(/\[ROLL:[^\]]*\]/)?.[0];
    if (!tag) return res.status(400).json({ error: "no_roll", message: "В этом ходе нет броска" });
    const chars = gameApi.ensureEngineState(req.params.id);
    if ((chars[row.char_name]?.tokens || 0) < 1) return res.status(409).json({ error: "no_tokens", message: "Нет жетонов судьбы" });
    const type: RollType = /Fate Shift/.test(tag) ? "shifted" : /Stress Resonance/.test(tag) ? "triple" : /Chaos Roll/.test(tag) ? "taint" : "classic";
    const s = loadSession(db, req.params.id)!;
    const dash = lastDashboard(s.history);
    const ch = dash.characters?.find(c => c.name === row.char_name);
    const mech = s.config.mechanics || readSettings(db).mechanics;
    const enabled = (mid: string) => mech.find(m => m.id === mid)?.enabled ?? true;
    const isDeath = /^Спасбросок смерти/.test(row.action_text);
    gameApi.applyStateChanges(chars, [{ field: "tokens", name: row.char_name, delta: -1 }]);
    gameApi.saveEngineState(req.params.id, chars);
    const fresh = rollTag({ type, bare: true, charName: row.char_name, actionName: "", stress: ch?.stress, threatLevel: isDeath ? 0 : dash.threatLevel, stressEnabled: enabled("stress"), threatEnabled: enabled("threat") });
    const base = String(row.action_text).replace(/\n?\[ROLL:[^\]]*\]/g, "").replace(/\s*\(переброс за жетон\)$/, "");
    const resolved = resolveRolls(`[PLAYER ACTION: ${row.char_name}] ${base}\n${fresh}`, engine.rollContext(s)).text.replace(/^\[PLAYER ACTION: [^\]]+\] /, "");
    const text = resolved.replace(/(\[ROLL:[^\]]*\])$/, "$1 (переброс за жетон)");
    db.prepare("UPDATE pending_actions SET action_text = ?, tokens_spent = tokens_spent + 1 WHERE id = ?").run(text, row.id);
    syncTokensToDashboard(req.params.id);
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", action: text });
  });

  app.delete("/api/sessions/:id/actions/:aid", (req, res) => {
    const row = db.prepare("SELECT char_name, tokens_spent FROM pending_actions WHERE id = ? AND session_id = ?").get(req.params.aid, req.params.id) as any;
    db.prepare("DELETE FROM pending_actions WHERE id = ? AND session_id = ?").run(req.params.aid, req.params.id);
    // отменённый ход возвращает потраченные жетоны
    if (row?.tokens_spent > 0) {
      const chars = gameApi.ensureEngineState(req.params.id);
      gameApi.applyStateChanges(chars, [{ field: "tokens", name: row.char_name, delta: row.tokens_spent }]);
      gameApi.saveEngineState(req.params.id, chars);
      syncTokensToDashboard(req.params.id);
    }
    broadcast(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok" });
  });

  // Мастер тратит жетон героя (переброс на своём экране, флешбэк, право на истину). ИИ узнает со следующим ходом.
  app.post("/api/sessions/:id/tokens", (req, res) => {
    if (!(req as any).isOwner) return res.status(403).json({ error: "owner_required" });
    const charName = str(req.body?.charName, 60);
    const kind = String(req.body?.kind || "");
    const note = str(req.body?.note, 400).trim();
    const KINDS: Record<string, string> = { reroll: "переброс", flashback: "флешбэк", narrative: "право на истину", stabilize: "стабилизация союзника" };
    if (!KINDS[kind]) return res.status(400).json({ error: "bad_kind" });
    const chars = gameApi.ensureEngineState(req.params.id);
    const name = gameApi.resolveName(chars, charName);
    if (!name) return res.status(404).json({ error: "character_not_found" });
    if ((chars[name].tokens || 0) < 1) return res.status(409).json({ error: "no_tokens", message: "Нет жетонов судьбы" });
    let target: string | null = null;
    if (kind === "stabilize") {
      target = gameApi.resolveName(chars, note);
      if (!target || chars[target].status !== "downed") return res.status(409).json({ error: "not_downed", message: "Укажите поверженного союзника" });
    }
    gameApi.applyStateChanges(chars, [{ field: "tokens", name, delta: -1 }, ...(target ? [{ field: "hp", name: target, delta: 1 }] : [])]);
    gameApi.saveEngineState(req.params.id, chars);
    if (kind !== "reroll") gameApi.queueNews(req.params.id, `[TOKEN SPENT: ${name} → ${KINDS[kind]}${note ? `: ${note}` : ""}] Жетон уже списан. ${kind === "flashback" ? "Флешбэк правдив, если правдоподобен: покажи, как подготовка помогает сейчас." : kind === "narrative" ? "Деталь, которую ввёл игрок, — правда мира." : `${target} стабилизирован и снова в строю с 1 HP (уже применено) — опиши, как ${name} его поднимает.`}`);
    syncTokensToDashboard(req.params.id);
    res.json({ status: "ok", tokens: chars[name].tokens });
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

  // Подобрать добычу со сцены: мастер — любому герою, игрок — своему. ИИ узнает со следующим ходом.
  app.post("/api/sessions/:id/loot/take", (req, res) => {
    const charName = str(req.body?.charName, 60);
    const item = str(req.body?.item, 200);
    if (!charName || !item) return res.status(400).json({ error: "charName/item required" });
    if (!(req as any).isOwner) {
      const claim = req.auth.deviceId && db.prepare("SELECT 1 FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved' AND device_id = ?").get(req.params.id, charName, req.auth.deviceId);
      if (!claim) return res.status(403).json({ error: "not_your_character", message: "Персонаж не закреплён за этим устройством" });
    }
    engine.withLock(req.params.id, () => {
      const s = loadSession(db, req.params.id)!;
      let idx = -1;
      for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].dashboard) { idx = i; break; }
      const dash = idx >= 0 ? structuredClone(s.history[idx].dashboard!) : null;
      const ch = dash?.characters?.find(c => c.name === charName);
      const li = (dash?.sceneLoot || []).indexOf(item);
      if (!dash || !ch || li < 0) return res.status(404).json({ error: "not_found", message: "Этого предмета уже нет на сцене" });
      dash.sceneLoot = dash.sceneLoot!.filter((_, i) => i !== li);
      ch.inventory = [...(ch.inventory || []), item];
      s.history[idx] = { ...s.history[idx], dashboard: dash };
      saveSession(db, s);
      gameApi.queueNews(req.params.id, `[LOOT TAKEN: ${charName} забирает «${item}»]`);
      broadcast(req.params.id, { type: "update", sessionId: req.params.id });
      res.json({ status: "ok" });
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
    // Только по дорогам карты: если у текущей локации есть связи, цель должна быть среди них (или знать дорогу назад)
    const here = dash.locations?.find(l => l.id === dash.currentLocationId);
    if (here?.connections?.length && !here.connections.includes(loc.id) && !(loc.connections || []).includes(here.id)) {
      return res.status(400).json({ error: "no_route", message: `Из «${here.name}» нет прямой дороги в «${loc.name}» — идите через соседние места` });
    }
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
  engine = new Engine(db, gameApi, broadcastWithHooks, tenancy, billing);
  heroes.register(app, requireUser);
  worlds.register(app, requireUser);

  // ------------------------------- настройки (админ) -------------------------------
  // Глобальные настройки: дефолтные промпт и механики видны всем вошедшим, ИИ платформы — суперадмину
  app.get("/api/settings", requireUser, (req, res) => {
    const full = settingsForClient(db);
    if (req.auth.user!.isSuperadmin) return res.json({ ...full, canEdit: true });
    res.json({ extraInstructions: full.extraInstructions, mechanics: full.mechanics, idlePlayerAction: full.idlePlayerAction, canEdit: false });
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
      const r = await completeWithUsage(llm, { system: "Ответь одним словом.", messages: [{ role: "user", content: "Скажи «готов»." }], maxTokens: 1024 });
      res.json({ ok: true, ms: Date.now() - started, sample: r.text.slice(0, 80), ...describeProvider(llm) });
    } catch (e: any) {
      res.json({ ok: false, ms: Date.now() - started, error: e?.message, ...describeProvider(llm) });
    }
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "not_found" }));

  return { engine, billing, tenancy, gameApi };
}

/** Ошибки обработчиков — JSON, без стектрейсов наружу. */
export function apiErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  console.error("[http]", err?.stack || err);
  if (res.headersSent) return;
  res.status(err?.status || 500).json({ error: "internal_error", message: err?.type === "entity.too.large" ? "Слишком большой запрос" : "Внутренняя ошибка сервера" });
}
