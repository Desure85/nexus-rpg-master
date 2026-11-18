import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LogIn, UserPlus, Loader2 } from 'lucide-react';
import { api } from '../api';

interface Props {
  registration: 'open' | 'invite' | 'closed';
  inviteToken?: string;
  onDone: () => void;
}

const inputCls = 'w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50 transition-all';

/** Вход и регистрация мастеров. Игрокам по ссылке на героя аккаунт не нужен. */
export const AuthScreen: React.FC<Props> = ({ registration, inviteToken, onDone }) => {
  const canRegister = registration === 'open' || !!inviteToken;
  const [mode, setMode] = useState<'login' | 'register'>(inviteToken ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<{ workspace: string; role: string } | null>(null);

  useEffect(() => {
    if (!inviteToken) return;
    api<{ workspace: string; role: string }>(`/api/invites/${inviteToken}`)
      .then(setInvite)
      .catch(e => setError(e instanceof Error ? e.message : 'Приглашение недействительно'));
  }, [inviteToken]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
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

        {mode === 'register' && (
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Как вас называть" autoComplete="nickname" className={inputCls} />
        )}
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className={inputCls} />
        <input type="password" required minLength={mode === 'register' ? 8 : undefined} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'register' ? 'Пароль (от 8 символов)' : 'Пароль'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className={inputCls} />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button type="submit" disabled={busy} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
          {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
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
