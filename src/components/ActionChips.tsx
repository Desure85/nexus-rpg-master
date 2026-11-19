import React from 'react';
import type { DashboardData } from '../types';

const tone = (cat: string) =>
  cat === 'Искушение' ? 'border-red-400/30 text-red-200 bg-red-500/10' :
  cat === 'Рискованный' ? 'border-orange-400/30 text-orange-200 bg-orange-500/10' :
  cat === 'Синергия' ? 'border-emerald-400/30 text-emerald-200 bg-emerald-500/10' :
  cat === 'Лут' || cat === 'Loot' ? 'border-amber-400/30 text-amber-200 bg-amber-500/10' :
  'border-sky-400/30 text-sky-200 bg-sky-500/10';

/** Варианты действий из последнего ответа — прямо над полем ввода (на телефоне панель «Сцена» скрыта). */
export const ActionChips: React.FC<{ dashboard: DashboardData; skip?: string[]; disabled?: boolean; onPick: (text: string) => void }> = ({ dashboard, skip = [], disabled, onPick }) => {
  const chars = (dashboard.characters || []).filter(c => !skip.includes(c.name) && (c.actions || []).length && !/повержен|мёртв|мертв/i.test(String(c.status || '')));
  if (!chars.length) return null;
  const multi = chars.length > 1;
  return (
    <div className="mb-2 -mx-1 px-1 flex gap-1.5 overflow-x-auto no-scrollbar" aria-label="Варианты действий">
      {chars.flatMap(c => (c.actions || []).slice(0, 4).map((a, i) => (
        <button
          key={`${c.name}-${i}`}
          disabled={disabled}
          onClick={() => onPick(`${c.name}: ${a.name}${a.description ? ` — ${a.description}` : ''}`)}
          title={`${a.category}: ${a.description}`}
          className={`shrink-0 max-w-[16rem] px-3 py-1.5 rounded-xl border text-left text-xs leading-tight transition-all hover:brightness-125 disabled:opacity-40 ${tone(a.category)}`}
        >
          {multi && <span className="opacity-60">{c.name}: </span>}
          <span className="font-semibold">{a.name}</span>
        </button>
      )))}
    </div>
  );
};
