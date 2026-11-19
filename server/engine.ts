import crypto from "crypto";
import type { DB } from "./db";
import type { GameApi } from "./game";
import type { Tenancy } from "./tenancy";
import type { Billing } from "./billing";
import { completeWithUsage, type ChatMessage, type LlmRequest, type LlmSettings } from "./llm";
import { DAILY_MODIFIERS } from "../shared/daily";
import { worldPromptBlock, findEnemy, enemyStats, chronicleBlock, type ChronicleEntry } from "../shared/world";
import { loadSession, saveSession, lastDashboard, readSettings, mergeMechanics, type StoredSession, type SessionConfig } from "./store";
import {
  CLARIFY_SYSTEM_PROMPT, SYSTEM_PROMPT, extraInstructionsBlock, getTechnicalInstructions, getStyleInstruction, getTaleSystemPrompt, levelFromXp,
  META_COMMAND_RE, IDLE_RULES, type TaleConfig,
} from "../shared/rules";
import { parseDashboard, parseStateTags, parseSideTags, parseTale, extractRollEffects, parseCombatTags, parseDramaTags, normalizeBlocks } from "../shared/parse";
import { resolveRolls, resolvedOutcomes, armorOf } from "../shared/resolve";
import { archetypeById, applyArchetype } from "../shared/archetypes";
import { genreOf } from "../shared/genre";
import { applyVeteran } from "./heroes";
import { actionSlotsTag } from "../shared/oracle";
import { createOracleStore, tablesFor, buildOraclePrompt, parseOracleResponse, type OracleStore, type OracleTableDef } from "./oracle";
import { BillingError } from "./billing";
import type { DashboardData, Message, MechanicConfig } from "../src/types";

export interface TurnOptions {
  /** Броски ГМа из Dice Roller, добавляются к сообщению */
  rolls?: string[];
  /** Внутренний follow-up (level up): не порождает новых follow-up */
  followUp?: boolean;
}

type Broadcast = (roomId: string, data: any) => void;

const DEFAULT_TALE: TaleConfig = { age: "6-8", chapters: 6 };

export class Engine {
  private chains = new Map<string, Promise<unknown>>();
  private busy = new Set<string>();
  private pendingTurns = new Map<string, number>();

  readonly oracle: OracleStore;
  private oracleJobs = new Set<string>();
  private oraclePromises = new Set<Promise<void>>();
  private oracleAttempt = new Map<string, number>();

  constructor(private db: DB, private game: GameApi, private broadcast: Broadcast, private tenancy: Tenancy, private billing: Billing,
    /** Канон хроники мира (живой мир): события других партий */
    private worldChronicle: (worldId: string, exceptSession: string) => ChronicleEntry[] = () => []) {
    this.oracle = createOracleStore(db);
  }

  isOracleGenerating(sessionId: string) {
    return [...this.oracleJobs].some(k => k.startsWith(`${sessionId}:`));
  }

  /**
   * Поставить в очередь сессии генерацию таблиц оракула.
   * replace — с нуля (старт игры, «перегенерировать»), extend — дописать новые строки (колода на исходе, «догенерировать»).
   */
  scheduleOracle(sessionId: string, mode: "replace" | "extend", opts: { tables?: string[]; hint?: string; reason?: string } = {}) {
    const key = `${sessionId}:${mode}:${(opts.tables || []).join(",")}`;
    if (this.oracleJobs.has(key)) return false;
    this.oracleJobs.add(key);
    this.oracleAttempt.set(sessionId, Date.now());
    this.broadcast(sessionId, { type: "oracle", sessionId, status: "generating", mode });
    // Оракул пишет только в свои таблицы — не держим очередь ходов, пока медленная модель генерирует (до минут)
    const job = (async () => {
      try {
        const changed = await this.generateOracle(sessionId, mode, opts);
        this.broadcast(sessionId, { type: "oracle", sessionId, status: "ready", mode, changed });
      } catch (e: any) {
        console.error(`[oracle ${sessionId}]`, e?.message || e);
        this.broadcast(sessionId, { type: "oracle", sessionId, status: "error", mode, error: e?.message || "Ошибка генерации" });
      } finally {
        this.oracleJobs.delete(key);
        this.oraclePromises.delete(job);
      }
    })();
    this.oraclePromises.add(job);
    return true;
  }

  private async generateOracle(sessionId: string, mode: "replace" | "extend", opts: { tables?: string[]; hint?: string }) {
    const s = loadSession(this.db, sessionId);
    if (!s) throw new Error("Сессия не найдена");
    const cfg = this.effectiveConfig(s);
    const all = tablesFor(s);
    const defs: OracleTableDef[] = opts.tables?.length ? all.filter(d => opts.tables!.includes(d.id)) : all;
    if (!defs.length) throw new Error("Нет таких таблиц");
    const existing = this.oracle.load(sessionId);
    const { system, user } = buildOraclePrompt(s, defs, mode, opts.hint, existing);
    const request: LlmRequest = { system, messages: [{ role: "user", content: user }], temperature: 1.0, maxTokens: 8000 };
    const text = await this.callLlm(s, cfg, request, "oracle", () => undefined);
    const data = parseOracleResponse(text);
    if (!data) throw new Error("Модель вернула таблицы не в формате JSON");
    const changed = this.oracle.apply(sessionId, defs, data, mode);
    if (!changed.length) throw new Error("Модель не дала новых строк");
    return changed;
  }

  /** Строка из таблицы сессии; при «колода на исходе» — фоновая догенерация. Нет таблиц — лениво создаём. */
  private drawOracle(s: StoredSession, tableId: string, fallbackId = tableId) {
    const r = this.oracle.draw(s.id, tableId, Math.random, fallbackId);
    if (!r) return "";
    if (r.low) this.scheduleOracle(s.id, "extend", { tables: [tableId], reason: "low" });
    if (r.source === "default") {
      const last = this.oracleAttempt.get(s.id) || 0;
      // старые сессии (до оракула сессии) и неудачная генерация — пробуем не чаще раза в 10 минут
      if (Date.now() - last > 10 * 60_000 && s.history.some(m => m.role === "assistant")) this.scheduleOracle(s.id, "replace", { reason: "lazy" });
    }
    return r.value;
  }

  private museFor(s: StoredSession, event: boolean) {
    const gentle = s.style === "fairytale";
    const parts = [`«${this.drawOracle(s, "actions", gentle ? "gentle_actions" : "actions")} — ${this.drawOracle(s, "subjects", gentle ? "gentle_subjects" : "subjects")}»`];
    if (event) {
      const comp = this.drawOracle(s, "complications");
      const npc = this.drawOracle(s, "npcs");
      if (comp) parts.push(`осложнение: ${comp}`);
      if (npc) parts.push(`если появится NPC: ${npc}`);
    } else if (Math.random() < 0.3) {
      const detail = this.drawOracle(s, "details");
      if (detail) parts.push(`деталь места: ${detail}`);
    }
    return `[MUSE: ${parts.join("; ")}]`;
  }

