import { describe, it, expect } from 'vitest';
import { cardTriggered, worldPromptBlock, normalizeWorldData } from '../shared/world';

describe('лор мира', () => {
  const card = { id: 'a', kind: 'npc' as const, name: 'Сетта', keys: ['колокольный звон'], text: 'Дочь звонаря.' };
  it('ключи по основе слова и с начала слова', () => {
    expect(cardTriggered(card, 'Спроси о Сетте')).toBe(true);
    expect(cardTriggered(card, 'Звучит колокольного звона эхо')).toBe(true);
    expect(cardTriggered(card, 'Кассетта')).toBe(false);
    expect(cardTriggered(card, 'ничего')).toBe(false);
  });
  it('бюджет промпта', () => {
    const data = normalizeWorldData({ core: 'Ядро', cards: Array.from({ length: 30 }, (_, i) => ({ name: `Карта${i}`, text: 'x'.repeat(900), always: true })) });
    const { text, used } = worldPromptBlock({ title: 'Т', data }, '', 5000);
    expect(text.length).toBeLessThan(5400);
    expect(used.length).toBeGreaterThan(2);
    expect(used.length).toBeLessThan(30);
  });
});

import { closeJson, parseGeneratedWorld } from '../shared/world';
describe('оборванный JSON мира', () => {
  it('закрывает и отбрасывает неполный хвост', () => {
    const cut = '{"title":"Мир","genre":"space","cards":[{"kind":"npc","name":"А","keys":["а"],"text":"Текст"},{"kind":"npc","name":"Б","te';
    const w = parseGeneratedWorld(closeJson(cut));
    expect(w.title).toBe('Мир');
    expect(w.data.cards.map(c => c.name)).toEqual(['А']);
  });
  it('целый JSON не трогает', () => {
    expect(JSON.parse(closeJson('текст {"a":[1,2]} хвост'))).toEqual({ a: [1, 2] });
  });
});

import { displayUserContent } from '../shared/parse';
describe('служебное в ходе игрока', () => {
  it('прячет состояние мира с вложенными тегами', () => {
    expect(displayUserContent('Рина идёт в порт\n\n[STATE: Рина 10/10]\n\n[WORLD STATE: Гильдия -1; «Туман» 2/6 — если ход задел, поставь [FACTION: Название ±1] / [WORLD CLOCK: Название ±1]]')).toBe('Рина идёт в порт');
  });
});

describe('parseWorldJson', () => {
  it('turns JSON-style world state into ±1 shifts', async () => {
    const { parseWorldJson } = await import('../shared/world');
    const d = { factions: [{ id: 'g', name: 'Гильдия ныряльщиков', desc: '', attitude: -1 }, { id: 's', name: 'Смотрители маяков', desc: '', attitude: 1 }], clocks: [{ id: 't', name: 'Туман наступает', max: 6, value: 2, onFull: '' }] };
    const cur = { factions: { g: -1, s: 1 }, clocks: { t: 2 } };
    const same = parseWorldJson('[{"faction": "Гильдия ныряльщиков", "value": -1}, {"faction": "Смотрители маяков", "value": 1}]', d as any, cur);
    expect(same.factions).toEqual([]);
    const moved = parseWorldJson('{"faction": "Гильдия ныряльщиков", "value": 0} {"clock": "Туман наступает", "value": 4, "max": 6}', d as any, cur);
    expect(moved.factions).toEqual([{ name: 'Гильдия ныряльщиков', delta: 1 }]);
    expect(moved.clocks).toEqual([{ name: 'Туман наступает', delta: 1 }]);
  });
});
