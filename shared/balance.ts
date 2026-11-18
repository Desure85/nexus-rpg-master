// Числа боя: подобраны симуляцией (scripts/balance.ts) и попадают в промпт мастера.
export const BALANCE = {
  /** Урон героя по врагу [HIT] по исходу броска */
  hit: { crit: 5, success: 3, partial: 2 },
  /** Урон «цены» при успехе с ценой */
  costDamage: [1, 2] as [number, number],
};

/** Ранги врагов: HP, урон по герою на провале, сложность попасть */
export const ENEMY_TIERS = {
  minion: { name: 'приспешник', hp: [3, 4] as [number, number], dmg: [2, 2] as [number, number], dc: 10 },
  regular: { name: 'обычный враг', hp: [7, 9] as [number, number], dmg: [3, 4] as [number, number], dc: 12 },
  elite: { name: 'опасный враг', hp: [13, 15] as [number, number], dmg: [3, 4] as [number, number], dc: 14 },
  boss: { name: 'босс', hp: [20, 24] as [number, number], dmg: [3, 5] as [number, number], dc: 14 },
};

/** Строка для промпта мастера. */
export const balanceRules = () => {
  const t = ENEMY_TIERS;
  const r = (x: [number, number]) => (x[0] === x[1] ? `${x[0]}` : `${x[0]}–${x[1]}`);
  return `ЧИСЛА БОЯ (проверены симуляцией, держись их):
- Урон героя по врагу [HIT] по исходу броска: КРИТ ${BALANCE.hit.crit}, УСПЕХ ${BALANCE.hit.success}, УСПЕХ С ЦЕНОЙ ${BALANCE.hit.partial}. Особо мощное оружие или удачный аспект — +1.
- Враги: ${t.minion.name} HP ${r(t.minion.hp)} (DC ${t.minion.dc}, урон ${r(t.minion.dmg)}); ${t.regular.name} HP ${r(t.regular.hp)} (DC ${t.regular.dc}, урон ${r(t.regular.dmg)}); ${t.elite.name} HP ${r(t.elite.hp)} (DC ${t.elite.dc}, урон ${r(t.elite.dmg)}); ${t.boss.name} HP ${r(t.boss.hp)} (DC ${t.boss.dc}, урон ${r(t.boss.dmg)}).
- Урон по герою [DAMAGE] — на ПРОВАЛЕ (урон врага) и как цена УСПЕХА С ЦЕНОЙ (${r(BALANCE.costDamage)}). На успехе герой не ранен.
- Соло-герою — 1 обычный враг или 2 приспешника за раз; партии из 3 — опасный враг или 2–3 обычных; босс — для партии и кульминации.`;
};
