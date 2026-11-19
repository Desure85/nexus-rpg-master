// Импорт миров и лора из популярных форматов + экспорт своего.
// Поддержка: свой JSON (nexus-world), SillyTavern World Info, NovelAI Lorebook,
// Character Card V2/V3 (JSON или PNG с вшитой карточкой), AI Dungeon Story Cards.
import { normalizeWorldData, type LoreCard, type LoreKind, type World, type WorldData } from './world';

export interface ImportResult {
  format: string;
  title?: string;
  icon?: string;
  genre?: World['genre'];
  description?: string;
  data: WorldData;
  /** что не удалось перенести — показать автору */
  notes: string[];
}

export const EXPORT_FORMAT = 'nexus-world';

export const exportWorld = (w: Pick<World, 'title' | 'icon' | 'genre' | 'description' | 'data'>) =>
  JSON.stringify({ format: EXPORT_FORMAT, version: 1, world: { title: w.title, icon: w.icon, genre: w.genre, description: w.description, data: w.data } }, null, 2);

const s = (v: unknown) => (typeof v === 'string' ? v : '').trim();
/** Ключи бывают регэкспами (/дракон(ы)?/i) — берём читаемую основу */
const cleanKey = (k: string) => s(k).replace(/^\/(.+)\/[a-z]*$/i, '$1').replace(/[\\^$()[\]{}?*+|]/g, '').trim();
const keysOf = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => cleanKey(String(x))).filter(Boolean);

const KIND_WORDS: [RegExp, LoreKind][] = [
  [/character|npc|person|персонаж|нпс/i, 'npc'], [/location|place|место|локац|город/i, 'place'],
  [/faction|group|guild|фракц|орден|гильд/i, 'faction'], [/item|object|artifact|предмет|артефакт/i, 'item'],
];
const kindOf = (...hints: unknown[]): LoreKind => {
  const t = hints.map(h => s(h)).join(' ');
  return KIND_WORDS.find(([re]) => re.test(t))?.[1] || 'lore';
};

const card = (i: number, name: string, text: string, keys: string[], kind: LoreKind, always = false): LoreCard => ({
  id: `imp${i}`, kind, name: (name || keys[0] || `Запись ${i + 1}`).slice(0, 80), keys: keys.slice(0, 10), text, ...(always ? { always: true } : {}),
});

