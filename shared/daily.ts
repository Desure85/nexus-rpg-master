// Испытание дня: один и тот же сюжет, поворот и условие для всех игроков в этот день.
// Детерминировано по дате — клиент показывает карточку, сервер пересчитывает по ключу и применяет условие.
import { SCENARIOS, type Scenario } from './scenarios';
import type { Character } from '../src/types';

export interface DailyModifier {
  id: string;
  icon: string;
  title: string;
  desc: string;
  /** Изменение героя после GAME START (числа задаёт игра, не модель) */
  hero?: (c: Partial<Character>) => Partial<Character>;
  /** Стартовый пул рока */
  doom?: number;
  /** Подсказка мастеру — как обыграть условие в сюжете */
  gm: string;
}

const hpParts = (hp?: string) => {
  const m = String(hp || '').match(/(\d+)\s*\/\s*(\d+)/);
  return m ? [+m[1], +m[2]] : [10, 10];
};
const withMaxHp = (c: Partial<Character>, d: number) => {
  const [, max] = hpParts(c.hp);
  const next = Math.max(4, max + d);
  return { ...c, hp: `${next}/${next}` };
};

export const DAILY_MODIFIERS: DailyModifier[] = [
  { id: 'fragile', icon: '🩸', title: 'Хрупкие герои', desc: '−3 к максимуму здоровья', hero: c => withMaxHp(c, -3), gm: 'Герои измотаны дорогой — каждая рана ощущается сильнее.' },
  { id: 'hardened', icon: '🛡️', title: 'Закалённые', desc: '+3 к максимуму здоровья, но рок уже 2', hero: c => withMaxHp(c, 3), doom: 2, gm: 'Герои крепки, но над краем сгущаются тучи.' },
  { id: 'lucky', icon: '🍀', title: 'Счастливая звезда', desc: '+1 жетон на старте', hero: c => ({ ...c, tokens: Math.min(3, (Number(c.tokens) || 0) + 1) }), gm: 'Судьба благосклонна к героям — пусть удача проявится в мелочах.' },
  { id: 'broke', icon: '🕳️', title: 'Пустые карманы', desc: 'Ни монеты и без жетонов', hero: c => ({ ...c, gold: 0, tokens: 0 }), gm: 'Героев обобрали накануне — им придётся добывать всё самим.' },
  { id: 'rich', icon: '💰', title: 'Щедрый наниматель', desc: '+40 золота, рок 1', hero: c => ({ ...c, gold: (Number(c.gold) || 0) + 40 }), doom: 1, gm: 'Аванс щедрый — и кто-то знает, что у героев есть деньги.' },
  { id: 'dread', icon: '🌑', title: 'Дурное предзнаменование', desc: 'Пул рока стартует с 4', doom: 4, gm: 'Мир на грани: знамения дурные, враги смелее обычного.' },
  { id: 'nerves', icon: '😰', title: 'На взводе', desc: 'Стресс 3 на старте, +1 жетон', hero: c => ({ ...c, stress: 3, tokens: Math.min(3, (Number(c.tokens) || 0) + 1) }), gm: 'Героев мучает недавний кошмар — нервы натянуты.' },
];

export const DAILY_TWISTS: string[] = [
  'Наниматель героев лжёт о главном.',
  'Один из союзников тайно работает на врага.',
  'Время ограничено: к рассвету всё будет кончено.',
  'Главный злодей когда-то спас жизнь одному из героев.',
  'Нужная вещь уже украдена — кем-то третьим.',
  'Местные ненавидят чужаков и не станут помогать даром.',
  'Буря отрезала путь назад.',
  'Враг предлагает сделку, и она выглядит честной.',
  'Свидетель всего произошедшего — ребёнок, которому никто не верит.',
  'Награда за героев уже назначена.',
  'Всё повторяется: кто-то проходил этот путь до них и не вернулся.',
  'Цель — не то, чем кажется: спасать придётся противника.',
  'В деле замешано старое пророчество, и оно ошибается.',
  'Союзник просит об одной услуге — и не говорит какой.',
];

/** Ключ дня по UTC: одинаков для всех игроков. */
export const dailyKey = (d: Date = new Date()) => d.toISOString().slice(0, 10);
export const isDailyKey = (k: unknown): k is string => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);

const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

export interface DailyChallenge {
  key: string;
  scenario: Scenario;
  twist: string;
  modifier: DailyModifier;
  plotHook: string;
}

export function dailyChallenge(key: string = dailyKey()): DailyChallenge {
  const pool = SCENARIOS.filter(s => s.mode === 'short');
  const h = hash(`nexus:${key}`);
  const scenario = pool[h % pool.length];
  const twist = DAILY_TWISTS[Math.floor(h / pool.length) % DAILY_TWISTS.length];
  const modifier = DAILY_MODIFIERS[Math.floor(h / (pool.length * DAILY_TWISTS.length)) % DAILY_MODIFIERS.length];
  const plotHook = `${scenario.plotHook}\nПоворот дня: ${twist}\nУсловие дня «${modifier.title}»: ${modifier.gm}`;
  return { key, scenario, twist, modifier, plotHook };
}

/** Серия дней подряд (по списку сыгранных ключей). */
export function dailyStreak(played: string[], today: string = dailyKey()): number {
  const set = new Set(played);
  let n = 0;
  const d = new Date(`${today}T00:00:00Z`);
  if (!set.has(today)) d.setUTCDate(d.getUTCDate() - 1); // сегодня ещё не играл — серия не прервана
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}
