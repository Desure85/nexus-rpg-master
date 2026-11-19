export interface CharacterAction {
  category: string;
  name: string;
  description: string;
}

export interface Ability {
  name: string;
  desc: string;
  effect?: string;
  type?: 'boon' | 'curse' | 'flavor' | 'mechanical';
  /** Пассивный бонус к броскам «+N к <навык>» (архетип, награда за уровень) — его применяет движок */
  bonus?: string;
}

export interface Relationship {
  target: string;
  level: number; // -10 to 10
  status: string;
}

export interface Item {
  name: string;
  description?: string;
  bonus?: string;
  rarity?: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
}

export interface EquipmentSlot {
  slot: string; // head | body | main-hand | off-hand | accessory | динамические слоты сеттинга
  item: Item | string | null;
}

export const stressValue = (s: number | string | undefined): number => (typeof s === 'number' ? s : parseInt(String(s ?? '0')) || 0);
export const itemName = (item: Item | string | null | undefined): string => (!item ? '' : typeof item === 'string' ? item : item.name || '');

export interface Character {
  /** Архетип героя (shared/archetypes.ts) */
  archetype?: string;
  /** Ветеран из зала героев */
  veteranId?: string;
  name: string;
  hp: string;
  stress: number | string;
  tokens: number;
  gold?: number;
  xp?: number;
  abilities?: Ability[];
  status?: string; // active | base (на базе — отдыхает, не в сцене)
  condition: string;
  goal: string;
  actions?: CharacterAction[];
  inventory?: string[];
  equipment?: EquipmentSlot[];
  relationships?: Relationship[];
}

export interface Threat {
  name: string;
  hp: string;
  features: string[];
}

export interface Clock {
  name: string;
  progress: number;
  total: number;
}

export interface Quest {
  id: string;
  title: string;
  desc: string;
  reward?: string;
  status: 'available' | 'active' | 'done' | 'failed';
}

export interface DecisionNode {
  id: string;
  choice: string;
  status: 'active' | 'resolved';
  consequence?: string;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  travelTime?: string;
  dangerLevel?: number; // 1-5
  status?: 'visited' | 'known' | 'locked';
  type?: string; // city | village | outpost | fortress | tavern | temple | wilderness | ruins | dungeon | ...
  services?: string[]; // market / tavern / inn / smith / healer / questboard / library / stables / barracks / dock
  coordinates?: { x: number; y: number };
  connections?: string[]; // IDs of connected locations
}

export interface DashboardData {
  characters: Character[];
  threats: Threat[];
  sceneAspects: string[];
  sceneLoot?: string[];
  locations?: Location[];
  currentLocationId?: string;
  clocks: Clock[];
  doomPool: number;
  echoes: string[];
  atmosphere: string;
  quests?: Quest[];
  decisionTree?: DecisionNode[];
  threatLevel?: number;
  suggestedRoll?: {
    type: 'classic' | 'triple' | 'shifted' | 'taint';
    reason: string;
    /** Сложность, объявленная до броска (5–25, по умолчанию 12) */
    dc?: number;
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  dashboard?: DashboardData;
  /** Режим «Сказка»: варианты продолжения, предложенные сказочником */
  choices?: string[];
}

export interface CodexEntry {
  id: string;
  name: string;
  type: 'npc' | 'location' | 'item' | 'lore';
  description: string;
  status?: string;
}

export interface GameSession {
  id: string;
  name: string;
  genre: string;
  setting: string;
  style: string;
  mode?: 'short' | 'campaign' | 'tale';
  snapshot: string;
  history: Message[];
  lore: string;
  archive: string;
  codex: CodexEntry[];
  updated_at: string;
  config?: SessionConfig;
  isOwner?: boolean;
  busy?: boolean;
}

export interface SessionConfig {
  mechanics?: MechanicConfig[];
  extraInstructions?: string;
  idlePlayerAction?: 'random' | 'skip' | 'gm';
  autoApprove?: boolean;
  daily?: { key: string; modifier: string };
  tutorial?: boolean;
  world?: { id: string; title: string; version: number; genre: string; currency?: string };
  tale?: { age: '3-5' | '6-8' | '9-12' | 'adult'; chapters: number; moral?: string; finished?: boolean; title?: string };
}

export interface MechanicConfig {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
}

export interface AppSettings {
  provider: 'local' | 'gemini' | 'openrouter' | 'opencode' | 'mock';
  modelUrl: string;
  apiKey: string;
  modelName: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  extraInstructions?: string;
  fontSize: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  loggingEnabled: boolean;
  idlePlayerAction?: 'random' | 'skip' | 'gm';
  mechanics?: MechanicConfig[];
}

export type WorkspaceRole = 'owner' | 'admin' | 'gm';

export interface WorkspaceInfo {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  role?: WorkspaceRole;
  credits: number;
  plan: 'free' | 'pro';
  planExpiresAt?: string | null;
  limits: { title: string; maxSessions: number; maxHeroes: number; maxPlayers: number };
  ai: { mode: 'platform' | 'byok'; provider: string; model: string; url: string; key: string; providers: string[] };
  platformAi: { available: boolean; provider: string };
  payments: 'none' | 'yookassa' | 'mock';
}

export interface CurrentUser { id: string; email: string; name: string; isSuperadmin: boolean }

/** Подписи стандартных слотов снаряжения (модель пишет id на английском). */
export const SLOT_RU: Record<string, string> = { head: 'Голова', body: 'Тело', 'main-hand': 'Оружие', 'off-hand': 'Вторая рука', accessory: 'Аксессуар' };
export const slotLabel = (slot: string) => SLOT_RU[slot] || slot;
