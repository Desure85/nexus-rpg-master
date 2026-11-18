// Исход бросков считает движок, а не модель: кубик → модификаторы → итог → уровень успеха.
// Модель получает готовый результат («Итог: 14 → УСПЕХ С ЦЕНОЙ») и только описывает его.
import type { Character, EquipmentSlot } from '../src/types';

export type Outcome = 'crit' | 'success' | 'partial' | 'fail' | 'critfail';

export const OUTCOME_LABEL: Record<Outcome, string> = {
  crit: 'КРИТ. УСПЕХ',
  success: 'УСПЕХ',
  partial: 'УСПЕХ С ЦЕНОЙ',
  fail: 'ПРОВАЛ',
  critfail: 'КРИТ. ПРОВАЛ',
};

/**
 * Сложность (DC) мастер объявляет ДО броска (suggestedRoll.dc), по умолчанию 12.
 * Итог ≥ DC+5 или натуральная 20 — крит; ≥ DC — успех; DC−3…DC−1 — успех с ценой; ниже — провал; натуральная 1 — крит. провал.
 */
export const DEFAULT_DC = 12;
export const clampDc = (dc: unknown) => { const n = Math.round(Number(dc)); return n >= 5 && n <= 25 ? n : DEFAULT_DC; };
/** Потолок суммарного бонуса снаряжения на один бросок — чтобы предметы не ломали баланс. */
export const MAX_GEAR_BONUS = 3;

export const outcomeOf = (die: number, total: number, dc = DEFAULT_DC): Outcome =>
  die === 20 || total >= dc + 5 ? 'crit' : die === 1 ? 'critfail' : total >= dc ? 'success' : total >= dc - 3 ? 'partial' : 'fail';

// Начало слова: \b в JS не работает с кириллицей
const W = '(?<![а-яё])';
const re = (parts: string) => new RegExp(`${W}(?:${parts})`, 'i');
const FIGHT_RE = re('атак|удар|бь[юёе]|бить|рублю|руби|кол[юе]т?|реж[уе]|стрел|выстрел|сраж|напад|бой|дерус|драт|метн|замах|пронз|закол|оглуш|добива');
const STEMS: [RegExp, RegExp][] = [
  [/атак|урон|удар|оружи|бо[йя]/i, FIGHT_RE],
  [/скрыт|незамет|тен/i, re('пряч|спряч|крад|подкрад|прокрад|незамет|скрыт|тихо|тихонько|в тен|из тен|тенью')],
  [/внимат|восприят|зрени|поиск|чуть/i, re('осматр|ищу|ищет|искать|поиск|замеч|присматр|исслед|следы|слуша|наблюд|изуча')],
  [/убежд|обаян|харизм|красноре|переговор|торг/i, re('убежд|уговар|договар|торгу|обман|льщ|льст|угрож|расспраш|спраш|говор|прош[уу]|уболт')],
  [/маги|заклин|чар|воли|ментал|разум/i, re('колду|заклин|магию|магией|чары|ритуал|призыв|молюсь|молит|медитир')],
  [/взлом|хак|техник|механ|инжен/i, re('взлам|взлом|хак|чиню|починить|ремонт|настраива|отключа|подключ|терминал|замок|замка|замки')],
  [/ловк|акробат|атлет|сил[аы]/i, re('прыг|перепрыг|лезу|залез|карабк|бег|убега|уклон|увернут|толка|поднима|выбива')],
  [/лечени|медиц|врачев|лекар/i, re('лечу|лечит|перевяз|исцел|зашива|оказыва')],
];

const itemOf = (eq: EquipmentSlot) => (typeof eq.item === 'string' ? { name: eq.item, bonus: eq.item } : eq.item);

/** Бонус «+N к защите/броня N» — снижает входящий урон (минимум 1 урона всё равно проходит). */
export const armorOf = (char?: Partial<Character>): number => {
  let armor = 0;
  for (const eq of char?.equipment || []) {
    const it = itemOf(eq);
    const text = `${it?.bonus || ''}`;
    for (const m of text.matchAll(/([+−-]?\d+)\s*(?:к\s*)?(?:защит|брон)/gi)) armor += Math.max(0, parseInt(m[1].replace('−', '-'), 10));
    for (const m of text.matchAll(/(?:защит\S*|брон\S*)\s*\+?(\d+)/gi)) armor += parseInt(m[1], 10);
  }
  return Math.min(armor, MAX_GEAR_BONUS);
};

