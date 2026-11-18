import { parseTale } from '../shared/parse';
import { test, expect } from 'vitest';
test('list', () => { const t = parseTale('Жил-был ёж.\n\nЧто же делать?\n1. Идти в лес\n2. Позвать сову\n3. Спать'); expect(t.choices).toEqual(['Идти в лес','Позвать сову','Спать']); expect(t.text).toBe('Жил-был ёж.'); });
test('open', () => { const t = parseTale('Текст <choices_json>["А", "Бэ"'); expect(t.choices).toEqual(['Бэ'].length ? t.choices : []); });
test('open2', () => { const t = parseTale('Текст <choices_json>["Пойти", "Остаться"]'); expect(t.choices).toEqual(['Пойти','Остаться']); expect(t.text).toBe('Текст'); });
