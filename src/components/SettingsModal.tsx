import React, { useEffect, useState } from 'react';
import { AppSettings } from '../types';
import { X, Save, Type, Users, KeyRound, LogOut, Feather, Lock } from 'lucide-react';
import { MECHANIC_INFO } from '../../shared/rules';
import { api } from '../api';
import { customAlert } from './PromptModal';
import { inputCls, labelCls } from './PlatformAiForm';

interface SettingsModalProps {
  settings: AppSettings;
  /** Если открыта своя сессия — механики/промпт сохраняются и в неё */
  sessionName?: string;
  user?: { email: string; name: string } | null;
  onSave: (settings: AppSettings) => void;
  onLogout: () => void;
  onClose: () => void;
}

type Tab = 'prompt' | 'mechanics' | 'appearance' | 'account';

const EXTRA_PRESETS = ['Больше диалогов NPC', 'Короткие ответы', 'Мрачнее и серьёзнее', 'Больше юмора', 'Без жестоких сцен', 'Больше загадок', 'Быстрее к действию'];

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, sessionName, user, onSave, onLogout, onClose }) => {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [ids, setIds] = useState<Identities | null>(null);
  useEffect(() => { api<Identities>('/api/auth/identities').then(setIds).catch(() => undefined); }, []);

  const changePassword = async () => {
    setPwStatus(null);
    try {
      await api('/api/auth/password', { body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '' });
      setPwStatus({ ok: true, text: ids?.hasPassword === false ? 'Пароль задан — теперь можно входить и по почте.' : 'Пароль изменён. Остальные устройства разлогинены.' });
      if (ids) setIds({ ...ids, hasPassword: true });
    } catch (e) {
      setPwStatus({ ok: false, text: e instanceof Error ? e.message : 'Ошибка' });
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'prompt', label: 'Мастер' },
    { id: 'mechanics', label: 'Механики' },
    { id: 'appearance', label: 'Вид' },
    { id: 'account', label: 'Аккаунт' },
  ];

  // Esc закрывает окно
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#1a1614] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center shrink-0">
          <h2 className="font-display text-xl text-white">Настройки Nexus</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-white/10 overflow-x-auto shrink-0">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 min-w-max px-3 py-3 text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === t.id ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'prompt' && (
            <div className="space-y-4">
              <div>
                <label className={labelCls}><Feather size={12} /> Пожелания мастеру</label>
                <p className="text-xs text-white/50 mt-1 leading-relaxed">
                  Как вести игру: тон, темп, о чём писать больше, чего избегать. Правила, броски и формат ответа задаёт движок — пожелания их не отменяют.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {EXTRA_PRESETS.map(p => {
                  const lines = (local.extraInstructions || '').split('\n').map(l => l.trim());
                  const on = lines.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => setLocal({ ...local, extraInstructions: (on ? lines.filter(l => l !== p) : [...lines.filter(Boolean), p]).join('\n') })}
                      className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${on ? 'bg-emerald-500/15 border-emerald-400/50 text-emerald-200' : 'border-white/10 bg-white/5 text-white/70 hover:border-white/30 hover:text-white'}`}
                    >{on ? '✓' : '+'} {p}</button>
                  );
                })}
              </div>
              <textarea
                value={local.extraInstructions || ''}
                maxLength={3000}
                onChange={e => setLocal({ ...local, extraInstructions: e.target.value })}
                placeholder="Например: больше живых диалогов с NPC, мрачная атмосфера, без пыток и жестокости к животным, ответы покороче."
                className="w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-white/30 transition-all resize-y min-h-[160px]"
              />
              <p className="text-[10px] text-white/30 flex justify-between">
                <span>{sessionName ? `Для сессии «${sessionName}» и новых игр.` : 'Для новых игр.'} Работает и в режиме «Сказка».</span>
                <span>{(local.extraInstructions || '').length}/3000</span>
              </p>
            </div>
          )}

          {activeTab === 'mechanics' && (
            <div className="space-y-4">
              <p className="text-[10px] text-white/40">{sessionName ? `Изменения применятся к сессии «${sessionName}» и к новым сессиям.` : 'Применяются к новым сессиям.'}</p>
              <div className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-3">
                <label className={labelCls}><Users size={12} /> Игрок не успел отправить действие</label>
                <div className="flex gap-2">
                  {([['random', 'Случайно'], ['skip', 'Не действует'], ['gm', 'Играет ГМ']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setLocal({ ...local, idlePlayerAction: id })}
                      className={`flex-1 py-2.5 rounded-lg border text-xs font-bold transition-all ${(local.idlePlayerAction || 'random') === id ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {(['Броски', 'Герой', 'Сцена', 'Повествование'] as const).map(group => {
                const items = (local.mechanics || []).filter(m => (MECHANIC_INFO[m.id]?.group || 'Повествование') === group);
                if (!items.length) return null;
                return (
                  <div key={group} className="space-y-1.5">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-white/40 px-1">{group}</div>
                    <div className="bg-black/40 border border-white/10 rounded-xl divide-y divide-white/5">
                      {items.map(mechanic => {
                        const info = MECHANIC_INFO[mechanic.id];
                        const core = !!info?.core;
                        return (
                          <label key={mechanic.id} className={`flex items-start gap-3 p-3 ${core ? 'opacity-60' : 'cursor-pointer hover:bg-white/[0.03]'}`}>
                            <input
                              type="checkbox"
                              checked={core || mechanic.enabled}
                              disabled={core}
                              onChange={e => setLocal({ ...local, mechanics: (local.mechanics || []).map(m => m.id === mechanic.id ? { ...m, enabled: e.target.checked } : m) })}
                              className="accent-emerald-500 w-4 h-4 mt-0.5 shrink-0"
                            />
                            <span className="min-w-0">
                              <span className="text-sm text-white flex items-center gap-1.5">{info?.title || mechanic.name}{core && <Lock size={10} className="text-white/40" />}</span>
                              <span className="block text-[11px] text-white/45 leading-snug">{core ? 'Основа игры — всегда включено. ' : ''}{info?.hint}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className={labelCls}><Type size={12} /> Шрифт</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['sans', 'serif', 'mono'] as const).map(f => (
                    <button key={f} onClick={() => setLocal({ ...local, fontFamily: f })} className={`py-3 rounded-xl border transition-all text-xs font-bold capitalize ${local.fontFamily === f ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className={labelCls}><Type size={12} /> Размер ({local.fontSize}px)</label>
                <input type="range" min="12" max="24" step="1" value={local.fontSize} onChange={e => setLocal({ ...local, fontSize: parseInt(e.target.value) })} className="w-full accent-white" />
              </div>
              <p className="leading-relaxed text-white/80 p-4 bg-white/5 border border-white/10 rounded-xl" style={{ fontSize: `${local.fontSize}px`, fontFamily: local.fontFamily === 'serif' ? 'serif' : local.fontFamily === 'mono' ? 'monospace' : 'sans-serif' }}>
                Нексус гудит низкой, ритмичной вибрацией. Вы стоите на пороге реальности.
              </p>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="space-y-6">
              <div className="p-4 bg-black/40 border border-white/10 rounded-xl flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-white font-medium">{user?.name}</p>
                  <p className="text-xs text-white/40">{user?.email}</p>
                </div>
                <button onClick={onLogout} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold text-white flex items-center gap-2"><LogOut size={14} /> Выйти</button>
              </div>
              <LoginMethods />
              <NotifyPrefs />
              <div className="space-y-2">
                <label className={labelCls}><KeyRound size={12} /> {ids?.hasPassword === false ? 'Задать пароль' : 'Сменить пароль'}</label>
                {ids?.hasPassword !== false && <input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} className={inputCls} />}
                <input type="password" autoComplete="new-password" placeholder="Новый пароль (от 8 символов)" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} className={inputCls} />
                <button onClick={changePassword} disabled={(ids?.hasPassword !== false && !pw.current) || pw.next.length < 8} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white disabled:opacity-40">{ids?.hasPassword === false ? 'Задать' : 'Сменить'}</button>
                {pwStatus && <p className={`text-xs ${pwStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>{pwStatus.text}</p>}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 bg-black/20 flex gap-3">
          <button onClick={() => onSave(local)} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl font-semibold hover:bg-white/90 transition-all">
            <Save size={18} /> Сохранить
          </button>
          <button onClick={onClose} className="px-6 py-3 border border-white/10 text-white rounded-xl font-semibold hover:bg-white/5 transition-all">
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};

interface Identities { identities: { provider: string; email?: string }[]; hasPassword: boolean; available: { id: string; name: string }[] }

/** Способы входа: VK ID, Яндекс ID, Google — привязать или отвязать. */
/** Какие уведомления присылать на почту (в колокольчике они есть всегда). */
const NotifyPrefs: React.FC = () => {
  const [d, setD] = useState<{ prefs: Record<string, boolean>; kinds: { id: string; name: string }[]; mail: boolean } | null>(null);
  useEffect(() => { api<any>('/api/notifications/prefs').then(setD).catch(() => undefined); }, []);
  if (!d) return null;
  const toggle = async (id: string) => {
    const r = await api<any>('/api/notifications/prefs', { method: 'PUT', body: { prefs: { [id]: !d.prefs[id] } } }).catch(() => null);
    if (r) setD({ ...d, prefs: r.prefs });
  };
  return (
    <div className="space-y-2 pt-2" data-testid="notify-prefs">
      <p className="text-[10px] uppercase tracking-widest font-bold text-white/40">Письма на почту</p>
      {!d.mail && <p className="text-[11px] text-white/40">Почта на сервере не настроена — уведомления будут только в колокольчике 🔔.</p>}
      {d.kinds.map(k => (
        <label key={k.id} className="flex items-center gap-3 text-sm text-white/75 cursor-pointer">
          <input type="checkbox" checked={!!d.prefs[k.id]} onChange={() => toggle(k.id)} className="accent-amber-500 w-4 h-4" />
          {k.name}
        </label>
      ))}
      <p className="text-[11px] text-white/35">Письмо приходит, только если вы не увидели уведомление в игре за 10 минут, и не чаще раза в 6 часов.</p>
    </div>
  );
};

const LoginMethods: React.FC = () => {
  const [ids, setIds] = useState<Identities | null>(null);
  const load = () => api<Identities>('/api/auth/identities').then(setIds).catch(() => undefined);
  useEffect(() => { load(); }, []);
  if (!ids || !ids.available.length) return null;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/40">Способы входа</label>
      {ids.available.map(p => {
        const linked = ids.identities.find(i => i.provider === p.id);
        return (
          <div key={p.id} className="flex items-center gap-3 p-3 bg-black/40 border border-white/10 rounded-xl">
            <span className="flex-1 text-sm text-white">{p.name}{linked?.email ? <span className="text-xs text-white/40"> · {linked.email}</span> : null}</span>
            {linked
              ? <button onClick={async () => { try { await api(`/api/auth/identities/${p.id}`, { method: 'DELETE' }); load(); } catch (e) { customAlert(e instanceof Error ? e.message : 'Ошибка'); } }} className="px-3 py-1.5 rounded-lg bg-white/5 text-xs text-white/60 hover:text-white">Отвязать</button>
              : <a href={`/api/auth/oauth/${p.id}/start?link=1&next=${encodeURIComponent(window.location.pathname)}`} className="px-3 py-1.5 rounded-lg bg-emerald-600/80 text-xs font-bold text-white hover:bg-emerald-500">Привязать</a>}
          </div>
        );
      })}
    </div>
  );
};