/** Бонусы снаряжения, подходящие к описанию действия: «+1 к атаке» сработает на «бью мечом». */
export const gearBonus = (char: Partial<Character> | undefined, actionText: string): { total: number; parts: string[] } => {
  const parts: string[] = [];
  let total = 0;
  for (const eq of char?.equipment || []) {
    const it = itemOf(eq);
    if (!it?.bonus) continue;
    for (const m of it.bonus.matchAll(/([+−-]\d+)\s*(?:к\s*)?([а-яё]+)/gi)) {
      const value = parseInt(m[1].replace('−', '-'), 10);
      const category = m[2];
      if (/защит|брон/i.test(category)) continue; // броня работает на входящий урон
      const rule = STEMS.find(([cat]) => cat.test(category));
      const applies = rule ? rule[1].test(actionText) : actionText.toLowerCase().includes(category.toLowerCase().slice(0, 5));
      if (applies && value) { total += value; parts.push(`${value > 0 ? '+' : ''}${value} ${it.name}`); }
    }
  }
  if (total > MAX_GEAR_BONUS) total = MAX_GEAR_BONUS;
  return { total, parts };
};

/** Отношения с NPC: каждые 3 пункта — ±1 к броску, если NPC назван в действии (до ±3). */
export const relationshipBonus = (char: Partial<Character> | undefined, actionText: string): { total: number; parts: string[] } => {
  const low = actionText.toLowerCase().replace(/ё/g, 'е');
  let total = 0;
  const parts: string[] = [];
  for (const r of char?.relationships || []) {
    const name = String(r.target || '').toLowerCase().replace(/ё/g, 'е').trim();
    if (!name || name.length < 3) continue;
    const stem = name.split(/\s+/)[0].slice(0, Math.max(3, name.split(/\s+/)[0].length - 2));
    if (!low.includes(stem)) continue;
    const v = Math.trunc((Number(r.level) || 0) / 3);
    if (v) { total += v; parts.push(`${v > 0 ? '+' : ''}${v} ${r.target}`); }
  }
  total = Math.max(-MAX_GEAR_BONUS, Math.min(MAX_GEAR_BONUS, total));
  return { total, parts };
};

export interface ParsedRoll { type: 'classic' | 'triple' | 'shifted' | 'taint'; die: number; label: string; shift: number; threat: number }

/** Разбор тега [ROLL: …] в выбранный кубик (с учётом метки стресса) и модификаторы. */
export const parseRoll = (tag: string): ParsedRoll | null => {
  const threat = parseInt(tag.match(/Threat d\d+ = -(\d+)/)?.[1] || '0', 10);
  const values = (tag.match(/\[([\d,\s]+)\]/)?.[1] || '').split(',').map(v => parseInt(v, 10)).filter(n => !isNaN(n));
  if (/1d20 = (\d+)/.test(tag)) return { type: 'classic', die: parseInt(tag.match(/1d20 = (\d+)/)![1], 10), label: 'd20', shift: 0, threat };
  if (/Chaos Roll/i.test(tag) && values.length >= 2) return { type: 'taint', die: Math.max(...values), label: 'больший из 2d20', shift: 0, threat };
  if ((/Stress Resonance|Fate Shift/i.test(tag)) && values.length >= 3) {
    const sorted = [...values].sort((a, b) => a - b);
    const pickIdx = /Max used/i.test(tag) ? 2 : /Min used/i.test(tag) ? 0 : 1;
    const label = pickIdx === 2 ? 'Max' : pickIdx === 0 ? 'Min' : 'Mid';
    const shift = /Fate Shift/i.test(tag) ? parseInt(tag.match(/Mod:\s*([+−-]?\d+)/)?.[1]?.replace('−', '-') || '0', 10) : 0;
    return { type: /Fate Shift/i.test(tag) ? 'shifted' : 'triple', die: sorted[pickIdx], label, shift, threat };
  }
  return null;
};

export interface ResolveContext {
  characters: Partial<Character>[];
  /** Состояние движка: статусы героев (downed — спасбросок смерти) */
  status?: Record<string, string | undefined>;
  gearEnabled?: boolean;
  relationsEnabled?: boolean;
  /** Сложность, объявленная мастером до броска (suggestedRoll.dc) */
  dc?: number;
}

