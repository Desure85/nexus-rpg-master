// Миры: шаблон игры от автора — паспорт, лор (постоянная память + карточки по ключам), карта, сценарии, герои.
// Общий код сервера и клиента: нормализация (защита от мусора и раздувания) и выбор карточек лора для промпта.
import type { Genre, LootTier } from './genre';
import { ENEMY_TIERS } from './balance';

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

export type EnemyTier = keyof typeof ENEMY_TIERS;
export const ENEMY_TIER_LIST: { id: EnemyTier; name: string }[] = [
  { id: 'minion', name: 'Приспешник' }, { id: 'regular', name: 'Обычный' }, { id: 'elite', name: 'Опасный' }, { id: 'boss', name: 'Босс' },
];

/** Враг бестиария: числа по рангу из баланса, автор может уточнить в разумных пределах — их держит движок. */
export interface WorldEnemy { id: string; name: string; tier: EnemyTier; hp?: number; dmg?: number; dc?: number; traits: string }

/** Предмет мира: эффект и бонус пишутся в название — так их понимает движок (расходники, снаряжение). */
export interface WorldItem {
  id: string; name: string;
  kind: 'consumable' | 'gear' | 'misc';
  heal?: number; calm?: number;      // расходник: +HP, −стресс
  bonus?: string;                    // снаряжение: «+1 к атаке»
  price?: number; inShop?: boolean;  // лавка
  rarity?: LootTier;                 // добыча при обыске
  desc?: string;
}

/** Фракция мира: отношение к героям от −3 (война) до +3 (преданы) — общее для всех партий мира. */
export interface WorldFaction { id: string; name: string; desc: string; attitude: number }
/** Шкала мира: надвигающаяся угроза или план, общий для всех партий; заполнилась — событие мира. */
export interface WorldClock { id: string; name: string; max: number; value: number; onFull: string }
/** Текущее состояние мира (меняется итогами партий): id → значение */
export interface WorldState { factions: Record<string, number>; clocks: Record<string, number> }

export const ATTITUDES: Record<string, string> = { '-3': 'война', '-2': 'враждебны', '-1': 'настороже', '0': 'нейтральны', '1': 'расположены', '2': 'союзники', '3': 'преданы' };
export const attitudeLabel = (n: number) => ATTITUDES[String(Math.max(-3, Math.min(3, Math.round(n))))];

export interface WorldData {
  setting: string;          // короткое описание мира — уходит как сеттинг партии
  core: string;             // постоянная память мастера
  tone?: string;            // пожелания мастеру (тон, табу)
  cards: LoreCard[];
  locations: WorldLocation[];
  scenarios: WorldScenario[];
  heroes: WorldHero[];
  enemies?: WorldEnemy[];
  items?: WorldItem[];
  /** Название денег мира: «раковины», «кредиты» */
  currency?: string;
  /** Лавки продают только предметы мира (иначе — вдобавок к товарам жанра) */
  shopReplace?: boolean;
  factions?: WorldFaction[];
  clocks?: WorldClock[];
  /** Живой мир: итоги партий попадают в хронику — off / review (автор принимает) / auto */
  living?: 'off' | 'review' | 'auto';
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
  likes?: number;
  liked?: boolean;
  /** записей хроники в каноне; новых — ждут автора (только для автора) */
  chronicle?: number;
  chronicleNew?: number;
  hidden?: boolean;
  updated_at?: string;
  mine?: boolean;
  /** текущее состояние фракций и шкал (только в полном виде мира) */
  state?: WorldState;
}

