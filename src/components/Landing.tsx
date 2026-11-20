import React, { useEffect, useState } from 'react';
import { ArrowLeft, Dices, Users, Moon, Scale, Globe2, Medal } from 'lucide-react';
import { api } from '../api';
import { AuthScreen } from './AuthScreen';
import { WorldCover } from './WorldCover';
import { WORLD_GENRES } from '../../shared/world';

interface PublicWorld {
  id: string; title: string; icon: string; genre: string; description: string; author?: string; official?: boolean;
  plays?: number; rating?: number; reviews?: number; price?: number; cover?: string;
  scenarios: { title: string; hook: string; mode: string }[];
}

/** Источник перехода (utm_source / ref) и анонимный id браузера — для воронки; без сторонних счётчиков. */
const trackVisit = () => {
  try {
    const q = new URLSearchParams(window.location.search);
    const src = (q.get('utm_source') || q.get('ref') || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
    if (src) document.cookie = `nx_src=${encodeURIComponent(src)}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax`;
    let anon = localStorage.getItem('nx_anon');
    if (!anon) { anon = crypto.randomUUID(); localStorage.setItem('nx_anon', anon); }
    const day = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('nx_visit_day') === day) return;
    localStorage.setItem('nx_visit_day', day);
    const saved = (document.cookie.match(/(?:^|;\s*)nx_src=([^;]+)/) || [])[1];
    api('/api/public/visit', { body: { anonId: anon, source: src || (saved ? decodeURIComponent(saved) : '') } }).catch(() => undefined);
  } catch { /* приватный режим браузера — не считаем */ }
};

const MODES = [
  { icon: <Dices size={22} />, title: 'Соло-приключение', text: 'Вы и ИИ-мастер. Один герой или целая партия, бои, тайны, торговля — в своём темпе.' },
  { icon: <Users size={22} />, title: 'С друзьями', text: 'Отправьте ссылку: каждый берёт героя и пишет свои действия, мастер сводит их в одну сцену.' },
  { icon: <Moon size={22} />, title: 'Сказка на ночь', text: 'Интерактивная сказка: ребёнок выбирает, что будет дальше, мастер рассказывает добрую историю.' },
];
const WHY = [
  { icon: <Scale size={18} />, title: 'Честные кубики', text: 'Броски, урон, деньги и опыт считает движок, а не нейросеть: мастер не подыгрывает и не жульничает.' },
  { icon: <Globe2 size={18} />, title: 'Живые миры', text: 'Готовые миры и миры игроков. Ваши партии меняют их историю, а персонажи мира помнят ваших героев.' },
  { icon: <Medal size={18} />, title: 'Герои растут', text: 'Уровень, способности и вещи переходят из приключения в приключение. Павшие остаются в зале славы.' },
];

