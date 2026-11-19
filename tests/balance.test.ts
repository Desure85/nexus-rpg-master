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

describe('баланс партии целиком', () => {
  it('соло за вечер (12 сцен): гибель редка, на грани бывает часто, растёт до 2 уровня, деньги на лечение есть', async () => {
    const { simulateCampaigns } = await import('../shared/campaign-sim');
    const r = simulateCampaigns(3000, undefined, 12);
    expect(r.dead).toBeLessThan(0.05);
    expect(r.defeats).toBeLessThan(0.75);       // проигранных боёв за вечер меньше одного
    expect(r.nearDeath).toBeGreaterThan(0.3);   // но напряжение есть
    expect(r.nearDeath).toBeLessThan(0.75);
    expect(r.level).toBeGreaterThanOrEqual(2);
    expect(r.level).toBeLessThan(3);
    expect(r.townHeals).toBeGreaterThan(0.8);   // в городе есть на что лечиться
    expect(r.gold).toBeGreaterThan(20);
    expect(r.gold).toBeLessThan(150);
  });

  it('передышка после победы снижает поражения', async () => {
    const { simulateCampaigns } = await import('../shared/campaign-sim');
    const without = simulateCampaigns(4000, undefined, 12, { startPotions: 0, secondWind: 0 });
    const withWind = simulateCampaigns(4000, undefined, 12, { startPotions: 0, secondWind: 2 });
    expect(withWind.defeats).toBeLessThan(without.defeats);
  });
});

describe('потолки хода', () => {
  it('срезают урон, лечение, золото и опыт от модели, суммируя теги одного героя', async () => {
    const { capTurnChanges, TURN_CAPS } = await import('../shared/balance');
    const { changes, cut } = capTurnChanges([
      { field: 'hp', name: 'Арн', delta: -5 }, { field: 'hp', name: 'арн', delta: -4 },
      { field: 'gold', name: 'Арн', delta: 1000 }, { field: 'xp', name: 'Арн', delta: 40 },
      { field: 'gold', name: 'Арн', delta: -30 }, { field: 'stress', name: 'Арн', delta: 5 },
    ], n => n.toLowerCase() === 'арн' ? 'Арн' : n);
    const get = (f: string, sign: number) => changes.find(c => c.field === f && Math.sign(c.delta) === sign)?.delta;
    expect(get('hp', -1)).toBe(-TURN_CAPS.damage);
    expect(get('gold', 1)).toBe(TURN_CAPS.gold);
    expect(get('gold', -1)).toBe(-30); // траты не режем
    expect(get('xp', 1)).toBe(40);
    expect(get('stress', 1)).toBe(TURN_CAPS.stress);
    expect(cut.map(c => c.field).sort()).toEqual(['gold', 'hp', 'stress']);
  });
});
