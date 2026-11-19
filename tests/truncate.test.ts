import { describe, it, expect } from 'vitest';
import { cutToSentence, isTruncatedTurn } from '../server/engine';

describe('обрыв ответа', () => {
  it('узнаёт оборванный ход', () => {
    expect(isTruncatedTurn('Текст. <dashboard_json>{}</dashboard_json>')).toBe(false);
    expect(isTruncatedTurn('Текст. <dashboard_json>{"a":')).toBe(true);
    expect(isTruncatedTurn('Текст без блока')).toBe(true);
  });
  it('срезает недописанную фразу и незакрытый блок', () => {
    expect(cutToSentence('Первая фраза. Вторая фраза. И вот обры')).toBe('Первая фраза. Вторая фраза.');
    expect(cutToSentence('Всё сказано. <dashboard_json>{"atm')).toBe('Всё сказано.');
    expect(cutToSentence('Коротко и оборва')).toBe('Коротко и оборва');
  });
});

import { stripStrayTags } from '../server/engine';
describe('чистка служебного в тексте', () => {
  it('убирает эхо входных тегов и обрывки', () => {
    const t = 'Ветер стих.\n\n[DAMAGE: Кайрел]\n[suggestedRoll] подсказанный бросок: разговорить\n[LOOT FOUND: Медный ключ (тёплый)] Кайрел сжимает ключ.\n\n — Моя печать, — говорит он.';
    const r = stripStrayTags(t);
    expect(r).not.toMatch(/\[|suggestedRoll/);
    expect(r).toContain('Кайрел сжимает ключ.');
    expect(r).toContain('\n— Моя печать');
  });
  it('не трогает обычный текст в скобках', () => {
    expect(stripStrayTags('Надпись гласила: [неразборчиво].')).toBe('Надпись гласила: [неразборчиво].');
  });
});

import { normalizeBlocks } from '../shared/parse';
describe('кривая разметка блоков', () => {
  it('[dashboard_json]{…}</dashboard_json>', () => {
    const t = normalizeBlocks('Текст.\n\n[must roll]\n[dashboard_json]{"atmosphere":"x"}</dashboard_json>');
    expect(t).toContain('<dashboard_json>{"atmosphere":"x"}</dashboard_json>');
  });
  it('```json без тегов', () => {
    expect(normalizeBlocks('Текст.\n```json\n{"atmosphere":"x","characters":[]}\n```')).toContain('<dashboard_json>{"atmosphere":"x","characters":[]}</dashboard_json>');
  });
  it('нет открывающего тега', () => {
    const t = normalizeBlocks('Текст сцены.\n{\n"atmosphere": "x"\n}</dashboard_json>');
    expect(t).toMatch(/<dashboard_json>\s*\{\s*"atmosphere": "x"\s*\}<\/dashboard_json>/);
  });
  it('```json внутри тега', () => {
    expect(normalizeBlocks('<dashboard_json>```json\n{"a":1}\n```</dashboard_json>')).toBe('<dashboard_json>{"a":1}</dashboard_json>');
  });
  it('[must roll] уходит из текста', () => {
    expect(stripStrayTags('Сцена.\n[must roll]\nДальше.')).toBe('Сцена.\nДальше.');
  });
});