export const WORLD_LIMITS = { factions: 12, clocks: 8, enemies: 40, items: 60, cards: 80, cardText: 1500, keys: 10, core: 3000, setting: 1500, tone: 1500, locations: 40, scenarios: 12, heroes: 12, hook: 1500 };

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
  const num = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo ? Math.min(hi, n) : undefined; };
  const enemies: WorldEnemy[] = uniq((Array.isArray(d.enemies) ? d.enemies : []).slice(0, WORLD_LIMITS.enemies).map((e: any, i: number) => ({
    id: str(e?.id, 40) || `e${i}`,
    name: str(e?.name, 60),
    tier: (e?.tier in ENEMY_TIERS ? e.tier : 'regular') as EnemyTier,
    ...(num(e?.hp, 1, 60) ? { hp: num(e.hp, 1, 60) } : {}),
    ...(num(e?.dmg, 1, 10) ? { dmg: num(e.dmg, 1, 10) } : {}),
    ...(num(e?.dc, 5, 25) ? { dc: num(e.dc, 5, 25) } : {}),
    traits: str(e?.traits, 400),
  })).filter((e: WorldEnemy) => e.name), (e: WorldEnemy) => e.name.toLowerCase());
  const items: WorldItem[] = uniq((Array.isArray(d.items) ? d.items : []).slice(0, WORLD_LIMITS.items).map((it: any, i: number) => {
    const kind = (['consumable', 'gear', 'misc'].includes(it?.kind) ? it.kind : 'misc') as WorldItem['kind'];
    const bonus = str(it?.bonus, 30).match(/^[+−-]?\s*\d+\s+к\s+[а-яё]+/i)?.[0];
    return {
      id: str(it?.id, 40) || `i${i}`,
      name: str(it?.name, 60).replace(/[()]/g, ''),
      kind,
      ...(kind === 'consumable' && num(it?.heal, 1, 20) ? { heal: num(it.heal, 1, 20) } : {}),
      ...(kind === 'consumable' && num(it?.calm, 1, 5) ? { calm: num(it.calm, 1, 5) } : {}),
      ...(kind === 'gear' && bonus ? { bonus: bonus.replace(/^(\d)/, '+$1').replace('−', '-') } : {}),
      ...(num(it?.price, 1, 500) ? { price: num(it.price, 1, 500) } : {}),
      ...(it?.inShop && num(it?.price, 1, 500) ? { inShop: true } : {}),
      ...(['common', 'uncommon', 'rare', 'epic'].includes(it?.rarity) ? { rarity: it.rarity } : {}),
      ...(str(it?.desc, 300) ? { desc: str(it.desc, 300) } : {}),
    };
  }).filter((it: WorldItem) => it.name), (it: WorldItem) => it.name.toLowerCase());
  const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const factions: WorldFaction[] = uniq((Array.isArray(d.factions) ? d.factions : []).slice(0, WORLD_LIMITS.factions).map((f: any, i: number) => ({
    id: str(f?.id, 40) || `f${i}`, name: str(f?.name, 60), desc: str(f?.desc, 400), attitude: clamp(f?.attitude, -3, 3, 0),
  })).filter((f: WorldFaction) => f.name), (f: WorldFaction) => f.id);
  const clocks: WorldClock[] = uniq((Array.isArray(d.clocks) ? d.clocks : []).slice(0, WORLD_LIMITS.clocks).map((c: any, i: number) => {
    const max = clamp(c?.max, 3, 12, 6);
    return { id: str(c?.id, 40) || `k${i}`, name: str(c?.name, 60), max, value: clamp(c?.value, 0, max - 1, 0), onFull: str(c?.onFull, 400) };
  }).filter((c: WorldClock) => c.name), (c: WorldClock) => c.id);
  return {
    ...(factions.length ? { factions } : {}), ...(clocks.length ? { clocks } : {}),
    enemies, items,
    ...(str(d.currency, 30) ? { currency: str(d.currency, 30) } : {}),
    ...(d.shopReplace && items.some(i => i.inShop) ? { shopReplace: true } : {}),
    ...(d.living === 'off' || d.living === 'auto' ? { living: d.living } : {}),
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
  const bestiary = (d.enemies || []).length
    ? `\n### Бестиарий мира (вводи врагов отсюда, HP пиши ровно такими — движок их проверяет)\n${d.enemies!.map(e => { const st = enemyStats(e); return `- ${e.name} — ${ENEMY_TIERS[e.tier].name}, HP ${st.hp}, DC ${st.dc}, урон ${st.dmg}${e.traits ? `: ${e.traits}` : ''}`; }).join('\n')}`
    : '';
  const goods = (d.items || []).length
    ? `\n### Предметы мира (в добыче и наградах используй их названия как есть — со скобками эффекта)\n${d.items!.map(i => `- ${itemLabel(i)}${i.desc ? ` — ${i.desc}` : ''}`).join('\n')}`
    : '';
  const money = d.currency ? `\nДеньги мира называются «${d.currency}» — так и пиши в тексте (в цифрах это gold героя).` : '';
  const text = `\n\n## МИР «${w.title}» (канон автора — не противоречь ему)\n${d.core}${places}${money}${lines.length ? `\n### Справка по тому, что сейчас в сцене\n${lines.join('\n')}` : ''}${bestiary}${goods}`;
  return { text, used };
}

export const emptyWorldData = (): WorldData => ({ setting: '', core: '', cards: [], locations: [], scenarios: [], heroes: [], enemies: [], items: [] });

