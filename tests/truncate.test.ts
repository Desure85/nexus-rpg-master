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
