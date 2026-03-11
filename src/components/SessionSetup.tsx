import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Wand2, Swords, UserPlus, Trash2, X, Sparkles } from 'lucide-react';

export interface SetupData {
  setting: string;
  plotHook: string;
  style: string;
  characters: { id: string; name: string; concept: string; gender: string }[];
}

interface Props {
  onStart: (data: SetupData) => void;
  onCancel: () => void;
  onGenerate: (prompt: string) => Promise<string>;
}

const PREDEFINED_SETTINGS = [
  "Dark Fantasy", "Cyberpunk", "Space Opera", "Post-Apocalyptic", "Victorian Horror", "Weird West"
];

const GAME_STYLES = [
  { id: 'narrative', name: 'Narrative Focus', desc: 'Больше сюжета, загадок и общения. Бои редкие и сюжетные (10-15%).' },
  { id: 'balanced', name: 'Balanced', desc: 'Классический баланс между экшеном и историей (50/50).' },
  { id: 'combat', name: 'Combat Heavy', desc: 'Фокус на тактике, сражениях и механике. (80% боев).' },
  { id: 'fairytale', name: 'Сказка для детей', desc: 'Добрая, волшебная атмосфера. Без жестокости и мрака. Фокус на дружбе и чудесах.' },
];

export const SessionSetup: React.FC<Props> = ({ onStart, onCancel, onGenerate }) => {
  const [setting, setSetting] = useState('');
  const [plotHook, setPlotHook] = useState('');
  const [style, setStyle] = useState('balanced');
  const [characters, setCharacters] = useState<{ id: string; name: string; concept: string; gender: string }[]>([
    { id: Date.now().toString() + Math.random().toString(), name: '', concept: '', gender: 'М' }
  ]);
  
  const [isGenSetting, setIsGenSetting] = useState(false);
  const [settingPrompt, setSettingPrompt] = useState('');
  const [isGenPlot, setIsGenPlot] = useState(false);
  const [genCharId, setGenCharId] = useState<string | null>(null);

  const handleGenSetting = async () => {
    setIsGenSetting(true);
    try {
      const basePrompt = "Придумай короткий, необычный и атмосферный сеттинг для НРИ (1-2 предложения).";
      const userPrompt = settingPrompt.trim() ? ` Направление/идея от игрока: "${settingPrompt}".` : "";
      const res = await onGenerate(basePrompt + userPrompt);
      setSetting(res.replace(/["*]/g, ''));
    } catch (e) { 
      console.error(e);
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      alert(`Ошибка генерации сеттинга: ${msg}`);
    }
    setIsGenSetting(false);
  };

  const handleGenPlot = async () => {
    setIsGenPlot(true);
    try {
      const res = await onGenerate(`Придумай интригующую завязку сюжета (plot hook) для НРИ в сеттинге: ${setting || 'Любой'}. (1-2 предложения).`);
      setPlotHook(res.replace(/["*]/g, ''));
    } catch (e) { 
      console.error(e);
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      alert(`Ошибка генерации сюжета: ${msg}`);
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
    try {
      const res = await onGenerate(`Придумай имя и краткий концепт (класс/профессия/особенность) для персонажа в сеттинге: ${setting || 'Любой'}. Пол персонажа: ${genderStr}. Ответь СТРОГО в формате "Имя: Концепт" без лишних слов. Пример: "Гаррет: Вор-тень из трущоб"`);
      
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
      
      setCharacters(chars => chars.map(c => c.id === id ? { ...c, name, concept } : c));
    } catch (e) { 
      console.error(e);
      alert("Ошибка генерации персонажа.");
    }
    setGenCharId(null);
  };

  const handleStart = () => {
    if (!setting.trim()) {
      alert("Пожалуйста, укажите сеттинг!");
      return;
    }
    const validChars = characters.filter(c => c.name.trim() && c.concept.trim());
    if (validChars.length === 0) {
      alert("Добавьте хотя бы одного персонажа с именем и концептом!");
      return;
    }
    onStart({ setting, plotHook, style, characters: validChars });
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
          Создание Кампании
        </h2>
        <button onClick={onCancel} className="text-white/40 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="p-6 space-y-8 overflow-y-auto">
        {/* Setting Section */}
        <section className="space-y-3">
          <div className="flex justify-between items-end">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Сеттинг / Мир</label>
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
            {PREDEFINED_SETTINGS.map(s => (
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
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Завязка сюжета (Plot Hook)</label>
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

        {/* Game Style Section */}
        <section className="space-y-3">
          <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Стиль Игры</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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

        {/* Characters Section */}
        <section className="space-y-4">
          <div className="flex justify-between items-end border-b border-white/10 pb-2">
            <label className="text-xs uppercase tracking-widest text-white/40 font-bold">Персонажи</label>
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
                <div className="flex-1 space-y-3">
                  <div className="flex gap-3">
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
                      className="w-1/3 bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                    <input 
                      type="text"
                      value={char.concept}
                      onChange={e => setCharacters(chars => chars.map(c => c.id === char.id ? { ...c, concept: e.target.value } : c))}
                      placeholder="Концепт (напр. Угрюмый дворф-наемник)"
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
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
          className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl flex items-center gap-2 transition-all shadow-[0_0_20px_rgba(5,150,105,0.3)] hover:shadow-[0_0_30px_rgba(5,150,105,0.5)]"
        >
          <Swords size={18} />
          Начать Приключение
        </button>
      </div>
    </motion.div>
  );
};
