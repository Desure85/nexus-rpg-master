import React, { useEffect, useRef, useState } from 'react';
import type { DashboardData, Message } from '../types';
import { diffDashboards, type Change } from '../../shared/diff';

const TONE: Record<string, string> = {
  good: 'bg-emerald-500/10 text-emerald-200 border-emerald-500/25',
  bad: 'bg-red-500/10 text-red-200 border-red-500/25',
  neutral: 'bg-white/5 text-white/70 border-white/10',
  epic: 'bg-amber-400/15 text-amber-100 border-amber-400/40',
};

/** Состояние сцены до каждого сообщения (для «Итога хода»). */
export const dashboardsBefore = (history: Message[]): (DashboardData | undefined)[] => {
  const out: (DashboardData | undefined)[] = [];
  let last: DashboardData | undefined;
  history.forEach((m, i) => { out[i] = last; if (m.dashboard) last = m.dashboard; });
  return out;
};

/** «Итог хода»: что изменилось после ответа мастера. Игроку — его герой и общие события. */
export const TurnSummary: React.FC<{ prev?: DashboardData; next?: DashboardData; focus?: string }> = ({ prev, next, focus }) => {
  let items = diffDashboards(prev, next);
  if (focus) items = items.filter(c => !c.who || c.who === focus);
  if (!items.length) return null;
  const many = new Set(items.filter(c => c.who).map(c => c.who)).size > 1;
  return (
    <div className="not-italic font-sans flex flex-wrap gap-1.5 pt-2" aria-label="Итог хода">
      {items.slice(0, 16).map((c, k) => (
        <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] ${TONE[c.tone]}`}>
          <span>{c.icon}</span>{many && c.who ? <b className="font-semibold">{c.who.split(' ')[0]}:</b> : null}<span>{c.text}</span>
        </span>
      ))}
    </div>
  );
};

/** Число с всплывающей разницей («−3») на пару секунд после изменения. */
export const DeltaBadge: React.FC<{ value: number; className?: string; invert?: boolean }> = ({ value, className = '', invert }) => {
  const prev = useRef(value);
  const [delta, setDelta] = useState<{ d: number; key: number } | null>(null);
  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (!d) return;
    setDelta({ d, key: Date.now() });
    const t = setTimeout(() => setDelta(null), 2600);
    return () => clearTimeout(t);
  }, [value]);
  if (!delta) return null;
  const good = invert ? delta.d < 0 : delta.d > 0;
  return (
    <span key={delta.key} className={`nexus-delta pointer-events-none absolute -top-3 right-0 text-xs font-bold font-mono ${good ? 'text-emerald-300' : 'text-red-300'} ${className}`}>
      {delta.d > 0 ? `+${delta.d}` : `−${Math.abs(delta.d)}`}
    </span>
  );
};

export type { Change };
