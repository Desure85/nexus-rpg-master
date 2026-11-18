import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2 } from 'lucide-react';
import { api } from '../api';
import { archetypeById } from '../../shared/archetypes';

interface Hero { id: string; name: string; concept: string; archetype?: string; level: number; xp: number; adventures: number; abilities: { name: string; bonus?: string }[]; gold: number }
interface Ach { code: string; icon: string; title: string; desc: string; unlocked_at: string | null }

/** Зал героев (ветераны для следующих игр) и достижения. */
export const HallModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<'heroes' | 'achievements'>('heroes');
  const [heroes, setHeroes] = useState<Hero[] | null>(null);
  const [achs, setAchs] = useState<Ach[]>([]);
  const load = () => {
    api<Hero[]>('/api/heroes').then(setHeroes).catch(() => setHeroes([]));
    api<Ach[]>('/api/achievements').then(setAchs).catch(() => undefined);
  };
  useEffect(load, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const got = achs.filter(a => a.unlocked_at).length;
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm text-left" onClick={onClose}>
      <div className="w-full sm:max-w-2xl h-[88dvh] sm:h-[78vh] bg-[#151210] border border-white/10 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="font-display text-xl text-white">🎖️ Зал героев</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex gap-1.5 px-4 py-3 border-b border-white/5">
          <button onClick={() => setTab('heroes')} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${tab === 'heroes' ? 'bg-white text-black' : 'bg-white/5 text-white/60'}`}>Ветераны {heroes ? `(${heroes.length})` : ''}</button>
          <button onClick={() => setTab('achievements')} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${tab === 'achievements' ? 'bg-white text-black' : 'bg-white/5 text-white/60'}`}>Достижения ({got}/{achs.length})</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {tab === 'heroes' && (heroes === null ? <p className="text-white/40 text-sm">Загружаем…</p> : heroes.length === 0 ? (
            <p className="text-sm text-white/50 leading-relaxed">Пока пусто. В игре нажмите 🎖️ в карточке героя — он попадёт сюда со своим уровнем, способностями и вещами. В новой игре выберите «Ветеран из зала», и герой продолжит путь.</p>
          ) : heroes.map(h => {
            const a = archetypeById(h.archetype);
            return (
              <div key={h.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex gap-3 items-start">
                <div className="text-2xl">{a?.icon || '🧭'}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold">{h.name} <span className="text-xs font-normal text-white/40">· ур. {h.level} · {h.xp} опыта · приключений: {h.adventures}</span></p>
                  <p className="text-xs text-white/50">{a ? `${a.name}. ` : ''}{h.concept}</p>
                  {h.abilities?.length > 0 && <p className="text-[11px] text-violet-200/70 mt-1">✦ {h.abilities.map(x => x.name + (x.bonus ? ` (${x.bonus})` : '')).join(' · ')}</p>}
                </div>
                <button onClick={async () => { if (confirm(`Отпустить ${h.name} из зала?`)) { await api(`/api/heroes/${h.id}`, { method: 'DELETE' }); load(); } }} className="p-2 text-white/30 hover:text-red-300" title="Удалить"><Trash2 size={14} /></button>
              </div>
            );
          }))}
          {tab === 'achievements' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {achs.map(a => (
                <div key={a.code} className={`p-3 rounded-xl border flex gap-3 items-center ${a.unlocked_at ? 'bg-amber-400/10 border-amber-400/30' : 'bg-white/[0.02] border-white/5 opacity-50'}`}>
                  <span className={`text-2xl ${a.unlocked_at ? '' : 'grayscale'}`}>{a.icon}</span>
                  <div>
                    <p className="text-sm font-bold text-white">{a.title}</p>
                    <p className="text-[11px] text-white/50">{a.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
