import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import { guideFor, guideDisclaimer, type GuideAudience } from '../../shared/guide';

/** Гайд: что где и на что влияет. Мастеру — все разделы, игроку — свои. */
export const GuideModal: React.FC<{ audience: GuideAudience; initial?: string; onClose: () => void }> = ({ audience, initial, onClose }) => {
  const sections = [...guideFor(audience), guideDisclaimer(audience)];
  const [active, setActive] = useState(initial && sections.some(s => s.id === initial) ? initial : sections[0].id);
  const sec = sections.find(s => s.id === active) || sections[0];
  // Портал: родитель с backdrop-filter иначе станет «рамкой» для position: fixed
  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm text-left" onClick={onClose}>
      <div className="w-full sm:max-w-2xl h-[92dvh] sm:h-[80vh] bg-[#151210] border border-white/10 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="font-display text-xl text-white flex items-center gap-2"><BookOpen size={18} className="text-amber-400" /> Как всё устроено</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex gap-1.5 px-4 py-3 overflow-x-auto border-b border-white/5 shrink-0">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${active === s.id ? 'bg-white text-black' : 'bg-white/5 text-white/60 hover:text-white'}`}
            >{s.icon} {s.title}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {sec.intro && <p className="text-sm text-white/75 leading-relaxed bg-white/5 border border-white/10 rounded-xl p-4">{sec.intro}</p>}
          {sec.items.map(it => (
            <div key={it.title} className="space-y-1">
              <h3 className="text-sm font-bold text-white">{it.title}</h3>
              <p className="text-sm text-white/60 leading-relaxed">{it.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};

/** Кнопка «Как играть» + модалка. */
export const GuideButton: React.FC<{ audience: GuideAudience; className?: string; label?: string; initial?: string }> = ({ audience, className = '', label = 'Как играть', initial }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className} title="Гайд: что где и на что влияет">
        <BookOpen size={14} /> {label}
      </button>
      {open && <GuideModal audience={audience} initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
};
