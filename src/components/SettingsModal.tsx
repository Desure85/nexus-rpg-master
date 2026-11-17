import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { X, Save, Globe, Key, Cpu, Terminal, Type, Database, Copy, Check, RotateCcw, AlertTriangle, Users, Shield } from 'lucide-react';
import { SYSTEM_PROMPT } from '../../shared/rules';
import { api, getOwnerKey, setOwnerKey, getAccessCode, setAccessCode, getAdminToken, setAdminToken } from '../api';

interface SettingsModalProps {
  settings: AppSettings;
  canEditGlobal: boolean;
  /** Если открыта своя сессия — механики/промпт сохраняются и в неё */
  sessionName?: string;
  serverConfig: { adminConfigured: boolean; isAdmin: boolean; accessCodeRequired: boolean; llm: { provider: string; forcedByEnv: boolean; keyPresent: boolean } } | null;
  onSave: (settings: AppSettings) => void;
  onAdminTokenChanged: () => void;
  onClose: () => void;
}

type Tab = 'model' | 'prompt' | 'mechanics' | 'appearance' | 'access' | 'logs';

const PROVIDERS: { id: AppSettings['provider']; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'local', label: 'Локальная / OpenAI' },
  { id: 'mock', label: 'Демо (без ИИ)' },
];

const OPENCODE_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5', 'mimo-v2-omni', 'minimax-m2.5', 'minimax-m2.7', 'minimax-m3', 'kimi-k2.5', 'kimi-k2.6', 'qwen3.5-plus', 'qwen3.6-plus', 'glm-5.2'];
const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (быстрая, по умолчанию)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (умнее, медленнее)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

const inputCls = 'w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-all font-mono text-sm disabled:opacity-50';
const labelCls = 'text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2';

