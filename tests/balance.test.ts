import { describe, it, expect } from 'vitest';
import { simulate } from '../shared/balance-sim';

// Коридоры сложности: если правишь числа в shared/balance.ts — проверь, что бои остаются в них
describe('баланс боя', () => {
  it('соло против обычного врага: почти всегда победа, но с ощутимыми потерями', () => {
    const r = simulate(1, 'regular', 1, 3000);
    expect(r.win).toBeGreaterThan(0.93);
    expect(r.hpLost).toBeGreaterThan(0.15);
    expect(r.hpLost).toBeLessThan(0.4);
  });
  it('соло против опасного врага — реальный риск', () => {
    const r = simulate(1, 'elite', 1, 3000);
    expect(r.win).toBeGreaterThan(0.65);
    expect(r.win).toBeLessThan(0.95);
  });
  it('партия из 3 против босса: побеждает, но кто-то часто падает и гибель редка', () => {
    const r = simulate(3, 'boss', 1, 3000);
    expect(r.win).toBeGreaterThan(0.85);
    expect(r.downed).toBeGreaterThan(0.1);
    expect(r.dead).toBeLessThan(0.1);
  });
});