export const Landing: React.FC<{ registration: 'open' | 'invite' | 'closed'; onDone: () => void; worldId?: string }> = ({ registration, onDone, worldId }) => {
  const [auth, setAuth] = useState<null | 'login' | 'register'>(null);
  const [worlds, setWorlds] = useState<PublicWorld[]>([]);
  const [focus, setFocus] = useState<PublicWorld | null>(null);
  useEffect(() => { trackVisit(); }, []);
  useEffect(() => { api<PublicWorld[]>('/api/public/worlds').then(setWorlds).catch(() => undefined); }, []);
  useEffect(() => { if (worldId) api<PublicWorld>(`/api/public/worlds/${worldId}`).then(setFocus).catch(() => undefined); }, [worldId]);
  const canRegister = registration === 'open';

  if (auth) return (
    <div className="relative">
      <button onClick={() => setAuth(null)} className="absolute top-4 left-4 z-10 flex items-center gap-1.5 px-3 py-2 rounded-lg text-white/60 hover:text-white text-sm"><ArrowLeft size={16} /> Назад</button>
      <AuthScreen registration={registration} onDone={onDone} initialMode={auth} />
    </div>
  );

  const Cta = ({ big }: { big?: boolean }) => (
    <div className="flex flex-wrap gap-3 justify-center">
      <button data-testid="landing-start" onClick={() => setAuth(canRegister ? 'register' : 'login')} className={`rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold shadow-lg shadow-orange-900/30 hover:scale-[1.02] transition-all ${big ? 'px-8 py-4 text-lg' : 'px-6 py-3'}`}>
        {canRegister ? 'Начать бесплатно' : 'Войти'}
      </button>
      {canRegister && <button onClick={() => setAuth('login')} className={`rounded-2xl border border-white/15 text-white/80 hover:bg-white/5 ${big ? 'px-8 py-4 text-lg' : 'px-6 py-3'}`}>Войти</button>}
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-[#0a0502] text-white overflow-x-hidden" data-testid="landing">
      <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.18),transparent_60%)] pointer-events-none" />
      <header className="relative max-w-5xl mx-auto px-5 pt-14 pb-10 text-center space-y-5">
        <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tighter">Fate & Dragons</h1>
        <p className="text-lg sm:text-2xl text-white/80 font-serif italic max-w-2xl mx-auto">Настольная ролевая игра, где мастер — ИИ. Соло, с друзьями или сказка на ночь.</p>
        <p className="text-sm text-white/50 max-w-xl mx-auto">Пишете, что делает ваш герой, — мастер рассказывает, что случилось. Без подготовки, расписаний и книг правил: первая сцена через минуту.</p>
        <div className="pt-2"><Cta big /></div>
        <p className="text-[11px] text-white/35">Бесплатные кредиты на старте · вход по почте, через VK, Яндекс или Google</p>
      </header>

      {focus && (
        <section className="relative max-w-3xl mx-auto px-5 pb-10">
          <div className="rounded-3xl overflow-hidden border border-amber-400/30 bg-white/[0.03]" data-testid="landing-world">
            <WorldCover w={focus} className="h-40 sm:h-56" />
            <div className="p-5 space-y-3">
              <p className="text-[11px] uppercase tracking-widest text-amber-300/80 font-bold">Вас пригласили в мир</p>
              <h2 className="font-display text-2xl font-bold">{focus.icon} {focus.title}</h2>
              <p className="text-sm text-white/65 leading-relaxed">{focus.description}</p>
              {focus.scenarios.length > 0 && (
                <ul className="space-y-2">{focus.scenarios.slice(0, 3).map(sc => (
                  <li key={sc.title} className="text-xs text-white/55"><b className="text-white/80">{sc.title}.</b> {sc.hook}</li>
                ))}</ul>
              )}
              <div className="pt-1"><Cta /></div>
            </div>
          </div>
        </section>
      )}

      <section className="relative max-w-5xl mx-auto px-5 pb-12 grid sm:grid-cols-3 gap-3">
        {MODES.map(m => (
          <div key={m.title} className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
            <div className="text-amber-300">{m.icon}</div>
            <h3 className="font-bold">{m.title}</h3>
            <p className="text-sm text-white/55 leading-relaxed">{m.text}</p>
          </div>
        ))}
      </section>

      {worlds.length > 0 && (
        <section className="relative max-w-5xl mx-auto px-5 pb-12 space-y-4">
          <h2 className="font-display text-2xl font-bold text-center">Миры, в которых уже играют</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {worlds.slice(0, 6).map(w => (
              <button key={w.id} onClick={() => { setFocus(w); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="text-left rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] transition-all">
                <WorldCover w={w} className="h-28" />
                <div className="p-4 space-y-1">
                  <p className="font-bold">{w.title}</p>
                  <p className="text-[11px] text-white/40">{WORLD_GENRES.find(g => g.id === w.genre)?.name}{w.reviews ? ` · ★ ${w.rating}` : ''}{w.price ? ` · 💎 ${w.price}` : ''}</p>
                  <p className="text-xs text-white/55 line-clamp-3">{w.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="relative max-w-5xl mx-auto px-5 pb-12 grid sm:grid-cols-3 gap-4">
        {WHY.map(w => (
          <div key={w.title} className="flex gap-3">
            <div className="text-emerald-300 mt-0.5">{w.icon}</div>
            <div><h3 className="font-bold text-sm">{w.title}</h3><p className="text-xs text-white/55 leading-relaxed mt-1">{w.text}</p></div>
          </div>
        ))}
      </section>

      <section className="relative max-w-3xl mx-auto px-5 pb-12 space-y-3">
        <h2 className="font-display text-xl font-bold text-center">Частые вопросы</h2>
        {[
          ['Нужно ли знать правила?', 'Нет. Пишите обычными словами, что делает герой. Обучающая партия на 5 ходов покажет броски, бой и предметы.'],
          ['Сколько это стоит?', 'На старте — бесплатные кредиты на несколько партий. Дальше — пакеты кредитов или подписка; можно подключить свой ключ ИИ.'],
          ['Подходит ли для детей?', 'Режим «Сказка» — добрые истории с выбором для детей. Обычные партии рассчитаны на взрослых и подростков.'],
          ['Можно ли создать свой мир?', 'Да: редактор миров, импорт из SillyTavern, NovelAI и AI Dungeon, генерация по описанию. Миры можно публиковать и продавать.'],
        ].map(([q, a]) => (
          <details key={q} className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
            <summary className="cursor-pointer font-semibold text-sm">{q}</summary>
            <p className="text-sm text-white/60 mt-2 leading-relaxed">{a}</p>
          </details>
        ))}
      </section>

      <footer className="relative max-w-5xl mx-auto px-5 pb-12 text-center space-y-4">
        <Cta />
        <p className="text-[11px] text-white/30">Истории и ответы мастера генерирует ИИ: они могут быть неточными или неуместными.</p>
      </footer>
    </div>
  );
};