export interface RollResult { actor: string; outcome: Outcome; total: number; deathSave?: 'stabilized' | 'failed' }

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').trim();

/**
 * Дописывает в каждый ещё не разрешённый тег [ROLL: …] итог и исход.
 * Актёр — из «**Имя**» перед тегом или из ближайшего [PLAYER ACTION: Имя].
 */
export function resolveRolls(text: string, ctx: ResolveContext): { text: string; results: RollResult[] } {
  const results: RollResult[] = [];
  let actor = '';
  let context = '';
  const lines = text.split('\n').map(line => {
    const pa = line.match(/\[PLAYER ACTION: ([^\](]+?)\s*(?:\(|\])/)?.[1];
    if (pa) { actor = pa.trim(); context = ''; }
    if (!line.includes('[ROLL:')) { context += ' ' + line.replace(/\[[^\]]*\]/g, ''); return line; }
    if (line.includes('Итог:')) return line;
    const who = line.match(/\*\*(.+?)\*\*/)?.[1]?.trim() || actor;
    const char = ctx.characters.find(c => c.name && norm(c.name) === norm(who));
    const own = line.replace(/\[ROLL:[^\]]*\]/g, '').replace(/\*\*[^*]+\*\*/g, '');
    const actionText = /[а-яё]{3}/i.test(own) ? own : context;
    return line.replace(/\[ROLL:([^\]]*)\]/g, (full, body) => {
      const r = parseRoll(full);
      if (!r) return full;
      const gear = ctx.gearEnabled === false ? { total: 0, parts: [] } : gearBonus(char, actionText);
      const rel = ctx.relationsEnabled ? relationshipBonus(char, actionText) : { total: 0, parts: [] };
      const total = r.die + r.shift + gear.total + rel.total - r.threat;
      const downed = !!who && ctx.status?.[char?.name || who] === 'downed';
      const dc = downed ? 10 : clampDc(ctx.dc);
      const outcome = outcomeOf(r.die, total, dc);
      const math = [`${r.die} (${r.label})`];
      if (r.shift) math.push(`${r.shift > 0 ? '+' : ''}${r.shift} сдвиг`);
      if (gear.total) math.push(gear.parts.join(' '));
      if (rel.total) math.push(rel.parts.join(' '));
      if (r.threat) math.push(`−${r.threat} угроза`);
      let death: RollResult['deathSave'];
      if (downed) death = (total >= 10 && r.die !== 1) || r.die === 20 ? 'stabilized' : 'failed';
      results.push({ actor: char?.name || who, outcome, total, deathSave: death });
      const deathStr = death ? ` | Спасбросок: ${death === 'stabilized' ? 'стабилизирован (HP 1)' : 'не удался'}` : '';
      return `[ROLL:${body} | Итог: ${total} = ${math.join(' ')} против DC ${dc} → ${OUTCOME_LABEL[outcome]}${deathStr}]`;
    });
  });
  return { text: lines.join('\n'), results };
}

/** Итоги уже разрешённых бросков (для эффектов движка после ответа модели). */
export const resolvedOutcomes = (text: string): { actor: string; outcome: Outcome; deathSave?: 'stabilized' | 'failed' }[] => {
  const out: { actor: string; outcome: Outcome; deathSave?: 'stabilized' | 'failed' }[] = [];
  let actor = '';
  const byLabel = Object.fromEntries(Object.entries(OUTCOME_LABEL).map(([k, v]) => [v, k as Outcome]));
  for (const line of text.split('\n')) {
    const pa = line.match(/\[PLAYER ACTION: ([^\](]+?)\s*(?:\(|\])/)?.[1];
    if (pa) actor = pa.trim();
    for (const m of line.matchAll(/\[ROLL:[^\]]*Итог:[^\]]*→ (КРИТ\. УСПЕХ|УСПЕХ С ЦЕНОЙ|КРИТ\. ПРОВАЛ|УСПЕХ|ПРОВАЛ)(?: \| Спасбросок: (стабилизирован|не удался))?[^\]]*\]/g)) {
      const who = line.match(/\*\*(.+?)\*\*/)?.[1]?.trim() || actor;
      out.push({ actor: who, outcome: byLabel[m[1]], deathSave: m[2] ? (m[2] === 'стабилизирован' ? 'stabilized' : 'failed') : undefined });
    }
  }
  return out;
};