export const SettingsModal: React.FC<SettingsModalProps> = ({ settings, canEditGlobal, sessionName, serverConfig, onSave, onAdminTokenChanged, onClose }) => {
  const [local, setLocal] = useState<AppSettings>(settings);
  const [activeTab, setActiveTab] = useState<Tab>('model');
  const [logs, setLogs] = useState<any[]>([]);
  const [logsError, setLogsError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [ownerKeyInput, setOwnerKeyInput] = useState('');
  const [accessInput, setAccessInput] = useState(getAccessCode());
  const [adminInput, setAdminInput] = useState(getAdminToken());

  useEffect(() => { if (activeTab === 'logs') fetchLogs(); }, [activeTab]);

  const fetchLogs = async () => {
    try { setLogs(await api('/api/logs')); setLogsError(''); } catch (e) { setLogsError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const r = await api<any>('/api/llm/test', { body: local });
      setTestStatus(r.ok ? { ok: true, text: `Модель ответила за ${r.ms} мс: «${r.sample}»` } : { ok: false, text: r.error || 'Ошибка' });
    } catch (e) {
      setTestStatus({ ok: false, text: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setTesting(false);
    }
  };

  const tabs: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: 'model', label: 'Модель' },
    { id: 'prompt', label: 'Промпт' },
    { id: 'mechanics', label: 'Механики' },
    { id: 'appearance', label: 'Вид' },
    { id: 'access', label: 'Доступ' },
    { id: 'logs', label: 'Логи', hidden: !canEditGlobal },
  ];

  const readOnlyModel = !canEditGlobal;

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
          {tabs.filter(t => !t.hidden).map(t => (
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
          {activeTab === 'model' && (
            <>
              {readOnlyModel && (
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white/60 leading-relaxed">
                  Модель ИИ общая для всего сервера и меняется администратором. Если вы администратор — введите токен во вкладке «Доступ».
                </div>
              )}
              {serverConfig?.llm.forcedByEnv && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-200/80">
                  Провайдер зафиксирован переменной окружения <code>LLM_PROVIDER={serverConfig.llm.provider}</code>.
                </div>
              )}
              {serverConfig && !serverConfig.llm.keyPresent && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-200/80 flex gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> Для провайдера «{serverConfig.llm.provider}» на сервере нет API-ключа.
                </div>
              )}

              <div className="space-y-2">
                <label className={labelCls}><Cpu size={12} /> ИИ-провайдер</label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      disabled={readOnlyModel}
                      onClick={() => setLocal({ ...local, provider: p.id })}
                      className={`py-2.5 px-2 rounded-xl border transition-all text-xs font-bold disabled:cursor-not-allowed ${local.provider === p.id ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10 hover:border-white/30'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {local.provider === 'gemini' && (
                <>
                  <div className="space-y-2">
                    <label className={labelCls}><Key size={12} /> Gemini API key</label>
                    <input type="password" disabled={readOnlyModel} value={local.apiKey} onChange={e => setLocal({ ...local, apiKey: e.target.value })} placeholder="Пусто — ключ из GEMINI_API_KEY на сервере" className={inputCls} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelCls}><Cpu size={12} /> Модель</label>
                    <select disabled={readOnlyModel} value={local.modelName || 'gemini-3-flash-preview'} onChange={e => setLocal({ ...local, modelName: e.target.value })} className={inputCls}>
                      {GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </div>
                </>
              )}

              {local.provider === 'openrouter' && (
                <>
                  <div className="space-y-2">
                    <label className={labelCls}><Key size={12} /> OpenRouter API key</label>
                    <input type="password" disabled={readOnlyModel} value={local.openRouterApiKey || ''} onChange={e => setLocal({ ...local, openRouterApiKey: e.target.value })} placeholder="Пусто — ключ из OPENROUTER_API_KEY" className={inputCls} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelCls}><Cpu size={12} /> Модель</label>
                    <input disabled={readOnlyModel} value={local.openRouterModel || ''} onChange={e => setLocal({ ...local, openRouterModel: e.target.value })} placeholder="anthropic/claude-3.5-sonnet" className={inputCls} />
                  </div>
                </>
              )}

              {local.provider === 'opencode' && (
                <div className="space-y-2">
                  <label className={labelCls}><Cpu size={12} /> Модель OpenCode (ключ — OPENCODE_API_KEY на сервере)</label>
                  <select disabled={readOnlyModel} value={OPENCODE_MODELS.includes(local.modelName) ? local.modelName : 'deepseek-v4-flash'} onChange={e => setLocal({ ...local, modelName: e.target.value })} className={inputCls}>
                    {OPENCODE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              )}

              {local.provider === 'local' && (
                <>
                  <div className="space-y-2">
                    <label className={labelCls}><Globe size={12} /> URL OpenAI-совместимого API</label>
                    <input disabled={readOnlyModel} value={local.modelUrl} onChange={e => setLocal({ ...local, modelUrl: e.target.value })} placeholder="http://localhost:11434/v1" className={inputCls} />
                    <p className="text-[10px] text-white/40">Запросы идут с сервера игры, а не из браузера: адрес должен быть доступен серверу (в Docker — <code>host.docker.internal</code>).</p>
                  </div>
                  <div className="space-y-2">
                    <label className={labelCls}><Key size={12} /> API key</label>
                    <input type="password" disabled={readOnlyModel} value={local.apiKey} onChange={e => setLocal({ ...local, apiKey: e.target.value })} placeholder="Необязательно" className={inputCls} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelCls}><Cpu size={12} /> Модель</label>
                    <input disabled={readOnlyModel} value={local.modelName} onChange={e => setLocal({ ...local, modelName: e.target.value })} placeholder="llama3.1" className={inputCls} />
                  </div>
                </>
              )}

              {local.provider === 'mock' && (
                <p className="text-xs text-white/50">Демо-режим отвечает заготовками без обращения к ИИ — чтобы проверить интерфейс и мультиплеер.</p>
              )}

              {canEditGlobal && (
                <>
                  <div>
                    <button onClick={testConnection} disabled={testing} className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-bold text-white transition-all disabled:opacity-50">
                      {testing ? 'Проверяем...' : 'Проверить подключение'}
                    </button>
                    {testStatus && <p className={`text-xs mt-2 font-bold ${testStatus.ok ? 'text-emerald-400' : 'text-red-400'}`}>{testStatus.text}</p>}
                  </div>
                  <div className="flex items-center justify-between p-4 bg-black/40 border border-white/10 rounded-xl">
                    <div className="space-y-1">
                      <p className="text-sm text-white font-medium flex items-center gap-2"><Terminal size={12} /> Логировать запросы к ИИ</p>
                      <p className="text-[10px] text-white/40">Сохраняет промпты и ответы (последние 500) для отладки.</p>
                    </div>
                    <input type="checkbox" className="accent-emerald-500 w-5 h-5" checked={local.loggingEnabled} onChange={e => setLocal({ ...local, loggingEnabled: e.target.checked })} />
                  </div>
                </>
              )}
            </>
          )}

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

          {activeTab === 'access' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <label className={labelCls}><Key size={12} /> Ключ мастера</label>
                <p className="text-[10px] text-white/40 leading-relaxed">По этому ключу сервер узнаёт ваши сессии. Чтобы вести игры с другого устройства, скопируйте ключ и вставьте его там. Никому не показывайте.</p>
                <div className="flex gap-2">
                  <input readOnly value={getOwnerKey()} className={inputCls} onFocus={e => e.target.select()} />
                  <button onClick={() => handleCopy(getOwnerKey(), 'owner')} className="px-3 bg-white/10 rounded-xl text-white">{copiedId === 'owner' ? <Check size={14} /> : <Copy size={14} />}</button>
                </div>
                <div className="flex gap-2">
                  <input value={ownerKeyInput} onChange={e => setOwnerKeyInput(e.target.value)} placeholder="Вставить ключ с другого устройства" className={inputCls} />
                  <button
                    disabled={ownerKeyInput.trim().length < 16}
                    onClick={() => { setOwnerKey(ownerKeyInput); window.location.reload(); }}
                    className="px-3 bg-white/10 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                  >
                    Применить
                  </button>
                </div>
              </div>

              {serverConfig?.accessCodeRequired && (
                <div className="space-y-2">
                  <label className={labelCls}><Shield size={12} /> Код доступа мастера</label>
                  <p className="text-[10px] text-white/40">Сервер разрешает создавать игры только по коду. Игрокам код не нужен.</p>
                  <div className="flex gap-2">
                    <input type="password" value={accessInput} onChange={e => setAccessInput(e.target.value)} className={inputCls} />
                    <button onClick={() => { setAccessCode(accessInput); onAdminTokenChanged(); }} className="px-3 bg-white/10 rounded-xl text-xs font-bold text-white">Сохранить</button>
                  </div>
                </div>
              )}

              {serverConfig?.adminConfigured && (
                <div className="space-y-2">
                  <label className={labelCls}><Shield size={12} /> Токен администратора {serverConfig.isAdmin && <span className="text-emerald-400 normal-case">— вы администратор</span>}</label>
                  <p className="text-[10px] text-white/40">Нужен, чтобы менять модель ИИ и смотреть логи.</p>
                  <div className="flex gap-2">
                    <input type="password" value={adminInput} onChange={e => setAdminInput(e.target.value)} className={inputCls} />
                    <button onClick={() => { setAdminToken(adminInput); onAdminTokenChanged(); }} className="px-3 bg-white/10 rounded-xl text-xs font-bold text-white">Сохранить</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'logs' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <label className={labelCls}><Database size={12} /> Запросы к ИИ (последние 100)</label>
                <button onClick={fetchLogs} className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 hover:text-emerald-300">Обновить</button>
              </div>
              {logsError && <p className="text-xs text-red-400">{logsError}</p>}
              {logs.length === 0 ? (
                <div className="text-white/40 text-sm text-center py-10">Логов нет. Включите логирование во вкладке «Модель».</div>
              ) : logs.map(log => (
                <div key={log.id} className="bg-black/40 p-3 rounded-xl border border-white/10">
                  <div className="text-[10px] text-white/40 mb-2 font-mono">{new Date(String(log.created_at).replace(' ', 'T') + 'Z').toLocaleString()} | {log.session_id}</div>
                  {(['request', 'response'] as const).map(kind => (
                    <details key={kind} className="mb-2">
                      <summary className={`text-xs cursor-pointer font-bold uppercase tracking-wider flex justify-between items-center ${kind === 'request' ? 'text-emerald-400' : 'text-blue-400'}`}>
                        <span>{kind === 'request' ? 'Запрос' : 'Ответ'}</span>
                        <button onClick={e => { e.preventDefault(); handleCopy(log[kind], `${kind}-${log.id}`); }} className="text-white/40 hover:text-white flex items-center gap-1 text-[10px]">
                          {copiedId === `${kind}-${log.id}` ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                      </summary>
                      <pre className="mt-2 p-2 bg-black/60 rounded-lg overflow-x-auto text-[10px] text-white/60 whitespace-pre-wrap font-mono">{log[kind]}</pre>
                    </details>
                  ))}
                </div>
              ))}
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
