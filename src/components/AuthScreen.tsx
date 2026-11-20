import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { api, IS_DEMO } from '../api';
import { DemoBadge } from './DemoBanner';

interface Props {
  registration: 'open' | 'invite' | 'closed';
  inviteToken?: string;
  onDone: () => void;
  /** с лендинга: сразу форма регистрации */
  initialMode?: 'login' | 'register';
}

const inputCls = 'w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 transition-all';

/** Вход и регистрация мастеров. Игрокам по ссылке на героя аккаунт не нужен. */
export const AuthScreen: React.FC<Props> = ({ registration, inviteToken, onDone, initialMode }) => {
  const canRegister = registration === 'open' || !!inviteToken;
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(inviteToken ? 'register' : initialMode === 'register' && canRegister ? 'register' : 'login');
  const [info, setInfo] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ workspace: string; role: string } | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    api<{ id: string; name: string }[]>('/api/auth/providers').then(setProviders).catch(() => undefined);
    // ошибка входа через провайдера приходит параметром после редиректа
    const err = new URLSearchParams(window.location.search).get('auth_error');
    if (err) {
      setError(err);
      const url = new URL(window.location.href);
      url.searchParams.delete('auth_error');
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    api<{ workspace: string; role: string }>(`/api/invites/${inviteToken}`)
      .then(setInvite)
      .catch(e => setError(e instanceof Error ? e.message : 'Приглашение недействительно'));
  }, [inviteToken]);

  /** Демо: вход в один клик — аккаунт создаётся в этом браузере. */
  const quickDemo = async () => {
    setError('');
    setBusy(true);
    const creds = { email: 'master@demo.local', password: 'demo-password' };
    try {
      try { await api('/api/auth/login', { body: creds }); }
      catch { await api('/api/auth/register', { body: { ...creds, name: 'Мастер' } }); }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        const r = await api<{ mail: boolean }>('/api/auth/forgot', { body: { email } });
        setInfo(r.mail
          ? 'Если такой email зарегистрирован, мы отправили на него ссылку для сброса пароля (действует 1 час).'
          : 'Почта на этом сервере не настроена. Попросите администратора платформы выдать вам ссылку для сброса пароля.');
        return;
      }
      if (mode === 'login') {
        await api('/api/auth/login', { body: { email, password } });
        if (inviteToken) await api(`/api/invites/${inviteToken}/accept`, { body: {} }).catch(() => undefined);
      } else {
        await api('/api/auth/register', { body: { email, password, name, invite: inviteToken } });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0a0502]">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-[#14100d] border border-white/10 rounded-2xl p-6 space-y-5 shadow-2xl"
      >
        <div className="text-center space-y-1">
          <h1 className="font-display text-3xl font-bold text-white tracking-tighter">Fate & Dragons</h1>
          <p className="text-xs text-white/40">Онлайн-НРИ с ИИ-мастером</p>
        </div>

        {IS_DEMO && !inviteToken && (
          <>
            <button type="button" onClick={quickDemo} disabled={busy} className="w-full py-3.5 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-violet-900/30">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />} Попробовать без регистрации
            </button>
            <DemoBadge compact />
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-white/25"><span className="h-px flex-1 bg-white/10" />или свой аккаунт<span className="h-px flex-1 bg-white/10" /></div>
          </>
        )}

        {invite && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-200">
            Вас пригласили в пространство «<b>{invite.workspace}</b>» ({invite.role === 'admin' ? 'администратор' : 'мастер'}).
          </div>
        )}

        {canRegister && (
          <div className="flex bg-white/5 rounded-lg p-1">
            {(['login', 'register'] as const).map(m => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`flex-1 py-2 rounded-md text-xs font-bold uppercase tracking-widest transition-all ${mode === m ? 'bg-white/10 text-white' : 'text-white/40'}`}>
                {m === 'login' ? 'Вход' : 'Регистрация'}
              </button>
            ))}
          </div>
        )}

        {mode === 'forgot' && <p className="text-xs text-white/50">Введите email — пришлём ссылку для нового пароля.</p>}
        {mode === 'register' && (
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Как вас называть" autoComplete="nickname" className={inputCls} />
        )}
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className={inputCls} />
        {mode !== 'forgot' && <input type="password" required minLength={mode === 'register' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'Пароль (от 8 символов)' : 'Пароль'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className={inputCls} />}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {info && <p className="text-xs text-emerald-300">{info}</p>}

        <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'register' ? <UserPlus size={16} /> : <LogIn size={16} />}
          {mode === 'login' ? 'Войти' : mode === 'forgot' ? 'Отправить ссылку' : 'Создать аккаунт'}
        </button>
        {mode !== 'forgot' && providers.length > 0 && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-white/30"><span className="flex-1 h-px bg-white/10" />или<span className="flex-1 h-px bg-white/10" /></div>
            {providers.map(p => (
              <a
                key={p.id}
                href={`/api/auth/oauth/${p.id}/start?next=${encodeURIComponent(window.location.pathname === '/' ? '/' : window.location.pathname)}${inviteToken ? `&invite=${encodeURIComponent(inviteToken)}` : ''}`}
                className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${p.id === 'vk' ? 'bg-[#0077FF] hover:bg-[#1a85ff] text-white' : p.id === 'yandex' ? 'bg-[#FC3F1D] hover:bg-[#ff5535] text-white' : 'bg-white hover:bg-white/90 text-black'}`}
              >Войти через {p.name}</a>
            ))}
          </div>
        )}
        <button type="button" onClick={() => { setMode(mode === 'forgot' ? 'login' : 'forgot'); setError(''); setInfo(''); }} className="w-full text-[11px] text-white/40 hover:text-white">
          {mode === 'forgot' ? '← Ко входу' : 'Забыли пароль?'}
        </button>

        {!canRegister && (
          <p className="text-[10px] text-white/30 text-center">
            {registration === 'invite' ? 'Регистрация — по приглашению от владельца пространства.' : 'Регистрация на этом сервере закрыта.'}
          </p>
        )}
        <p className="text-[10px] text-white/30 text-center">Игрокам аккаунт не нужен — достаточно ссылки на героя от мастера.</p>
      </motion.form>
    </div>
  );
};

/** Новый пароль по ссылке /reset/:token */
export const ResetPasswordScreen: React.FC<{ token: string; onDone: () => void }> = ({ token, onDone }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** Демо: вход в один клик — аккаунт создаётся в этом браузере. */
  const quickDemo = async () => {
    setError('');
    setBusy(true);
    const creds = { email: 'master@demo.local', password: 'demo-password' };
    try {
      try { await api('/api/auth/login', { body: creds }); }
      catch { await api('/api/auth/register', { body: { ...creds, name: 'Мастер' } }); }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/reset', { body: { token, password } });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[#0a0502]">
      <form onSubmit={submit} className="w-full max-w-sm bg-[#14100d] border border-white/10 rounded-2xl p-6 space-y-4">
        <h1 className="font-display text-2xl font-bold text-white text-center">Новый пароль</h1>
        <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Новый пароль (от 8 символов)" className={inputCls} />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl disabled:opacity-50">Сохранить и войти</button>
      </form>
    </div>
  );
};