/** Числа врага: заданные автором или середина диапазона ранга. */
export const enemyStats = (e: Pick<WorldEnemy, 'tier' | 'hp' | 'dmg' | 'dc'>) => {
  const t = ENEMY_TIERS[e.tier] || ENEMY_TIERS.regular;
  return { hp: e.hp ?? Math.round((t.hp[0] + t.hp[1]) / 2), dmg: e.dmg ?? t.dmg[1], dc: e.dc ?? t.dc };
};

/** Название предмета с эффектом в скобках: «Свеча маяка (+3 HP, снимает 1 стресс)», «Гарпун (+1 к атаке)». */
export const itemLabel = (i: WorldItem) => {
  const fx = i.kind === 'consumable'
    ? [i.heal ? `+${i.heal} HP` : '', i.calm ? `снимает ${i.calm} ${i.calm === 1 ? 'стресс' : 'стресса'}` : ''].filter(Boolean).join(', ')
    : i.kind === 'gear' ? (i.bonus || '') : '';
  return fx ? `${i.name} (${fx})` : i.name;
};

const normName = (n: string) => String(n || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, '').trim();
/** Враг бестиария для угрозы на сцене: «Безымянный №2», «стая безымянных» → «Безымянный». */
export const findEnemy = (enemies: WorldEnemy[] | undefined, threatName: string) => {
  const t = normName(threatName);
  if (!t || !enemies?.length) return undefined;
  return enemies.find(e => normName(e.name) === t)
    || enemies.find(e => { const n = normName(e.name); const st = n.length > 5 ? n.slice(0, n.length - 2) : n; return new RegExp(`(^|[^a-zа-я0-9])${st.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t); });
};

/** Промпт конструктора мира: модель отдаёт черновик мира одним JSON (дальше — normalizeWorldData). */
export const WORLD_GEN_SYSTEM = `Ты — КОНСТРУКТОР МИРОВ для настольной ролевой игры с ИИ-мастером. По описанию автора создай черновик мира на русском.
Ответь ТОЛЬКО JSON-объектом без markdown и пояснений:
{
 "title": "название мира", "icon": "один эмодзи", "genre": "fantasy|horror|cyber|space|post|west",
 "description": "1–2 предложения для игроков — чем мир цепляет",
 "setting": "где и когда, общество, магия/технологии — 3–5 предложений",
 "core": "канон мастера: главные законы мира, конфликт, что все знают — до 1200 символов",
 "tone": "тон и табу одной строкой",
 "currency": "как называются деньги",
 "cards": [{"kind":"npc|place|faction|item|lore","name":"...","keys":["слово","слово"],"text":"внешность, мотив, тайна или суть — 2–4 предложения"}],
 "locations": [{"id":"латиницей-через-дефис","name":"...","description":"...","services":["market","tavern","inn","smith","healer","questboard","library","stables","dock"],"dangerLevel":1,"connections":["id другого места"]}],
 "scenarios": [{"id":"s1","title":"...","hook":"завязка: что случилось и почему герои вмешаются — 2–3 предложения","mode":"short","startLocationId":"id места"}],
 "heroes": [{"name":"...","concept":"кто он одной фразой","gender":"М|Ж"}],
 "enemies": [{"name":"...","tier":"minion|regular|elite|boss","traits":"повадки и слабость"}],
 "items": [{"name":"...","kind":"consumable|gear|misc","heal":3,"calm":1,"bonus":"+1 к атаке","price":10,"inShop":true,"rarity":"common|uncommon|rare|epic"}]
}
Объём: карточек 8–12 (персонажи, фракции, места, предметы, история), мест 4–6 со связями (у сферы услуг — 1–2 безопасных поселения), сюжетов 2–3, героев 3–4, врагов 4–6 (один boss), предметов 4–6 (расходники, снаряжение, сюжетные). Ключи карточек — слова, которыми о них будут говорить в игре (имя, прозвище, род занятий). Всё самобытное: не бери персонажей и названия из чужих книг, игр и фильмов.`;

/** Достаёт JSON мира из ответа модели (бывает обёрнут в \`\`\`json или с текстом вокруг). */
export const parseGeneratedWorld = (text: string) => {
  const t = text.replace(/\`\`\`(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('Модель не прислала мир — попробуйте ещё раз или опишите подробнее');
  const j = JSON.parse(t.slice(a, b + 1));
  const genre = WORLD_GENRES.some(g => g.id === j.genre) ? j.genre as Genre : 'fantasy';
  return { title: String(j.title || '').slice(0, 80), icon: String(j.icon || '🌍').slice(0, 4), genre, description: String(j.description || '').slice(0, 600), data: normalizeWorldData(j) };
};

/** Закрывает оборванный JSON: незакрытую строку, хвостовую запятую, открытые [ и {. Неполный последний элемент отбрасывается. */
export const closeJson = (text: string) => {
  const t = text.replace(/\`\`\`(?:json)?/g, '');
  const start = t.indexOf('{');
  if (start < 0) return t;
  let out = '';
  const stack: string[] = [];
  let inStr = false, esc = false;
  let lastSafe = 0; // позиция после последнего завершённого элемента
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    out += c;
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); lastSafe = out.length; if (!stack.length) return out; }
    else if (c === ',') lastSafe = out.length - 1;
  }
  // обрезаем до последнего целого элемента и закрываем по стеку на тот момент
  let cut = out.slice(0, lastSafe).replace(/,\s*$/, '');
  const st: string[] = [];
  let s2 = false, e2 = false;
  for (const c of cut) {
    if (s2) { if (e2) e2 = false; else if (c === '\\') e2 = true; else if (c === '"') s2 = false; continue; }
    if (c === '"') s2 = true; else if (c === '{' || c === '[') st.push(c === '{' ? '}' : ']'); else if (c === '}' || c === ']') st.pop();
  }
  cut = cut.replace(/,\s*$/, '').replace(/:\s*$/, ': null');
  return cut + st.reverse().join('');
};

export interface ChronicleEntry { kind: string; title: string; summary: string; heroes: string; created_at?: string }

/** Хроника мира в промпте: что уже случилось в других партиях — это канон мира. */
export const chronicleBlock = (entries: ChronicleEntry[], budget = 2000) => {
  if (!entries.length) return '';
  let left = budget;
  const lines: string[] = [];
  for (const e of entries) {
    const line = `- ${e.kind === 'news' ? 'Событие' : e.kind === 'tale' ? 'Сказка' : 'Партия'} «${e.title}»${e.heroes ? ` (${e.heroes})` : ''}: ${e.summary.replace(/\s+/g, ' ').slice(0, 350)}`;
    if (line.length > left) break;
    left -= line.length;
    lines.push(line);
  }
  return `\n### Хроника мира — уже случилось (это канон: последствия видны, NPC помнят; не повторяй эти сюжеты)\n${lines.join('\n')}`;
};

/* ------------------------------------------------ состояние мира: фракции и шкалы ------------------------------------------------ */

/** Состояние мира с учётом определений: новые фракции/шкалы получают стартовые значения, удалённые — выпадают. */
export const worldState = (d: Pick<WorldData, 'factions' | 'clocks'>, stored?: Partial<WorldState> | null): WorldState => ({
  factions: Object.fromEntries((d.factions || []).map(f => [f.id, Math.max(-3, Math.min(3, stored?.factions?.[f.id] ?? f.attitude))])),
  clocks: Object.fromEntries((d.clocks || []).map(c => [c.id, Math.max(0, Math.min(c.max, stored?.clocks?.[c.id] ?? c.value))])),
});

/** Сдвиги состояния за партию: id → изменение */
export interface WorldDelta { factions: Record<string, number>; clocks: Record<string, number> }
/** За одну партию фракция или шкала сдвигается не больше чем на 2 — мир меняется постепенно. */
export const DELTA_PER_SESSION = 2;

/** Теги мастера: [FACTION: Гильдия +1], [WORLD CLOCK: Туман наступает +1] */
export const parseWorldTags = (text: string) => {
  const grab = (re: RegExp) => [...text.matchAll(re)].map(m => ({ name: m[1].replace(/[«»"]/g, '').trim(), delta: (m[2] === '+' ? 1 : -1) * Math.min(1, parseInt(m[3], 10) || 0) })).filter(x => x.name && x.delta);
  return {
    factions: grab(/\[FACTION:\s*([^\]]+?)\s*([+\-−–])\s*(\d+)\s*\]/gi),
    clocks: grab(/\[WORLD[ _]CLOCK:\s*([^\]]+?)\s*([+\-−–])\s*(\d+)\s*\]/gi),
  };
};

/**
 * Модели часто пишут состояние мира JSON-ом ({"faction": "X", "value": 1} или {"clock": "Y", "value": 3}),
 * а не тегами. Сравниваем с текущим состоянием и превращаем разницу в сдвиг ±1.
 */
export const parseWorldJson = (text: string, d: Pick<WorldData, 'factions' | 'clocks'>, cur: WorldState): ReturnType<typeof parseWorldTags> => {
  const out: ReturnType<typeof parseWorldTags> = { factions: [], clocks: [] };
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const obj = m[0];
    const name = obj.match(/"(faction|clock|name|фракция|шкала)"\s*:\s*"([^"]+)"/i);
    const val = obj.match(/"(value|attitude|отношение|progress|значение)"\s*:\s*(-?\d+)/i);
    if (!name || !val) continue;
    const v = parseInt(val[2], 10);
    const isClock = /clock|шкала/i.test(name[1]) || /"max"\s*:/.test(obj);
    if (!isClock) {
      const f = byName(d.factions, name[2]);
      if (f && cur.factions[f.id] !== undefined && v !== cur.factions[f.id]) out.factions.push({ name: f.name, delta: v > cur.factions[f.id] ? 1 : -1 });
      else if (f) continue;
    }
    const c = byName(d.clocks, name[2]);
    if (c && cur.clocks[c.id] !== undefined && v !== cur.clocks[c.id]) out.clocks.push({ name: c.name, delta: v > cur.clocks[c.id] ? 1 : -1 });
  }
  return out;
};

const byName = <T extends { name: string }>(list: T[] | undefined, name: string) => {
  const n = normName(name);
  return (list || []).find(x => normName(x.name) === n) || (list || []).find(x => { const m = normName(x.name); return m.includes(n) || n.includes(m); });
};

/**
 * Применяет теги хода к сдвигам партии: каждая фракция/шкала — не больше ±1 за ход и ±2 за партию.
 * Возвращает новые сдвиги и человекочитаемые изменения для новостей.
 */
export const applyWorldTags = (d: Pick<WorldData, 'factions' | 'clocks'>, delta: WorldDelta, tags: ReturnType<typeof parseWorldTags>) => {
  const next: WorldDelta = { factions: { ...delta.factions }, clocks: { ...delta.clocks } };
  const changed: string[] = [];
  const seen = new Set<string>();
  for (const t of tags.factions) {
    const f = byName(d.factions, t.name);
    if (!f || seen.has(`f:${f.id}`)) continue;
    seen.add(`f:${f.id}`);
    const cur = next.factions[f.id] || 0;
    const v = Math.max(-DELTA_PER_SESSION, Math.min(DELTA_PER_SESSION, cur + t.delta));
    if (v !== cur) { next.factions[f.id] = v; changed.push(`${f.name} ${t.delta > 0 ? '+1' : '−1'}`); }
  }
  for (const t of tags.clocks) {
    const c = byName(d.clocks, t.name);
    if (!c || seen.has(`c:${c.id}`)) continue;
    seen.add(`c:${c.id}`);
    const cur = next.clocks[c.id] || 0;
    const v = Math.max(-DELTA_PER_SESSION, Math.min(DELTA_PER_SESSION, cur + t.delta));
    if (v !== cur) { next.clocks[c.id] = v; changed.push(`«${c.name}» ${t.delta > 0 ? '+1' : '−1'}`); }
  }
  return { delta: next, changed };
};

/** Состояние «старт партии + сдвиги партии» для показа и промпта. */
export const stateWithDelta = (d: Pick<WorldData, 'factions' | 'clocks'>, start: WorldState, delta?: WorldDelta | null): WorldState => worldState(d, {
  factions: Object.fromEntries(Object.entries(start.factions).map(([k, v]) => [k, v + (delta?.factions?.[k] || 0)])),
  clocks: Object.fromEntries(Object.entries(start.clocks).map(([k, v]) => [k, v + (delta?.clocks?.[k] || 0)])),
});

/** Блок состояния мира для мастера + правила тегов. */
export const worldStateBlock = (d: Pick<WorldData, 'factions' | 'clocks'>, st: WorldState) => {
  if (!(d.factions || []).length && !(d.clocks || []).length) return '';
  const f = (d.factions || []).map(x => `- ${x.name}: ${attitudeLabel(st.factions[x.id] ?? x.attitude)} к героям (${st.factions[x.id] ?? x.attitude})${x.desc ? ` — ${x.desc}` : ''}`);
  const c = (d.clocks || []).map(x => `- «${x.name}»: ${st.clocks[x.id] ?? x.value}/${x.max}${x.onFull ? ` (когда заполнится: ${x.onFull})` : ''}`);
  return `\n### Состояние мира (общее для всех партий — веди себя согласно ему)${f.length ? `\nФракции:\n${f.join('\n')}` : ''}${c.length ? `\nШкалы мира:\n${c.join('\n')}` : ''}
Поступки героев меняют мир: помогли людям фракции, заключили сделку, обидели, предали — поставь [FACTION: Название +1] или [FACTION: Название -1]; события сцены приблизили угрозу — [WORLD CLOCK: Название +1], герои её отодвинули — [WORLD CLOCK: Название -1]. Пиши теги прямо в тексте ответа, не чаще одного раза на фракцию/шкалу за ход; числа считает движок. Последствия отношений показывай в сцене: союзники помогают, враги мешают.`;
};
