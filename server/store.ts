import type { DB } from "./db";
import type { Message, CodexEntry, MechanicConfig, DashboardData } from "../src/types";
import type { LlmSettings, Provider } from "./llm";
import { DEFAULT_MECHANICS, INITIAL_DASHBOARD, MECHANIC_INFO } from "../shared/rules";
import { stateWithDelta } from "../shared/world";
import type { TaleConfig } from "../shared/rules";

export interface SessionConfig {
  mechanics?: MechanicConfig[];
  /** Устарело: системный промпт больше не редактируется (игнорируется). */
  systemPrompt?: string;
  /** Пожелания мастера сверх системного промпта: стиль, тон, табу. */
  extraInstructions?: string;
  idlePlayerAction?: "random" | "skip" | "gm";
  autoApprove?: boolean;
  tale?: TaleConfig & { finished?: boolean; title?: string; moral?: string };
  /** Герои при создании: архетип и ветеран из зала героев (снимок листа) */
  heroes?: { name: string; gender?: string; concept?: string; archetype?: string; veteran?: any; veteranId?: string }[];
  /** Мир автора: снимок на момент старта (правки мира не ломают идущие партии) */
  world?: { id: string; title: string; version: number; genre: string; startLocationId?: string; data: import("../shared/world").WorldData; state?: import("../shared/world").WorldState; npcMemory?: import("../shared/world").NpcMemory[] };
  /** Сдвиги фракций и шкал мира за эту партию (применятся к миру, когда итоги станут каноном) */
  worldDelta?: import("../shared/world").WorldDelta;
  /** Испытание дня: ключ даты и условие */
  daily?: { key: string; modifier: string };
  /** Обучающая партия: мастер первые ходы показывает механики, клиент — подсказки */
  tutorial?: boolean;
}

export interface StoredSession {
  id: string;
  name: string;
  genre: string;
  setting: string;
  style: string;
  mode: "short" | "campaign" | "tale";
  snapshot: string;
  history: Message[];
  lore: string;
  archive: string;
  codex: CodexEntry[];
  config: SessionConfig;
  owner_hash?: string | null;
  workspace_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const parse = <T>(raw: any, fallback: T): T => {
  if (raw == null || raw === "") return fallback;
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
};

export const hydrate = (row: any): StoredSession => ({
  ...row,
  name: row.name || "Без названия",
  mode: row.mode || "short",
  history: parse<Message[]>(row.history, []),
  codex: parse<CodexEntry[]>(row.codex, []),
  config: parse<SessionConfig>(row.config, {}),
  lore: row.lore || "",
  archive: row.archive || "",
});

export const loadSession = (db: DB, id: string): StoredSession | null => {
  const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
  return row ? hydrate(row) : null;
};

/** Сохраняет в истории полный dashboard только у последних N сообщений — иначе JSON сессии растёт квадратично. */
export const pruneDashboards = (history: Message[], keep = 3): Message[] => {
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].dashboard) {
      seen++;
      if (seen > keep) delete history[i].dashboard;
    }
  }
  return history;
};

export const lastDashboard = (history: Message[]): DashboardData =>
  history.slice().reverse().find(m => m.dashboard)?.dashboard || structuredClone(INITIAL_DASHBOARD);

