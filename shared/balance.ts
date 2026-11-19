// Числа боя: подобраны симуляцией (scripts/balance.ts) и попадают в промпт мастера.
export const BALANCE = {
  /** Урон героя по врагу [HIT] по исходу броска */
  hit: { crit: 5, success: 3, partial: 2 },
  /** Урон «цены» при успехе с ценой */
  costDamage: [1, 2] as [number, number],
  /** Передышка после победы в бою: +HP каждому герою на ногах (движок, см. scripts/balance.ts) */
  secondWind: 2,
};

/** Цены и эффекты услуг в городе: восстановление в городе дешевле зелья (~1.5 монеты за HP против 3), зелье — за то, что всегда с собой. */
export const ECONOMY = {
  rest: { cost: 8, healPct: 0.5, stress: -1 },   // таверна: половина max HP, −1 стресс
  inn: { cost: 20 },                              // постоялый двор: всё HP, стресс 0
  healer: { cost: 10, heal: 6 },                  // лекарь: +6 HP
};

/**
 * Потолки изменений за один ход мастера на героя: модель может ошибиться или «расщедриться» — движок не даст сломать баланс.
 * Урон: самый сильный удар босса 5 + 1 за крит. провал; золото: эпическая добыча 150; опыт: квест до 100.
 * Предметы, услуги, уровни и спасброски движок применяет сам — их потолки не трогают.
 */
export const TURN_CAPS = { damage: 6, heal: 6, stress: 3, gold: 150, xp: 100, tokens: 1 };

type Change = { field: string; name: string; delta: number };
/** Сводит изменения модели по герою и полю и срезает их до потолков хода. Возвращает итог и что было срезано. */
export const capTurnChanges = <T extends Change>(changes: T[], resolve: (name: string) => string = n => n) => {
  const sum = new Map<string, { c: T; delta: number }>();
  for (const c of changes) {
    const key = `${c.field}\u0000${resolve(c.name)}\u0000${c.delta < 0 ? '-' : '+'}`;
    const cur = sum.get(key);
    if (cur) cur.delta += c.delta; else sum.set(key, { c, delta: c.delta });
  }
  const out: T[] = [];
  const cut: { field: string; name: string; asked: number; applied: number }[] = [];
  for (const { c, delta } of sum.values()) {
    let lim = Infinity;
    if (c.field === 'hp') lim = delta < 0 ? TURN_CAPS.damage : TURN_CAPS.heal;
    else if (delta > 0 && c.field in TURN_CAPS) lim = (TURN_CAPS as any)[c.field];
    const applied = Math.sign(delta) * Math.min(Math.abs(delta), lim);
    if (applied !== delta) cut.push({ field: c.field, name: resolve(c.name), asked: delta, applied });
    if (applied) out.push({ ...c, delta: applied });
  }
  return { changes: out, cut };
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
- После победы движок сам даёт героям передышку +${BALANCE.secondWind} HP — не лечи их за это тегами.
- Урон по герою [DAMAGE] — на ПРОВАЛЕ (урон врага) и как цена УСПЕХА С ЦЕНОЙ (${r(BALANCE.costDamage)}). На успехе герой не ранен.
- Соло-герою — 1 обычный враг или 2 приспешника за раз; партии из 3 — опасный враг или 2–3 обычных; босс — для партии и кульминации.`;
};
