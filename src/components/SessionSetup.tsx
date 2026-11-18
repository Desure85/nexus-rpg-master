import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Wand2, Swords, UserPlus, Trash2, X, Sparkles } from 'lucide-react';
import { ARCHETYPES } from '../../shared/archetypes';
import { api } from '../api';
import { customAlert } from './PromptModal';

export type SessionMode = 'short' | 'campaign' | 'tale';

export interface SetupData {
  setting: string;
  plotHook: string;
  style: string;
  mode: SessionMode;
  title?: string;
  characters: { id: string; name: string; concept: string; gender: string; archetype?: string; veteranId?: string }[];
  multiplayer?: boolean;
  autoApprove?: boolean;
  tale?: { age: string; chapters: number; moral?: string };
}

interface Props {
  preset?: { mode: SessionMode; multiplayer: boolean };
  taleAges?: { id: string; name: string; desc: string }[];
  onStart: (data: SetupData) => void | Promise<void>;
  onCancel: () => void;
  onGenerate: (prompt: string) => Promise<string>;
}

const TALE_SETTINGS = ["Волшебный лес", "Подводное царство", "Город игрушек", "Облачное королевство", "Зимняя сказка", "Космос и звёзды"];

const PREDEFINED_SETTINGS = [
  "Тёмное фэнтези", "Киберпанк", "Космоопера", "Постапокалипсис", "Викторианский хоррор", "Мистический Дикий Запад"
];

const GAME_STYLES = [
  { id: 'narrative', name: 'Упор на сюжет', desc: 'Больше сюжета, загадок и общения. Бои редкие и сюжетные (10-15%).' },
  { id: 'balanced', name: 'Баланс', desc: 'Классический баланс между экшеном и историей (50/50).' },
  { id: 'combat', name: 'Упор на бои', desc: 'Фокус на тактике, сражениях и механике. (80% боев).' },
  { id: 'fairytale', name: 'Сказка для детей', desc: 'Добрая, волшебная атмосфера. Без жестокости и мрака. Фокус на дружбе и чудесах.' },
];

