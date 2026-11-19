import React, { useMemo, useState } from 'react';
import { dailyChallenge, dailyKey, dailyStreak } from '../../shared/daily';

const KEY = 'nexus_daily_played';
export const loadPlayedDays = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
export const markDailyPlayed = (key: string) => {
  try { const days = [...new Set([...loadPlayedDays(), key])].sort().slice(-60); localStorage.setItem(KEY, JSON.stringify(days)); } catch { /* приватный режим */ }
};

/** Карточка «Испытание дня» на главном экране: общий для всех сюжет, поворот и условие. */
export const DailyCard: React.FC<{ disabled?: boolean; onStart: (key: string) => void }> = ({ disabled, onStart }) => {
  const key = dailyKey();
  const dc = useMemo(() => dailyChallenge(key), [key]);
  const [played] = useState(loadPlayedDays);
  const streak = dailyStreak(played, key);
  const today = played.includes(key);
  return (
    <button
      onClick={() => onStart(key)}
      disabled={disabled}
      className="w-full max-w-xl mx-4 text-left p-4 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-500/10 via-white/[0.03] to-transparent hover:border-amber-300/50 transition-all disabled:opacity-50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-amber-300/90">☀️ Испытание дня</span>
        <span className="text-[11px] text-white/50">
          {streak > 0 && <span className="text-orange-300 font-bold">🔥 {streak} {streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней'} подряд</span>}
          {today && <span className="ml-2 text-emerald-300">✓ сыграно сегодня</span>}
        </span>
      </div>
      <div className="mt-2 flex items-start gap-3">
        <span className="text-3xl leading-none">{dc.scenario.icon}</span>
        <div className="min-w-0">
          <p className="text-white font-bold">{dc.scenario.title}</p>
          <p className="text-xs text-white/55 mt-0.5 leading-snug">{dc.twist}</p>
        </div>
      </div>
      <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/30 border border-white/10 text-[11px] text-white/75">
        <span>{dc.modifier.icon}</span><b className="text-white/90">{dc.modifier.title}</b><span className="text-white/50">· {dc.modifier.desc}</span>
      </div>
    </button>
  );
};
