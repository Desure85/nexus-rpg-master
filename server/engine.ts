import crypto from "crypto";
import type { DB } from "./db";
import type { GameApi } from "./game";
import { complete, type ChatMessage, type LlmRequest } from "./llm";
import { loadSession, saveSession, lastDashboard, readSettings, mergeMechanics, type StoredSession, type SessionConfig } from "./store";
import {
  CLARIFY_SYSTEM_PROMPT, getTechnicalInstructions, getStyleInstruction, getTaleSystemPrompt, levelFromXp,
  META_COMMAND_RE, IDLE_RULES, type TaleConfig,
} from "../shared/rules";
import { parseDashboard, parseStateTags, parseSideTags, parseTale } from "../shared/parse";
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

  constructor(private db: DB, private game: GameApi, private broadcast: Broadcast) {}

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
      const live = chains.filter(Boolean);
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
        this.broadcast(sessionId, { type: "turn_error", sessionId, error: e?.message || "Ошибка хода" });
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
        : `[ROUND] Игроки прислали действия (сообщения [PLAYER ACTION] выше). Обработай ВСЕ действия сразу и дай сцену-ответ каждому. ${IDLE_RULES[cfg.idlePlayerAction] || IDLE_RULES.random}`;
      try {
        await this.runTurn(sessionId, content, {});
      } catch (e: any) {
        console.error(`[round ${sessionId}]`, e?.message || e);
        this.broadcast(sessionId, { type: "turn_error", sessionId, error: e?.message || "Ошибка хода" });
      } finally {
        if (!this.isBusy(sessionId)) this.broadcast(sessionId, { type: "busy", sessionId, busy: false });
      }
      return pending.length;
    });
  }

  effectiveConfig(s: StoredSession) {
    const g = readSettings(this.db);
    const c: SessionConfig = s.config || {};
    return {
      llm: g.llm,
      loggingEnabled: g.loggingEnabled,
      systemPrompt: c.systemPrompt || g.systemPrompt,
      mechanics: c.mechanics ? mergeMechanics(c.mechanics) : g.mechanics,
      idlePlayerAction: c.idlePlayerAction || g.idlePlayerAction,
      tale: { ...DEFAULT_TALE, ...(c.tale || {}) },
    };
  }

  private log(enabled: boolean, sessionId: string, request: LlmRequest, response: string) {
    if (!enabled) return;
    this.db.prepare("INSERT INTO logs (session_id, request, response) VALUES (?, ?, ?)").run(sessionId, JSON.stringify(request), response);
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

  private async runTurn(sessionId: string, content: string, opts: TurnOptions) {
    const s = loadSession(this.db, sessionId);
    if (!s) throw new Error("Сессия не найдена");
    const cfg = this.effectiveConfig(s);
    const isTale = s.mode === "tale";

    let finalContent = (content || "").trim();
    if (opts.rolls?.length) finalContent += (finalContent ? "\n\n" : "") + `### GM Rolls:\n${opts.rolls.join("\n")}`;

    if (finalContent) {
      if (!isTale && !META_COMMAND_RE.test(finalContent)) {
        const ec = this.game.encounterCheck(sessionId, s.style || "balanced", false);
        if (ec.tag) finalContent += `\n\n${ec.tag}`;
        const chars = this.game.ensureEngineState(sessionId);
        const stateTag = this.game.stateToTag(chars);
        if (stateTag) finalContent += `\n\n[STATE: ${stateTag}]`;
      }
      s.history.push({ role: "user", content: finalContent });
      saveSession(this.db, s);
      this.broadcast(sessionId, { type: "update", sessionId });
    } else if (s.history[s.history.length - 1]?.role !== "user") {
      return; // нечего обрабатывать
    }

    if (isTale) return this.runTaleTurn(s, cfg, finalContent);

    const userText = s.history[s.history.length - 1].content;
    const isClarify = userText.startsWith("[CLARIFY]");
    const currentDashboard = lastDashboard(s.history);
    const mechanics = cfg.mechanics;
    const system = this.buildRpgSystem(s, cfg.systemPrompt, mechanics, currentDashboard, isClarify);
    const request: LlmRequest = { system, messages: this.contextWindow(s.history) };

    const turnId = crypto.randomUUID();
    this.busy.add(sessionId);
    this.broadcast(sessionId, { type: "turn_start", sessionId, turnId });
    const stream = this.streamTo(sessionId, turnId);
    let aiContent: string;
    try {
      aiContent = await complete(cfg.llm, request, stream.push);
    } finally {
      stream.end();
      this.busy.delete(sessionId);
    }
    this.log(cfg.loggingEnabled, sessionId, request, aiContent);

    // Перечитываем сессию: пока модель думала, никто не мог её поменять (очередь), но конфиг/имя — могли
    const fresh = loadSession(this.db, sessionId) || s;
    const { clean: cleanAi, changes } = parseStateTags(aiContent);
    const parsed = parseDashboard(cleanAi, currentDashboard);

    const side = parseSideTags(aiContent);
    for (const t of side.trophies) this.db.prepare("INSERT INTO collection (id, session_id, name, desc, type) VALUES (?,?,?,?, 'trophy')").run(crypto.randomUUID(), sessionId, t.name, t.desc);
    for (const f of side.fronts) this.db.prepare("INSERT INTO fronts (id, session_id, name, impulse, portents, doom) VALUES (?,?,?,?,?,?)").run(crypto.randomUUID(), sessionId, f.name, f.impulse, JSON.stringify(f.portents), f.doom);
    for (const m of side.memorials) this.db.prepare("INSERT INTO memorial (id, session_id, name, desc) VALUES (?,?,?,?)").run(crypto.randomUUID(), sessionId, m.name, m.desc);

    let dashboard: DashboardData = isClarify ? currentDashboard : (parsed.dashboard || structuredClone(currentDashboard));
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
      const applied = this.game.applyStateChanges(chars, changes);
      if (added || applied.length) this.game.saveEngineState(sessionId, chars);
      dashboard = this.game.mergeStateIntoDashboard(dashboard, chars);
    }

    let codex = [...fresh.codex];
    for (const u of parsed.codexUpdates || []) {
      if (!u || !u.name) continue;
      const i = codex.findIndex(e => e.name === u.name);
      if (i >= 0) codex[i] = { ...codex[i], ...u };
      else codex.push({ ...u, id: u.id || crypto.randomUUID() });
    }

    fresh.history = [...fresh.history, { role: "assistant", content: parsed.cleanText, dashboard }];
    fresh.codex = codex;
    if (parsed.loreUpdate) fresh.lore = parsed.loreUpdate;
    const archiveAdd = [parsed.finalDraft, parsed.sessionSummary ? `# Итоги партии\n\n${parsed.sessionSummary}` : ""].filter(Boolean).join("\n\n---\n\n");
    if (archiveAdd) fresh.archive = fresh.archive ? `${fresh.archive}\n\n---\n\n${archiveAdd}` : archiveAdd;
    saveSession(this.db, fresh);
    this.broadcast(sessionId, { type: "turn_end", sessionId, turnId, sessionSummary: parsed.sessionSummary || null });
    this.broadcast(sessionId, { type: "update", sessionId });

    // Повышение уровня → ИИ придумывает уникальные способности (отдельный ход)
    if (!opts.followUp && !isClarify && this.isEnabled(mechanics, "abilities")) {
      const leveled: string[] = [];
      for (const nc of dashboard.characters || []) {
        const prev = (currentDashboard.characters || []).find(c => c.name === nc.name);
        if (prev && levelFromXp(Number(nc.xp || 0)) > levelFromXp(Number(prev.xp || 0))) leveled.push(`${nc.name} → уровень ${levelFromXp(Number(nc.xp || 0))}`);
      }
      if (leveled.length) {
        this.enqueueTurn(sessionId, `[LEVEL UP] ${leveled.join(", ")}. Для КАЖДОГО придумай УНИКАЛЬНУЮ способность, отражающую путь героя. Тип — любой: boon (бонус), curse (шрам/проклятие от пережитого), flavor (особенность без механики) или mechanical (конкретное правило). Добавь в abilities (с полем type) в dashboard_json.`, { followUp: true });
      }
    }
  }

  private isEnabled(mechanics: MechanicConfig[], id: string) {
    return mechanics.find(m => m.id === id)?.enabled ?? false;
  }

  private buildRpgSystem(s: StoredSession, basePrompt: string, mechanics: MechanicConfig[], dash: DashboardData, isClarify: boolean) {
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
    const mechCtx = active ? `\n\n## АКТИВНЫЕ МЕХАНИКИ\nПроверки выполняются тобой. Стат всегда суммируется с итоговым кубиком.\n${active}` : "";
    const base = isClarify ? CLARIFY_SYSTEM_PROMPT : basePrompt;
    const style = s.style ? getStyleInstruction(s.style) : "";
    return `${base}${isClarify ? "" : mechCtx}${style}\n\n${getTechnicalInstructions(mechanics)}\n${lore}${codex}${dashCtx}`;
  }

  private async runTaleTurn(s: StoredSession, cfg: ReturnType<Engine["effectiveConfig"]>, content: string) {
    const sessionId = s.id;
    const tale = cfg.tale;
    if (s.config.tale?.finished) throw new Error("Сказка уже закончена — начните новую");
    const chapter = s.history.filter(m => m.role === "assistant").length + 1;
    const isFinal = /^\[TALE_END\]/.test(content) || chapter >= tale.chapters;
    const heroes = (lastDashboard(s.history).characters || []).map(c => `- ${c.name}${c.goal ? `: ${c.goal}` : ""}`).join("\n");
    const memory = (heroes ? `\n\n## ГЕРОИ СКАЗКИ\n${heroes}` : "") + (s.lore ? `\n\n## ПАМЯТЬ СКАЗКИ\n${s.lore}` : "");
    const request: LlmRequest = { system: getTaleSystemPrompt(tale, chapter, isFinal) + memory, messages: this.contextWindow(s.history, 6), temperature: 0.85 };

    const turnId = crypto.randomUUID();
    this.busy.add(sessionId);
    this.broadcast(sessionId, { type: "turn_start", sessionId, turnId });
    const stream = this.streamTo(sessionId, turnId);
    let raw: string;
    try {
      raw = await complete(cfg.llm, request, stream.push);
    } finally {
      stream.end();
      this.busy.delete(sessionId);
    }
    this.log(cfg.loggingEnabled, sessionId, request, raw);

    const fresh = loadSession(this.db, sessionId) || s;
    const t = parseTale(raw);
    fresh.history = [...fresh.history, { role: "assistant", content: t.text, ...(isFinal ? {} : { choices: t.choices }) } as Message];
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
    this.broadcast(sessionId, { type: "update", sessionId });
  }
}
