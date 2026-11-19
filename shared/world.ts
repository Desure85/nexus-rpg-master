// Миры: шаблон игры от автора — паспорт, лор (постоянная память + карточки по ключам), карта, сценарии, герои.
// Общий код сервера и клиента: нормализация (защита от мусора и раздувания) и выбор карточек лора для промпта.
import type { Genre } from './genre';

export const WORLD_GENRES: { id: Genre; name: string }[] = [
  { id: 'fantasy', name: 'Фэнтези' }, { id: 'horror', name: 'Мистика и хоррор' }, { id: 'cyber', name: 'Киберпанк' },
  { id: 'space', name: 'Космос' }, { id: 'post', name: 'Постапокалипсис' }, { id: 'west', name: 'Вестерн' },
];

export type LoreKind = 'npc' | 'place' | 'faction' | 'item' | 'lore';
export const LORE_KINDS: { id: LoreKind; name: string; icon: string }[] = [
  { id: 'npc', name: 'Персонаж', icon: '🧑' }, { id: 'place', name: 'Место', icon: '🏰' }, { id: 'faction', name: 'Фракция', icon: '⚑' },
  { id: 'item', name: 'Предмет', icon: '🗝️' }, { id: 'lore', name: 'История и правила мира', icon: '📜' },
];

export interface LoreCard {
  id: string;
  kind: LoreKind;
  name: string;
  /** Слова, при упоминании которых карточка попадает к мастеру (имя карточки — всегда ключ) */
  keys: string[];
  text: string;
  /** Всегда в памяти мастера */
  always?: boolean;
}

export interface WorldLocation {
  id: string; name: string; description: string;
  type?: string; services?: string[]; dangerLevel?: number; connections?: string[];
}

export interface WorldHero { name: string; concept: string; gender: 'М' | 'Ж'; archetype?: string }

export interface WorldScenario {
  id: string; title: string; hook: string;
  mode: 'short' | 'campaign' | 'tale';
  startLocationId?: string;
  heroes?: WorldHero[];
}

export interface WorldData {
  setting: string;          // короткое описание мира — уходит как сеттинг партии
  core: string;             // постоянная память мастера
  tone?: string;            // пожелания мастеру (тон, табу)
  cards: LoreCard[];
  locations: WorldLocation[];
  scenarios: WorldScenario[];
  heroes: WorldHero[];
}

export interface World {
  id: string;
  title: string;
  icon: string;
  genre: Genre;
  description: string;
  visibility: 'private' | 'link' | 'public';
  version: number;
  data: WorldData;
  owner_id?: string;
  author?: string;
  plays?: number;
  updated_at?: string;
  mine?: boolean;
}

