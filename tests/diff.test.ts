import { describe, it, expect } from 'vitest';
import { diffDashboards } from '../shared/diff';

describe('итог хода', () => {
  it('урон, опыт, уровень, предметы, враги, часы, Пул Рока, локация', () => {
    const prev: any = {
      characters: [{ name: 'Мира', hp: '10/10', stress: 1, gold: 5, xp: 40, tokens: 1, inventory: ['Зелье лечения'] }],
      threats: [{ name: 'Волк', hp: '8/8' }], clocks: [{ name: 'Тревога', progress: 1, total: 4 }], doomPool: 1,
      locations: [{ id: 'a', name: 'Деревня' }], currentLocationId: 'a', sceneLoot: [],
    };
    const next: any = {
      characters: [{ name: 'Мира', hp: '7/10', stress: 2, gold: 15, xp: 60, tokens: 1, inventory: ['Кинжал'] }],
      threats: [{ name: 'Волк', hp: '3/8' }, { name: 'Вожак', hp: '12/12' }], clocks: [{ name: 'Тревога', progress: 2, total: 4 }], doomPool: 2,
      locations: [{ id: 'a', name: 'Деревня' }, { id: 'b', name: 'Лес' }], currentLocationId: 'b', sceneLoot: ['Шкура'],
    };
    const t = diffDashboards(prev, next).map(c => `${c.icon} ${c.text}`);
    expect(t).toEqual(expect.arrayContaining(['💔 −3 HP', '🌀 +1 стресс', '🪙 +10 золота', '⭐ +20 опыта', '🏆 уровень 2!', '🎒 Кинжал', '➖ Зелье лечения',
      '🗡️ Волк −5 HP', '⚔️ появляется Вожак', '⏳ «Тревога» 2/4', '☠️ Пул Рока +1 (2/5)', '📍 Лес', '🗺️ открыто: Лес', '💎 на сцене: Шкура']));
  });
  it('без изменений — пусто', () => {
    const d: any = { characters: [{ name: 'А', hp: '5/5' }] };
    expect(diffDashboards(d, structuredClone(d))).toEqual([]);
  });
});
