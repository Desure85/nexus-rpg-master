import { describe, it, expect } from 'vitest';
import { importWorld, exportWorld, cardFromPng } from '../shared/world-import';

describe('импорт миров', () => {
  it('SillyTavern World Info', () => {
    const r = importWorld({ entries: {
      0: { uid: 0, key: ['Сетта', '/звонар(ь|я)/i'], keysecondary: ['колокол'], comment: 'Сетта (персонаж)', content: 'Дочь звонаря.', constant: false },
      1: { uid: 1, key: [], comment: 'Законы мира', content: 'Магия запрещена.', constant: true },
      2: { uid: 2, key: ['x'], comment: 'выкл', content: 'нет', disable: true },
    } });
    expect(r.format).toBe('SillyTavern World Info');
    expect(r.data.cards).toHaveLength(2);
    expect(r.data.cards[0]).toMatchObject({ name: 'Сетта (персонаж)', kind: 'npc', keys: ['Сетта', 'звонарья'] });
    expect(r.data.cards[1].always).toBe(true);
    expect(r.notes.join()).toMatch(/Вторичные ключи/);
  });
  it('NovelAI Lorebook', () => {
    const r = importWorld({ lorebookVersion: 5, categories: [{ id: 'c1', name: 'Locations' }], entries: [
      { displayName: 'Порт', text: 'Причалы', keys: ['порт', 'причал'], category: 'c1', enabled: true },
      { displayName: 'Вкл всегда', text: 'Всегда', keys: [], forceActivation: true },
    ] });
    expect(r.data.cards[0]).toMatchObject({ kind: 'place', keys: ['порт', 'причал'] });
    expect(r.data.cards[1].always).toBe(true);
  });
  it('AI Dungeon Story Cards', () => {
    const r = importWorld([{ type: 'character', title: 'Ивар', keys: 'Ивар,смотритель', value: 'Старик с маяка', description: 'заметка' }, { type: 'faction', title: 'Гильдия', keys: 'гильдия', entry: 'Ныряльщики' }]);
    expect(r.format).toBe('AI Dungeon Story Cards');
    expect(r.data.cards.map(c => c.kind)).toEqual(['npc', 'faction']);
    expect(r.data.cards[0].keys).toEqual(['Ивар', 'смотритель']);
  });
  it('Character Card V2 и PNG', () => {
    const cc = { spec: 'chara_card_v2', data: { name: 'Лиса Мира', description: 'Хитрая лиса-торговка', personality: 'Остроумна', scenario: 'Ярмарка в лесу', first_mes: 'Привет, путник!', character_book: { entries: [{ keys: ['ярмарка'], content: 'Раз в год', enabled: true, comment: 'Ярмарка' }] } } };
    const r = importWorld(cc);
    expect(r.title).toBe('Лиса Мира');
    expect(r.data.cards.map(c => c.name)).toEqual(['Лиса Мира', 'Ярмарка']);
    expect(r.data.scenarios[0].hook).toBe('Ярмарка в лесу');
    const json = new TextEncoder().encode(JSON.stringify(cc));
    const b64 = btoa(String.fromCharCode(...json));
    const text = new TextEncoder().encode(`chara\0${b64}`);
    const chunk = (type: string, data: Uint8Array) => { const out = new Uint8Array(12 + data.length); new DataView(out.buffer).setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8); return out; };
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('tEXt', text), ...chunk('IEND', new Uint8Array())]);
    expect(importWorld(cardFromPng(png)).title).toBe('Лиса Мира');
  });
  it('экспорт и обратно', () => {
    const w = { title: 'Т', icon: '🌍', genre: 'space' as const, description: 'д', data: importWorld({ entries: { 0: { key: ['а'], content: 'б', comment: 'в' } } }).data };
    const back = importWorld(exportWorld(w));
    expect(back).toMatchObject({ format: 'Nexus', title: 'Т', genre: 'space' });
    expect(back.data.cards[0].name).toBe('в');
  });
  it('неизвестный формат — понятная ошибка', () => {
    expect(() => importWorld({ foo: 1 })).toThrow(/Не узнали формат/);
  });
});
