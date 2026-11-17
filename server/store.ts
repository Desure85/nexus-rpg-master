import type { DB } from "./db";
import type { Message, CodexEntry, MechanicConfig, DashboardData } from "../src/types";
import type { LlmSettings, Provider } from "./llm";
import { DEFAULT_MECHANICS, SYSTEM_PROMPT, INITIAL_DASHBOARD } from "../shared/rules";
import type { TaleConfig } from "../shared/rules";
import { LEGACY_MECHANIC_DESCRIPTIONS, LEGACY_SYSTEM_PROMPTS } from "../shared/legacy-prompts";

export interface SessionConfig {
  mechanics?: MechanicConfig[];
  systemPrompt?: string;
  idlePlayerAction?: "random" | "skip" | "gm";
  autoApprove?: boolean;
  tale?: TaleConfig & { finished?: boolean; title?: string; moral?: string };
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
  owner_hash: string | null;
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

/** Публичное представление сессии: без хеша владельца; системный промпт видит только мастер. */
export const publicSession = (s: StoredSession, isOwner: boolean, busy: boolean) => {
  const { owner_hash, ...rest } = s;
  const config = { ...s.config };
  if (!isOwner) delete config.systemPrompt;
  return { ...rest, config, isOwner, busy };
};

export const sessionSummary = (s: StoredSession, busy: boolean) => ({
  id: s.id, name: s.name, setting: s.setting, style: s.style, mode: s.mode, updated_at: s.updated_at, created_at: s.created_at,
  turns: s.history.filter(m => m.role === "assistant").length, busy,
});

// ---------------------------- глобальные настройки ----------------------------

export interface GlobalSettings {
  llm: LlmSettings;
  systemPrompt: string;
  mechanics: MechanicConfig[];
  idlePlayerAction: "random" | "skip" | "gm";
  loggingEnabled: boolean;
}

const SECRET_KEYS = ["apiKey", "openRouterApiKey"] as const;

export const readSettingsRaw = (db: DB): Record<string, string> => {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.filter(r => r.value != null).map(r => [r.key, r.value]));
};

/** Сохранённые механики поверх актуальных; неотредактированные старые описания обновляются до новой версии. */
export const mergeMechanics = (stored?: MechanicConfig[] | null): MechanicConfig[] =>
  DEFAULT_MECHANICS.map(def => {
    const existing = stored?.find(p => p.id === def.id);
    if (!existing) return def;
    const legacy = LEGACY_MECHANIC_DESCRIPTIONS[def.id] || [];
    const description = !existing.description || legacy.includes(existing.description) ? def.description : existing.description;
    return { ...def, ...existing, name: def.name, description };
  });

/** Старый дефолтный промпт, сохранённый без правок, заменяем актуальным. */
export const upgradeSystemPrompt = (p?: string | null) =>
  !p || LEGACY_SYSTEM_PROMPTS.some(l => l.trim() === p.trim()) ? SYSTEM_PROMPT : p;

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
    systemPrompt: upgradeSystemPrompt(r.systemPrompt),
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
    systemPrompt: s.systemPrompt,
    mechanics: s.mechanics,
    idlePlayerAction: s.idlePlayerAction,
    loggingEnabled: s.loggingEnabled,
  };
};

export const writeSettings = (db: DB, body: Record<string, any>) => {
  const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const plain = ["provider", "modelUrl", "modelName", "openRouterModel", "systemPrompt", "idlePlayerAction"];
  db.transaction(() => {
    for (const k of plain) if (typeof body[k] === "string") upsert.run(k, body[k]);
    if (typeof body.loggingEnabled === "boolean") upsert.run("loggingEnabled", body.loggingEnabled ? "true" : "false");
    if (Array.isArray(body.mechanics)) upsert.run("mechanics", JSON.stringify(body.mechanics));
    for (const k of SECRET_KEYS) {
      const v = body[k];
      // маска «••••1234» означает «не менять»; пустая строка — удалить ключ
      if (typeof v === "string" && !v.startsWith("••••")) upsert.run(k, v.trim());
    }
  })();
};
