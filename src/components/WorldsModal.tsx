import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Copy, Pencil, Play, Link2, Globe2, Lock, Heart, Flag, Search, Upload, Download, Sparkles } from 'lucide-react';
import { customPrompt } from './PromptModal';
import { importWorld, exportWorld, cardFromPng, type ImportResult } from '../../shared/world-import';
import { api, appLink } from '../api';
import { customAlert, customConfirm } from './PromptModal';
import { ARCHETYPES } from '../../shared/archetypes';
import { WORLD_GENRES, LORE_KINDS, ENEMY_TIER_LIST, emptyWorldData, normalizeWorldData, enemyStats, itemLabel, type World, type WorldData, type LoreCard, type WorldHero, type WorldScenario, type WorldLocation, type WorldEnemy, type WorldItem } from '../../shared/world';
import { ENEMY_TIERS } from '../../shared/balance';
import { describeEffect } from '../../shared/items';

const input = 'w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30';
const label = 'block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-1';
const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${on ? 'bg-white text-black' : 'bg-white/5 text-white/60 hover:text-white'}`;
const SERVICES: [string, string][] = [['market', 'рынок'], ['tavern', 'таверна'], ['inn', 'ночлег'], ['smith', 'кузня'], ['healer', 'лекарь'], ['questboard', 'доска заданий'], ['library', 'библиотека'], ['stables', 'конюшня'], ['dock', 'причал']];
const VIS_LABEL = { private: 'Только я', link: 'По ссылке', public: 'В каталоге' } as const;
const uid = () => Math.random().toString(36).slice(2, 9);

export const worldLink = (id: string) => appLink(`/world/${id}`);

/** Выбор файла и разбор формата (JSON или PNG с карточкой персонажа). */
const pickImport = (): Promise<ImportResult | null> => new Promise(resolve => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,.png,application/json,image/png';
  inp.onchange = async () => {
    const f = inp.files?.[0];
    if (!f) return resolve(null);
    try {
      if (f.size > 5_000_000) throw new Error('Файл больше 5 МБ');
      const raw = /\.png$/i.test(f.name) || f.type === 'image/png' ? cardFromPng(new Uint8Array(await f.arrayBuffer())) : JSON.parse(await f.text());
      resolve(importWorld(raw));
    } catch (e) {
      customAlert(e instanceof SyntaxError ? 'Файл повреждён: это не JSON' : e instanceof Error ? e.message : 'Не удалось прочитать файл');
      resolve(null);
    }
  };
  inp.click();
});

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${name.replace(/[\\/:*?"<>|]+/g, '_') || 'world'}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export interface WorldStart { worldId: string; scenarioId?: string; title?: string; mode: 'short' | 'campaign' | 'tale'; characters: WorldHero[] }

/** Каталог миров: свои и общие; отсюда — редактор и запуск игры. */
export const WorldsModal: React.FC<{ onClose: () => void; onPlay: (s: WorldStart) => void; openId?: string; maxHeroes?: number; workspaceId?: string }> = ({ onClose, onPlay, openId, maxHeroes = 4, workspaceId }) => {
  const [genOpen, setGenOpen] = useState(false);
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [list, setList] = useState<World[] | null>(null);
  const [editing, setEditing] = useState<World | null>(null);
  const [playing, setPlaying] = useState<World | null>(null);
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [sort, setSort] = useState<'popular' | 'likes' | 'new'>('popular');
  const load = (t = tab) => {
    const qs = t === 'public' ? `&q=${encodeURIComponent(q.trim())}&genre=${genre}&sort=${sort}` : '';
    api<World[]>(`/api/worlds?scope=${t}${qs}`).then(setList).catch(() => setList([]));
  };
  useEffect(() => { setList(null); load(tab); }, [tab, genre, sort]);
  useEffect(() => { if (tab !== 'public') return; const t = setTimeout(() => load('public'), 300); return () => clearTimeout(t); }, [q]);
  const like = async (w: World) => {
    const r = await api<{ likes: number; liked: boolean }>(`/api/worlds/${w.id}/like`, { method: 'POST' });
    setList(l => (l || []).map(x => x.id === w.id ? { ...x, ...r } : x));
  };
  const report = async (w: World) => {
    const reason = await customPrompt(`Что не так с миром «${w.title}»? Например: чужая вселенная без прав, оскорбления, неприемлемый контент.`, '');
    if (reason === null) return;
    await api(`/api/worlds/${w.id}/report`, { body: { reason } }).catch(() => undefined);
    customAlert('Спасибо, модераторы посмотрят. Если жалоб несколько, мир скроется из каталога до проверки.');
  };
  useEffect(() => {
    if (openId) api<World>(`/api/worlds/${openId}`).then(setPlaying).catch(e => customAlert(e instanceof Error ? e.message : 'Мир не найден'));
  }, [openId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing && !playing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing, playing]);

  const full = async (w: World) => api<World>(`/api/worlds/${w.id}`);
  const newWorld = (): World => ({ id: '', title: '', icon: '🌍', genre: 'fantasy', description: '', visibility: 'private', version: 0, data: emptyWorldData(), mine: true });

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm text-left" onClick={onClose}>
      <div className="w-full sm:max-w-3xl h-[92dvh] sm:h-[84vh] bg-[#151210] border border-white/10 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <h2 className="font-display text-xl text-white">🌍 Миры</h2>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3 border-b border-white/5 shrink-0">
          <button onClick={() => setTab('mine')} className={chip(tab === 'mine')}>Мои миры</button>
          <button onClick={() => setTab('public')} className={chip(tab === 'public')}>Каталог</button>
          <button onClick={async () => {
            const r = await pickImport();
            if (!r) return;
            setEditing({ ...newWorld(), title: r.title || '', icon: r.icon || '🌍', genre: r.genre || 'fantasy', description: r.description || '', data: r.data });
            customAlert(`Импорт: ${r.format}. Карточек: ${r.data.cards.length}, мест: ${r.data.locations.length}, сюжетов: ${r.data.scenarios.length}.${r.notes.length ? `\n\n${r.notes.join('\n')}` : ''}\n\nПроверьте мир и сохраните.`);
          }} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 text-white/70 text-xs hover:text-white" title="SillyTavern, NovelAI, Character Card, AI Dungeon, экспорт Nexus"><Upload size={13} /> Импорт</button>
          <button onClick={() => setGenOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/20 text-violet-200 text-xs font-bold hover:bg-violet-500/30" title="Опишите мир — ИИ соберёт черновик"><Sparkles size={13} /> С ИИ</button>
          <button onClick={() => setEditing(newWorld())} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 text-black text-xs font-bold hover:bg-amber-300"><Plus size={14} /> Создать</button>
        </div>
        {tab === 'public' && (
          <div className="px-4 py-3 border-b border-white/5 space-y-2 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input className={`${input} pl-9`} placeholder="Поиск по названию, описанию, автору" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              <button onClick={() => setGenre('')} className={`${chip(!genre)} shrink-0`}>Все жанры</button>
              {WORLD_GENRES.map(g => <button key={g.id} onClick={() => setGenre(g.id)} className={`${chip(genre === g.id)} shrink-0`}>{g.name}</button>)}
            </div>
            <div className="flex gap-3 text-[11px]">
              {([['popular', 'Популярные'], ['likes', 'Любимые'], ['new', 'Новые']] as const).map(([id, n]) => <button key={id} onClick={() => setSort(id)} className={sort === id ? 'text-amber-300 font-bold' : 'text-white/45 hover:text-white'}>{n}</button>)}
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {list === null ? <p className="text-white/40 text-sm">Загружаем…</p> : list.length === 0 ? (
            <div className="text-sm text-white/55 leading-relaxed space-y-2 max-w-lg">
              {tab === 'mine' ? <>
                <p>Мир — это ваш сеттинг для ИИ-мастера: история, персонажи, места, фракции и готовые завязки. Мастер держит канон мира и подтягивает нужные карточки, когда о них заходит речь.</p>
                <p>Создайте мир, сыграйте в нём сами или поделитесь ссылкой с друзьями.</p>
              </> : <p>{q || genre ? 'Ничего не нашлось — попробуйте другой запрос или жанр.' : 'В каталоге пока пусто. Опубликуйте свой мир — переключите доступ на «В каталоге».'}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {list.map(w => {
                const counts = (w.data as any).counts || { cards: w.data.cards.length, locations: w.data.locations.length, scenarios: w.data.scenarios.length };
                return (
                  <div key={w.id} className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col gap-2">
                    <div className="flex items-start gap-3">
                      <span className="text-3xl leading-none">{w.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-bold truncate">{w.title}</p>
                        <p className="text-[11px] text-white/40">{WORLD_GENRES.find(g => g.id === w.genre)?.name}{w.author && !w.mine ? ` · ${w.author}` : ''} · сыграно {w.plays || 0}</p>
                      </div>
                      {w.mine && <span className="text-[10px] text-white/40 flex items-center gap-1">{w.visibility === 'private' ? <Lock size={10} /> : w.visibility === 'link' ? <Link2 size={10} /> : <Globe2 size={10} />}{VIS_LABEL[w.visibility]}</span>}
                    </div>
                    {w.description && <p className="text-xs text-white/55 leading-snug line-clamp-3">{w.description}</p>}
                    <p className="text-[11px] text-white/35">карточек {counts.cards} · мест {counts.locations} · сценариев {counts.scenarios}</p>
                    {w.mine && w.hidden && <p className="text-[11px] text-red-300/80">Скрыт из каталога по жалобам — ждёт проверки модератора</p>}
                    <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                      <button onClick={async () => setPlaying(await full(w))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25"><Play size={12} /> Играть</button>
                      {w.mine && <button onClick={async () => setEditing(await full(w))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-white/70 text-xs hover:text-white"><Pencil size={12} /> Изменить</button>}
                      {w.mine && <button onClick={async () => { const f = await full(w); download(f.title, exportWorld(f)); }} className="p-1.5 rounded-lg bg-white/5 text-white/50 hover:text-white" aria-label="Скачать JSON" title="Скачать JSON"><Download size={13} /></button>}
                      <button onClick={async () => { try { await api(`/api/worlds/${w.id}/copy`, { method: 'POST' }); setTab('mine'); load('mine'); } catch (e) { customAlert(e instanceof Error ? e.message : 'Ошибка'); } }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-white/70 text-xs hover:text-white" title="Копия в мои миры — можно переделать под себя"><Copy size={12} /> {w.mine ? 'Копия' : 'Ремикс'}</button>
                      <button onClick={() => like(w)} className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs ${w.liked ? 'text-rose-300 bg-rose-500/10' : 'text-white/50 bg-white/5 hover:text-white'}`} aria-label="Нравится"><Heart size={12} fill={w.liked ? 'currentColor' : 'none'} /> {w.likes || 0}</button>
                      {!w.mine && <button onClick={() => report(w)} className="ml-auto p-1.5 rounded-lg text-white/25 hover:text-red-300" aria-label="Пожаловаться" title="Пожаловаться"><Flag size={13} /></button>}
                      {w.mine && <button onClick={async () => { if (await customConfirm(`Удалить мир «${w.title}»? Начатые игры сохранятся.`)) { await api(`/api/worlds/${w.id}`, { method: 'DELETE' }); load(); } }} className="ml-auto p-1.5 rounded-lg text-white/30 hover:text-red-300" aria-label="Удалить"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {genOpen && <WorldGenerator workspaceId={workspaceId} onClose={() => setGenOpen(false)} onDraft={d => { setGenOpen(false); setEditing({ ...newWorld(), ...d }); }} />}
      {editing && <WorldEditor world={editing} onClose={() => setEditing(null)} onSaved={w => { setEditing(null); setTab('mine'); load('mine'); if (!editing.id) setPlaying(w); }} />}
      {playing && <WorldPlay world={playing} maxHeroes={maxHeroes} onClose={() => setPlaying(null)} onPlay={s => { setPlaying(null); onPlay(s); }} />}
    </div>,
    document.body,
  );
};