export const SessionSetup: React.FC<Props> = ({ preset, taleAges = [], onStart, onCancel, onGenerate }) => {
  const [setting, setSetting] = useState('');
  const [plotHook, setPlotHook] = useState('');
  const [mode, setMode] = useState<SessionMode>(preset?.mode || 'short');
  const [style, setStyle] = useState(preset?.mode === 'tale' ? 'fairytale' : 'balanced');
  const [multiplayer, setMultiplayer] = useState(!!preset?.multiplayer);
  const [autoApprove, setAutoApprove] = useState(false);
  const [taleAge, setTaleAge] = useState('6-8');
  const [taleChapters, setTaleChapters] = useState(6);
  const [taleMoral, setTaleMoral] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const isTale = mode === 'tale';
  const [veterans, setVeterans] = useState<{ id: string; name: string; concept: string; gender: string; archetype?: string; level: number; adventures: number }[]>([]);
  useEffect(() => { api<any[]>('/api/heroes').then(setVeterans).catch(() => undefined); }, []);
  const [characters, setCharacters] = useState<{ id: string; name: string; concept: string; gender: string; archetype?: string; veteranId?: string }[]>([
    { id: Date.now().toString() + Math.random().toString(), name: '', concept: '', gender: 'М' }
  ]);
  
  const [isGenSetting, setIsGenSetting] = useState(false);
  const [settingPrompt, setSettingPrompt] = useState('');
  const [isGenPlot, setIsGenPlot] = useState(false);
  const [genCharId, setGenCharId] = useState<string | null>(null);

  const handleGenSetting = async () => {
    setIsGenSetting(true);
    try {
      const basePrompt = isTale
        ? `Придумай волшебный мир для сказки (1-2 предложения) для слушателей ${taleAge === 'adult' ? 'взрослых' : `${taleAge} лет`}.`
        : "Придумай короткий, необычный и атмосферный сеттинг для НРИ (1-2 предложения).";
      const userPrompt = settingPrompt.trim() ? ` Направление/идея от игрока: "${settingPrompt}".` : "";
      const res = await onGenerate(basePrompt + userPrompt);
      setSetting(res.replace(/["*]/g, ''));
    } catch (e) { 
      console.error(e);
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      void customAlert(`Ошибка генерации сеттинга: ${msg}`);
    }
    setIsGenSetting(false);
  };

  const handleGenPlot = async () => {
    setIsGenPlot(true);
    try {
      const res = await onGenerate(isTale
        ? `Придумай завязку сказки (1-2 предложения) в мире: ${setting || 'Любой'}. Что за чудесная проблема стоит перед героями?`
        : `Придумай интригующую завязку сюжета (plot hook) для НРИ в сеттинге: ${setting || 'Любой'}. (1-2 предложения).`);
      setPlotHook(res.replace(/["*]/g, ''));
    } catch (e) { 
      console.error(e);
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      void customAlert(`Ошибка генерации сюжета: ${msg}`);
    }
    setIsGenPlot(false);
  };

  const handleAddChar = () => {
    setCharacters([...characters, { id: Date.now().toString() + Math.random().toString(), name: '', concept: '', gender: 'М' }]);
  };

  const handleRemoveChar = (id: string) => {
    setCharacters(characters.filter(c => c.id !== id));
  };

  const handleGenChar = async (id: string) => {
    setGenCharId(id);
    const char = characters.find(c => c.id === id);
    const genderStr = char?.gender === 'Ж' ? 'Женщина' : 'Мужчина';
    const taken = characters.filter(c => c.id !== id && c.name.trim()).map(c => c.name.trim());
    const avoid = taken.length ? ` Имя не должно совпадать с: ${taken.join(', ')}.` : '';
    try {
      const res = await onGenerate(isTale
        ? `Придумай сказочного героя для мира: ${setting || 'Любой'}. Пол: ${genderStr}. Ответь СТРОГО в формате "Имя: Концепт" без лишних слов. Пример: "Ёжик Тимоша: Любопытный и очень храбрый"${avoid}`
        : `Придумай имя и краткий концепт (класс/профессия/особенность) для персонажа в сеттинге: ${setting || 'Любой'}. Пол персонажа: ${genderStr}. Ответь СТРОГО в формате "Имя: Концепт" без лишних слов. Пример: "Гаррет: Вор-тень из трущоб"${avoid}`);
      
      // Clean up the response first (remove markdown bold, quotes, etc)
      const cleanRes = res.replace(/[*"']/g, '').trim();
      
      // Try to split by common separators
      let parts = cleanRes.split(':');
      if (parts.length < 2) {
        parts = cleanRes.split(' - ');
      }
      if (parts.length < 2) {
        parts = cleanRes.split('—');
      }
      
      let name = 'Hero';
      let concept = 'Unknown';
      
      if (parts.length >= 2) {
        name = parts[0].trim();
        concept = parts.slice(1).join(':').trim();
      } else {
        // Fallback if AI completely ignored the format
        name = cleanRes.split(' ')[0] || 'Hero';
        concept = cleanRes.substring(name.length).trim() || 'Unknown';
      }
      
      // модель всё же повторилась — добавляем прозвище, чтобы игроки не путались
      const suffixes = ['Младший', 'Второй', 'из Пустошей', 'Тихий', 'Рыжий'];
      let finalName = name, k = 0;
      while (taken.some(t => t.toLowerCase() === finalName.toLowerCase()) && k < suffixes.length) finalName = `${name} ${suffixes[k++]}`;
      setCharacters(chars => chars.map(c => c.id === id ? { ...c, name: finalName, concept } : c));
    } catch (e) { 
      console.error(e);
      void customAlert("Ошибка генерации персонажа.");
    }
    setGenCharId(null);
  };

  const handleStart = async () => {
    if (!setting.trim()) {
      void customAlert(isTale ? "Опишите мир сказки!" : "Пожалуйста, укажите сеттинг!");
      return;
    }
    const validChars = characters.filter(c => c.veteranId || (c.name.trim() && (isTale || c.concept.trim())));
    if (validChars.length === 0) {
      void customAlert(isTale ? "Добавьте хотя бы одного героя сказки!" : "Добавьте хотя бы одного персонажа с именем и концептом!");
      return;
    }
    if (new Set(validChars.map(c => c.name.trim())).size !== validChars.length) {
      void customAlert("Имена героев должны различаться.");
      return;
    }
    setIsStarting(true);
    try {
      await onStart({
        setting, plotHook, style: isTale ? 'fairytale' : style, mode, characters: validChars.map(c => ({ ...c, name: c.name.trim(), concept: c.concept.trim() })),
        multiplayer, autoApprove,
        tale: isTale ? { age: taleAge, chapters: taleChapters, moral: taleMoral.trim() || undefined } : undefined,
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl w-full mx-auto bg-[#0a0502] border border-white/10 rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
      <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5 shrink-0">
        <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
          <Sparkles className="text-emerald-400" size={20} />
          {isTale ? 'Новая сказка' : 'Новое приключение'}
        </h2>
        <button onClick={onCancel} className="text-white/40 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="p-6 space-y-8 overflow-y-auto">
        {/* Setting Section */}
        <section className="space-y-3">
          <div className="flex justify-between items-end">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">{isTale ? 'Мир сказки' : 'Сеттинг / Мир'}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={settingPrompt}
                onChange={e => setSettingPrompt(e.target.value)}
                placeholder="Направление (напр. киберпанк с магией)"
                className="bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white focus:outline-none focus:border-emerald-500/50 w-48"
              />
              <button 
                onClick={handleGenSetting}
                disabled={isGenSetting}
                className="text-[10px] uppercase tracking-widest text-emerald-400 hover:text-emerald-300 flex items-center gap-1 disabled:opacity-50"
              >
                <Wand2 size={12} /> {isGenSetting ? 'Генерация...' : 'Сгенерировать ИИ'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            {(isTale ? TALE_SETTINGS : PREDEFINED_SETTINGS).map(s => (
              <button
                key={s}
                onClick={() => setSetting(s)}
                className={`px-3 py-1 rounded-full text-xs border ${setting === s ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <textarea 
            value={setting}
            onChange={e => setSetting(e.target.value)}
            placeholder="Опишите мир, в котором будет происходить игра..."
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50 resize-none h-24"
          />
        </section>

        {/* Plot Hook Section */}
        <section className="space-y-3">
          <div className="flex justify-between items-end">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">{isTale ? 'Завязка (необязательно)' : 'Завязка сюжета'}</label>
            <button 
              onClick={handleGenPlot}
              disabled={isGenPlot}
              className="text-[10px] uppercase tracking-widest text-emerald-400 hover:text-emerald-300 flex items-center gap-1 disabled:opacity-50"
            >
              <Wand2 size={12} /> {isGenPlot ? 'Генерация...' : 'Сгенерировать ИИ'}
            </button>
          </div>
          <textarea 
            value={plotHook}
            onChange={e => setPlotHook(e.target.value)}
            placeholder="С чего начинается история? Какая проблема стоит перед героями?"
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50 resize-none h-24"
          />
        </section>

        {/* Session Format Section */}
        <section className="space-y-3">
          <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Формат</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {([
              { id: 'short', title: '⚡ Партия на вечер', desc: '1 сессия на 2-3 часа. Без идл-механик и базы.' },
              { id: 'campaign', title: '🗺️ Кампания', desc: 'Много сессий: идл-доход, логово, экспедиции, долгая прокачка.' },
              { id: 'tale', title: '📖 Сказка', desc: 'История с выборами без кубиков и цифр. В конце — книга.' },
            ] as const).map(opt => (
              <button
                key={opt.id}
                onClick={() => { setMode(opt.id); if (opt.id === 'tale') setStyle('fairytale'); else if (style === 'fairytale' && mode === 'tale') setStyle('balanced'); }}
                className={`p-4 rounded-xl border text-left transition-all ${mode === opt.id ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-black/40 border-white/10 hover:border-white/30'}`}
              >
                <div className={`text-sm font-bold mb-1 ${mode === opt.id ? 'text-emerald-400' : 'text-white'}`}>{opt.title}</div>
                <div className="text-[10px] text-white/60 leading-tight">{opt.desc}</div>
              </button>
            ))}
          </div>
        </section>

        {isTale ? (
          <section className="space-y-4">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Для кого сказка</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {taleAges.map(a => (
                <button
                  key={a.id}
                  onClick={() => setTaleAge(a.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${taleAge === a.id ? 'bg-amber-400/10 border-amber-400/50' : 'bg-black/40 border-white/10 hover:border-white/30'}`}
                >
                  <div className={`text-sm font-bold ${taleAge === a.id ? 'text-amber-300' : 'text-white'}`}>{a.name}</div>
                  <div className="text-[10px] text-white/50 leading-tight mt-1">{a.desc}</div>
                </button>
              ))}
            </div>
            <div className="flex flex-col md:flex-row gap-4">
              <label className="flex-1 space-y-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Глав: {taleChapters}</span>
                <input type="range" min={3} max={12} value={taleChapters} onChange={e => setTaleChapters(Number(e.target.value))} className="w-full accent-amber-400" />
              </label>
              <label className="flex-[2] space-y-2">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">Чему научит (необязательно)</span>
                <input value={taleMoral} onChange={e => setTaleMoral(e.target.value)} placeholder="напр. Делиться — это здорово" className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-amber-400/50" />
              </label>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Стиль Игры</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {GAME_STYLES.map(s => (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  className={`p-4 rounded-xl border text-left transition-all ${style === s.id ? 'bg-emerald-500/10 border-emerald-500/50' : 'bg-black/40 border-white/10 hover:border-white/30'}`}
                >
                  <div className={`text-sm font-bold mb-1 ${style === s.id ? 'text-emerald-400' : 'text-white'}`}>
                    {s.name}
                  </div>
                  <div className="text-[10px] text-white/60 leading-tight">
                    {s.desc}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Multiplayer */}
        <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" className="accent-emerald-500 w-4 h-4" checked={multiplayer} onChange={e => setMultiplayer(e.target.checked)} />
            <span className="text-sm text-white font-medium">Играть с друзьями онлайн</span>
          </label>
          <p className="text-[10px] text-white/40 leading-relaxed pl-7">
            {isTale
              ? 'Друзья откроют ссылки своих героев и будут предлагать, что делать дальше. Вы собираете их идеи и продолжаете сказку.'
              : 'Каждый игрок получит ссылку на своего героя и будет ходить со своего устройства. Вы подтверждаете раунд — ИИ отвечает всем сразу.'}
          </p>
          {multiplayer && (
            <label className="flex items-center gap-3 cursor-pointer pl-7">
              <input type="checkbox" className="accent-emerald-500" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
              <span className="text-xs text-white/70">Пускать по ссылке без подтверждения</span>
            </label>
          )}
        </section>

        {/* Characters Section */}
        <section className="space-y-4">
          <div className="flex justify-between items-end border-b border-white/10 pb-2">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">{isTale ? 'Герои сказки' : 'Персонажи'}</label>
            <button 
              onClick={handleAddChar}
              className="text-[10px] uppercase tracking-widest text-white/60 hover:text-white flex items-center gap-1"
            >
              <UserPlus size={12} /> Добавить
            </button>
          </div>
          
          <div className="space-y-3">
            {characters.map((char, index) => (
              <div key={char.id} className="flex gap-3 items-start bg-white/5 p-3 rounded-xl border border-white/5">
                <div className="flex-1 min-w-0 space-y-3">
                  <div className="flex flex-wrap sm:flex-nowrap gap-2 sm:gap-3">
                    <div className="flex bg-black/40 border border-white/10 rounded-lg p-1">
                      <button
                        onClick={() => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, gender: 'М' } : c))}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${char.gender === 'М' ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/40 hover:text-white/80'}`}
                      >
                        М
                      </button>
                      <button
                        onClick={() => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, gender: 'Ж' } : c))}
                        className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${char.gender === 'Ж' ? 'bg-emerald-500/20 text-emerald-400' : 'text-white/40 hover:text-white/80'}`}
                      >
                        Ж
                      </button>
                    </div>
                    <input 
                      type="text"
                      value={char.name}
                      onChange={e => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, name: e.target.value } : c))}
                      placeholder="Имя персонажа"
                      className="flex-1 sm:flex-none min-w-0 sm:w-1/3 bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                    <input 
                      type="text"
                      value={char.concept}
                      onChange={e => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, concept: e.target.value } : c))}
                      placeholder={isTale ? 'Какой он? (напр. Любопытный зайчонок)' : 'Концепт (напр. Угрюмый дворф-наемник)'}
                      className="w-full sm:w-auto sm:flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  {!isTale && (
                    <div className="flex flex-wrap gap-1.5">
                      {ARCHETYPES.map(a => (
                        <button
                          key={a.id}
                          onClick={() => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, archetype: c.archetype === a.id ? undefined : a.id } : c))}
                          title={`${a.pitch}. HP ${a.hp}, жетонов ${a.tokens}, золота ${a.gold}. «${a.ability.name}»: ${a.ability.bonus}. ${a.ability.desc}`}
                          className={`px-2 py-1 rounded-full text-[11px] border transition-all ${char.archetype === a.id ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200' : 'border-white/10 text-white/50 hover:text-white'}`}
                        >{a.icon} {a.name}</button>
                      ))}
                      {veterans.length > 0 && (
                        <select
                          value={char.veteranId || ''}
                          onChange={e => {
                            const v = veterans.find(h => h.id === e.target.value);
                            setCharacters(chars => chars.map(c => c.id === char.id ? (v ? { ...c, veteranId: v.id, name: v.name, concept: v.concept, gender: v.gender, archetype: v.archetype } : { ...c, veteranId: undefined }) : c));
                          }}
                          className="px-2 py-1 rounded-full text-[11px] bg-amber-400/10 border border-amber-400/30 text-amber-100"
                          title="Взять героя из зала: он придёт со своим опытом, способностями и вещами"
                        >
                          <option value="">🎖️ Ветеран из зала…</option>
                          {veterans.map(h => <option key={h.id} value={h.id}>{h.name} · ур. {h.level} · приключений: {h.adventures}</option>)}
                        </select>
                      )}
                    </div>
                  )}
                  {!isTale && char.archetype && (() => {
                    const a = ARCHETYPES.find(x => x.id === char.archetype)!;
                    return <p className="text-[11px] text-white/45">{a.icon} <b className="text-white/70">{a.name}</b>: HP {a.hp} · жетонов {a.tokens} · 🪙 {a.gold} · «{a.ability.name}» ({a.ability.bonus}) — {a.ability.desc}</p>;
                  })()}
                </div>
                <div className="flex flex-col gap-2 pt-1">
                  <button 
                    onClick={() => handleGenChar(char.id)}
                    disabled={genCharId === char.id}
                    title="Сгенерировать персонажа"
                    className="p-2 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Wand2 size={14} />
                  </button>
                  <button 
                    onClick={() => handleRemoveChar(char.id)}
                    disabled={characters.length === 1}
                    title="Удалить"
                    className="p-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="p-6 border-t border-white/10 bg-black/40 flex justify-end shrink-0">
        <button 
          onClick={handleStart}
          disabled={isStarting}
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(5,150,105,0.3)] hover:shadow-[0_0_30px_rgba(5,150,105,0.5)]"
        >
          <Swords size={18} />
          {isStarting ? 'Начинаем...' : isTale ? 'Начать сказку' : 'Начать приключение'}
        </button>
      </div>
    </motion.div>
  );
};