  private taleIdeaFor(s: StoredSession) {
    return `помощник — ${this.drawOracle(s, "helpers")}; чудо — ${this.drawOracle(s, "wonders")}; испытание — ${this.drawOracle(s, "trials")}`;
  }

  isBusy(sessionId: string) {
    return this.busy.has(sessionId) || (this.pendingTurns.get(sessionId) || 0) > 0;
  }

  /** Последовательно выполняет fn для сессии: все изменения истории идут через эту очередь. */
  withLock<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = this.chains.get(sessionId) || Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.chains.set(sessionId, settled);
    settled.then(() => { if (this.chains.get(sessionId) === settled) this.chains.delete(sessionId); });
    return next;
  }

  /** Ждёт, пока очередь сессии опустеет (для тестов и graceful shutdown). */
  async whenIdle(sessionId?: string) {
    for (;;) {
      const chains = sessionId ? [this.chains.get(sessionId)] : [...this.chains.values()];
      const live: Promise<unknown>[] = [...chains.filter(Boolean) as Promise<unknown>[], ...this.oraclePromises];
      if (!live.length) return;
      await Promise.all(live);
    }
  }

  /** Ставит ход в очередь; не ждёт ответа ИИ. */
  enqueueTurn(sessionId: string, content: string, opts: TurnOptions = {}) {
    this.pendingTurns.set(sessionId, (this.pendingTurns.get(sessionId) || 0) + 1);
    this.broadcast(sessionId, { type: "busy", sessionId, busy: true });
    return this.withLock(sessionId, async () => {
      this.pendingTurns.set(sessionId, Math.max(0, (this.pendingTurns.get(sessionId) || 1) - 1));
      try {
        await this.runTurn(sessionId, content, opts);
      } catch (e: any) {
        console.error(`[turn ${sessionId}]`, e?.message || e);
        this.broadcast(sessionId, { type: "turn_error", sessionId, error: e?.message || "Ошибка хода", code: e?.code });
      } finally {
        if (!this.isBusy(sessionId)) this.broadcast(sessionId, { type: "busy", sessionId, busy: false });
      }
    });
  }

  /** Переносит очередь действий игроков в историю и запускает раунд — атомарно. */
  commitRound(sessionId: string) {
    this.pendingTurns.set(sessionId, (this.pendingTurns.get(sessionId) || 0) + 1);
    this.broadcast(sessionId, { type: "busy", sessionId, busy: true });
    return this.withLock(sessionId, async () => {
      this.pendingTurns.set(sessionId, Math.max(0, (this.pendingTurns.get(sessionId) || 1) - 1));
      const pending = this.db.prepare("SELECT * FROM pending_actions WHERE session_id = ? ORDER BY created_at ASC, rowid ASC").all(sessionId) as any[];
      if (!pending.length) {
        if (!this.isBusy(sessionId)) this.broadcast(sessionId, { type: "busy", sessionId, busy: false });
        return 0;
      }
      const s = loadSession(this.db, sessionId);
      if (!s) return 0;
      const cfg = this.effectiveConfig(s);
      for (const p of pending) {
        s.history.push({ role: "user", content: `[PLAYER ACTION: ${p.char_name}${p.player_name ? ` (${p.player_name})` : ""}] ${p.action_text}` });
      }
      saveSession(this.db, s);
      this.db.prepare("DELETE FROM pending_actions WHERE session_id = ?").run(sessionId);
      this.broadcast(sessionId, { type: "actions_changed", sessionId });
      this.broadcast(sessionId, { type: "update", sessionId });
      const content = s.mode === "tale"
        ? `[TALE_CHOICE] Слушатели решили (сообщения выше). Объедини их выборы в продолжение сказки.`
        : `[ROUND] Игроки прислали действия (сообщения [PLAYER ACTION] выше). Обработай ВСЕ действия сразу и дай сцену-ответ каждому. Называй героев по именам, не «ты»: за столом несколько игроков, и каждый должен узнать свою часть сцены. ${IDLE_RULES[cfg.idlePlayerAction] || IDLE_RULES.random}`;
      try {
        await this.runTurn(sessionId, content, {});
      } catch (e: any) {
        console.error(`[round ${sessionId}]`, e?.message || e);
        this.broadcast(sessionId, { type: "turn_error", sessionId, error: e?.message || "Ошибка хода", code: e?.code });
      } finally {
        if (!this.isBusy(sessionId)) this.broadcast(sessionId, { type: "busy", sessionId, busy: false });
      }
      return pending.length;
    });
  }

  effectiveConfig(s: StoredSession) {
    const g = readSettings(this.db);
    const c: SessionConfig = s.config || {};
    const { llm, mode } = this.tenancy.resolveLlm(s.workspace_id);
    return {
      llm,
      aiMode: mode,
      loggingEnabled: g.loggingEnabled,
      // системный промпт — только из кода; владелец и мастер могут лишь дописать пожелания
      extraInstructions: [g.extraInstructions, c.extraInstructions].map(x => (x || "").trim()).filter(Boolean).join("\n\n"),
      mechanics: c.mechanics ? mergeMechanics(c.mechanics) : g.mechanics,
      idlePlayerAction: c.idlePlayerAction || g.idlePlayerAction,
      tale: { ...DEFAULT_TALE, ...(c.tale || {}) },
    };
  }

  /** Вызов ИИ с проверкой и списанием кредитов пространства. */
  private async callLlm(s: StoredSession, cfg: ReturnType<Engine["effectiveConfig"]>, request: LlmRequest, kind: string, onDelta: (d: string) => void) {
    if (s.workspace_id) this.billing.assertCanSpend(s.workspace_id, cfg.aiMode);
    // один разговор на сессию и вид запроса: стабильный id помогает кэшу промптов у провайдера
    // явный лимит: иначе часть провайдеров режет ответ на ~2k токенов (у reasoning-моделей туда входят и «мысли»)
    const r = await completeWithUsage(cfg.llm, { maxTokens: 8192, ...request, conversationId: request.conversationId || `${s.id}:${kind}` }, onDelta);
    if (s.workspace_id) this.billing.recordUsage({ workspaceId: s.workspace_id, sessionId: s.id, userId: s.created_by, kind, mode: cfg.aiMode, llm: cfg.llm as LlmSettings, usage: r.usage });
    this.log(cfg.loggingEnabled, s, request, r.text);
    return r.text;
  }

  private log(enabled: boolean, s: StoredSession, request: LlmRequest, response: string) {
    if (!enabled) return;
    this.db.prepare("INSERT INTO logs (session_id, workspace_id, request, response) VALUES (?, ?, ?, ?)").run(s.id, s.workspace_id, JSON.stringify(request), response);
    this.db.prepare("DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)").run();
  }

  private streamTo(sessionId: string, turnId: string) {
    // склеиваем мелкие дельты, чтобы не заваливать сокеты
    let buf = "";
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      timer = null;
      if (buf) { this.broadcast(sessionId, { type: "delta", sessionId, turnId, text: buf }); buf = ""; }
    };
    return {
      push: (d: string) => { buf += d; if (!timer) timer = setTimeout(flush, 60); },
      end: () => { if (timer) clearTimeout(timer); flush(); },
    };
  }

  /** Окно контекста: последние сообщения, но не меньше всего, что пришло после последнего ответа мастера. */
  private contextWindow(history: Message[], size = 8): ChatMessage[] {
    let start = Math.max(0, history.length - size);
    let lastAssistant = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "assistant") { lastAssistant = i; break; }
    if (lastAssistant >= 0 && lastAssistant < start) start = lastAssistant;
    return history.slice(start)
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));
  }

  /** Контекст для расчёта исхода бросков: лист героев, статусы движка, DC мастера. */
  rollContext(s: StoredSession) {
    const engineChars = this.game.ensureEngineState(s.id);
    const dash = lastDashboard(s.history);
    return {
      characters: dash.characters || [],
      status: Object.fromEntries(Object.entries(engineChars).map(([n, c]: [string, any]) => [n, c.status])),
      gearEnabled: this.isEnabled(this.effectiveConfig(s).mechanics, "equipment"),
      relationsEnabled: this.isEnabled(this.effectiveConfig(s).mechanics, "relationships"),
      dc: (dash.suggestedRoll as any)?.dc,
    };
  }

  private async runTurn(sessionId: string, content: string, opts: TurnOptions) {
    const s = loadSession(this.db, sessionId);
    if (!s) throw new Error("Сессия не найдена");
    const cfg = this.effectiveConfig(s);
    const isTale = s.mode === "tale";

    let finalContent = (content || "").trim();
    if (opts.rolls?.length) finalContent += (finalContent ? "\n\n" : "") + `### GM Rolls:\n${opts.rolls.join("\n")}`;

    if (finalContent) {
      const isMetaCmd = META_COMMAND_RE.test(finalContent);
      // Броски мастера разрешаем сразу: провал героя повышает шанс встречи
      if (!isTale && finalContent.includes("[ROLL:")) finalContent = resolveRolls(finalContent, this.rollContext(s)).text;
      if (!isTale && !isMetaCmd) {
        let lastA = -1;
        for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].role === "assistant") { lastA = i; break; }
        const sinceMaster = s.history.slice(lastA + 1).filter(m => m.role === "user").map(m => m.content).join("\n") + "\n" + finalContent;
        const playerFailed = resolvedOutcomes(sinceMaster).some(o => o.outcome === "fail" || o.outcome === "critfail");
        const ec = this.game.encounterCheck(sessionId, s.style || "balanced", playerFailed);
        if (ec.tag) finalContent += `\n\n${ec.tag}`;
        // Оракул: случайный мотив — всегда при событии, иначе примерно в каждом третьем ходе
        if (ec.result !== "none" || Math.random() < 0.35) finalContent += `\n\n${this.museFor(s, ec.result !== "none")}`;
        // Эхо прошлых решений: раз в 4 хода движок возвращает одно из них в сюжет
        const dashNow = lastDashboard(s.history);
        const round = s.history.filter(m => m.role === "assistant").length;
        if (this.isEnabled(cfg.mechanics, "echoes") && (dashNow.echoes || []).length && round > 0 && round % 4 === 0) {
          const echo = dashNow.echoes[Math.floor(Math.random() * dashNow.echoes.length)];
          finalContent += `\n\n[ECHO RETURN: «${echo}»]`;
        }
        const chars = this.game.ensureEngineState(sessionId);
        const stateTag = this.game.stateToTag(chars);
        if (stateTag) finalContent += `\n\n[STATE: ${stateTag}]`;
      }
      // Вести мира (idle, экспедиции, фронты, новые уровни) — одним блоком в этот же ход
      if (!isTale && !finalContent.startsWith("[CLARIFY]")) {
        const news = this.game.takeNews(sessionId);
        if (news.length) {
          finalContent += `\n\n[WORLD NEWS]\n${news.join("\n")}\nЧисла уже применены движком. Коротко вплети эти вести в ответ (1–3 предложения на все), [LEVEL UP] выполни полностью.\n[/WORLD NEWS]`;
        }
      }
      // Слоты действий выбирает движок (модель «случайно» выбирает одно и то же)
      if (!isTale && !finalContent.startsWith("[CLARIFY]") && this.isEnabled(cfg.mechanics, "actions")) {
        const active = (lastDashboard(s.history).characters || []).filter(c => c.status !== "base").map(c => c.name);
        const slots = actionSlotsTag(active, s.style);
        if (slots) finalContent += `\n\n${slots}`;
      }
      s.history.push({ role: "user", content: finalContent });
      saveSession(this.db, s);
      this.broadcast(sessionId, { type: "update", sessionId });
    } else if (s.history[s.history.length - 1]?.role !== "user") {
      return; // нечего обрабатывать
    }

    if (isTale) return this.runTaleTurn(s, cfg, finalContent);

    // Всё, что пришло от игроков с прошлого ответа мастера (для эффектов бросков)
    let lastAssistantIdx = -1;
    for (let i = s.history.length - 1; i >= 0; i--) if (s.history[i].role === "assistant") { lastAssistantIdx = i; break; }
    // Исход бросков считает движок: дописываем «Итог … → УСПЕХ/ПРОВАЛ» до того, как модель увидит ход
    {
      const ctx = this.rollContext(s);
      let changed = false;
      for (let i = lastAssistantIdx + 1; i < s.history.length; i++) {
        const m = s.history[i];
        if (m.role !== "user" || !m.content.includes("[ROLL:")) continue;
        const r = resolveRolls(m.content, ctx);
        if (r.text !== m.content) { s.history[i] = { ...m, content: r.text }; changed = true; }
      }
      if (changed) saveSession(this.db, s);
    }
    const userText = s.history[s.history.length - 1].content;
    const turnUserText = s.history.slice(lastAssistantIdx + 1).filter(m => m.role === "user").map(m => m.content).join("\n");
    const isClarify = userText.startsWith("[CLARIFY]");
    const currentDashboard = lastDashboard(s.history);
    const mechanics = cfg.mechanics;
    const system = this.buildRpgSystem(s, cfg.extraInstructions, mechanics, currentDashboard, isClarify);
    const request: LlmRequest = { system, messages: this.contextWindow(s.history) };

    const turnId = crypto.randomUUID();
    this.busy.add(sessionId);
    this.broadcast(sessionId, { type: "turn_start", sessionId, turnId });
    const stream = this.streamTo(sessionId, turnId);
    let aiContent: string;
    try {
      aiContent = normalizeBlocks(await this.callLlm(s, cfg, request, isClarify ? "clarify" : "turn", stream.push));
      if (!isClarify && isTruncatedTurn(aiContent)) aiContent = normalizeBlocks(await this.repairTurn(s, cfg, request, aiContent));
    } finally {
      stream.end();
      this.busy.delete(sessionId);
    }

    // Перечитываем сессию: пока модель думала, никто не мог её поменять (очередь), но конфиг/имя — могли
    const fresh = loadSession(this.db, sessionId) || s;
    const { clean: cleanAi, changes } = parseStateTags(aiContent);
    const parsed = parseDashboard(cleanAi, currentDashboard);

    const side = parseSideTags(aiContent);
    for (const t of side.trophies) this.db.prepare("INSERT INTO collection (id, session_id, name, desc, type) VALUES (?,?,?,?, 'trophy')").run(crypto.randomUUID(), sessionId, t.name, t.desc);
    for (const f of side.fronts) this.db.prepare("INSERT INTO fronts (id, session_id, name, impulse, portents, doom) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), sessionId, f.name, f.impulse, JSON.stringify(f.portents), f.doom);
    for (const m of side.memorials) this.db.prepare("INSERT INTO memorial (id, session_id, name, desc) VALUES (?,?,?,?)").run(crypto.randomUUID(), sessionId, m.name, m.desc);

    const leveled: string[] = [];
    let dashboard: DashboardData = isClarify ? currentDashboard : (parsed.dashboard || structuredClone(currentDashboard));
    // Архетипы и ветераны: стартовые числа, снаряжение и способности задаёт игра, а не модель
    // Условие испытания дня — тоже числа игры
    const dailyMod = !isClarify && userText.startsWith("[SYSTEM COMMAND: GAME START]") && s.config.daily ? DAILY_MODIFIERS.find(m => m.id === s.config.daily!.modifier) : undefined;
    if (!isClarify && userText.startsWith("[SYSTEM COMMAND: GAME START]") && s.config.heroes?.length) {
      const genre = genreOf(`${s.config.world?.genre || ""} ${s.setting} ${s.name}`);
      // модель могла не прислать героя (или весь дашборд) — заводим по данным настройки
      const have = new Set((dashboard.characters || []).map(c => c.name));
      for (const h of s.config.heroes) {
        if (!have.has(h.name)) (dashboard.characters ||= []).push({ name: h.name, hp: "10/10", stress: 0, tokens: 1, gold: 10, xp: 0, condition: "", goal: h.concept || "", inventory: [], equipment: [], abilities: [] } as any);
      }
      dashboard.characters = (dashboard.characters || []).map(c => {
        const h = s.config.heroes!.find(x => x.name === c.name);
        if (!h) return c;
        let out: any = c;
        const a = archetypeById(h.archetype);
        if (a) out = applyArchetype(out, a, genre);
        if (h.veteran) out = applyVeteran(out, h.veteran);
        return out;
      });
    }
    // карта мира автора: его места добавляются на старте, стартовое место сценария — текущее
    if (!isClarify && userText.startsWith("[SYSTEM COMMAND: GAME START]") && s.config.world?.data?.locations?.length) {
      const wl = s.config.world.data.locations;
      const have = dashboard.locations || [];
      const added = wl.filter(l => !have.some(h => h.id === l.id || h.name.toLowerCase() === l.name.toLowerCase()))
        .map(l => ({ ...l, status: "known" as const, coordinates: { x: 20 + Math.round(Math.random() * 60), y: 20 + Math.round(Math.random() * 60) } }));
      dashboard.locations = [...have, ...added] as any;
      // модель могла завести то же место под своим id — ищем и по названию
      const startDef = wl.find(l => l.id === s.config.world!.startLocationId);
      const start = startDef && (dashboard.locations || []).find(l => l.id === startDef.id || l.name.toLowerCase() === startDef.name.toLowerCase());
      if (start) { dashboard.currentLocationId = start.id; (start as any).status = "visited"; }
    }
    if (!isClarify) ensurePlayable(dashboard, s.setting);
    if (dailyMod) {
      if (dailyMod.hero) dashboard.characters = (dashboard.characters || []).map(c => dailyMod.hero!(c) as any);
      if (dailyMod.doom) dashboard.doomPool = Math.max(Number(dashboard.doomPool) || 0, dailyMod.doom);
    }
    if (!isClarify) {
      // State Authority: новые персонажи из ответа попадают в движок, затем применяются теги и числа перезаписываются
      const chars = this.game.ensureEngineState(sessionId);
      let added = false;
      for (const c of dashboard.characters || []) {
        if (!chars[c.name]) {
          const m = String(c.hp || "").match(/(\d+)\s*\/\s*(\d+)/);
          chars[c.name] = { hp_cur: m ? +m[1] : 10, hp_max: m ? +m[2] : 10, stress: Number(c.stress) || 0, gold: Number(c.gold) || 0, xp: Number(c.xp) || 0, tokens: Number(c.tokens) || 0, status: "active" };
          added = true;
        }
      }
      const prevLevels = Object.fromEntries(Object.entries(chars).map(([n, c]: [string, any]) => [n, levelFromXp(c.xp || 0)]));
      // Стресс из меток бросков применяет движок; если модель сама дала [STRESS] этому герою — не дублируем
      const rollFx = extractRollEffects(turnUserText);
      const aiStress = new Set(changes.filter(c => c.field === "stress").map(c => this.game.resolveName(chars, c.name)));
      const auto = rollFx.stress
        .map(r => ({ field: "stress" as const, name: this.game.resolveName(chars, r.name) || r.name, delta: r.delta }))
        .filter(r => chars[r.name] && !aiStress.has(r.name));
      // Расходники [USE: Герой|Предмет]: убираем из инвентаря, эффект применяет движок
      const useChanges: { field: "hp" | "stress"; name: string; delta: number }[] = [];
      for (const u of parseCombatTags(aiContent).uses) {
        const name = this.game.resolveName(chars, u.name);
        const ch = (dashboard.characters || []).find(c => c.name === name);
        if (!name || !ch) continue;
        const q = u.item.toLowerCase();
        const idx = (ch.inventory || []).findIndex(i => i.toLowerCase().includes(q) || q.includes(i.toLowerCase().split("(")[0].trim()));
        if (idx < 0) continue;
        const effects = this.game.itemEffect(ch.inventory![idx]);
        if (!effects.length) continue;
        ch.inventory = ch.inventory!.filter((_, i) => i !== idx);
        for (const e of effects) useChanges.push({ ...e, name });
      }
      // Броня снижает входящий урон из тегов модели (минимум 1 урона проходит)
      const armored = changes.map(c => {
        if (c.field !== "hp" || c.delta >= 0 || !this.isEnabled(mechanics, "equipment")) return c;
        const name = this.game.resolveName(chars, c.name);
        const armor = armorOf((dashboard.characters || []).find(x => x.name === name));
        return armor ? { ...c, delta: Math.min(-1, c.delta + armor) } : c;
      });
      // Спасбросок смерти: успех — герой стабилизирован с 1 HP
      const outcomes = resolvedOutcomes(turnUserText);
      const deathChanges = outcomes.filter(o => o.deathSave === "stabilized")
        .map(o => ({ field: "hp" as const, name: this.game.resolveName(chars, o.actor) || o.actor, delta: 1 }))
        .filter(c => chars[c.name]?.status === "downed");
      // Крит даёт жетон автоматически; свой [TOKEN +N] модели этому же герою не дублируем
      const critActors = new Set(outcomes.filter(o => o.outcome === "crit").map(o => this.game.resolveName(chars, o.actor)).filter(Boolean) as string[]);
      const tokenChanges = this.isEnabled(mechanics, "tokens") ? [...critActors].map(name => ({ field: "tokens" as const, name, delta: 1 })) : [];
      const modelChanges = armored.filter(c => !(c.field === "tokens" && c.delta > 0 && critActors.has(this.game.resolveName(chars, c.name) || "")));
      const applied = this.game.applyStateChanges(chars, [...modelChanges, ...auto, ...useChanges, ...deathChanges, ...tokenChanges]);
      for (const o of outcomes.filter(o => o.deathSave === "failed")) {
        const ch = (dashboard.characters || []).find(c => c.name === (this.game.resolveName(chars, o.actor) || o.actor));
        if (ch) ch.condition = "💀 При смерти: без помощи союзника погибнет в конце следующего хода";
      }
      // Повышение уровня: +2 max HP за уровень — детерминированно, движком
      for (const [n, c] of Object.entries(chars) as [string, any][]) {
        const gained = levelFromXp(c.xp || 0) - (prevLevels[n] ?? levelFromXp(c.xp || 0));
        if (gained > 0) {
          c.hp_max += 2 * gained;
          c.hp_cur = Math.min(c.hp_max, c.hp_cur + 2 * gained);
          leveled.push(`${n} → уровень ${levelFromXp(c.xp || 0)}`);
        }
      }
      if (added || applied.length || leveled.length) this.game.saveEngineState(sessionId, chars);
      dashboard = this.game.mergeStateIntoDashboard(dashboard, chars);

      // HP врагов принадлежит движку: у известных угроз берём прежнее значение, меняем только тегами [HIT]
      if (dashboard.threats?.length || currentDashboard.threats?.length) {
        const norm = (n: string) => String(n || "").toLowerCase().replace(/ё/g, "е").trim();
        const hpRe = /(\d+)\s*\/\s*(\d+)/;
        const prev = currentDashboard.threats || [];
        const bestiary = s.config.world?.data?.enemies;
        let threats = (dashboard.threats || []).map(t => {
          const p = prev.find(x => norm(x.name) === norm(t.name));
          if (p && hpRe.test(String(p.hp))) return { ...t, hp: p.hp };
          // новый враг из бестиария мира — HP задаёт автор мира, а не модель
          const e = findEnemy(bestiary, t.name);
          if (!e) return t;
          const st = enemyStats(e);
          const features = (t.features || []).length ? t.features : (e.traits ? [e.traits] : []);
          return { ...t, hp: `${st.hp}/${st.hp}`, features };
        });
        for (const h of parseCombatTags(aiContent).hits) {
          let i = threats.findIndex(t => norm(t.name) === norm(h.name));
          if (i < 0) {
            const partial = threats.map((t, k) => [t, k] as const).filter(([t]) => norm(t.name).includes(norm(h.name)) || norm(h.name).includes(norm(t.name)));
            if (partial.length === 1) i = partial[0][1];
          }
          if (i < 0) continue;
          const m = String(threats[i].hp).match(hpRe);
          if (!m) continue;
          const max = +m[2];
          const cur = Math.max(0, Math.min(max, +m[1] + h.delta));
          threats[i] = { ...threats[i], hp: `${cur}/${max}` };
        }
        // побеждённые угрозы уходят со сцены
        threats = threats.filter(t => { const m = String(t.hp).match(hpRe); return !m || +m[1] > 0; });
        dashboard.threats = threats;
      }

      // Часы принадлежат движку: прогресс известных часов меняется только тегами [CLOCK]
      if (this.isEnabled(mechanics, "clocks")) {
        const norm = (n: string) => String(n || "").toLowerCase().replace(/ё/g, "е").replace(/[«»"]/g, "").trim();
        const prevClocks = currentDashboard.clocks || [];
        let clocks = (dashboard.clocks || []).map(c => {
          const p = prevClocks.find(x => norm(x.name) === norm(c.name));
          const total = Math.max(2, Math.min(12, Number(p?.total ?? c.total) || 6));
          return { ...c, total, progress: p ? Number(p.progress) || 0 : Math.max(0, Math.min(total - 1, Number(c.progress) || 0)) };
        });
        for (const t of parseDramaTags(aiContent).clocks) {
          let i = clocks.findIndex(c => norm(c.name) === norm(t.name));
          if (i < 0) i = clocks.findIndex(c => norm(c.name).includes(norm(t.name)) || norm(t.name).includes(norm(c.name)));
          if (i < 0) continue;
          clocks[i] = { ...clocks[i], progress: Math.max(0, Math.min(clocks[i].total, clocks[i].progress + t.delta)) };
        }
        // заполненные часы: событие наступает в следующем ходе, часы уходят с доски
        for (const c of clocks.filter(c => c.progress >= c.total)) {
          this.game.queueNews(sessionId, `[CLOCK FILLED: «${c.name}»] Часы заполнились — событие наступает прямо сейчас. Опиши его последствия.`);
        }
        dashboard.clocks = clocks.filter(c => c.progress < c.total);
      }

      // Добыча: [TAKE: Герой|Предмет] переносит предмет со сцены в инвентарь
      for (const t of parseDramaTags(aiContent).takes) {
        const name = this.game.resolveName(chars, t.name);
        const ch = (dashboard.characters || []).find(c => c.name === name);
        const loot = dashboard.sceneLoot || [];
        const q = t.item.toLowerCase();
        const idx = loot.findIndex(l => l.toLowerCase() === q || l.toLowerCase().includes(q) || q.includes(l.toLowerCase()));
        if (!ch || idx < 0) continue;
        ch.inventory = [...(ch.inventory || []), loot[idx]];
        dashboard.sceneLoot = loot.filter((_, i) => i !== idx);
      }

      // Путешествия: прибытие фиксирует движок (модель могла забыть сменить currentLocationId), перехват — оставляет на месте
      const arrival = turnUserText.match(/\[TRAVEL(?: DISCOVERY)?\][\s\S]*?currentLocationId = "([^"]+)"/)?.[1];
      if (arrival && (dashboard.locations || []).some(l => l.id === arrival)) {
        dashboard.currentLocationId = arrival;
        dashboard.locations = (dashboard.locations || []).map(l => l.id === arrival ? { ...l, status: "visited" } : l);
      } else if (/\[TRAVEL ENCOUNTER\]/.test(turnUserText)) {
        dashboard.currentLocationId = currentDashboard.currentLocationId;
      }

      // Квесты: статус меняется тегом [QUEST: Название|done/failed/active]
      const accepted = [...turnUserText.matchAll(/\[ACCEPT QUEST\][^«]*«([^»]+)»/g)].map(m => ({ title: m[1], status: "active" as const }));
      for (const q of [...accepted, ...parseDramaTags(aiContent).quests]) {
        const norm = (n: string) => String(n || "").toLowerCase().replace(/ё/g, "е").trim();
        const list = dashboard.quests || [];
        const i = list.findIndex(x => norm(x.title) === norm(q.title) || norm(x.title).includes(norm(q.title)));
        if (i >= 0) list[i] = { ...list[i], status: q.status };
        else if (q.status === "active") list.push({ id: crypto.randomUUID(), title: q.title, desc: "", status: "active" });
        dashboard.quests = list;
      }

      // Пул Рока: обнуление после мирового события и дубли Хаоса — движком
      if (this.isEnabled(mechanics, "doom_pool")) {
        const prevDoom = Number(currentDashboard.doomPool) || 0;
        const worldEvent = /\[WORLD EVENT/.test(turnUserText);
        let doom = Number(dashboard.doomPool) || 0;
        if (worldEvent && doom >= prevDoom) doom = 0;
        // +1 за каждый провал броска и каждый дубль Хаоса — даже если модель забыла поднять пул
        const fails = resolvedOutcomes(turnUserText).filter(o => o.outcome === "fail" || o.outcome === "critfail").length;
        doom = Math.max(doom, (worldEvent ? 0 : prevDoom) + rollFx.doomDoubles + fails);
        dashboard.doomPool = Math.max(0, Math.min(10, doom));
      }
    }

    let codex = [...fresh.codex];
    for (const u of parsed.codexUpdates || []) {
      if (!u || !u.name) continue;
      const i = codex.findIndex(e => e.name === u.name);
      if (i >= 0) codex[i] = { ...codex[i], ...u };
      else codex.push({ ...u, id: u.id || crypto.randomUUID() });
    }

    fresh.history = [...fresh.history, { role: "assistant", content: stripStrayTags(parsed.cleanText), dashboard }];
    fresh.codex = codex;
    if (parsed.loreUpdate) fresh.lore = parsed.loreUpdate;
    const archiveAdd = [parsed.finalDraft, parsed.sessionSummary ? `# Итоги партии\n\n${parsed.sessionSummary}` : ""].filter(Boolean).join("\n\n---\n\n");
    if (archiveAdd) fresh.archive = fresh.archive ? `${fresh.archive}\n\n---\n\n${archiveAdd}` : archiveAdd;
    saveSession(this.db, fresh);
    this.broadcast(sessionId, { type: "turn_end", sessionId, turnId, sessionSummary: parsed.sessionSummary || null });
    // Старт игры: сеттинг и завязка уже есть — генерируем таблицы оракула под них
    if (userText.startsWith("[SYSTEM COMMAND: GAME START]")) this.scheduleOracle(sessionId, "replace", { reason: "start" });
    this.broadcast(sessionId, { type: "update", sessionId });

    // Повышение уровня → ИИ придумывает уникальные способности (отдельный ход)
    if (!opts.followUp && !isClarify && this.isEnabled(mechanics, "abilities")) {
      if (leveled.length) {
        // Без отдельного платного хода: способности ИИ выдаст в следующем ответе
        this.broadcast(sessionId, { type: "level_up", sessionId, leveled });
        this.game.queueNews(sessionId, `[LEVEL UP] ${leveled.join(", ")}. Для КАЖДОГО придумай УНИКАЛЬНУЮ способность, отражающую путь героя. Тип — любой: boon (бонус), curse (шрам/проклятие от пережитого), flavor (особенность без механики) или mechanical (конкретное правило). Добавь в abilities (с полем type) в dashboard_json, старые способности сохрани. Max HP уже повышен движком.`);
      }
    }
  }

  private isEnabled(mechanics: MechanicConfig[], id: string) {
    return mechanics.find(m => m.id === id)?.enabled ?? false;
  }

  /** Провайдер оборвал поток (нет закрытого dashboard_json): срезаем недописанное и просим модель закончить ход. */
  private async repairTurn(s: StoredSession, cfg: ReturnType<Engine["effectiveConfig"]>, request: LlmRequest, partial: string) {
    console.warn(`[engine] ход оборван (${partial.length} симв.), дописываем; хвост: ${JSON.stringify(partial.slice(-160))}`);
    const head = cutToSentence(partial);
    try {
      const tail = await this.callLlm(s, cfg, {
        ...request,
        messages: [
          ...request.messages,
          { role: "assistant", content: head },
          { role: "user", content: "[SYSTEM: твой ответ оборвался из-за сбоя связи. Продолжи с места обрыва, НЕ повторяя написанное: закончи сцену 1–3 предложениями (без реплик и поступков героев игроков — только мир и NPC) и обязательно выведи все служебные блоки по формату (<dashboard_json> с вариантами действий и т. д.). Теги изменений ([DAMAGE], [XP] …), которые уже есть в тексте выше, не повторяй.]" },
        ],
      }, "turn_repair", () => undefined);
      const cleanTail = dropRepeatedLead(head, tail.replace(/^\s*(Продолжаю|Продолжение)[^\n]*\n/i, ""));
      const joined = `${head}${/^\s/.test(cleanTail) ? "" : " "}${cleanTail}`;
      return joined;
    } catch (e) {
      console.warn("[engine] не удалось дописать ход:", (e as Error).message);
      return head;
    }
  }

  /** Лор мира автора: постоянная память + карточки, о которых зашла речь в последних сообщениях. */
  private worldBlock(s: StoredSession) {
    const w = s.config.world;
    if (!w?.data) return "";
    const recent = s.history.slice(-5).map(m => m.content).join("\n");
    const { text } = worldPromptBlock({ title: w.title, data: w.data }, recent);
    let chronicle = "";
    try { chronicle = chronicleBlock(this.worldChronicle(w.id, s.id)); } catch { /* хроники может не быть */ }
    return text + chronicle + (w.data.tone ? `\nТон мира от автора: ${w.data.tone}` : "");
  }

  private buildRpgSystem(s: StoredSession, extra: string, mechanics: MechanicConfig[], dash: DashboardData, isClarify: boolean) {
    const isEnabled = (id: string) => this.isEnabled(mechanics, id);
    const filtered: any = structuredClone(dash);
    if (!isEnabled("threats_dash")) delete filtered.threats;
    if (!isEnabled("scene_aspects")) delete filtered.sceneAspects;
    if (!isEnabled("loot")) delete filtered.sceneLoot;
    if (!isEnabled("clocks")) delete filtered.clocks;
    if (!isEnabled("doom_pool")) delete filtered.doomPool;
    if (!isEnabled("echoes")) delete filtered.echoes;
    if (!isEnabled("decision_tree")) delete filtered.decisionTree;
    if (!isEnabled("threat")) delete filtered.threatLevel;
    filtered.characters = (filtered.characters || []).map((c: any) => {
      for (const [mech, field] of [["hp", "hp"], ["stress", "stress"], ["tokens", "tokens"], ["condition", "condition"], ["inventory", "inventory"], ["equipment", "equipment"], ["relationships", "relationships"], ["actions", "actions"]]) {
        if (!isEnabled(mech)) delete c[field];
      }
      return c;
    });
    const lore = s.lore ? `\n\n### ЭХО ПРОШЛОГО (Краткое содержание предыдущих событий):\n${s.lore}\n` : "";
    const codex = s.codex.length ? `\n\n### КОДЕКС (NPC, Локации, Предметы):\n${JSON.stringify(s.codex, null, 2)}\n` : "";
    const dashCtx = `\n\n### ТЕКУЩЕЕ СОСТОЯНИЕ ИГРЫ (DASHBOARD):\n${JSON.stringify(filtered, null, 2)}\nОБЯЗАТЕЛЬНО используй эти данные как основу для следующего JSON.`;
    const active = mechanics.filter(m => m.enabled).map(m => `### ${m.name}\n${m.description}`).join("\n\n");
    const mechCtx = active ? `\n\n## АКТИВНЫЕ МЕХАНИКИ\nБроски, итоги и исходы считает движок приложения — ты описываешь последствия.\n${active}` : "";
    const base = isClarify ? CLARIFY_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const style = s.style ? getStyleInstruction(s.style) : "";
    return `${base}${isClarify ? "" : mechCtx}${style}${this.worldBlock(s)}${extraInstructionsBlock(extra)}\n\n${getTechnicalInstructions(mechanics)}\n${lore}${codex}${dashCtx}`;
  }

  private async runTaleTurn(s: StoredSession, cfg: ReturnType<Engine["effectiveConfig"]>, content: string) {
    const sessionId = s.id;
    const tale = cfg.tale;
    if (s.config.tale?.finished) throw new Error("Сказка уже закончена — начните новую");
    const chapter = s.history.filter(m => m.role === "assistant").length + 1;
    const isFinal = /^\[TALE_END\]/.test(content) || chapter >= tale.chapters;
    const heroes = (lastDashboard(s.history).characters || []).map(c => `- ${c.name}${c.goal ? `: ${c.goal}` : ""}`).join("\n");
    const memory = (heroes ? `\n\n## ГЕРОИ СКАЗКИ\n${heroes}` : "") + (s.lore ? `\n\n## ПАМЯТЬ СКАЗКИ\n${s.lore}` : "");
    const request: LlmRequest = { system: getTaleSystemPrompt(tale, chapter, isFinal, isFinal ? undefined : this.taleIdeaFor(s)) + this.worldBlock(s) + extraInstructionsBlock(cfg.extraInstructions) + memory, messages: this.contextWindow(s.history, 6), temperature: 0.85 };

    const turnId = crypto.randomUUID();
    this.busy.add(sessionId);
    this.broadcast(sessionId, { type: "turn_start", sessionId, turnId });
    const stream = this.streamTo(sessionId, turnId);
    let raw: string;
    try {
      raw = await this.callLlm(s, cfg, request, "tale", stream.push);
    } finally {
      stream.end();
      this.busy.delete(sessionId);
    }

    const fresh = loadSession(this.db, sessionId) || s;
    const t = parseTale(normalizeBlocks(raw));
    // Развилка обязательна: без вариантов слушатели застрянут — даём запасные, близкие к стилю сказки
    let choices = (t.choices || []).map(c => String(c).replace(/^\s*[\d.)-]+\s*/, "").trim().slice(0, 90)).filter(Boolean);
    choices = [...new Set(choices)].slice(0, 3);
    if (!isFinal && choices.length < 2) {
      console.warn(`[tale] модель не дала вариантов, хвост ответа: ${JSON.stringify(raw.slice(-400))}`);
      // ответ оборвался (провайдер закрыл поток): срезаем недописанную фразу и коротким запросом просим концовку и развилку
      const cut = t.text.search(/[^.!?…»]*$/);
      const broken = !/[.!?…»"]\s*$/.test(t.text) && cut > t.text.length * 0.5;
      if (broken) t.text = t.text.slice(0, cut).trimEnd();
      try {
        const fix = await this.callLlm(s, cfg, {
          system: "Ты сказочник. Отвечай строго в заданном формате, без пояснений.",
          messages: [{ role: "user", content: `Конец главы сказки:\n«…${t.text.slice(-1200)}»\n\n${broken ? "Допиши одно-два коротких предложения, которыми глава закончится на интересном месте. " : ""}Предложи 3 варианта, что герои сделают дальше (до 8 слов каждый).\nФормат:\n${broken ? "<ending>концовка главы</ending>\n" : ""}<choices_json>["…","…","…"]</choices_json>` }],
          temperature: 0.7, maxTokens: 4096,
        }, "tale", () => undefined);
        const ending = fix.match(/<ending>([\s\S]*?)<\/ending>/i)?.[1]?.trim();
        if (broken && ending) t.text = `${t.text} ${ending}`;
        const more = parseTale(fix.replace(/<ending>[\s\S]*?<\/ending>/i, "")).choices.map(c => c.slice(0, 90));
        if (more.length >= 2) choices = more.slice(0, 3);
      } catch (e) { console.warn("[tale] не удалось дозапросить варианты:", (e as Error).message); }
    }
    if (!isFinal && choices.length < 2) {
      const extra = ["Пойти дальше и посмотреть, что будет", "Позвать на помощь друзей", "Остановиться и хорошенько подумать"];
      choices = [...choices, ...extra.filter(e => !choices.includes(e))].slice(0, 3);
    }
    fresh.history = [...fresh.history, { role: "assistant", content: stripStrayTags(t.text), ...(isFinal ? {} : { choices }) } as Message];
    if (t.lore) fresh.lore = t.lore;
    if (isFinal) {
      const title = t.title || fresh.name;
      const chapters = fresh.history.filter(m => m.role === "assistant").map(m => m.content.trim()).filter(Boolean);
      fresh.archive = [`# ${title}`, ...chapters, t.moral ? `*${t.moral}*` : ""].filter(Boolean).join("\n\n");
      fresh.config = { ...fresh.config, tale: { ...tale, ...(fresh.config.tale || {}), finished: true, title, moral: t.moral } };
      fresh.name = title.slice(0, 80);
    }
    saveSession(this.db, fresh);
    this.broadcast(sessionId, { type: "turn_end", sessionId, turnId, taleFinished: isFinal });
    if (content.startsWith("[TALE_START]")) this.scheduleOracle(sessionId, "replace", { reason: "start" });
    this.broadcast(sessionId, { type: "update", sessionId });
  }
}

/** Ход без закрытого dashboard_json — ответ оборвался (у живых моделей бывает обрыв потока). */
export const isTruncatedTurn = (text: string) => !/<\/dashboard_json>/i.test(text);

/** Срезаем незакрытый служебный блок и недописанную фразу. */
export const cutToSentence = (text: string) => {
  let t = text;
  const open = t.search(/<(dashboard_json|codex_json|lore_update|session_summary|final_draft|choices_json)>(?![\s\S]*<\/\1>)/i);
  if (open >= 0) t = t.slice(0, open);
  t = t.trimEnd();
  if (/[.!?…»")\]]$/.test(t)) return t;
  const cut = t.search(/[^.!?…»"\]]*$/);
  return cut > t.length * 0.5 ? t.slice(0, cut).trimEnd() : t;
};

const FALLBACK_ACTIONS = [
  { category: "Профильный", name: "Действовать по призванию", description: "Опереться на то, в чём герой силён" },
  { category: "Рискованный", name: "Пойти напролом", description: "Быстро и смело — но последствия могут ударить" },
  { category: "Синергия", name: "Разузнать подробнее", description: "Расспросить, осмотреться, найти зацепку" },
];

/** Минимум для игры: у сцены есть место, у каждого активного героя — варианты действий. */
export function ensurePlayable(d: DashboardData, setting: string) {
  if (!(d.locations || []).length) {
    const name = (setting.split(/[.,;\n]/)[1] || setting.split(/[.,;\n]/)[0] || "Место действия").trim().slice(0, 40) || "Место действия";
    d.locations = [{ id: "start", name, description: "", status: "visited", connections: [] } as any];
  }
  if (!d.currentLocationId || !(d.locations || []).some(l => l.id === d.currentLocationId)) d.currentLocationId = d.locations![0].id;
  for (const c of d.characters || []) {
    if (c.status === "base" || /повержен|мёртв|мертв/i.test(String(c.status || ""))) continue;
    if (!(c.actions || []).length) c.actions = FALLBACK_ACTIONS.map(a => ({ ...a }));
  }
}

/**
 * Служебное, что модель иногда повторяет в тексте: эхо входных тегов ([LOOT FOUND: …], [ROLL: …]),
 * недописанные теги изменений ([DAMAGE: Имя] без числа), подписи полей дашборда ([suggestedRoll] …).
 * Игроку это не нужно — чистим перед сохранением ответа.
 */
export const stripStrayTags = (text: string) => text
  .replace(/^[ \t]*\[(suggestedRoll|dashboard|actions|threats|clocks|codex)\][^\n]*\n?/gim, "")
  .replace(/^[ \t]*\[[a-z][a-z _-]{2,30}\][ \t]*\n?/gm, "")
  .replace(/\[(LOOT FOUND|LOOT|ROLL|STATE|ENCOUNTER|WORLD EVENT|MUSE|ACTION SLOTS|PLAYER ACTION|GM Rolls|ECHO RETURN|SYSTEM)[^\]\n]*\]\s*/g, "")
  .replace(/\[(DAMAGE|HEAL|STRESS|GOLD|XP|TOKEN|HIT|USE|CLOCK|TAKE|QUEST)(:[^\]\n]*)?\]/g, "")
  // пояснения к числам в скобках: «(урон 1, не 2: тропа выбрана верно)», «(−2 HP)»
  .replace(/\s*\((?=[^)]*\d)(?:урон|HP|ОЗ|хп|опыт|XP|стресс|DC|сложность|бросок|[+−-]\s*\d+\s*(?:HP|ОЗ|XP|стресс|золот))[^)]{0,100}\)/gi, "")
  .replace(/\n[ \t]+(?=[—–-]\s)/g, "\n")
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

/** Модель, дописывая оборванный ход, иногда пересказывает последнюю фразу — убираем такие повторы в начале продолжения. */
export const dropRepeatedLead = (head: string, tail: string) => {
  const words = (t: string) => new Set((t.toLowerCase().match(/[а-яёa-z]{3,}/g) || []));
  const lastSentences = head.split(/(?<=[.!?…])\s+/).slice(-2).join(" ");
  const seen = words(lastSentences);
  let rest = tail;
  for (let i = 0; i < 2; i++) {
    const m = rest.match(/^\s*[^.!?…]+[.!?…]+/);
    if (!m) break;
    const w = [...words(m[0])];
    const overlap = w.length ? w.filter(x => seen.has(x)).length / w.length : 0;
    if (overlap < 0.6) break;
    rest = rest.slice(m[0].length);
  }
  return rest.replace(/^\s+/, rest.startsWith("\n") ? "\n" : "");
};
