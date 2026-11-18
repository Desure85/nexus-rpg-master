import { describe, it, expect } from 'vitest';
import { resolveRolls, resolvedOutcomes, gearBonus, armorOf, outcomeOf, parseRoll } from '../shared/resolve';

const mira = {
  name: 'Мира',
  equipment: [
    { slot: 'main-hand', item: { name: 'Меч', bonus: '+1 к атаке' } },
    { slot: 'body', item: { name: 'Кольчуга', bonus: '+2 к защите' } },
    { slot: 'accessory', item: { name: 'Плащ', bonus: '+1 к скрытности' } },
  ],
} as any;

describe('исход броска', () => {
  it('уровни успеха относительно DC', () => {
    expect(outcomeOf(20, 5, 12)).toBe('crit');
    expect(outcomeOf(1, 15, 12)).toBe('critfail');
    expect(outcomeOf(15, 17, 12)).toBe('crit');
    expect(outcomeOf(12, 12, 12)).toBe('success');
    expect(outcomeOf(9, 9, 12)).toBe('partial');
    expect(outcomeOf(8, 8, 12)).toBe('fail');
  });

  it('кубик по метке стресса и сдвиг', () => {
    expect(parseRoll('[ROLL: Stress Resonance (3d20) = [3, 11, 18] | Stress: +2 (Max used)]')!.die).toBe(18);
    expect(parseRoll('[ROLL: Stress Resonance (3d20) = [3, 11, 18] | Stress: -2 (Min used, Catharsis)]')!.die).toBe(3);
    const fs = parseRoll('[ROLL: Fate Shift (3d20 + 1d6) = [3, 11, 18] | d6: 6 (Mod: +1) | Stress: +1 (Mid used)]')!;
    expect([fs.die, fs.shift]).toEqual([11, 1]);
    expect(parseRoll('[ROLL: Chaos Roll (2d20) = [4, 17]]')!.die).toBe(17);
  });

  it('снаряжение подходит по смыслу действия, броня — к урону', () => {
    expect(gearBonus(mira, 'Бью мечом стражника').total).toBe(1);
    expect(gearBonus(mira, 'Прокрадываюсь мимо').total).toBe(1);
    expect(gearBonus(mira, 'Уговариваю торговца').total).toBe(0);
    expect(armorOf(mira)).toBe(2);
  });

  it('движок дописывает итог: кубик + снаряжение − угроза против DC', () => {
    const r = resolveRolls('[PLAYER ACTION: Мира (Аня)] Атакую разбойника\n[ROLL: 1d20 = 12 | Threat d6 = -3]', { characters: [mira], dc: 10 });
    expect(r.text).toContain('Итог: 10 = 12 (d20) +1 Меч −3 угроза против DC 10 → УСПЕХ');
    expect(r.results[0]).toMatchObject({ actor: 'Мира', outcome: 'success', total: 10 });
    // повторно не разрешается
    expect(resolveRolls(r.text, { characters: [mira] }).text).toBe(r.text);
    expect(resolvedOutcomes(r.text)).toEqual([{ actor: 'Мира', outcome: 'success', deathSave: undefined }]);
  });

  it('спасбросок смерти у поверженного героя — против DC 10', () => {
    const ok = resolveRolls('**Мира** performs *Спасбросок*: [ROLL: 1d20 = 11]', { characters: [mira], status: { 'Мира': 'downed' }, dc: 18 });
    expect(ok.text).toContain('против DC 10');
    expect(ok.results[0].deathSave).toBe('stabilized');
    const bad = resolveRolls('**Мира** performs *Спасбросок*: [ROLL: 1d20 = 6]', { characters: [mira], status: { 'Мира': 'downed' } });
    expect(bad.results[0].deathSave).toBe('failed');
  });
});
