// Симуляция боя по правилам игры: подбирает HP врагов и урон так, чтобы бои были напряжёнными, но проходимыми.
// Запуск: npx tsx scripts/balance.ts
// Модель боя (как в промпте): каждый раунд каждый герой бросает d20 + бонус против DC врага.
//   КРИТ → урон по врагу HIT.crit, УСПЕХ → HIT.success, УСПЕХ С ЦЕНОЙ → HIT.partial и с шансом 50% герой получает урон «цены»,
//   ПРОВАЛ → герой получает урон врага. Броня снижает урон (минимум 1). 0 HP — «повержен», спасбросок DC 10.
import { simulate } from '../shared/balance-sim';
import { ENEMY_TIERS } from '../shared/balance';

const SCEN: [string, number, keyof typeof ENEMY_TIERS, number][] = [
  ['Соло vs 2 приспешника', 1, 'minion', 2],
  ['Соло vs обычный враг', 1, 'regular', 1],
  ['Соло vs элита', 1, 'elite', 1],
  ['Партия 3 vs 4 приспешника', 3, 'minion', 4],
  ['Партия 3 vs 2 обычных', 3, 'regular', 2],
  ['Партия 3 vs элита', 3, 'elite', 1],
  ['Партия 3 vs босс', 3, 'boss', 1],
  ['Партия 4 vs босс', 4, 'boss', 1],
];

const N = 4000;
console.log('Сценарий'.padEnd(28), 'победа', 'раунды', 'HP потеряно', 'повержены', 'гибель');
for (const [name, n, tier, cnt] of SCEN) {
  const r = simulate(n, tier, cnt, N);
  const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(5);
  console.log(name.padEnd(28), pct(r.win).padStart(6), r.rounds.toFixed(1).padStart(6), pct(r.hpLost).padStart(11), pct(r.downed).padStart(9), pct(r.dead).padStart(6));
}

// Партия целиком: соло-герой, 12 и 20 сцен, город каждые 4 сцены (shared/campaign-sim.ts)
import('../shared/campaign-sim').then(({ simulateCampaigns }) => {
  console.log('\nПартия соло'.padEnd(16), 'гибель', 'поражений', 'на грани', 'уровень', 'деньги', 'зелий', 'лечений в городе');
  for (const scenes of [12, 20]) {
    const r = simulateCampaigns(4000, undefined, scenes);
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    console.log(`${scenes} сцен`.padEnd(16), pct(r.dead).padStart(6), r.defeats.toFixed(2).padStart(9), pct(r.nearDeath).padStart(8), r.level.toFixed(1).padStart(7), Math.round(r.gold).toString().padStart(6), r.potionsUsed.toFixed(1).padStart(5), r.townHeals.toFixed(1).padStart(16));
  }
});
