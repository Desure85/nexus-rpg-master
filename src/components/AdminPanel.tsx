import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { AppSettings } from '../types';
import { PlatformAiForm, labelCls } from './PlatformAiForm';
import { customPrompt } from './PromptModal';

interface Props {
  settings: AppSettings;
  serverLlm: { provider: string; forcedByEnv: boolean; keyPresent: boolean } | null;
  onBack: () => void;
  onSettingsSaved: () => void;
}

const fmt = (s?: string | null) => (s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU') : '—');

/** Панель администратора платформы: пространства, кредиты, выручка, ИИ платформы. */
export const AdminPanel: React.FC<Props> = ({ settings, serverLlm, onBack, onSettingsSaved }) => {
  const [tab, setTab] = useState<'workspaces' | 'ai' | 'health'>('workspaces');
  const [data, setData] = useState<{ workspaces: any[]; revenue: any[] } | null>(null);
  const [error, setError] = useState('');
  const [local, setLocal] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [filter, setFilter] = useState('');

  const load = () => api<any>('/api/admin/workspaces').then(setData).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { setLocal(settings); }, [settings]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const grant = async (w: any) => {
    const v = await customPrompt(`Сколько кредитов начислить «${w.name}»? (отрицательное число — списать)`, '1000');
    if (v && Number(v)) act(() => api(`/api/admin/workspaces/${w.id}/credits`, { body: { delta: Number(v), reason: 'manual' } }));
  };
  const setPro = async (w: any) => {
    const v = await customPrompt(`На сколько дней включить тариф «Мастер» для «${w.name}»? (0 — отключить)`, '30');
    if (v !== null) act(() => api(`/api/admin/workspaces/${w.id}/plan`, { body: { days: Number(v) || 0 } }));
  };

  const saveAi = async () => {
    try {
      await api('/api/settings', { body: local });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSettingsSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const rows = (data?.workspaces || []).filter(w => !filter || `${w.name} ${w.owner_email}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-white/5 rounded-lg text-white/60 hover:text-white"><ArrowLeft size={18} /></button>
          <h1 className="font-display text-2xl font-bold text-white">Администрирование платформы</h1>
        </div>
        <div className="flex gap-2">
          {(['workspaces', 'ai', 'health'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest ${tab === t ? 'bg-white text-black' : 'bg-white/5 text-white/50'}`}>
              {t === 'workspaces' ? 'Пространства' : t === 'ai' ? 'ИИ платформы' : 'Здоровье'}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}

        {tab === 'workspaces' && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              {(data?.revenue || []).map(r => (
                <div key={r.currency} className="px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                  <p className={labelCls}>Выручка</p>
                  <p className="text-lg font-bold text-emerald-300">{Math.round(r.total)} {r.currency === 'RUB' ? '₽' : r.currency} <span className="text-xs text-white/40">({r.n} платежей)</span></p>
                </div>
              ))}
              <div className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl">
                <p className={labelCls}>Пространств</p>
                <p className="text-lg font-bold text-white">{data?.workspaces.length ?? '…'}</p>
              </div>
              <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Поиск по названию или email" className="flex-1 min-w-48 px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white" />
              <button onClick={load} className="p-2 bg-white/5 rounded-lg text-white/60"><RefreshCw size={16} /></button>
              <button
                onClick={async () => {
                  const email = await customPrompt('Email пользователя, которому нужна ссылка сброса пароля:');
                  if (!email) return;
                  try {
                    const r = await api<{ link: string }>('/api/admin/users/reset-link', { body: { email } });
                    await customPrompt('Ссылка действует 24 часа — отправьте её пользователю:', r.link);
                  } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
                }}
                className="px-3 py-2 bg-white/5 rounded-lg text-xs text-white/70"
              >
                Сброс пароля
              </button>
            </div>
            <div className="overflow-x-auto border border-white/10 rounded-xl">
              <table className="w-full text-xs text-white/80">
                <thead className="bg-white/5 text-[10px] uppercase tracking-widest text-white/40">
                  <tr>
                    <th className="text-left p-3">Пространство</th><th className="p-3">Тариф</th><th className="p-3">Кредиты</th>
                    <th className="p-3">Расход 30д</th><th className="p-3">ИИ</th><th className="p-3">Люди / сессии</th><th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(w => (
                    <tr key={w.id} className={`border-t border-white/5 ${w.status === 'suspended' ? 'opacity-50' : ''}`}>
                      <td className="p-3"><p className="font-medium text-white">{w.name}</p><p className="text-[10px] text-white/40">{w.owner_email} · с {fmt(w.created_at)}</p></td>
                      <td className="p-3 text-center">{w.plan === 'pro' ? `Мастер до ${fmt(w.plan_expires_at)}` : 'Бесплатный'}</td>
                      <td className={`p-3 text-center font-mono ${w.credits <= 0 ? 'text-red-400' : ''}`}>{w.credits}</td>
                      <td className="p-3 text-center font-mono">{w.credits30} кр · {Math.round(w.tokens30 / 1000)}k ток.</td>
                      <td className="p-3 text-center">{w.ai_mode === 'byok' ? 'свой ключ' : 'платформа'}</td>
                      <td className="p-3 text-center">{w.members} / {w.sessions}</td>
                      <td className="p-3 whitespace-nowrap text-right space-x-2">
                        <button onClick={() => grant(w)} className="px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded">Кредиты</button>
                        <button onClick={() => setPro(w)} className="px-2 py-1 bg-amber-500/20 text-amber-300 rounded">Тариф</button>
                        <button onClick={() => act(() => api(`/api/admin/workspaces/${w.id}/status`, { body: { status: w.status === 'suspended' ? 'active' : 'suspended' } }))} className="px-2 py-1 bg-red-500/20 text-red-300 rounded">
                          {w.status === 'suspended' ? 'Разблок.' : 'Блок.'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'health' && <OpsPanel />}

        {tab === 'ai' && (
          <div className="max-w-2xl space-y-4">
            <p className="text-xs text-white/50">Этот ИИ используют пространства в режиме «ИИ платформы»; их ходы списывают кредиты. Пространства со своим ключом его не используют.</p>
            <PlatformAiForm local={local} setLocal={setLocal} serverLlm={serverLlm} />
            <button onClick={saveAi} className="w-full py-3 bg-white text-black rounded-xl font-semibold flex items-center justify-center gap-2">
              <Save size={16} /> {saved ? 'Сохранено' : 'Сохранить'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** Здоровье платформы: ходы и ошибки за час и сутки, бэкапы, алерты. */
const OpsPanel: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const load = () => api<any>('/api/admin/ops').then(setD).catch(e => setMsg(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, []);
  if (!d) return <p className="text-xs text-white/40">{msg || 'Загрузка…'}</p>;
  const sec = (ms: number | null) => ms == null ? '—' : `${Math.round(ms / 100) / 10} с`;
  const Win = ({ title, w }: { title: string; w: any }) => (
    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
      <p className={labelCls}>{title}</p>
      <p className="text-2xl font-bold text-white mt-1">{w.turns} <span className="text-sm text-white/40 font-normal">ходов</span></p>
      <p className={`text-sm mt-1 ${w.errorRate >= 10 ? 'text-red-400' : 'text-white/60'}`}>ошибок {w.errors} ({w.errorRate}%)</p>
      <p className="text-xs text-white/45 mt-1">время хода: медиана {sec(w.p50)}, p95 {sec(w.p95)}</p>
      {w.lastErrors?.length > 0 && <ul className="mt-2 space-y-0.5">{w.lastErrors.map((e: string, i: number) => <li key={i} className="text-[11px] text-red-300/70 truncate" title={e}>• {e}</li>)}</ul>}
    </div>
  );
  const b = d.backup;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <Win title="Последний час" w={d.hour} />
        <Win title="Сутки" w={d.day} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {[['Игроков за сутки', d.activeUsers24], ['Всего аккаунтов', d.users], ['Кредитов за сутки', d.credits24], ['База', d.dbSizeMb != null ? `${d.dbSizeMb} МБ` : '—'], ['Память', `${d.memoryMb} МБ`], ['Аптайм', `${Math.floor(d.uptimeSec / 3600)} ч ${Math.floor(d.uptimeSec % 3600 / 60)} мин`]].map(([k, v]) => (
          <div key={k as string} className="p-3 rounded-xl bg-white/[0.03] border border-white/10"><p className={labelCls}>{k}</p><p className="text-white font-semibold mt-1">{v}</p></div>
        ))}
      </div>
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className={labelCls}>Бэкапы базы</p>
          <button disabled={!b.enabled} onClick={async () => { setMsg(''); try { const r = await api<any>('/api/admin/ops/backup', { method: 'POST' }); setMsg(`Готово: ${r.file}, ${Math.round(r.size / 1024)} КБ за ${r.ms} мс`); load(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка бэкапа'); } }} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1"><RefreshCw size={12} /> Сделать сейчас</button>
        </div>
        <p className="text-xs text-white/55">{b.enabled ? `Каждые ${b.everyHours} ч, храним ${b.keep}. ` : 'Выключены (база в памяти или BACKUP_INTERVAL_HOURS=0). '}{b.last ? `Последний: ${new Date(b.last.at).toLocaleString('ru-RU')} — ${b.last.ok ? 'успешно' : `ошибка: ${b.last.detail || ''}`}` : 'Ещё не было.'}</p>
        {b.files?.length > 0 && <ul className="text-[11px] text-white/40 space-y-0.5">{b.files.map((f: any) => <li key={f.file}>{f.file} · {Math.round(f.size / 1024)} КБ</li>)}</ul>}
        <p className="text-[11px] text-white/35">Файлы лежат на сервере рядом с базой (BACKUP_DIR). Копируйте их на другой диск или в облако — бэкап на той же машине не спасёт от её потери.</p>
      </div>
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className={labelCls}>Алерты</p>
          <button disabled={!d.alerts.email && !d.alerts.webhook} onClick={async () => { const r = await api<any>('/api/admin/ops/alert-test', { method: 'POST' }).catch(() => null); setMsg(r?.sent ? 'Тестовый алерт отправлен' : 'Не отправлен (тест не чаще раза в час)'); }} className="px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-bold disabled:opacity-40">Проверить</button>
        </div>
        <p className="text-xs text-white/55">Почта: {d.alerts.email ? 'включена' : 'нет (ALERT_EMAIL + SMTP_URL)'} · вебхук: {d.alerts.webhook ? 'включён' : 'нет (ALERT_WEBHOOK_URL)'}. Срабатывают при ≥30% ошибок ходов или p95 больше 3 минут за 15 минут, и если бэкап не удался или устарел; не чаще раза в час на тему.</p>
      </div>
      {msg && <p className="text-xs text-emerald-300">{msg}</p>}
    </div>
  );
};