export const saveSession = (db: DB, s: StoredSession) => {
  const tree = lastDashboard(s.history).decisionTree;
  db.prepare(`UPDATE sessions SET name = ?, history = ?, lore = ?, archive = ?, codex = ?, config = ?, decision_tree = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(s.name, JSON.stringify(pruneDashboards(s.history)), s.lore, s.archive, JSON.stringify(s.codex), JSON.stringify(s.config), tree?.length ? JSON.stringify(tree) : null, s.id);
};

/** Публичное представление сессии: без хеша владельца; пожелания мастера видит только мастер. */
export const publicSession = (s: StoredSession, isOwner: boolean, busy: boolean) => {
  const { owner_hash, ...rest } = s;
  const config = { ...s.config };
  delete config.systemPrompt;
  if (config.mechanics) config.mechanics = mechanicsForClient(config.mechanics);
  if (!isOwner) delete config.extraInstructions;
  // лор мира целиком нужен только серверу; клиенту — название и id
  if (config.world) {
    const w = config.world, d = w.data;
    // фракции и шкалы с учётом сдвигов этой партии — игрокам видно, как их поступки меняют мир
    const st = d && w.state ? stateWithDelta(d, w.state, config.worldDelta) : null;
    config.world = {
      id: w.id, title: w.title, version: w.version, genre: w.genre,
      ...(d?.currency ? { currency: d.currency } : {}),
      ...(st && d?.factions?.length ? { factions: d.factions.map(f => ({ name: f.name, attitude: st.factions[f.id], delta: config.worldDelta?.factions?.[f.id] || 0 })) } : {}),
      ...(st && d?.clocks?.length ? { clocks: d.clocks.map(c => ({ name: c.name, value: st.clocks[c.id], max: c.max, delta: config.worldDelta?.clocks?.[c.id] || 0 })) } : {}),
    } as any;
    delete config.worldDelta;
  }
  return { ...rest, config, isOwner, busy };
};

export const sessionSummary = (s: StoredSession, busy: boolean) => ({
  id: s.id, name: s.name, setting: s.setting, style: s.style, mode: s.mode, updated_at: s.updated_at, created_at: s.created_at,
  turns: s.history.filter(m => m.role === "assistant").length, busy,
});

// ---------------------------- глобальные настройки ----------------------------

export interface GlobalSettings {
  llm: LlmSettings;
  extraInstructions: string;
  mechanics: MechanicConfig[];
  idlePlayerAction: "random" | "skip" | "gm";
  loggingEnabled: boolean;
}

const SECRET_KEYS = ["apiKey", "openRouterApiKey"] as const;

export const readSettingsRaw = (db: DB): Record<string, string> => {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.filter(r => r.value != null).map(r => [r.key, r.value]));
};

export const MAX_EXTRA_INSTRUCTIONS = 3000;
export const cleanExtra = (v: unknown) => typeof v === "string" ? v.trim().slice(0, MAX_EXTRA_INSTRUCTIONS) : undefined;

/** Из сохранённого берём только «включено/выключено»: тексты механик — часть системного промпта и живут в коде. */
export const mergeMechanics = (stored?: MechanicConfig[] | null): MechanicConfig[] =>
  DEFAULT_MECHANICS.map(def => {
    const existing = stored?.find(p => p.id === def.id);
    if (MECHANIC_INFO[def.id]?.core) return { ...def, enabled: true }; // без них игра не работает
    return existing && typeof existing.enabled === "boolean" ? { ...def, enabled: existing.enabled } : def;
  });

/** Для клиента: механики без внутренних текстов промпта. */
export const mechanicsForClient = (m: MechanicConfig[]) => m.map(({ id, name, enabled }) => ({ id, name, enabled, description: "" }));

export const readSettings = (db: DB): GlobalSettings => {
  const r = readSettingsRaw(db);
  return {
    llm: {
      provider: (r.provider as Provider) || (process.env.DEFAULT_PROVIDER as Provider) || "gemini",
      modelUrl: r.modelUrl || undefined,
      apiKey: r.apiKey || undefined,
      modelName: r.modelName || undefined,
      openRouterApiKey: r.openRouterApiKey || undefined,
      openRouterModel: r.openRouterModel || undefined,
    },
    extraInstructions: r.extraInstructions || "",
    mechanics: mergeMechanics(parse<MechanicConfig[] | null>(r.mechanics, null)),
    idlePlayerAction: (r.idlePlayerAction as any) || "random",
    loggingEnabled: r.loggingEnabled === "true",
  };
};

const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : "");

/** Настройки для UI: секреты заменены маской. */
export const settingsForClient = (db: DB) => {
  const s = readSettings(db);
  return {
    provider: s.llm.provider,
    modelUrl: s.llm.modelUrl || "",
    modelName: s.llm.modelName || "",
    openRouterModel: s.llm.openRouterModel || "",
    apiKey: mask(s.llm.apiKey),
    openRouterApiKey: mask(s.llm.openRouterApiKey),
    extraInstructions: s.extraInstructions,
    mechanics: mechanicsForClient(s.mechanics),
    idlePlayerAction: s.idlePlayerAction,
    loggingEnabled: s.loggingEnabled,
  };
};

export const writeSettings = (db: DB, body: Record<string, any>) => {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const plain = ["provider", "modelUrl", "modelName", "openRouterModel", "idlePlayerAction"];
  db.transaction(() => {
    for (const k of plain) if (typeof body[k] === "string") upsert.run(k, body[k]);
    if (typeof body.extraInstructions === "string") upsert.run("extraInstructions", cleanExtra(body.extraInstructions)!);
    if (typeof body.loggingEnabled === "boolean") upsert.run("loggingEnabled", body.loggingEnabled ? "true" : "false");
    if (Array.isArray(body.mechanics)) upsert.run("mechanics", JSON.stringify(body.mechanics.map((m: any) => ({ id: String(m.id), enabled: !!m.enabled }))));
    for (const k of SECRET_KEYS) {
      const v = body[k];
      // маска «••••1234» означает «не менять»; пустая строка — удалить ключ
      if (typeof v === "string" && !v.startsWith("••••")) upsert.run(k, v.trim());
    }
  })();
};
