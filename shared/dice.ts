// Серверные (честные) броски для удалённых игроков. Формат тегов совпадает с DiceRoller на экране ГМа.
export type RollType = 'classic' | 'triple' | 'shifted' | 'taint';

export const ROLL_TYPES: RollType[] = ['classic', 'triple', 'shifted', 'taint'];

type Rng = () => number;
const d = (sides: number, rng: Rng) => Math.floor(rng() * sides) + 1;

const parseStress = (stress: number | string | undefined): { current: number; max: number } => {
  if (typeof stress === 'number') return { current: stress, max: 10 };
  const parts = String(stress ?? '0').split('/');
  return { current: parseInt(parts[0]) || 0, max: parseInt(parts[1]) || 10 };
};

export interface RollInput {
  type: RollType;
  charName: string;
  actionName: string;
  stress?: number | string;
  threatLevel?: number;
  stressEnabled?: boolean;
  threatEnabled?: boolean;
  /** Только тег [ROLL: ...] без префикса «Имя performs действие» */
  bare?: boolean;
}

export const rollTag = (input: RollInput, rng: Rng = Math.random): string => {
  const { type, charName, actionName } = input;
  const prefix = input.bare ? '' : `**${charName}** performs *${actionName}*: `;
  let threatStr = '';
  if ((input.threatLevel || 0) > 0 && input.threatEnabled !== false) {
    threatStr = ` | Threat d${input.threatLevel} = -${d(input.threatLevel!, rng)}`;
  }
  let stressModStr = '';
  if ((type === 'triple' || type === 'shifted') && input.stressEnabled !== false) {
    const { current, max } = parseStress(input.stress);
    const ratio = current / (max || 10);
    stressModStr = ratio <= 0.2 ? ' | Stress: +2 (Max used)' : ratio <= 0.5 ? ' | Stress: +1 (Mid used)' : ' | Stress: -2 (Min used, Catharsis)';
  }
  switch (type) {
    case 'triple': {
      const v = [d(20, rng), d(20, rng), d(20, rng)].sort((a, b) => a - b);
      return `${prefix}[ROLL: Stress Resonance (3d20) = ${JSON.stringify(v)}${stressModStr}${threatStr}]`;
    }
    case 'shifted': {
      const v = [d(20, rng), d(20, rng), d(20, rng)].sort((a, b) => a - b);
      const shift = d(6, rng);
      const mod = shift <= 2 ? -1 : shift <= 4 ? 0 : 1;
      return `${prefix}[ROLL: Fate Shift (3d20 + 1d6) = ${JSON.stringify(v)} | d6: ${shift} (Mod: ${mod > 0 ? '+' : ''}${mod})${stressModStr}${threatStr}]`;
    }
    case 'taint': {
      const v = [d(20, rng), d(20, rng)];
      const dbl = v[0] === v[1] ? ' | DOUBLE! Doom +1' : '';
      return `${prefix}[ROLL: Chaos Roll (2d20) = ${JSON.stringify(v)}${dbl}${threatStr}]`;
    }
    default:
      return `${prefix}[ROLL: 1d20 = ${d(20, rng)}${threatStr}]`;
  }
};
