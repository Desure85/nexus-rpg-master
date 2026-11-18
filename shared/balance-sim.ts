// Симулятор боя по правилам игры (для подбора чисел в shared/balance.ts и проверки в тестах).
import { outcomeOf } from './resolve';
import { BALANCE, ENEMY_TIERS } from './balance';

const d = (n: number) => 1 + Math.floor(Math.random() * n);
const between = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

interface Hero { hp: number; max: number; atk: number; armor: number; downed: boolean; dead: boolean }

export function fight(heroes: Hero[], tier: keyof typeof ENEMY_TIERS, enemies: number) {
  const t = ENEMY_TIERS[tier];
  let foes = Array.from({ length: enemies }, () => between(t.hp[0], t.hp[1]));
  let rounds = 0;
  while (foes.some(h => h > 0) && heroes.some(h => !h.downed && !h.dead) && rounds < 30) {
    rounds++;
    for (const h of heroes) {
      if (h.dead) continue;
      if (h.downed) {
        const r = d(20);
        if (r >= 10) { h.downed = false; h.hp = 1; } else if (r === 1) h.dead = true;
        continue;
      }
      const i = foes.findIndex(x => x > 0);
      if (i < 0) break;
      const die = d(20);
      const out = outcomeOf(die, die + h.atk, t.dc);
      const hurt = (dmg: number) => { h.hp = Math.max(0, h.hp - Math.max(1, dmg - h.armor)); if (h.hp === 0) h.downed = true; };
      if (out === 'crit') foes[i] -= BALANCE.hit.crit;
      else if (out === 'success') foes[i] -= BALANCE.hit.success;
      else if (out === 'partial') { foes[i] -= BALANCE.hit.partial; if (Math.random() < 0.5) hurt(between(BALANCE.costDamage[0], BALANCE.costDamage[1])); }
      else hurt(between(t.dmg[0], t.dmg[1]) + (out === 'critfail' ? 1 : 0));
    }
    // каждый живой враг сверх первого давит: дополнительный урон случайному герою на провале уже учтён — здесь фокус-огонь толпы
    const alive = foes.filter(x => x > 0).length;
    if (alive > heroes.length) {
      const target = heroes.find(h => !h.downed && !h.dead);
      if (target) { target.hp = Math.max(0, target.hp - Math.max(1, t.dmg[0] - target.armor)); if (target.hp === 0) target.downed = true; }
    }
  }
  const won = !foes.some(h => h > 0);
  return { won, rounds, hpLost: heroes.reduce((a, h) => a + (h.max - h.hp), 0) / heroes.reduce((a, h) => a + h.max, 0), downed: heroes.filter(h => h.downed || h.dead).length, dead: heroes.filter(h => h.dead).length };
}

export const party = (n: number): Hero[] => Array.from({ length: n }, (_, k) => {
  const arche = [{ hp: 14, atk: 2, armor: 1 }, { hp: 11, atk: 1, armor: 0 }, { hp: 10, atk: 1, armor: 1 }, { hp: 11, atk: 1, armor: 0 }][k % 4];
  return { hp: arche.hp, max: arche.hp, atk: arche.atk, armor: arche.armor, downed: false, dead: false };
});


export function simulate(n: number, tier: keyof typeof ENEMY_TIERS, enemies: number, runs = 2000) {
  let win = 0, rounds = 0, lost = 0, down = 0, dead = 0;
  for (let i = 0; i < runs; i++) {
    const r = fight(party(n), tier, enemies);
    win += +r.won; rounds += r.rounds; lost += r.hpLost; down += r.downed > 0 ? 1 : 0; dead += r.dead > 0 ? 1 : 0;
  }
  return { win: win / runs, rounds: rounds / runs, hpLost: lost / runs, downed: down / runs, dead: dead / runs };
}