/** Распознаёт формат и переводит в данные мира. Бросает Error с понятным текстом, если формат неизвестен. */
export function importWorld(raw: unknown): ImportResult {
  const j: any = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const notes: string[] = [];
  const finish = (format: string, d: Partial<WorldData>, meta: Partial<ImportResult> = {}): ImportResult => {
    const before = d.cards?.length || 0;
    const data = normalizeWorldData(d);
    if (before > data.cards.length) notes.push(`Пропущено пустых или лишних записей: ${before - data.cards.length} (лимит — 80 карточек, 1500 символов в каждой)`);
    if ((d.cards || []).some(c => c.text.length > 1500)) notes.push('Длинные записи обрезаны до 1500 символов');
    return { format, data, notes, ...meta };
  };

  // 1. Свой формат
  if (j?.format === EXPORT_FORMAT && j.world) {
    const w = j.world;
    return finish('Nexus', w.data || {}, { title: s(w.title), icon: s(w.icon), genre: w.genre, description: s(w.description) });
  }

  // 2. Character Card V2/V3 (в т. ч. из PNG): персонаж + его лорбук
  const cc = j?.spec && /chara_card/.test(j.spec) ? j.data : j?.char_name || j?.first_mes ? j : null;
  if (cc) {
    const book = cc.character_book?.entries || [];
    const cards = book.filter((e: any) => e.enabled !== false).map((e: any, i: number) =>
      card(i, s(e.name) || s(e.comment), s(e.content), keysOf(e.keys), kindOf(e.comment, e.name), !!e.constant));
    const name = s(cc.name || cc.char_name);
    const persona = [s(cc.description), s(cc.personality)].filter(Boolean).join('\n');
    if (name && persona) cards.unshift(card(cards.length, name, persona, [name], 'npc', true));
    const hook = s(cc.scenario) || s(cc.first_mes);
    if (cc.first_mes) notes.push('Приветствие персонажа перенесено в завязку сюжета — проверьте, подходит ли оно для мастера');
    notes.push('Карточка персонажа стала NPC мира: героев игроков добавьте во вкладке «Герои»');
    return finish(j.spec === 'chara_card_v3' ? 'Character Card V3' : 'Character Card', {
      setting: s(cc.scenario).slice(0, 1500),
      core: s(cc.character_book?.description || cc.creator_notes).slice(0, 3000),
      cards,
      scenarios: hook ? [{ id: 's0', title: name ? `Встреча: ${name}` : 'Начало', hook: hook.slice(0, 1500), mode: 'short' }] : [],
    }, { title: s(cc.character_book?.name) || name || 'Импортированный мир', description: s(cc.creator_notes).slice(0, 600) });
  }

  // 3. SillyTavern World Info: { entries: { "0": { key, content, comment, constant } } }
  if (j?.entries && !Array.isArray(j.entries) && typeof j.entries === 'object') {
    const list = Object.values(j.entries) as any[];
    const cards = list.filter(e => !e.disable).map((e, i) => card(i, s(e.comment), s(e.content), keysOf(e.key ?? e.keys), kindOf(e.comment, e.group), !!e.constant));
    if (list.some(e => (e.keysecondary || []).length || e.selectiveLogic)) notes.push('Вторичные ключи и логика И/НЕ упрощены: карточка срабатывает на любой из основных ключей');
    return finish('SillyTavern World Info', { cards }, { title: s(j.name) || 'Импортированный лор' });
  }

  // 4. NovelAI Lorebook: { lorebookVersion, entries: [{ displayName, text, keys, enabled, forceActivation }] }
  if (Array.isArray(j?.entries) && (j.lorebookVersion || j.entries.some((e: any) => 'displayName' in e || 'forceActivation' in e))) {
    const cats = new Map((j.categories || []).map((c: any) => [c.id, s(c.name)]));
    const cards = j.entries.filter((e: any) => e.enabled !== false).map((e: any, i: number) =>
      card(i, s(e.displayName), s(e.text), keysOf(e.keys), kindOf(cats.get(e.category), e.displayName), !!e.forceActivation));
    return finish('NovelAI Lorebook', { cards }, { title: 'Импортированный лорбук' });
  }

  // 5. AI Dungeon Story Cards: [{ type, title, keys, value|entry, description }]
  const aid = Array.isArray(j) ? j : Array.isArray(j?.storyCards) ? j.storyCards : null;
  if (aid && aid.some((e: any) => 'keys' in e && ('value' in e || 'entry' in e))) {
    const cards = aid.map((e: any, i: number) => card(i, s(e.title), s(e.value ?? e.entry), keysOf(e.keys), kindOf(e.type)));
    if (aid.some((e: any) => s(e.description))) notes.push('Заметки автора к карточкам AI Dungeon (description) не переносятся — мастеру они не нужны');
    return finish('AI Dungeon Story Cards', { cards }, { title: 'Импортированные карточки' });
  }

  throw new Error('Не узнали формат. Поддерживаются: экспорт Nexus, SillyTavern World Info, NovelAI Lorebook, Character Card (JSON/PNG), AI Dungeon Story Cards.');
}

/** Character Card в PNG: JSON в base64 в чанке tEXt «chara» (V2) или «ccv3» (V3). */
export function cardFromPng(bytes: Uint8Array): unknown {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('Это не PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  const found: Record<string, string> = {};
  while (off + 8 <= bytes.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...bytes.slice(off + 4, off + 8));
    if (type === 'tEXt') {
      const chunk = bytes.slice(off + 8, off + 8 + len);
      const zero = chunk.indexOf(0);
      const key = String.fromCharCode(...chunk.slice(0, zero));
      if (key === 'chara' || key === 'ccv3') found[key] = String.fromCharCode(...chunk.slice(zero + 1));
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const b64 = found.ccv3 || found.chara;
  if (!b64) throw new Error('В картинке нет карточки персонажа');
  const bin = atob(b64);
  const utf8 = new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  return JSON.parse(utf8);
}
