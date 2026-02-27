export interface CharacterAction {
  category: string;
  name: string;
  description: string;
}

export interface Relationship {
  target: string;
  level: number; // -10 to 10
  status: string;
}

export interface Character {
  name: string;
  hp: string;
  stress: number;
  tokens: number;
  condition: string;
  goal: string;
  actions?: CharacterAction[];
  inventory?: string[];
  relationships?: Relationship[];
}

export interface Threat {
  name: string;
  hp: string;
  features: string;
}

export interface SceneAspect {
  name: string;
  description: string;
}

export interface Clock {
  name: string;
  progress: number;
  total: number;
}

export interface DashboardData {
  characters: Character[];
  threats: Threat[];
  sceneAspects: SceneAspect[];
  clocks: Clock[];
  doomPool: number;
  echoes: string[];
  atmosphere: string;
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
  snapshot: string;
  history: Message[];
  lore: string;
  codex: CodexEntry[];
  updated_at: string;
}

export interface MechanicConfig {
  id: string;
  name: string;
  enabled: boolean;
  description: string;
}

export interface AppSettings {
  provider: 'local' | 'gemini';
  modelUrl: string;
  apiKey: string;
  modelName: string;
  systemPrompt: string;
  fontSize: number;
  fontFamily: 'sans' | 'serif' | 'mono';
  loggingEnabled: boolean;
  mechanics?: MechanicConfig[];
}