/* ------------------------------------------------------------------ ИИ-черновик ------------------------------------------------------------------ */

const IDEAS = [
  'Северный архипелаг, где туман крадёт имена, а маяки — последняя защита. Контрабандисты, смотрители, гильдия ныряльщиков.',
  'Город-улей на спине гигантской черепахи. Касты, воздушные шары, черепаха умирает, и никто не знает почему.',
  'Добрая сказка: лесная деревня зверей, где пропала Весна. Совы-почтальоны, ворчливый барсук-мельник, хитрая лиса.',
  'Неоновый мегаполис, где воспоминания продаются в аптеках. Корпорации, подпольные мнемо-хакеры, детектив без прошлого.',
];

const WorldGenerator: React.FC<{ workspaceId?: string; onClose: () => void; onDraft: (w: Partial<World>) => void }> = ({ workspaceId, onClose, onDraft }) => {
  const [idea, setIdea] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const d = await api<Pick<World, 'title' | 'icon' | 'genre' | 'description' | 'data'>>('/api/worlds/generate', { body: { prompt: idea, workspaceId } });
      onDraft(d);
      customAlert(`Черновик готов: карточек ${d.data.cards.length}, мест ${d.data.locations.length}, сюжетов ${d.data.scenarios.length}, врагов ${(d.data.enemies || []).length}. Поправьте, что хочется, и сохраните.`);
    } catch (e) { customAlert(e instanceof Error ? e.message : 'Не удалось сгенерировать'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center sm:p-4 bg-black/70" onClick={busy ? undefined : onClose}>
      <div className="w-full sm:max-w-lg bg-[#1a1614] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2"><Sparkles size={16} className="text-violet-300" /> Мир с помощью ИИ</h3>
          {!busy && <button onClick={onClose} className="p-1 text-white/40 hover:text-white" aria-label="Закрыть"><X size={18} /></button>}
        </div>
        <p className="text-xs text-white/50 leading-relaxed">Опишите мир в паре абзацев: где, кто, в чём конфликт, какое настроение. ИИ соберёт черновик — канон, карточки, карту, сюжеты, героев, врагов и предметы. Всё можно будет поправить.</p>
        <textarea className={`${input} min-h-[140px]`} maxLength={2000} value={idea} onChange={e => setIdea(e.target.value)} placeholder="Например: северный архипелаг, где туман крадёт имена…" disabled={busy} />
        <div className="flex flex-wrap gap-1.5">
          {IDEAS.map(t => <button key={t} disabled={busy} onClick={() => setIdea(t)} className="px-2.5 py-1 rounded-full bg-white/5 text-[11px] text-white/55 hover:text-white text-left">{t.split('.')[0]}</button>)}
        </div>
        <button onClick={go} disabled={busy || idea.trim().length < 10} className="w-full py-3 rounded-xl bg-violet-500 text-white font-bold disabled:opacity-40">
          {busy ? 'Мастер сочиняет мир… обычно 1–2 минуты' : 'Собрать черновик'}
        </button>
        <p className="text-[10px] text-white/30 text-center">Списывает кредиты как обычная генерация · ИИ может ошибаться</p>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ запуск ------------------------------------------------------------------ */

const WorldPlay: React.FC<{ world: World; maxHeroes: number; onClose: () => void; onPlay: (s: WorldStart) => void }> = ({ world, maxHeroes, onClose, onPlay }) => {
  const d = world.data;
  const [scenarioId, setScenarioId] = useState<string>(d.scenarios[0]?.id || '');
  const sc = d.scenarios.find(s => s.id === scenarioId);
  const pool = useMemo(() => {
    const all = [...(sc?.heroes || []), ...d.heroes];
    return all.filter((h, i) => all.findIndex(x => x.name === h.name) === i);
  }, [sc, d.heroes]);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => { setPicked(pool.slice(0, 1).map(h => h.name)); }, [pool]);
  const [own, setOwn] = useState<WorldHero>({ name: '', concept: '', gender: 'М' });
  const heroes = [...pool.filter(h => picked.includes(h.name)), ...(own.name.trim() ? [{ ...own, name: own.name.trim() }] : [])].slice(0, maxHeroes);
  const copyLink = async () => { await navigator.clipboard?.writeText(worldLink(world.id)).catch(() => undefined); customAlert(`Ссылка на мир скопирована:\n${worldLink(world.id)}`); };
  return (
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center sm:p-4 bg-black/70" onClick={onClose}>
      <div className="w-full sm:max-w-xl max-h-[92dvh] bg-[#1a1614] border border-white/10 rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3 shrink-0">
          <span className="text-3xl">{world.icon}</span>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-bold text-lg leading-tight">{world.title}</h3>
            <p className="text-xs text-white/50 mt-1 leading-snug">{world.description || d.setting}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-white/40 hover:text-white" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <span className={label}>Сюжет</span>
            {d.scenarios.length === 0 ? <p className="text-xs text-white/45">У мира нет готовых завязок — мастер придумает её сам по канону мира.</p> : (
              <div className="space-y-2">
                {d.scenarios.map(s => (
                  <button key={s.id} onClick={() => setScenarioId(s.id)} className={`w-full text-left p-3 rounded-xl border transition-colors ${scenarioId === s.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}>
                    <p className="text-sm text-white font-semibold">{s.title} <span className="text-[10px] text-white/40 font-normal">· {s.mode === 'tale' ? 'сказка' : s.mode === 'campaign' ? 'кампания' : 'на вечер'}</span></p>
                    <p className="text-xs text-white/50 mt-0.5 line-clamp-2">{s.hook}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className={label}>Герои (до {maxHeroes})</span>
            <div className="flex flex-wrap gap-1.5">
              {pool.map(h => (
                <button key={h.name} onClick={() => setPicked(p => p.includes(h.name) ? p.filter(x => x !== h.name) : [...p, h.name])} title={h.concept} className={chip(picked.includes(h.name))}>{picked.includes(h.name) ? '✓ ' : ''}{h.name}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_2fr_auto] gap-2">
              <input className={input} placeholder="Свой герой" value={own.name} onChange={e => setOwn({ ...own, name: e.target.value })} maxLength={60} />
              <input className={input} placeholder="Кто он такой" value={own.concept} onChange={e => setOwn({ ...own, concept: e.target.value })} maxLength={200} />
              <button onClick={() => setOwn({ ...own, gender: own.gender === 'М' ? 'Ж' : 'М' })} className="px-3 rounded-lg bg-white/5 text-white/70 text-sm">{own.gender}</button>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-white/10 flex gap-2 shrink-0">
          {world.visibility !== 'private' && <button onClick={copyLink} className="px-3 py-3 rounded-xl bg-white/5 text-white/70 text-sm flex items-center gap-1.5"><Link2 size={14} /> Ссылка</button>}
          <button
            disabled={!heroes.length}
            onClick={() => onPlay({ worldId: world.id, scenarioId: sc?.id, mode: sc?.mode || 'short', title: sc ? `${world.title}: ${sc.title}` : world.title, characters: heroes })}
            className="flex-1 py-3 rounded-xl bg-amber-400 text-black font-bold disabled:opacity-40 flex items-center justify-center gap-2"
          ><Play size={16} /> Играть{heroes.length ? ` (${heroes.map(h => h.name).join(', ')})` : ''}</button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ редактор ------------------------------------------------------------------ */

type ETab = 'passport' | 'lore' | 'places' | 'scenarios' | 'heroes' | 'enemies' | 'items';

const WorldEditor: React.FC<{ world: World; onClose: () => void; onSaved: (w: World) => void }> = ({ world, onClose, onSaved }) => {
  const [w, setW] = useState<World>(world);
  const [tab, setTab] = useState<ETab>('passport');
  const [saving, setSaving] = useState(false);
  const d = w.data;
  const setD = (patch: Partial<WorldData>) => setW(prev => ({ ...prev, data: { ...prev.data, ...patch } }));
  const save = async () => {
    if (!w.title.trim()) { setTab('passport'); return customAlert('Дайте миру название'); }
    setSaving(true);
    try {
      const body = { title: w.title, icon: w.icon, genre: w.genre, description: w.description, visibility: w.visibility, data: normalizeWorldData(w.data) };
      const saved = w.id ? await api<World>(`/api/worlds/${w.id}`, { method: 'PATCH', body }) : await api<World>('/api/worlds', { body });
      onSaved(saved);
    } catch (e) { customAlert(e instanceof Error ? e.message : 'Не удалось сохранить'); } finally { setSaving(false); }
  };
  const tabs: [ETab, string][] = [['passport', 'Паспорт'], ['lore', `Лор · ${d.cards.length}`], ['places', `Места · ${d.locations.length}`], ['scenarios', `Сюжеты · ${d.scenarios.length}`], ['heroes', `Герои · ${d.heroes.length}`], ['enemies', `Враги · ${(d.enemies || []).length}`], ['items', `Предметы · ${(d.items || []).length}`]];

  return (
    <div className="fixed inset-0 z-[10000] flex items-stretch sm:items-center justify-center sm:p-4 bg-black/70" onClick={e => e.stopPropagation()}>
      <div className="w-full sm:max-w-3xl h-[100dvh] sm:h-[90vh] bg-[#1a1614] border border-white/10 sm:rounded-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3 shrink-0">
          <h3 className="text-white font-bold flex-1 truncate">{w.id ? `Мир «${w.title || 'без названия'}»` : 'Новый мир'}</h3>
          <button onClick={onClose} className="p-1.5 text-white/40 hover:text-white" aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="flex gap-1.5 px-4 py-2.5 border-b border-white/5 overflow-x-auto no-scrollbar shrink-0">
          {tabs.map(([id, name]) => <button key={id} onClick={() => setTab(id)} className={`${chip(tab === id)} shrink-0`}>{name}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'passport' && <>
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              <div><span className={label}>Знак</span><input className={`${input} text-center text-xl`} value={w.icon} maxLength={4} onChange={e => setW({ ...w, icon: e.target.value })} /></div>
              <div><span className={label}>Название</span><input className={input} value={w.title} maxLength={80} placeholder="Туманные Острова" onChange={e => setW({ ...w, title: e.target.value })} /></div>
            </div>
            <div>
              <span className={label}>Жанр — от него зависят лавки и добыча</span>
              <div className="flex flex-wrap gap-1.5">{WORLD_GENRES.map(g => <button key={g.id} onClick={() => setW({ ...w, genre: g.id })} className={chip(w.genre === g.id)}>{g.name}</button>)}</div>
            </div>
            <div><span className={label}>Описание для игроков</span><textarea className={`${input} min-h-[70px]`} maxLength={600} value={w.description} placeholder="Чем мир цепляет — 1–3 предложения" onChange={e => setW({ ...w, description: e.target.value })} /></div>
            <div><span className={label}>Сеттинг для мастера</span><textarea className={`${input} min-h-[90px]`} maxLength={1500} value={d.setting} placeholder="Где и когда всё происходит, что за общество, какая магия или технологии" onChange={e => setD({ setting: e.target.value })} /></div>
            <div><span className={label}>Тон и табу</span><textarea className={`${input} min-h-[60px]`} maxLength={1500} value={d.tone || ''} placeholder="Например: меланхолично, без жестокости к детям, больше загадок" onChange={e => setD({ tone: e.target.value })} /></div>
            <div>
              <span className={label}>Доступ</span>
              <div className="flex flex-wrap gap-1.5">{(['private', 'link', 'public'] as const).map(v => <button key={v} onClick={() => setW({ ...w, visibility: v })} className={chip(w.visibility === v)}>{VIS_LABEL[v]}</button>)}</div>
              <p className="text-[11px] text-white/35 mt-1.5">{w.visibility === 'private' ? 'Мир видите только вы.' : w.visibility === 'link' ? 'Играть может любой, у кого есть ссылка.' : 'Мир виден всем в каталоге, его можно сыграть и скопировать.'} Начатые игры не меняются, когда вы правите мир.{w.visibility === 'public' ? ' Публикуйте только своё: миры по чужим книгам, играм и фильмам без разрешения правообладателя скроют по жалобам.' : ''}</p>
            </div>
          </>}

          {tab === 'lore' && <>
            <div>
              <span className={label}>Канон — мастер помнит его всегда (до 3000 символов)</span>
              <textarea className={`${input} min-h-[120px]`} maxLength={3000} value={d.core} placeholder="Главные законы мира, история в двух абзацах, что все знают" onChange={e => setD({ core: e.target.value })} />
              <p className="text-[11px] text-white/35 mt-1 text-right">{d.core.length}/3000</p>
            </div>
            <div className="flex items-center justify-between">
              <span className={label}>Карточки — мастер берёт их, когда о них заходит речь</span>
              <span className="flex gap-3">
                <button onClick={async () => {
                  const r = await pickImport();
                  if (!r) return;
                  const have = new Set(d.cards.map(c => c.name.toLowerCase()));
                  const add = r.data.cards.filter(c => !have.has(c.name.toLowerCase())).map(c => ({ ...c, id: uid() }));
                  setD({ cards: [...d.cards, ...add].slice(0, 80) });
                  customAlert(`Добавлено карточек: ${add.length} из ${r.data.cards.length} (${r.format}).${r.notes.length ? `\n\n${r.notes.join('\n')}` : ''}`);
                }} className="text-xs text-white/50 hover:text-white flex items-center gap-1"><Upload size={12} /> Из файла</button>
                <button onClick={() => setD({ cards: [...d.cards, { id: uid(), kind: 'npc', name: '', keys: [], text: '' }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Карточка</button>
              </span>
            </div>
            {d.cards.length === 0 && <p className="text-xs text-white/40">Персонажи, места, фракции, предметы, история. Ключи — слова, по которым мастер вспомнит карточку (имя карточки — тоже ключ).</p>}
            {d.cards.map((c, i) => <CardEditor key={c.id} card={c} onChange={nc => setD({ cards: d.cards.map((x, j) => j === i ? nc : x) })} onDelete={() => setD({ cards: d.cards.filter((_, j) => j !== i) })} />)}
          </>}

          {tab === 'places' && <>
            <div className="flex items-center justify-between">
              <span className={label}>Места появятся на карте игры</span>
              <button onClick={() => setD({ locations: [...d.locations, { id: uid(), name: '', description: '', services: [], connections: [], dangerLevel: 1 }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Место</button>
            </div>
            {d.locations.map((l, i) => <PlaceEditor key={l.id} place={l} all={d.locations}
              onChange={nl => setD({ locations: d.locations.map((x, j) => j === i ? nl : x) })}
              onRoad={(other, on) => setD({ locations: d.locations.map(x => {
                const link = (from: string, to: string) => x.id === from ? { ...x, connections: on ? [...new Set([...(x.connections || []), to])] : (x.connections || []).filter(c => c !== to) } : null;
                return link(l.id, other) || link(other, l.id) || x;
              }) })}
              onDelete={() => setD({ locations: d.locations.filter((_, j) => j !== i).map(x => ({ ...x, connections: (x.connections || []).filter(c => c !== l.id) })) })} />)}
          </>}

          {tab === 'scenarios' && <>
            <div className="flex items-center justify-between">
              <span className={label}>Завязки — с них начинается игра</span>
              <button onClick={() => setD({ scenarios: [...d.scenarios, { id: uid(), title: '', hook: '', mode: 'short', heroes: [] }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Сюжет</button>
            </div>
            {d.scenarios.map((s, i) => <ScenarioEditor key={s.id} sc={s} places={d.locations} onChange={ns => setD({ scenarios: d.scenarios.map((x, j) => j === i ? ns : x) })} onDelete={() => setD({ scenarios: d.scenarios.filter((_, j) => j !== i) })} />)}
          </>}

          {tab === 'enemies' && <>
            <div className="flex items-center justify-between">
              <span className={label}>Бестиарий — числа держит движок</span>
              <button onClick={() => setD({ enemies: [...(d.enemies || []), { id: uid(), name: '', tier: 'regular', traits: '' }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Враг</button>
            </div>
            <p className="text-[11px] text-white/40 leading-snug">Ранг задаёт здоровье, урон и сложность по проверенному балансу. Когда мастер выводит врага из бестиария, его здоровье ставит игра, а случайные стычки предлагают подходящих врагов отсюда.</p>
            {(d.enemies || []).map((e, i) => <EnemyEditor key={e.id} enemy={e} onChange={ne => setD({ enemies: d.enemies!.map((x, j) => j === i ? ne : x) })} onDelete={() => setD({ enemies: d.enemies!.filter((_, j) => j !== i) })} />)}
          </>}

          {tab === 'items' && <>
            <div className="grid grid-cols-2 gap-3">
              <div><span className={label}>Деньги мира</span><input className={input} value={d.currency || ''} maxLength={30} placeholder="золото" onChange={e => setD({ currency: e.target.value })} /></div>
              <label className="flex items-end gap-2 text-xs text-white/60 pb-2"><input type="checkbox" className="accent-amber-400" checked={!!d.shopReplace} onChange={e => setD({ shopReplace: e.target.checked || undefined })} /> В лавках только предметы мира</label>
            </div>
            <div className="flex items-center justify-between">
              <span className={label}>Предметы — эффекты применяет движок</span>
              <button onClick={() => setD({ items: [...(d.items || []), { id: uid(), name: '', kind: 'consumable', heal: 3 }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Предмет</button>
            </div>
            {(d.items || []).map((it, i) => <ItemEditor key={it.id} item={it} onChange={ni => setD({ items: d.items!.map((x, j) => j === i ? ni : x) })} onDelete={() => setD({ items: d.items!.filter((_, j) => j !== i) })} />)}
          </>}

          {tab === 'heroes' && <>
            <div className="flex items-center justify-between">
              <span className={label}>Готовые герои мира — игрок выберет при старте</span>
              <button onClick={() => setD({ heroes: [...d.heroes, { name: '', concept: '', gender: 'М' }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Герой</button>
            </div>
            {d.heroes.map((h, i) => <HeroRow key={i} hero={h} onChange={nh => setD({ heroes: d.heroes.map((x, j) => j === i ? nh : x) })} onDelete={() => setD({ heroes: d.heroes.filter((_, j) => j !== i) })} />)}
          </>}
        </div>
        <div className="p-4 border-t border-white/10 flex gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-3 rounded-xl bg-white/5 text-white/70 text-sm">Отмена</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 rounded-xl bg-white text-black font-bold disabled:opacity-50">{saving ? 'Сохраняем…' : w.id ? 'Сохранить' : 'Создать мир'}</button>
        </div>
      </div>
    </div>
  );
};

const Box: React.FC<{ children: React.ReactNode; onDelete: () => void }> = ({ children, onDelete }) => (
  <div className="relative p-3 pr-9 rounded-xl bg-black/30 border border-white/10 space-y-2">
    {children}
    <button onClick={onDelete} className="absolute top-2 right-2 p-1 text-white/30 hover:text-red-300" aria-label="Удалить"><Trash2 size={14} /></button>
  </div>
);

const CardEditor: React.FC<{ card: LoreCard; onChange: (c: LoreCard) => void; onDelete: () => void }> = ({ card, onChange, onDelete }) => (
  <Box onDelete={onDelete}>
    <div className="flex flex-wrap gap-1">{LORE_KINDS.map(k => <button key={k.id} onClick={() => onChange({ ...card, kind: k.id })} className={`px-2 py-0.5 rounded-full text-[11px] ${card.kind === k.id ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/70'}`}>{k.icon} {k.name}</button>)}</div>
    <input className={input} placeholder="Имя: Смотритель Ивар" value={card.name} maxLength={80} onChange={e => onChange({ ...card, name: e.target.value })} />
    <input className={input} placeholder="Ключи через запятую: смотритель, маяк" value={card.keys.join(', ')} onChange={e => onChange({ ...card, keys: e.target.value.split(',').map(x => x.trimStart()) })} />
    <textarea className={`${input} min-h-[70px]`} placeholder="Что мастер должен знать: внешность, мотив, тайна, как говорит" maxLength={1500} value={card.text} onChange={e => onChange({ ...card, text: e.target.value })} />
    <label className="flex items-center gap-2 text-[11px] text-white/50"><input type="checkbox" checked={!!card.always} onChange={e => onChange({ ...card, always: e.target.checked || undefined })} className="accent-amber-400" /> Помнить всегда</label>
  </Box>
);

const PlaceEditor: React.FC<{ place: WorldLocation; all: WorldLocation[]; onChange: (l: WorldLocation) => void; onRoad: (otherId: string, on: boolean) => void; onDelete: () => void }> = ({ place, all, onChange, onRoad, onDelete }) => (
  <Box onDelete={onDelete}>
    <input className={input} placeholder="Название: Порт Сольвей" value={place.name} maxLength={60} onChange={e => onChange({ ...place, name: e.target.value })} />
    <textarea className={`${input} min-h-[50px]`} placeholder="Каким его видят герои" maxLength={600} value={place.description} onChange={e => onChange({ ...place, description: e.target.value })} />
    <div className="flex flex-wrap gap-1">{SERVICES.map(([id, name]) => {
      const on = (place.services || []).includes(id);
      return <button key={id} onClick={() => onChange({ ...place, services: on ? place.services!.filter(x => x !== id) : [...(place.services || []), id] })} className={`px-2 py-0.5 rounded-full text-[11px] ${on ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/5 text-white/40'}`}>{name}</button>;
    })}</div>
    <div className="flex items-center gap-2 text-[11px] text-white/50">Опасность
      {[1, 2, 3, 4, 5].map(n => <button key={n} onClick={() => onChange({ ...place, dangerLevel: n })} className={`w-6 h-6 rounded ${n <= (place.dangerLevel || 1) ? 'bg-red-500/40 text-white' : 'bg-white/5'}`}>{n}</button>)}
    </div>
    {all.length > 1 && <div className="flex flex-wrap items-center gap-1 text-[11px] text-white/50">Дороги в:
      {all.filter(o => o.id !== place.id && o.name).map(o => {
        const on = (place.connections || []).includes(o.id);
        return <button key={o.id} onClick={() => onRoad(o.id, !on)} className={`px-2 py-0.5 rounded-full ${on ? 'bg-sky-500/20 text-sky-200' : 'bg-white/5 text-white/40'}`}>{o.name}</button>;
      })}
    </div>}
  </Box>
);

const ScenarioEditor: React.FC<{ sc: WorldScenario; places: WorldLocation[]; onChange: (s: WorldScenario) => void; onDelete: () => void }> = ({ sc, places, onChange, onDelete }) => (
  <Box onDelete={onDelete}>
    <input className={input} placeholder="Название: Погасший маяк" value={sc.title} maxLength={80} onChange={e => onChange({ ...sc, title: e.target.value })} />
    <textarea className={`${input} min-h-[80px]`} placeholder="Завязка: что случилось и почему герои вмешаются" maxLength={1500} value={sc.hook} onChange={e => onChange({ ...sc, hook: e.target.value })} />
    <div className="flex flex-wrap gap-1.5">{([['short', 'На вечер'], ['campaign', 'Кампания'], ['tale', 'Сказка']] as const).map(([id, n]) => <button key={id} onClick={() => onChange({ ...sc, mode: id })} className={chip(sc.mode === id)}>{n}</button>)}</div>
    {places.length > 0 && <select className={input} value={sc.startLocationId || ''} onChange={e => onChange({ ...sc, startLocationId: e.target.value || undefined })}>
      <option value="">Стартовое место — на выбор мастера</option>
      {places.filter(p => p.name).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>}
    <div className="space-y-2">
      {(sc.heroes || []).map((h, i) => <HeroRow key={i} hero={h} onChange={nh => onChange({ ...sc, heroes: sc.heroes!.map((x, j) => j === i ? nh : x) })} onDelete={() => onChange({ ...sc, heroes: sc.heroes!.filter((_, j) => j !== i) })} />)}
      <button onClick={() => onChange({ ...sc, heroes: [...(sc.heroes || []), { name: '', concept: '', gender: 'М' }] })} className="text-[11px] text-amber-300/80">+ герой этого сюжета</button>
    </div>
  </Box>
);

const HeroRow: React.FC<{ hero: WorldHero; onChange: (h: WorldHero) => void; onDelete: () => void }> = ({ hero, onChange, onDelete }) => (
  <div className="flex flex-wrap gap-1.5 items-center p-2 rounded-lg bg-white/[0.02] border border-white/5">
    <input className={`${input} flex-1 min-w-[7rem] w-auto`} placeholder="Имя" value={hero.name} maxLength={60} onChange={e => onChange({ ...hero, name: e.target.value })} />
    <button onClick={() => onChange({ ...hero, gender: hero.gender === 'М' ? 'Ж' : 'М' })} className="px-3 py-2 rounded-lg bg-white/5 text-white/70 text-sm" title="Пол">{hero.gender}</button>
    <select className={`${input} w-auto max-w-[11rem]`} value={hero.archetype || ''} onChange={e => onChange({ ...hero, archetype: e.target.value || undefined })} title="Архетип: стартовые числа и снаряжение">
      <option value="">Без архетипа</option>
      {ARCHETYPES.map(a => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
    </select>
    <button onClick={onDelete} className="p-1 text-white/30 hover:text-red-300" aria-label="Удалить"><Trash2 size={14} /></button>
    <input className={`${input} basis-full`} placeholder="Кто он: лоцман, знает все отмели" value={hero.concept} maxLength={300} onChange={e => onChange({ ...hero, concept: e.target.value })} />
  </div>
);

const numIn = (v: string) => (v === '' ? undefined : Math.max(0, Math.round(Number(v)) || 0));

const EnemyEditor: React.FC<{ enemy: WorldEnemy; onChange: (e: WorldEnemy) => void; onDelete: () => void }> = ({ enemy, onChange, onDelete }) => {
  const st = enemyStats(enemy);
  const t = ENEMY_TIERS[enemy.tier];
  return (
    <Box onDelete={onDelete}>
      <input className={input} placeholder="Безымянный" value={enemy.name} maxLength={60} onChange={e => onChange({ ...enemy, name: e.target.value })} />
      <div className="flex flex-wrap gap-1.5">{ENEMY_TIER_LIST.map(x => <button key={x.id} onClick={() => onChange({ ...enemy, tier: x.id, hp: undefined, dmg: undefined, dc: undefined })} className={chip(enemy.tier === x.id)}>{x.name}</button>)}</div>
      <div className="grid grid-cols-3 gap-2">
        <label className="text-[10px] text-white/40">HP <span className="text-white/25">({t.hp[0]}–{t.hp[1]})</span><input type="number" min={1} max={60} className={input} value={enemy.hp ?? ''} placeholder={String(st.hp)} onChange={e => onChange({ ...enemy, hp: numIn(e.target.value) })} /></label>
        <label className="text-[10px] text-white/40">Урон<input type="number" min={1} max={10} className={input} value={enemy.dmg ?? ''} placeholder={String(st.dmg)} onChange={e => onChange({ ...enemy, dmg: numIn(e.target.value) })} /></label>
        <label className="text-[10px] text-white/40">Сложность<input type="number" min={5} max={25} className={input} value={enemy.dc ?? ''} placeholder={String(st.dc)} onChange={e => onChange({ ...enemy, dc: numIn(e.target.value) })} /></label>
      </div>
      <textarea className={`${input} min-h-[50px]`} placeholder="Повадки и слабости: зовёт голосами родных, боится огня маяка" maxLength={400} value={enemy.traits} onChange={e => onChange({ ...enemy, traits: e.target.value })} />
    </Box>
  );
};

const RARITY: [NonNullable<WorldItem['rarity']>, string][] = [['common', 'Обычный'], ['uncommon', 'Необычный'], ['rare', 'Редкий'], ['epic', 'Легендарный']];

const ItemEditor: React.FC<{ item: WorldItem; onChange: (i: WorldItem) => void; onDelete: () => void }> = ({ item, onChange, onDelete }) => {
  const label = itemLabel({ ...item, name: item.name || 'Предмет' });
  return (
    <Box onDelete={onDelete}>
      <input className={input} placeholder="Свеча маяка" value={item.name} maxLength={60} onChange={e => onChange({ ...item, name: e.target.value })} />
      <div className="flex flex-wrap gap-1.5">{([['consumable', 'Расходник'], ['gear', 'Снаряжение'], ['misc', 'Прочее']] as const).map(([id, n]) => <button key={id} onClick={() => onChange({ ...item, kind: id })} className={chip(item.kind === id)}>{n}</button>)}</div>
      {item.kind === 'consumable' && <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-white/40">Лечит HP<input type="number" min={0} max={20} className={input} value={item.heal ?? ''} onChange={e => onChange({ ...item, heal: numIn(e.target.value) })} /></label>
        <label className="text-[10px] text-white/40">Снимает стресс<input type="number" min={0} max={5} className={input} value={item.calm ?? ''} onChange={e => onChange({ ...item, calm: numIn(e.target.value) })} /></label>
      </div>}
      {item.kind === 'gear' && <select className={input} value={item.bonus || ''} onChange={e => onChange({ ...item, bonus: e.target.value || undefined })}>
        <option value="">Без бонуса</option>
        {['атаке', 'защите', 'скрытности', 'внимательности', 'убеждению', 'магии', 'взлому', 'ловкости', 'лечению'].flatMap(w => [1, 2].map(n => `+${n} к ${w}`)).map(b => <option key={b} value={b}>{b}</option>)}
      </select>}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-white/40">Цена<input type="number" min={1} max={500} className={input} value={item.price ?? ''} onChange={e => onChange({ ...item, price: numIn(e.target.value) })} /></label>
        <label className="text-[10px] text-white/40">В добыче<select className={input} value={item.rarity || ''} onChange={e => onChange({ ...item, rarity: (e.target.value || undefined) as WorldItem['rarity'] })}><option value="">Не выпадает</option>{RARITY.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-white/50"><input type="checkbox" className="accent-amber-400" checked={!!item.inShop} disabled={!item.price} onChange={e => onChange({ ...item, inShop: e.target.checked || undefined })} /> Продаётся в лавках{!item.price ? ' (укажите цену)' : ''}</label>
      <p className="text-[11px] text-white/40">В игре: <span className="text-white/70">{label}</span>{item.kind === 'consumable' && describeEffect(label) ? ` · ${describeEffect(label)}` : ''}</p>
    </Box>
  );
};
