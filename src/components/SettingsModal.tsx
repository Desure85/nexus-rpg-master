import React, { useState } from 'react';
import { AppSettings } from '../types';
import { X, Save, Terminal, Type, RotateCcw, Users, KeyRound, LogOut } from 'lucide-react';
import { SYSTEM_PROMPT } from '../../shared/rules';
import { api } from '../api';
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

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, sessionName, user, onSave, onLogout, onClose }) => {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState<Tab>('prompt');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async () => {
    setPwStatus(null);
    try {
      await api('/api/auth/password', { body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '' });
      setPwStatus({ ok: true, text: 'Пароль изменён. Остальные устройства разлогинены.' });
    } catch (e) {
      setPwStatus({ ok: false, text: e instanceof Error ? e.message : 'Ошибка' });
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'prompt', label: 'Промпт' },
    { id: 'mechanics', label: 'Механики' },
    { id: 'appearance', label: 'Вид' },
    { id: 'account', label: 'Аккаунт' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-[#1a1614] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b border-white/10 flex justify-between items-center">
          <h2 className="font-display text-xl text-white">Настройки Nexus</h2>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b border-white/10 overflow-x-auto">
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
            <div className="space-y-4 h-full flex flex-col">
              <div className="flex justify-between items-center">
                <label className={labelCls}><Terminal size={12} /> Базовые инструкции мастера</label>
                <button onClick={() => setLocal({ ...local, systemPrompt: SYSTEM_PROMPT })} className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1">
                  <RotateCcw size={10} /> По умолчанию
                </button>
              </div>
              <textarea
                value={local.systemPrompt}
                onChange={e => setLocal({ ...local, systemPrompt: e.target.value })}
                className="flex-1 w-full p-4 bg-black/40 border border-white/10 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-white/30 transition-all resize-none min-h-[300px]"
              />
              <p className="text-[10px] text-white/30 italic">
                {sessionName ? `Сохраняется для сессии «${sessionName}». ` : 'Будет применён к новым сессиям. '}
                JSON-схемы дашборда и кодекса добавляются автоматически. В режиме «Сказка» используется отдельный промпт сказочника.
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
              {(local.mechanics || []).map((mechanic, index) => (
                <div key={mechanic.id} className="p-4 bg-black/40 border border-white/10 rounded-xl space-y-3">
                  <label className="text-xs font-bold text-white flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mechanic.enabled}
                      onChange={e => {
                        const m = [...(local.mechanics || [])];
                        m[index] = { ...m[index], enabled: e.target.checked };
                        setLocal({ ...local, mechanics: m });
                      }}
                      className="accent-emerald-500 w-4 h-4"
                    />
                    {mechanic.name}
                  </label>
                  <textarea
                    value={mechanic.description}
                    onChange={e => {
                      const m = [...(local.mechanics || [])];
                      m[index] = { ...m[index], description: e.target.value };
                      setLocal({ ...local, mechanics: m });
                    }}
                    className="w-full p-3 bg-black/60 border border-white/5 rounded-lg text-white/80 font-mono text-[10px] focus:outline-none focus:border-white/20 resize-none min-h-[80px]"
                  />
                </div>
              ))}
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
              <div className="space-y-2">
                <label className={labelCls}><KeyRound size={12} /> Сменить пароль</label>
                <input type="password" autoComplete="current-password" placeholder="Текущий пароль" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} className={inputCls} />
                <input type="password" autoComplete="new-password" placeholder="Новый пароль (от 8 символов)" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} className={inputCls} />
                <button onClick={changePassword} disabled={!pw.current || pw.next.length < 8} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white disabled:opacity-40">Сменить</button>
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
