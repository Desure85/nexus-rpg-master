// Расходники: эффект из названия («+5 HP», «снимает 2 стресса») или стандартный по типу предмета.
// Один источник правды для движка и интерфейса.
export type ItemEffect = { field: 'hp' | 'stress'; delta: number };

const DEFAULT_EFFECTS: [RegExp, ItemEffect[]][] = [
  [/зель[ея] лечени|целебн|исцеля|аптечк|медпак|medkit|potion/i, [{ field: 'hp', delta: 5 }]],
  [/бинт|перевяз|мазь|пластыр/i, [{ field: 'hp', delta: 3 }]],
  [/стимулятор|стим\b|адреналин/i, [{ field: 'hp', delta: 3 }, { field: 'stress', delta: 1 }]],
  [/отвар|настой|травяной чай|успокоит|нюхательн|антирад|транквилиз/i, [{ field: 'stress', delta: -2 }]],
  [/виски|ром\b|вино|эль\b|самогон/i, [{ field: 'stress', delta: -1 }, { field: 'hp', delta: 1 }]],
  [/пирог|пряник|яблок|хлеб|паёк|паек|консерв|еда\b|сухар/i, [{ field: 'hp', delta: 2 }]],
];

export const itemEffect = (item: string): ItemEffect[] => {
  const out: ItemEffect[] = [];
  const heal = item.match(/(?:восстанавливает|лечит|\+)\s*(\d+)\s*(?:HP|ОЗ|здоровья)/i) || item.match(/(\d+)\s*HP/i);
  const calm = item.match(/(?:снимает|сброс|-)\s*(\d+)\s*стресс/i);
  if (heal) out.push({ field: 'hp', delta: parseInt(heal[1], 10) });
  if (calm) out.push({ field: 'stress', delta: -parseInt(calm[1], 10) });
  if (out.length) return out;
  return DEFAULT_EFFECTS.find(([re]) => re.test(item))?.[1].map(e => ({ ...e })) || [];
};

export const isConsumable = (item: string) => itemEffect(item).length > 0;

/** «+5 HP, −2 стресса» — подсказка на кнопке использования. */
export const describeEffect = (item: string) => itemEffect(item)
  .map(e => e.field === 'hp' ? `${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} HP` : `${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)} стресса`)
  .join(', ');
