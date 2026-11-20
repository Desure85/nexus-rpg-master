import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface Item { id: number; kind: string; title: string; body: string; url: string; created_at: string; read: boolean }

const ICON: Record<string, string> = { mp: '🎲', worlds: '🌍', comeback: '⏳', daily: '☀️' };
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso.replace(' ', 'T') + 'Z')) / 60000));
  return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн назад`;
};

/** Колокольчик: уведомления мастеру и автору миров; опрос раз в минуту, пока вкладка открыта. */
export const NotificationBell: React.FC<{ onOpenSession?: (id: string) => void; className?: string; panelClass?: string }> = ({ onOpenSession, className = '', panelClass = 'right-0' }) => {
  const [data, setData] = useState<{ unread: number; items: Item[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const load = () => api<{ unread: number; items: Item[] }>('/api/notifications').then(setData).catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const go = async (n: Item) => {
    setOpen(false);
    if (!n.read) { await api('/api/notifications/read', { body: { ids: [n.id] } }).catch(() => undefined); load(); }
    const sid = n.url.match(/[?&]session=([^&]+)/)?.[1];
    if (sid && onOpenSession) onOpenSession(decodeURIComponent(sid));
    else if (n.url.startsWith('/')) navigate(n.url);
  };
  const readAll = async () => { await api('/api/notifications/read', { body: {} }).catch(() => undefined); load(); };
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button data-testid="bell" onClick={() => setOpen(o => !o)} className="relative p-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5" aria-label={`Уведомления${data.unread ? `: ${data.unread} новых` : ''}`}>
        <Bell size={18} />
        {data.unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className={`absolute ${panelClass} top-full mt-2 w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto bg-[#151210] border border-white/10 rounded-2xl shadow-2xl z-[60] text-left`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-sm font-bold text-white">Уведомления</span>
            {data.unread > 0 && <button onClick={readAll} className="text-[11px] text-white/50 hover:text-white">Прочитать все</button>}
          </div>
          {data.items.length === 0 ? <p className="px-4 py-6 text-xs text-white/40 text-center">Пока тихо. Здесь появятся действия игроков, записи хроники ваших миров, покупки и отзывы.</p> : (
            <ul>{data.items.map(n => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.04] flex gap-3 ${n.read ? 'opacity-60' : ''}`}>
                  <span className="text-lg leading-none mt-0.5">{ICON[n.kind] || '🔔'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-white">{n.title}</span>
                    {n.body && <span className="block text-[11px] text-white/50 mt-0.5 line-clamp-2">{n.body}</span>}
                    <span className="block text-[10px] text-white/30 mt-1">{ago(n.created_at)}</span>
                  </span>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />}
                </button>
              </li>
            ))}</ul>
          )}
        </div>
      )}
    </div>
  );
};
