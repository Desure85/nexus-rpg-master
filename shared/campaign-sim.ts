// Симулятор партии целиком: сцены (бои, проверки, разговоры), добыча, опыт, город (таверна, ночлег, лекарь, лавка).
// Отвечает на вопросы баланса: как часто герой гибнет за вечер, бывает ли на грани, хватает ли денег на лечение, до какого уровня дорастает.
// Запуск отчёта: npx tsx scripts/balance.ts
import { fight, party } from './balance-sim';
import { outcomeOf } from './resolve';
import { ECONOMY, BALANCE } from './balance';
import { levelFromXp } from './rules';

const d = (n: number) => 1 + Math.floor(Math.random() * n);
const chance = (p: number) => Math.random() < p;

export interface Economy { rest: { cost: number; healPct: number; stress: number }; inn: { cost: number }; healer: { cost: number; heal: number }; potion: { cost: number; heal: number } }
export const CURRENT_ECONOMY: Economy = { ...ECONOMY, potion: { cost: 15, heal: 5 } };

export interface CampaignResult {
  dead: number; defeats: number; nearDeath: number; broken: number;
  level: number; gold: number; potionsUsed: number; townHeals: number;
}

/** Одна партия соло-героя: scenes сцен, город каждые townEvery сцен. */
export interface Rules { startPotions: number; secondWind: number; elite?: boolean }
export const CURRENT_RULES: Rules = { startPotions: 0, secondWind: BALANCE.secondWind };

export function campaign(econ: Economy = CURRENT_ECONOMY, scenes = 12, townEvery = 4, startGold = 12, rules: Rules = CURRENT_RULES): CampaignResult {
  const [h] = party(1);
  let gold = startGold, xp = 0, potions = rules.startPotions, stress = 0;
  const eliteOk = !!rules.elite; // соло-герою опасных врагов мастер не выставляет (правило в промпте)
  const r: CampaignResult = { dead: 0, defeats: 0, nearDeath: 0, broken: 0, level: 1, gold: 0, potionsUsed: 0, townHeals: 0 };
  let low = false;
  const hurt = (n: number) => { h.hp = Math.max(0, h.hp - n); if (h.hp <= h.max * 0.3) low = true; };
  const drinkIfLow = () => { if (potions && h.hp <= h.max / 2) { potions--; r.potionsUsed++; h.hp = Math.min(h.max, h.hp + econ.potion.heal); } };
  for (let s = 1; s <= scenes && !h.dead; s++) {
    const kind = Math.random();
    if (kind < 0.35) {
      drinkIfLow();
      const elite = eliteOk && s >= 8 && chance(0.3);
      const res = fight([h], elite ? 'elite' : chance(0.6) ? 'regular' : 'minion', elite ? 1 : chance(0.6) ? 1 : 2);
      if (h.hp <= h.max * 0.3) low = true;
      if (h.dead) { r.dead = 1; break; }
      if (!res.won) { r.defeats++; h.downed = false; h.hp = Math.max(1, h.hp); xp += 5; }
      else {
        xp += 20;
        h.hp = Math.min(h.max, h.hp + rules.secondWind); // передышка после победы
        if (chance(0.7)) { const t = Math.random(); gold += t < 0.6 ? 12 : t < 0.9 ? 30 : 75; }
        if (chance(0.15)) potions++;
      }
      if (h.downed) { h.downed = false; h.hp = 1; }
    } else if (kind < 0.7) {
      const die = d(20);
      const out = outcomeOf(die, die + 1, 12);
      if (out === 'partial' && chance(0.5)) hurt(1 + d(2) - 1);
      if (out === 'fail' || out === 'critfail') { stress++; if (chance(0.4)) hurt(2 + d(2) - 1); }
      if (h.hp === 0) { h.hp = 1; r.defeats++; }
      xp += 15;
    } else {
      xp += 10;
      if (chance(0.3)) gold += 15; // награда за поручение
      if (chance(0.25)) stress = Math.max(0, stress - 1);
    }
    if (stress >= 10) { r.broken = 1; stress = 7; }
    // повышение уровня: +2 max HP, как в движке
    const lvl = levelFromXp(xp);
    if (lvl > r.level) { h.max += 2 * (lvl - r.level); h.hp += 2 * (lvl - r.level); r.level = lvl; }
    // город: сначала дешёвая передышка/лекарь, ночлег при высоком стрессе, потом зелье в дорогу
    if (s % townEvery === 0) {
      if (stress >= 5 && gold >= econ.inn.cost) { gold -= econ.inn.cost; h.hp = h.max; stress = 0; r.townHeals++; }
      else if (h.hp < h.max * 0.7 && gold >= econ.rest.cost) { gold -= econ.rest.cost; h.hp = Math.min(h.max, h.hp + Math.ceil(h.max * econ.rest.healPct)); stress = Math.max(0, stress + econ.rest.stress); r.townHeals++; }
      else if (h.hp < h.max * 0.7 && gold >= econ.healer.cost) { gold -= econ.healer.cost; h.hp = Math.min(h.max, h.hp + econ.healer.heal); r.townHeals++; }
      while (potions < 2 && gold >= econ.potion.cost + econ.rest.cost) { gold -= econ.potion.cost; potions++; }
    }
  }
  r.nearDeath = low ? 1 : 0;
  r.gold = gold;
  return r;
}

export function simulateCampaigns(runs = 3000, econ: Economy = CURRENT_ECONOMY, scenes = 12, rules: Rules = CURRENT_RULES) {
  const acc = { dead: 0, defeats: 0, nearDeath: 0, broken: 0, level: 0, gold: 0, potionsUsed: 0, townHeals: 0 };
  for (let i = 0; i < runs; i++) { const r = campaign(econ, scenes, 4, 12, rules); for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] += r[k]; }
  for (const k of Object.keys(acc) as (keyof typeof acc)[]) acc[k] /= runs;
  return acc;
}
