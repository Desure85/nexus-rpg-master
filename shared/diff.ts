// «Итог хода»: что изменилось между двумя состояниями сцены. Используется под ответом мастера и в уведомлениях игрока.
import type { DashboardData, Character } from '../src/types';
import { levelFromXp } from './rules';

export type Tone = 'good' | 'bad' | 'neutral' | 'epic';
export interface Change { who?: string; icon: string; text: string; tone: Tone }

const num = (v: unknown) => { const n = parseInt(String(v ?? '').split('/')[0], 10); return isNaN(n) ? 0 : n; };
const max = (v: unknown) => { const n = parseInt(String(v ?? '').split('/')[1], 10); return isNaN(n) ? 0 : n; };
const itemName = (i: any) => (typeof i === 'string' ? i : i?.name || '');
const signed = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);

export function diffCharacter(a: Partial<Character> | undefined, b: Partial<Character>): Change[] {
  const out: Change[] = [];
  const who = b.name;
  if (!a) return [{ who, icon: '✨', text: 'присоединяется к партии', tone: 'neutral' }];
  const dHp = num(b.hp) - num(a.hp);
  if (dHp) out.push({ who, icon: dHp < 0 ? '💔' : '❤️', text: `${signed(dHp)} HP`, tone: dHp < 0 ? 'bad' : 'good' });
  if (max(b.hp) > max(a.hp)) out.push({ who, icon: '🛡️', text: `макс. HP ${max(b.hp)}`, tone: 'good' });
  if (num(a.hp) > 0 && num(b.hp) === 0) out.push({ who, icon: '💀', text: 'повержен', tone: 'bad' });
  if (num(a.hp) === 0 && num(b.hp) > 0 && max(a.hp)) out.push({ who, icon: '🌅', text: 'снова в строю', tone: 'good' });
  const dSt = num(b.stress) - num(a.stress);
  if (dSt) out.push({ who, icon: '🌀', text: `${signed(dSt)} стресс`, tone: dSt > 0 ? 'bad' : 'good' });
  const dGold = (Number(b.gold) || 0) - (Number(a.gold) || 0);
  if (dGold) out.push({ who, icon: '🪙', text: `${signed(dGold)} золота`, tone: dGold > 0 ? 'good' : 'neutral' });
  const dXp = (Number(b.xp) || 0) - (Number(a.xp) || 0);
  if (dXp > 0) out.push({ who, icon: '⭐', text: `+${dXp} опыта`, tone: 'good' });
  const la = levelFromXp(Number(a.xp) || 0), lb = levelFromXp(Number(b.xp) || 0);
  if (lb > la) out.push({ who, icon: '🏆', text: `уровень ${lb}!`, tone: 'epic' });
  const dTok = (Number(b.tokens) || 0) - (Number(a.tokens) || 0);
  if (dTok) out.push({ who, icon: '✦', text: `${signed(dTok)} жетон`, tone: dTok > 0 ? 'epic' : 'neutral' });
  const ia = (a.inventory || []).map(itemName), ib = (b.inventory || []).map(itemName);
  const added = ib.filter(x => { const i = ia.indexOf(x); if (i >= 0) { ia.splice(i, 1); return false; } return true; });
  for (const x of added) out.push({ who, icon: '🎒', text: x, tone: 'good' });
  for (const x of ia) out.push({ who, icon: '➖', text: x, tone: 'neutral' });
  const aa = new Set((a.abilities || []).map(x => x.name));
  for (const ab of b.abilities || []) if (!aa.has(ab.name)) out.push({ who, icon: '🔮', text: `способность «${ab.name}»`, tone: 'epic' });
  return out;
}

export function diffDashboards(prev: DashboardData | undefined, next: DashboardData | undefined): Change[] {
  if (!next) return [];
  if (!prev) return [];
  const out: Change[] = [];
  for (const c of next.characters || []) out.push(...diffCharacter((prev.characters || []).find(x => x.name === c.name), c));
  const pt = prev.threats || [];
  for (const t of next.threats || []) {
    const before = pt.find(x => x.name === t.name);
    if (!before) out.push({ icon: '⚔️', text: `появляется ${t.name}`, tone: 'bad' });
    else if (num(t.hp) < num(before.hp)) out.push({ icon: '🗡️', text: `${t.name} ${signed(num(t.hp) - num(before.hp))} HP${num(t.hp) <= 0 ? ' — повержен' : ''}`, tone: 'good' });
  }
  for (const t of pt) if (!(next.threats || []).some(x => x.name === t.name) && num(t.hp) > 0) out.push({ icon: '🏳️', text: `${t.name} уходит со сцены`, tone: 'good' });
  const dDoom = (next.doomPool || 0) - (prev.doomPool || 0);
  if (dDoom > 0) out.push({ icon: '☠️', text: `Пул Рока ${signed(dDoom)} (${next.doomPool}/5)`, tone: 'bad' });
  for (const c of next.clocks || []) {
    const b = (prev.clocks || []).find(x => x.name === c.name);
    if (!b) out.push({ icon: '⏳', text: `новые часы «${c.name}» ${c.progress}/${c.total}`, tone: 'neutral' });
    else if (c.progress !== b.progress) out.push({ icon: '⏳', text: `«${c.name}» ${c.progress}/${c.total}`, tone: c.progress > b.progress ? 'bad' : 'good' });
  }
  for (const c of prev.clocks || []) if (!(next.clocks || []).some(x => x.name === c.name)) out.push({ icon: '🔔', text: `часы «${c.name}» ${c.progress >= c.total - 1 ? 'пробили' : 'остановлены'}`, tone: 'neutral' });
  const pl = new Set(prev.sceneLoot || []);
  for (const l of next.sceneLoot || []) if (!pl.has(l)) out.push({ icon: '💎', text: `на сцене: ${l}`, tone: 'good' });
  if (next.currentLocationId && next.currentLocationId !== prev.currentLocationId) {
    const loc = (next.locations || []).find(l => l.id === next.currentLocationId);
    if (loc) out.push({ icon: '📍', text: loc.name, tone: 'neutral' });
  }
  const knownLoc = new Set((prev.locations || []).map(l => l.id));
  for (const l of next.locations || []) if (!knownLoc.has(l.id)) out.push({ icon: '🗺️', text: `открыто: ${l.name}`, tone: 'good' });
  for (const q of next.quests || []) {
    const b = (prev.quests || []).find(x => x.title === q.title);
    if (b?.status !== q.status) out.push({ icon: q.status === 'done' ? '✅' : q.status === 'failed' ? '❌' : '📜', text: `квест «${q.title}»${q.status === 'done' ? ' выполнен' : q.status === 'failed' ? ' провален' : ''}`, tone: q.status === 'failed' ? 'bad' : 'good' });
  }
  return out;
}
