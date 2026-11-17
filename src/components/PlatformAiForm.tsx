import React, { useState } from 'react';
import { AppSettings } from '../types';
import { Globe, Key, Cpu, Terminal, AlertTriangle } from 'lucide-react';
import { api } from '../api';

export const PROVIDERS: { id: AppSettings['provider']; label: string }[] = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'local', label: 'Свой URL (OpenAI API)' },
  { id: 'mock', label: 'Демо (без ИИ)' },
];

export const OPENCODE_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro', 'mimo-v2.5', 'mimo-v2-omni', 'minimax-m2.5', 'minimax-m2.7', 'minimax-m3', 'kimi-k2.5', 'kimi-k2.6', 'qwen3.5-plus', 'qwen3.6-plus', 'glm-5.2'];
export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (быстрая, по умолчанию)' },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (умнее, медленнее)' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

export const inputCls = 'w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/30 transition-all font-mono text-sm disabled:opacity-50';
export const labelCls = 'text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2';

interface Props {
  local: AppSettings;
  setLocal: (s: AppSettings) => void;
  serverLlm?: { provider: string; forcedByEnv: boolean; keyPresent: boolean } | null;
}

/** Настройки ИИ платформы (ключ сервера) — для суперадмина. */
export const PlatformAiForm: React.FC<Props> = ({ local, setLocal, serverLlm }) => {
  const [testStatus, setTestStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const readOnlyModel = false;
  const canEditGlobal = true;
  const serverConfig = serverLlm ? { llm: serverLlm } : null;

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

  return (
    <div className="space-y-6">

              {readOnlyModel && (
                <div className="p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white/60 leading-relaxed">
                  Модель ИИ общая для всего сервера.
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

    </div>
  );
};
