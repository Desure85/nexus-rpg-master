import React, { useEffect, useState } from 'react';
import { X, Users, Cpu, Wallet, Database, Copy, Check, Trash2, Plus, Key, Globe, Loader2 } from 'lucide-react';
import { api } from '../api';
import { WorkspaceInfo, CurrentUser, WorkspaceRole } from '../types';
import { inputCls, labelCls, GEMINI_MODELS, OPENCODE_MODELS } from './PlatformAiForm';
import { customConfirm } from './PromptModal';

export type WorkspaceTab = 'members' | 'ai' | 'billing' | 'logs';

interface Props {
  workspace: WorkspaceInfo;
  user: CurrentUser;
  initialTab?: WorkspaceTab;
  onChanged: () => void;
  onClose: () => void;
}

const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Владелец', admin: 'Админ', gm: 'Мастер' };
const PROVIDER_LABEL: Record<string, string> = { gemini: 'Gemini', openrouter: 'OpenRouter', opencode: 'OpenCode', local: 'Свой URL', mock: 'Демо' };
const fmtDate = (s?: string | null) => (s ? new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') ? '' : 'Z')).toLocaleString('ru-RU') : '');

export const WorkspaceModal: React.FC<Props> = ({ workspace: ws, user, initialTab = 'members', onChanged, onClose }) => {
  const isAdmin = ws.role === 'owner' || ws.role === 'admin' || user.isSuperadmin;
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [error, setError] = useState('');

  const tabs: { id: WorkspaceTab; label: string; icon: React.ReactNode; hidden?: boolean }[] = [
    { id: 'members', label: 'Участники', icon: <Users size={12} /> },
    { id: 'ai', label: 'ИИ', icon: <Cpu size={12} />, hidden: !isAdmin },
    { id: 'billing', label: 'Баланс', icon: <Wallet size={12} /> },
    { id: 'logs', label: 'Журнал', icon: <Database size={12} />, hidden: !isAdmin },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#1a1614] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-white/10 flex justify-between items-center gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl text-white truncate">{ws.name}</h2>
            <p className="text-[10px] text-white/40 uppercase tracking-widest">{ROLE_LABEL[ws.role || 'gm']} · тариф «{ws.limits.title}» · {ws.credits} кредитов</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white"><X size={20} /></button>
        </div>
        <div className="flex border-b border-white/10 overflow-x-auto">
          {tabs.filter(t => !t.hidden).map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); setError(''); }} className={`flex-1 min-w-max px-3 py-3 text-[10px] uppercase tracking-widest font-bold flex items-center justify-center gap-2 ${tab === t.id ? 'bg-white/5 text-white border-b-2 border-white' : 'text-white/40 hover:text-white'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && <p className="text-xs text-red-400">{error}</p>}
          {tab === 'members' && <MembersTab ws={ws} user={user} isAdmin={isAdmin} setError={setError} onChanged={onChanged} />}
          {tab === 'ai' && <AiTab ws={ws} setError={setError} onChanged={onChanged} />}
          {tab === 'billing' && <BillingTab ws={ws} isAdmin={isAdmin} setError={setError} />}
          {tab === 'logs' && <LogsTab ws={ws} />}
        </div>
      </div>
    </div>
  );
};

// ------------------------------- участники -------------------------------
const MembersTab: React.FC<{ ws: WorkspaceInfo; user: CurrentUser; isAdmin: boolean; setError: (s: string) => void; onChanged: () => void }> = ({ ws, user, isAdmin, setError, onChanged }) => {
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<any[]>([]);
  const [newLink, setNewLink] = useState('');
  const [inviteRole, setInviteRole] = useState<'gm' | 'admin'>('gm');
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState(ws.name);

  const load = async () => {
    try {
      setMembers(await api(`/api/workspaces/${ws.id}/members`));
      if (isAdmin) setInvites(await api(`/api/workspaces/${ws.id}/invites`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };
  useEffect(() => { load(); }, [ws.id]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const createInvite = () => act(async () => {
    const r = await api<{ token: string }>(`/api/workspaces/${ws.id}/invites`, { body: { role: inviteRole, days: 7, maxUses: 10 } });
    setNewLink(`${window.location.origin}/invite/${r.token}`);
  });

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex gap-2">
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
          <button disabled={!name.trim() || name === ws.name} onClick={() => act(() => api(`/api/workspaces/${ws.id}`, { method: 'PATCH', body: { name } }))} className="px-4 bg-white/10 rounded-xl text-xs font-bold text-white disabled:opacity-40">Переименовать</button>
        </div>
      )}
      <div className="space-y-2">
        <label className={labelCls}><Users size={12} /> Участники ({members.length})</label>
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-2 p-3 bg-black/40 border border-white/10 rounded-xl">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{m.name} {m.id === user.id && <span className="text-white/40">(вы)</span>}</p>
              <p className="text-[10px] text-white/40 truncate">{m.email}</p>
            </div>
            {isAdmin && m.id !== user.id ? (
              <select value={m.role} onChange={e => act(() => api(`/api/workspaces/${ws.id}/members/${m.id}`, { method: 'PATCH', body: { role: e.target.value } }))} className="bg-black/60 border border-white/10 rounded-lg text-xs text-white px-2 py-1">
                {(['gm', 'admin', 'owner'] as WorkspaceRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            ) : <span className="text-[10px] uppercase tracking-widest text-white/50 font-bold">{ROLE_LABEL[m.role as WorkspaceRole]}</span>}
            {(isAdmin || m.id === user.id) && (
              <button
                title={m.id === user.id ? 'Покинуть пространство' : 'Исключить'}
                onClick={async () => { if (await customConfirm(m.id === user.id ? 'Покинуть пространство?' : `Исключить ${m.email}?`)) act(() => api(`/api/workspaces/${ws.id}/members/${m.id}`, { method: 'DELETE' })); }}
                className="p-1.5 text-red-400/60 hover:text-red-400"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
      {isAdmin && (
        <div className="space-y-2">
          <label className={labelCls}><Plus size={12} /> Пригласить мастера</label>
          <p className="text-[10px] text-white/40">Ссылка действует 7 дней и до 10 регистраций. Игрокам приглашение не нужно — им хватит ссылки на героя.</p>
          <div className="flex gap-2">
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)} className="bg-black/40 border border-white/10 rounded-xl text-xs text-white px-3">
              <option value="gm">Мастер</option>
              <option value="admin">Админ</option>
            </select>
            <button onClick={createInvite} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-xs font-bold text-white">Создать ссылку</button>
          </div>
          {newLink && (
            <div className="flex gap-2">
              <input readOnly value={newLink} onFocus={e => e.target.select()} className={inputCls} />
              <button onClick={() => { navigator.clipboard?.writeText(newLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="px-3 bg-white/10 rounded-xl text-white">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
            </div>
          )}
          {invites.map(i => (
            <div key={i.id} className="flex items-center justify-between text-[11px] text-white/50 px-1">
              <span>{ROLE_LABEL[i.role as WorkspaceRole]} · использовано {i.uses}/{i.max_uses} · до {fmtDate(i.expires_at)}</span>
              <button onClick={() => act(() => api(`/api/workspaces/${ws.id}/invites/${i.id}`, { method: 'DELETE' }))} className="text-red-400/70 hover:text-red-400">отозвать</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ------------------------------- ИИ -------------------------------
const AiTab: React.FC<{ ws: WorkspaceInfo; setError: (s: string) => void; onChanged: () => void }> = ({ ws, setError, onChanged }) => {
  const [mode, setMode] = useState(ws.ai.mode);
  const [provider, setProvider] = useState(ws.ai.provider || ws.ai.providers[0] || 'gemini');
  const [model, setModel] = useState(ws.ai.model);
  const [url, setUrl] = useState(ws.ai.url);
  const [key, setKey] = useState(ws.ai.key);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api(`/api/workspaces/${ws.id}`, { method: 'PATCH', body: { ai: { mode, provider, model, url, key } } });
      onChanged();
      setTest(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
    finally { setSaving(false); }
  };

  const runTest = async () => {
    setTest(null);
    try {
      const r = await api<any>(`/api/workspaces/${ws.id}/ai/test`, { body: {} });
      setTest(r.ok ? { ok: true, text: `${r.provider}/${r.model}: ответ за ${r.ms} мс («${r.sample}»)` } : { ok: false, text: r.error });
    } catch (e) { setTest({ ok: false, text: e instanceof Error ? e.message : 'Ошибка' }); }
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <button onClick={() => setMode('platform')} className={`p-4 rounded-xl border text-left ${mode === 'platform' ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-black/40 border-white/10'}`}>
          <div className="text-sm font-bold text-white">ИИ платформы</div>
          <div className="text-[10px] text-white/50 mt-1">Ничего настраивать не нужно, ходы списывают кредиты пространства.{!ws.platformAi.available && ' Сейчас ключ платформы не настроен.'}</div>
        </button>
        <button onClick={() => setMode('byok')} className={`p-4 rounded-xl border text-left ${mode === 'byok' ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-black/40 border-white/10'}`}>
          <div className="text-sm font-bold text-white">Свой ключ</div>
          <div className="text-[10px] text-white/50 mt-1">Платите провайдеру напрямую, кредиты не тратятся. Ключ хранится зашифрованным.</div>
        </button>
      </div>
      {mode === 'byok' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className={labelCls}><Cpu size={12} /> Провайдер</label>
            <div className="flex flex-wrap gap-2">
              {ws.ai.providers.map(p => (
                <button key={p} onClick={() => { setProvider(p); setModel(''); }} className={`px-3 py-2 rounded-lg border text-xs font-bold ${provider === p ? 'bg-white text-black border-white' : 'bg-black/40 text-white/60 border-white/10'}`}>{PROVIDER_LABEL[p] || p}</button>
              ))}
            </div>
          </div>
          {provider === 'local' && (
            <div className="space-y-2">
              <label className={labelCls}><Globe size={12} /> URL OpenAI-совместимого API</label>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://my-llm.example.com/v1" className={inputCls} />
            </div>
          )}
          {provider !== 'mock' && (
            <div className="space-y-2">
              <label className={labelCls}><Key size={12} /> API-ключ</label>
              <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={provider === 'local' ? 'Необязательно' : 'Ключ провайдера'} className={inputCls} />
            </div>
          )}
          <div className="space-y-2">
            <label className={labelCls}><Cpu size={12} /> Модель</label>
            {provider === 'gemini' ? (
              <select value={model || 'gemini-3-flash-preview'} onChange={e => setModel(e.target.value)} className={inputCls}>{GEMINI_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
            ) : provider === 'opencode' ? (
              <select value={model || 'deepseek-v4-flash'} onChange={e => setModel(e.target.value)} className={inputCls}>{OPENCODE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}</select>
            ) : (
              <input value={model} onChange={e => setModel(e.target.value)} placeholder={provider === 'openrouter' ? 'anthropic/claude-3.5-sonnet' : 'llama3.1'} className={inputCls} />
            )}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 py-3 bg-white text-black rounded-xl font-semibold disabled:opacity-50">{saving ? 'Сохраняем...' : 'Сохранить'}</button>
        <button onClick={runTest} className="px-4 py-3 bg-white/10 rounded-xl text-xs font-bold text-white">Проверить</button>
      </div>
      {test && <p className={`text-xs font-bold ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>{test.text}</p>}
    </div>
  );
};

// ------------------------------- баланс и оплата -------------------------------
const BillingTab: React.FC<{ ws: WorkspaceInfo; isAdmin: boolean; setError: (s: string) => void }> = ({ ws, isAdmin, setError }) => {
  const [data, setData] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [buying, setBuying] = useState('');

  useEffect(() => {
    api(`/api/workspaces/${ws.id}/billing`).then(setData).catch(e => setError(e.message));
    api<any>('/api/billing/products').then(r => setProducts(r.products || [])).catch(() => undefined);
  }, [ws.id]);

  const buy = async (productId: string) => {
    setBuying(productId);
    try {
      const r = await api<{ confirmationUrl: string }>(`/api/workspaces/${ws.id}/checkout`, { body: { productId } });
      window.location.href = r.confirmationUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setBuying('');
    }
  };

  if (!data) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-white/40" /></div>;
  const maxCredits = Math.max(1, ...data.usage30.map((d: any) => d.credits || 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 bg-black/40 border border-white/10 rounded-xl">
          <p className={labelCls}>Кредиты</p>
          <p className={`text-3xl font-display font-bold ${data.credits > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{data.credits}</p>
          <p className="text-[10px] text-white/40 mt-1">{ws.ai.mode === 'byok' ? 'Свой ключ: ходы не списывают кредиты' : '≈10 кредитов за ход мастера'}</p>
        </div>
        <div className="p-4 bg-black/40 border border-white/10 rounded-xl">
          <p className={labelCls}>Тариф</p>
          <p className="text-xl font-bold text-white">{data.limits.title}</p>
          <p className="text-[10px] text-white/40 mt-1">
            {data.plan === 'pro' ? `до ${fmtDate(data.planExpiresAt)} · ` : ''}до {data.limits.maxHeroes} героев, {data.limits.maxPlayers} игроков, {data.limits.maxSessions} сессий
          </p>
        </div>
      </div>

      {products.length > 0 ? (
        <div className="space-y-2">
          <label className={labelCls}><Wallet size={12} /> Пополнить</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {products.map(p => (
              <button key={p.id} disabled={!isAdmin || !!buying} onClick={() => buy(p.id)} className={`p-4 rounded-xl border text-left transition-all disabled:opacity-50 ${p.kind === 'subscription' ? 'bg-amber-400/5 border-amber-400/30 hover:bg-amber-400/10' : 'bg-black/40 border-white/10 hover:border-white/30'}`}>
                <div className="text-sm font-bold text-white">{p.title}</div>
                <div className="text-[10px] text-white/50 mt-1 leading-snug">{p.description}</div>
                <div className="text-lg font-bold text-emerald-400 mt-2">{buying === p.id ? '...' : `${p.price} ₽`}</div>
              </button>
            ))}
          </div>
          {!isAdmin && <p className="text-[10px] text-white/40">Пополнять баланс могут владелец и админы пространства.</p>}
        </div>
      ) : (
        <p className="text-xs text-white/40">Онлайн-оплата на этом сервере не подключена — кредиты начисляет администратор платформы.</p>
      )}

      {data.usage30.length > 0 && (
        <div className="space-y-2">
          <label className={labelCls}>Расход за 30 дней</label>
          <div className="flex items-end gap-1 h-24 p-2 bg-black/40 border border-white/10 rounded-xl">
            {data.usage30.map((d: any) => (
              <div key={d.day} className="flex-1 bg-emerald-500/60 rounded-t" style={{ height: `${Math.max(4, (d.credits / maxCredits) * 100)}%` }} title={`${d.day}: ${d.credits} кредитов, ${d.calls} вызовов, ${d.input + d.output} токенов`} />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className={labelCls}>История баланса</label>
        {data.ledger.length === 0 && <p className="text-xs text-white/30">Пусто</p>}
        {data.ledger.map((l: any, i: number) => (
          <div key={i} className="flex justify-between text-[11px] text-white/60 px-1">
            <span>{fmtDate(l.created_at)} · {l.reason.replace('usage:', 'ход: ').replace('payment:', 'оплата: ').replace('admin:', 'начисление: ').replace('welcome', 'приветственные')}</span>
            <span className={l.delta > 0 ? 'text-emerald-400' : 'text-white/40'}>{l.delta > 0 ? '+' : ''}{l.delta} → {l.balance_after}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ------------------------------- журнал ИИ -------------------------------
const LogsTab: React.FC<{ ws: WorkspaceInfo }> = ({ ws }) => {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { api<any[]>(`/api/workspaces/${ws.id}/logs`).then(setLogs).catch(() => undefined); }, [ws.id]);
  return (
    <div className="space-y-3">
      <p className="text-[10px] text-white/40">Последние 100 запросов к ИИ из сессий пространства. Логирование включает администратор платформы.</p>
      {logs.length === 0 && <p className="text-sm text-white/30 text-center py-6">Логов нет</p>}
      {logs.map(l => (
        <details key={l.id} className="bg-black/40 p-3 rounded-xl border border-white/10">
          <summary className="text-[10px] text-white/50 font-mono cursor-pointer">{fmtDate(l.created_at)} · {l.session_id}</summary>
          <pre className="mt-2 text-[10px] text-white/60 whitespace-pre-wrap max-h-60 overflow-auto">{l.response}</pre>
        </details>
      ))}
    </div>
  );
};
