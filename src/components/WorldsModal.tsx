import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Copy, Pencil, Play, Link2, Globe2, Lock } from 'lucide-react';
import { api, appLink } from '../api';
import { customAlert, customConfirm } from './PromptModal';
import { ARCHETYPES } from '../../shared/archetypes';
import { WORLD_GENRES, LORE_KINDS, emptyWorldData, normalizeWorldData, type World, type WorldData, type LoreCard, type WorldHero, type WorldScenario, type WorldLocation } from '../../shared/world';

const input = 'w-full px-3 py-2 bg-black/40 border border-white/10 rounded-lg text-sm text-white placeholder-white/25 focus:outline-none focus:border-white/30';
const label = 'block text-[10px] uppercase tracking-widest font-bold text-white/40 mb-1';
const chip = (on: boolean) => `px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${on ? 'bg-white text-black' : 'bg-white/5 text-white/60 hover:text-white'}`;
const SERVICES: [string, string][] = [['market', 'рынок'], ['tavern', 'таверна'], ['inn', 'ночлег'], ['smith', 'кузня'], ['healer', 'лекарь'], ['questboard', 'доска заданий'], ['library', 'библиотека'], ['stables', 'конюшня'], ['dock', 'причал']];
const VIS_LABEL = { private: 'Только я', link: 'По ссылке', public: 'В каталоге' } as const;
const uid = () => Math.random().toString(36).slice(2, 9);

export const worldLink = (id: string) => appLink(`/world/${id}`);

export interface WorldStart { worldId: string; scenarioId?: string; title?: string; mode: 'short' | 'campaign' | 'tale'; characters: WorldHero[] }

/** Каталог миров: свои и общие; отсюда — редактор и запуск игры. */
export const WorldsModal: React.FC<{ onClose: () => void; onPlay: (s: WorldStart) => void; openId?: string; maxHeroes?: number }> = ({ onClose, onPlay, openId, maxHeroes = 4 }) => {
  const [tab, setTab] = useState<'mine' | 'public'>('mine');
  const [list, setList] = useState<World[] | null>(null);
  const [editing, setEditing] = useState<World | null>(null);
  const [playing, setPlaying] = useState<World | null>(null);
  const load = (t = tab) => { setList(null); api<World[]>(`/api/worlds?scope=${t}`).then(setList).catch(() => setList([])); };
  useEffect(() => { load(tab); }, [tab]);
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
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5 shrink-0">
          <button onClick={() => setTab('mine')} className={chip(tab === 'mine')}>Мои миры</button>
          <button onClick={() => setTab('public')} className={chip(tab === 'public')}>Каталог</button>
          <button onClick={() => setEditing(newWorld())} className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-400 text-black text-xs font-bold hover:bg-amber-300"><Plus size={14} /> Создать мир</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {list === null ? <p className="text-white/40 text-sm">Загружаем…</p> : list.length === 0 ? (
            <div className="text-sm text-white/55 leading-relaxed space-y-2 max-w-lg">
              {tab === 'mine' ? <>
                <p>Мир — это ваш сеттинг для ИИ-мастера: история, персонажи, места, фракции и готовые завязки. Мастер держит канон мира и подтягивает нужные карточки, когда о них заходит речь.</p>
                <p>Создайте мир, сыграйте в нём сами или поделитесь ссылкой с друзьями.</p>
              </> : <p>В каталоге пока пусто. Опубликуйте свой мир — переключите доступ на «В каталоге».</p>}
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
                    <div className="flex flex-wrap gap-1.5 mt-auto pt-1">
                      <button onClick={async () => setPlaying(await full(w))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-200 text-xs font-bold hover:bg-emerald-500/25"><Play size={12} /> Играть</button>
                      {w.mine && <button onClick={async () => setEditing(await full(w))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-white/70 text-xs hover:text-white"><Pencil size={12} /> Изменить</button>}
                      <button onClick={async () => { try { await api(`/api/worlds/${w.id}/copy`, { method: 'POST' }); setTab('mine'); load('mine'); } catch (e) { customAlert(e instanceof Error ? e.message : 'Ошибка'); } }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-white/70 text-xs hover:text-white" title="Копия в мои миры — можно переделать под себя"><Copy size={12} /> {w.mine ? 'Копия' : 'Ремикс'}</button>
                      {w.mine && <button onClick={async () => { if (await customConfirm(`Удалить мир «${w.title}»? Начатые игры сохранятся.`)) { await api(`/api/worlds/${w.id}`, { method: 'DELETE' }); load(); } }} className="ml-auto p-1.5 rounded-lg text-white/30 hover:text-red-300" aria-label="Удалить"><Trash2 size={14} /></button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {editing && <WorldEditor world={editing} onClose={() => setEditing(null)} onSaved={w => { setEditing(null); setTab('mine'); load('mine'); if (!editing.id) setPlaying(w); }} />}
      {playing && <WorldPlay world={playing} maxHeroes={maxHeroes} onClose={() => setPlaying(null)} onPlay={s => { setPlaying(null); onPlay(s); }} />}
    </div>,
    document.body,
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

type ETab = 'passport' | 'lore' | 'places' | 'scenarios' | 'heroes';

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
  const tabs: [ETab, string][] = [['passport', 'Паспорт'], ['lore', `Лор · ${d.cards.length}`], ['places', `Места · ${d.locations.length}`], ['scenarios', `Сюжеты · ${d.scenarios.length}`], ['heroes', `Герои · ${d.heroes.length}`]];

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
              <p className="text-[11px] text-white/35 mt-1.5">{w.visibility === 'private' ? 'Мир видите только вы.' : w.visibility === 'link' ? 'Играть может любой, у кого есть ссылка.' : 'Мир виден всем в каталоге, его можно сыграть и скопировать.'} Начатые игры не меняются, когда вы правите мир.</p>
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
              <button onClick={() => setD({ cards: [...d.cards, { id: uid(), kind: 'npc', name: '', keys: [], text: '' }] })} className="text-xs text-amber-300 flex items-center gap-1"><Plus size={12} /> Карточка</button>
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
