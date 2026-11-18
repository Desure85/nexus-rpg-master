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
  systemPrompt?: string;
  idlePlayerAction?: 'random' | 'skip' | 'gm';
  autoApprove?: boolean;
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
  systemPrompt: string;
  fontSize: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  loggingEnabled: boolean;
  idlePlayerAction?: 'random' | 'skip' | 'gm';
  mechanics?: MechanicConfig[];
}