export const WORLD_LIMITS = { cards: 80, cardText: 1500, keys: 10, core: 3000, setting: 1500, tone: 1500, locations: 40, scenarios: 12, heroes: 12, hook: 1500 };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v : '').trim().slice(0, max);
const slug = (v: string, i: number) => (v || '').toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || `id-${i}`;
const uniq = <T,>(arr: T[], key: (x: T) => string) => { const seen = new Set<string>(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** Приводит присланные данные мира к безопасному виду (длины, типы, уникальные id, связи только на существующие места). */
export function normalizeWorldData(raw: any): WorldData {
  const d = raw && typeof raw === 'object' ? raw : {};
  const cards: LoreCard[] = uniq((Array.isArray(d.cards) ? d.cards : []).slice(0, WORLD_LIMITS.cards).map((c: any, i: number) => ({
    id: str(c?.id, 40) || `c${i}`,
    kind: (LORE_KINDS.some(k => k.id === c?.kind) ? c.kind : 'lore') as LoreKind,
    name: str(c?.name, 80),
    keys: (Array.isArray(c?.keys) ? c.keys : String(c?.keys || '').split(',')).map((k: any) => str(k, 40)).filter(Boolean).slice(0, WORLD_LIMITS.keys),
    text: str(c?.text, WORLD_LIMITS.cardText),
    ...(c?.always ? { always: true } : {}),
  })).filter((c: LoreCard) => c.name && c.text), (c: LoreCard) => c.id);
  const locations: WorldLocation[] = uniq((Array.isArray(d.locations) ? d.locations : []).slice(0, WORLD_LIMITS.locations).map((l: any, i: number) => ({
    id: str(l?.id, 40) || slug(str(l?.name, 60), i),
    name: str(l?.name, 60),
    description: str(l?.description, 600),
    type: str(l?.type, 20) || undefined,
    services: (Array.isArray(l?.services) ? l.services : []).map((x: any) => str(x, 20)).filter(Boolean).slice(0, 10),
    dangerLevel: Math.min(5, Math.max(1, Number(l?.dangerLevel) || 1)),
    connections: (Array.isArray(l?.connections) ? l.connections : []).map((x: any) => str(x, 40)).filter(Boolean),
  })).filter((l: WorldLocation) => l.name), (l: WorldLocation) => l.id);
  const ids = new Set(locations.map(l => l.id));
  for (const l of locations) l.connections = (l.connections || []).filter(c => ids.has(c) && c !== l.id);
  // связи взаимные
  for (const l of locations) for (const c of l.connections || []) { const o = locations.find(x => x.id === c)!; if (!o.connections!.includes(l.id)) o.connections!.push(l.id); }
  const hero = (h: any): WorldHero | null => {
    const name = str(h?.name, 60);
    return name ? { name, concept: str(h?.concept, 300), gender: h?.gender === 'Ж' ? 'Ж' : 'М', ...(str(h?.archetype, 20) ? { archetype: str(h.archetype, 20) } : {}) } : null;
  };
  const heroes = uniq((Array.isArray(d.heroes) ? d.heroes : []).map(hero).filter(Boolean) as WorldHero[], h => h.name).slice(0, WORLD_LIMITS.heroes);
  const scenarios: WorldScenario[] = uniq((Array.isArray(d.scenarios) ? d.scenarios : []).slice(0, WORLD_LIMITS.scenarios).map((sc: any, i: number) => ({
    id: str(sc?.id, 40) || `s${i}`,
    title: str(sc?.title, 80),
    hook: str(sc?.hook, WORLD_LIMITS.hook),
    mode: (['short', 'campaign', 'tale'].includes(sc?.mode) ? sc.mode : 'short') as WorldScenario['mode'],
    ...(ids.has(str(sc?.startLocationId, 40)) ? { startLocationId: str(sc.startLocationId, 40) } : {}),
    heroes: (Array.isArray(sc?.heroes) ? sc.heroes : []).map(hero).filter(Boolean).slice(0, 6) as WorldHero[],
  })).filter((sc: WorldScenario) => sc.title && sc.hook), (sc: WorldScenario) => sc.id);
  return {
    setting: str(d.setting, WORLD_LIMITS.setting),
    core: str(d.core, WORLD_LIMITS.core),
    tone: str(d.tone, WORLD_LIMITS.tone) || undefined,
    cards, locations, scenarios, heroes,
  };
}

/** Основа слова для поиска в русском тексте: «Сетта» найдётся в «Сетту», «Сеттой». */
const stem = (k: string) => {
  const w = k.toLowerCase().trim();
  return w.length > 5 ? w.slice(0, w.length - 2) : w.length > 3 ? w.slice(0, w.length - 1) : w;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Сработала ли карточка: любое из ключей (или имя) встречается в тексте с начала слова. */
export function cardTriggered(card: LoreCard, text: string) {
  const t = text.toLowerCase();
  return [card.name, ...card.keys].some(k => {
    // ключ из нескольких слов — каждое слово по основе
    const parts = k.split(/\s+/).filter(Boolean).map(stem).filter(p => p.length >= 2);
    if (!parts.length) return false;
    return new RegExp(parts.map(p => `(?:^|[^a-zа-яё0-9])${esc(p)}`).join('[\\s\\S]{0,40}'), 'i').test(t);
  });
}

/**
 * Блок мира для системного промпта: постоянная память + карточки, о которых зашла речь в последних сообщениях.
 * Бюджет символов не даёт разрастись промпту, когда лор большой.
 */
export function worldPromptBlock(w: Pick<World, 'title'> & { data: WorldData }, recentText: string, budget = 5000): { text: string; used: string[] } {
  const d = w.data;
  const always = d.cards.filter(c => c.always);
  const hit = d.cards.filter(c => !c.always && cardTriggered(c, recentText));
  const used: string[] = [];
  let left = budget - d.core.length;
  const lines: string[] = [];
  for (const c of [...always, ...hit]) {
    const line = `- ${LORE_KINDS.find(k => k.id === c.kind)?.icon || ''} ${c.name}: ${c.text}`;
    if (line.length > left) continue;
    left -= line.length;
    lines.push(line);
    used.push(c.id);
  }
  const places = d.locations.length ? `\nМеста мира: ${d.locations.map(l => l.name).join(', ')}.` : '';
  const text = `\n\n## МИР «${w.title}» (канон автора — не противоречь ему)\n${d.core}${places}${lines.length ? `\n### Справка по тому, что сейчас в сцене\n${lines.join('\n')}` : ''}`;
  return { text, used };
}

export const emptyWorldData = (): WorldData => ({ setting: '', core: '', cards: [], locations: [], scenarios: [], heroes: [] });
