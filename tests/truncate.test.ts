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
