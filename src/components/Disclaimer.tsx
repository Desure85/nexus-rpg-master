import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { DISCLAIMER_SHORT, DISCLAIMER_VERSION, disclaimerFor, type DisclaimerAudience } from '../../shared/disclaimer';
import { api } from '../api';

const ackKey = (audience: DisclaimerAudience) => `nexus_disclaimer_${audience}_v${DISCLAIMER_VERSION}`;
const acknowledged = (audience: DisclaimerAudience) => { try { return localStorage.getItem(ackKey(audience)) === '1'; } catch { return true; } };
const acknowledge = (audience: DisclaimerAudience) => { try { localStorage.setItem(ackKey(audience), '1'); } catch { /* приватный режим */ } };

/** Дополнение оператора сервера (контакты, ссылка на условия) — из /api/config. */
const useOperatorNote = () => {
  const [note, setNote] = useState<{ extra?: string; url?: string }>({});
  useEffect(() => {
    api<any>('/api/config').then(c => setNote({ extra: c.disclaimer?.extra, url: c.disclaimer?.url })).catch(() => undefined);
  }, []);
  return note;
};

export const DisclaimerModal: React.FC<{ audience: DisclaimerAudience; requireAck?: boolean; onClose: () => void }> = ({ audience, requireAck, onClose }) => {
  const note = useOperatorNote();
  const close = () => { acknowledge(audience); onClose(); };
  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm" onClick={requireAck ? undefined : close}>
      <div className="w-full max-w-lg bg-[#1a1614] border border-white/10 rounded-2xl p-6 space-y-4 max-h-[88vh] overflow-y-auto text-left" onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl text-white flex items-center gap-2"><ShieldAlert size={20} className="text-amber-400" /> {requireAck ? 'Перед игрой' : 'Об ИИ и контенте'}</h2>
        {disclaimerFor(audience).map(s => (
          <div key={s.title} className="space-y-1">
            <p className="text-sm font-bold text-white">{s.title}</p>
            <p className="text-sm text-white/60 leading-relaxed">{s.text}</p>
          </div>
        ))}
        {note.extra && <p className="text-sm text-white/60 leading-relaxed whitespace-pre-wrap border-t border-white/10 pt-3">{note.extra}</p>}
        {note.url && <a href={note.url} target="_blank" rel="noreferrer" className="block text-xs text-emerald-400 underline">Условия использования</a>}
        <button onClick={close} className="w-full py-3 bg-white text-black rounded-xl font-semibold">{requireAck ? 'Понятно, играть' : 'Закрыть'}</button>
      </div>
    </div>
  );
};

/**
 * Короткая строка-дисклеймер внизу экрана + ссылка на полный текст.
 * При первом заходе (на этом устройстве) показывает полный текст и просит подтвердить.
 */
export const DisclaimerFooter: React.FC<{ audience: DisclaimerAudience; className?: string }> = ({ audience, className = '' }) => {
  const [open, setOpen] = useState<null | 'ack' | 'info'>(() => (acknowledged(audience) ? null : 'ack'));
  return (
    <>
      <p className={`text-[10px] text-white/30 leading-snug text-center ${className}`}>
        {DISCLAIMER_SHORT[audience]}{' '}
        <button onClick={() => setOpen('info')} className="underline hover:text-white/60">Подробнее</button>
      </p>
      {open && <DisclaimerModal audience={audience} requireAck={open === 'ack'} onClose={() => setOpen(null)} />}
    </>
  );
};
