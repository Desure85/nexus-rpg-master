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
