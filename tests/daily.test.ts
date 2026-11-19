import { describe, it, expect } from 'vitest';
import { dailyChallenge, dailyStreak, DAILY_MODIFIERS } from '../shared/daily';

describe('испытание дня', () => {
  it('одинаково для всех в этот день и меняется по дням', () => {
    const a = dailyChallenge('2026-11-19'), b = dailyChallenge('2026-11-19');
    expect(a.scenario.id).toBe(b.scenario.id);
    expect(a.plotHook).toBe(b.plotHook);
    const keys = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const variants = new Set(keys.map(k => { const d = dailyChallenge(k); return `${d.scenario.id}|${d.twist}|${d.modifier.id}`; }));
    expect(variants.size).toBeGreaterThan(10);
    expect(a.plotHook).toContain('Поворот дня');
  });
  it('условия меняют числа героя', () => {
    const f = DAILY_MODIFIERS.find(m => m.id === 'fragile')!;
    expect(f.hero!({ hp: '12/12' }).hp).toBe('9/9');
    expect(f.hero!({ hp: '5/5' }).hp).toBe('4/4');
  });
  it('серия дней', () => {
    expect(dailyStreak(['2026-11-17', '2026-11-18', '2026-11-19'], '2026-11-19')).toBe(3);
    expect(dailyStreak(['2026-11-17', '2026-11-18'], '2026-11-19')).toBe(2);
    expect(dailyStreak(['2026-11-15', '2026-11-19'], '2026-11-19')).toBe(1);
    expect(dailyStreak([], '2026-11-19')).toBe(0);
  });
});
