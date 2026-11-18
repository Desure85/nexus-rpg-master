import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { GameSession, Character, DashboardData, MechanicConfig, stressValue, itemName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Shield, Zap, Target, Wind, AlertTriangle, RotateCcw, ZapOff, MessageSquarePlus, Trash2, Plus, Send, LayoutDashboard, Library, History, User, BookOpen, Type } from 'lucide-react';
import { Codex } from './Codex';
import { isUsableItem } from './Dashboard';
import { DisclaimerFooter } from './Disclaimer';
import { api, ApiError, useSessionSocket, characterLink, type SocketEvent } from '../api';
import { cleanStreamForDisplay, displayUserContent } from '../../shared/parse';

export const CharacterView: React.FC = () => {
  const { sessionId, charName: rawCharName } = useParams<{ sessionId: string; charName: string }>();
  const [session, setSession] = useState<GameSession | null>(null);
  const [loadError, setLoadError] = useState('');
  const [character, setCharacter] = useState<Character | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [mechanics, setMechanics] = useState<MechanicConfig[]>([]);
  const [actionInput, setActionInput] = useState('');
  const [rollType, setRollType] = useState<'' | 'classic' | 'triple' | 'shifted' | 'taint'>('');
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'character' | 'scene' | 'story' | 'lore' | 'codex'>('character');
  const [isBookView, setIsBookView] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [masterBusy, setMasterBusy] = useState(false);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // --- Multiplayer: claim (закрепление персонажа за игроком) ---
  const [claimState, setClaimState] = useState<'loading' | 'unclaimed' | 'pending' | 'approved' | 'rejected' | 'other'>('loading');
  const [claimOwner, setClaimOwner] = useState('');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('nexus_player_name') || '');
  const [myPending, setMyPending] = useState<string | null>(null);

  // Decode character name safely (handle both Base64 and legacy URI encoded)
  const charName = React.useMemo(() => {
    if (!rawCharName) return '';
    try {
      return decodeURIComponent(escape(atob(decodeURIComponent(rawCharName))));
    } catch (e) {
      return decodeURIComponent(rawCharName);
    }
  }, [rawCharName]);

  const isTale = session?.mode === 'tale';

  const fetchPending = async () => {
    try {
      const pending = await api<any[]>(`/api/sessions/${sessionId}/pending`);
      setMyPending(pending.find((p: any) => p.char_name === charName)?.action_text ?? null);
    } catch (e) { console.error("Pending fetch error", e); }
  };

  const fetchClaims = async () => {
    try {
      const claims = await api<any[]>(`/api/sessions/${sessionId}/claims`);
      const forChar = claims.filter((c: any) => c.char_name === charName);
      const mine = forChar.filter((c: any) => c.mine).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      const other = forChar.find((c: any) => !c.mine && c.status === 'approved');
      if (mine?.status === 'approved') setClaimState('approved');
      else if (other) { setClaimState('other'); setClaimOwner(other.player_name); }
      else if (mine?.status === 'pending') setClaimState('pending');
      else if (mine?.status === 'rejected') setClaimState('rejected');
      else setClaimState('unclaimed');
    } catch (e) { console.error("Claims fetch error", e); }
  };

  const submitClaim = async () => {
    const name = playerName.trim();
    if (!name) return;
    localStorage.setItem('nexus_player_name', name);
    try {
      const data = await api<any>(`/api/sessions/${sessionId}/claim`, { body: { charName, playerName: name } });
      if (data.status === 'pending' || data.status === 'approved') setClaimState(data.status);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'claimed_by_other') fetchClaims();
      else alert(`Не удалось занять персонажа: ${e instanceof Error ? e.message : e}`);
    }
  };

  const fetchData = async () => {
    try {
      const data = await api<GameSession>(`/api/sessions/${sessionId}`);
      const history = data.history || [];
      const lastDashboard = history.slice().reverse().find((m: any) => m.dashboard)?.dashboard || null;
      setSession(data);
      setMasterBusy(!!data.busy);
      setDashboard(lastDashboard);
      setCharacter(lastDashboard?.characters?.find((c: any) => c.name === charName) || null);
      if (data.config?.mechanics) setMechanics(data.config.mechanics);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить сессию');
    }
  };

  const fetchSettings = async () => {
    if (mechanics.length) return;
    try {
      const data = await api<any>('/api/settings');
      if (Array.isArray(data.mechanics)) setMechanics(prev => prev.length ? prev : data.mechanics);
    } catch (e) { console.error("Fetch settings error", e); }
  };

  const isMechanicEnabled = (id: string) => {
    if (mechanics.length === 0) return true;
    const mech = mechanics.find(m => m.id === id);
    return mech ? mech.enabled : true;
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    fetchClaims();
    fetchPending();
  }, [sessionId, charName]);

  useEffect(() => { if (isTale) setActiveTab(t => (t === 'character' ? 'story' : t)); }, [isTale]);

  useSessionSocket(sessionId, (ev: SocketEvent) => {
    switch (ev.type) {
      case 'joined':
      case 'busy':
        setMasterBusy(ev.busy);
        if (!ev.busy) setStreamingText(null);
        break;
      case 'turn_start': setStreamingText(''); break;
      case 'delta': setStreamingText(prev => (prev ?? '') + ev.text); break;
      case 'turn_end':
      case 'turn_error': setStreamingText(null); break;
      case 'update': fetchData(); break;
      case 'claims_changed':
      case 'actions_changed': fetchClaims(); fetchPending(); break;
    }
  }, () => { fetchData(); fetchClaims(); fetchPending(); });

  useEffect(() => {
    if (activeTab === 'story') chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session?.history.length, activeTab, streamingText === null]);

  const handleManualRefresh = () => { fetchData(); fetchClaims(); fetchPending(); };

  const hasActed = myPending !== null;

  const sendAction = async (actionText: string = actionInput) => {
    if (!actionText.trim() || !session || isSending || hasActed || claimState !== 'approved') return;
    setIsSending(true);
    try {
      await api(`/api/sessions/${sessionId}/actions`, { body: { charName, action: actionText.trim(), roll: !isTale && rollType ? rollType : undefined } });
      setActionInput('');
      fetchPending();
    } catch (e) {
      alert(`Не удалось отправить: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    } finally {
      setIsSending(false);
    }
  };

  const lastAssistant = session?.history.slice().reverse().find(m => m.role === 'assistant');
  const taleChoices = isTale && !session?.config?.tale?.finished ? (lastAssistant?.choices || []) : [];

  if (!character || !dashboard || !session) {
    const others = dashboard?.characters?.map(c => c.name).filter(n => n !== charName) || [];
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0502] text-white font-sans space-y-4 p-6 text-center">
        {!session && !loadError ? (
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-amber-400"></div>
        ) : null}
        <p className="text-white/60 italic">
          {loadError ? loadError : session ? `Персонажа «${charName}» пока нет в этой сессии.` : 'Загружаем...'}
        </p>
        {session && others.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-white/40">Другие герои этой сессии:</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {others.map(n => (
                <a key={n} href={characterLink(session.id, n)} className="px-3 py-1.5 bg-white/10 rounded-lg text-sm hover:bg-white/20">{n}</a>
              ))}
            </div>
          </div>
        )}
        {session && <button onClick={handleManualRefresh} className="text-xs text-amber-400">Обновить</button>}
      </div>
    );
  }

  if (claimState !== 'approved') {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-[#0a0502] text-white p-6">
        <div className="max-w-sm w-full text-center space-y-6">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tighter">{charName}</h1>
            <p className="text-white/40 text-[10px] mt-1 uppercase tracking-widest">Подключение к сессии</p>
          </div>
          {claimState === 'loading' && (
            <div className="flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-amber-400" /></div>
          )}
          {(claimState === 'unclaimed' || claimState === 'rejected') && (
            <div className="space-y-4">
              {claimState === 'rejected' && (
                <p className="text-sm text-red-400">Мастер отклонил предыдущую заявку. Попробуй снова.</p>
              )}
              <p className="text-sm text-white/60 leading-relaxed">
                Чтобы играть этим персонажем — назови себя. Мастер подтвердит заявку.
              </p>
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Твоё имя"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:border-amber-400/50 transition-all text-center"
              />
              <button
                onClick={submitClaim}
                disabled={!playerName.trim()}
                className="w-full py-3 bg-amber-400 text-black rounded-xl font-bold hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Запросить персонажа
              </button>
            </div>
          )}
          {claimState === 'pending' && (
            <div className="space-y-3">
              <p className="text-amber-400 text-sm font-bold animate-pulse">Заявка отправлена</p>
              <p className="text-sm text-white/50">Ждём, пока Мастер подтвердит, что ты играешь {charName}.</p>
            </div>
          )}
          {claimState === 'other' && (
            <div className="space-y-3">
              <p className="text-sm text-white/50">Этот персонаж уже занят игроком</p>
              <p className="text-amber-400 font-bold text-lg">«{claimOwner}»</p>
              <p className="text-xs text-white/30">Попроси Мастера освободить персонажа или выбери другого.</p>
            </div>
          )}
          <DisclaimerFooter audience="player" className="pt-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-[#0a0502] text-white font-sans overflow-hidden">
      {/* Top Navigation */}
      <div className="flex border-b border-white/5 p-2 bg-black/40 backdrop-blur-md shrink-0 gap-2 overflow-x-auto">
        <button 
          onClick={handleManualRefresh}
          className="flex items-center justify-center p-3 rounded-xl text-white/40 hover:text-white bg-white/5 hover:bg-white/10 transition-all"
          title="Refresh Data"
        >
          <RotateCcw size={14} />
        </button>
        <button 
          onClick={() => setActiveTab('character')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'character' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <User size={14} /> {isTale ? 'Герой' : 'Персонаж'}
        </button>
        {!isTale && <button 
          onClick={() => setActiveTab('scene')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'scene' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <LayoutDashboard size={14} /> Сцена
        </button>}
        <button 
          onClick={() => setActiveTab('story')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'story' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <BookOpen size={14} /> {isTale ? 'Сказка' : 'История'}
          {masterBusy && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
        </button>
        <button 
          onClick={() => setActiveTab('lore')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'lore' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <History size={14} /> {isTale ? 'Память' : 'Лор'}
        </button>
        {!isTale && <button 
          onClick={() => setActiveTab('codex')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'codex' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <Library size={14} /> Кодекс
        </button>}
        <div className="flex items-center gap-1 border-l border-white/10 pl-2 ml-2">
          <button 
            onClick={() => setFontSize(Math.max(12, fontSize - 2))}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
            title="Decrease Font Size"
          >
            <Type size={12} />
          </button>
          <button 
            onClick={() => setFontSize(Math.min(24, fontSize + 2))}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-all"
            title="Increase Font Size"
          >
            <Type size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 lg:p-8" style={{ fontSize: `${fontSize}px` }}>
        <div className="max-w-2xl mx-auto space-y-8 pb-32">
          {activeTab === 'character' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              {/* Header */}
              <header className="flex justify-between items-end border-b border-white/10 pb-6">
                <div>
                  <h1 className="text-4xl font-display font-bold tracking-tighter">{character.name}</h1>
                  <p className="text-amber-400/60 uppercase tracking-widest text-[10px] font-bold mt-1">{character.goal}</p>
                </div>
                <div className="text-right">
                  {!isTale && isMechanicEnabled('condition') && (
                    <>
                      <p className="text-[10px] uppercase tracking-widest text-white/20 font-bold mb-1">Состояние</p>
                      <p className="text-sm italic text-orange-300">{character.condition}</p>
                    </>
                  )}
                </div>
              </header>

              {/* Stats */}
              {!isTale && <div className="grid grid-cols-2 gap-6">
                {isMechanicEnabled('hp') && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/40">
                      <span>Здоровье</span>
                      <span className="text-emerald-400">{character.hp}</span>
                    </div>
                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-500" 
                        style={{ width: `${Math.max(0, Math.min(100, ((parseInt(String(character.hp).split('/')[0]) || 0) / (parseInt(String(character.hp).split('/')[1]) || 1)) * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                {isMechanicEnabled('stress') && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/40">
                      <span>Стресс</span>
                      <span className="text-orange-400">{character.stress}/10</span>
                    </div>
                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-orange-500 transition-all duration-500" 
                        style={{ width: `${Math.min(100, (stressValue(character.stress) / 10) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>}

              {/* Tokens */}
              {!isTale && isMechanicEnabled('tokens') && (
                <div className="p-4 bg-amber-400/5 border border-amber-400/20 rounded-2xl flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400/60 font-bold">Жетоны судьбы</span>
                  <div className="flex gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-4 h-4 rounded-full transition-all ${
                          i < character.tokens 
                            ? 'bg-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]' 
                            : 'bg-white/5 border border-white/10'
                        }`} 
                      />
                    ))}
                  </div>
                </div>
              )}

              {character.status === 'downed' && (
                <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-200">
                  💀 <b>Герой повержен.</b> Ходить нельзя, пока союзник не стабилизирует его (жетон, зелье или помощь). Мастер уже знает.
                </div>
              )}

              {masterBusy && (
                <div className="p-3 bg-amber-400/5 border border-amber-400/20 rounded-xl text-xs text-amber-200 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> {isTale ? 'Сказочник пишет новую главу...' : 'Мастер обдумывает ход...'}
                  <button onClick={() => setActiveTab('story')} className="ml-auto underline">Читать</button>
                </div>
              )}

              {taleChoices.length > 0 && (
                <section className="space-y-2">
                  <h3 className="text-[10px] uppercase tracking-widest text-amber-400/70 font-bold">Что предложишь?</h3>
                  {taleChoices.map((c, i) => (
                    <button key={i} onClick={() => sendAction(c)} disabled={hasActed || isSending} className="w-full text-left p-3 bg-amber-400/5 border border-amber-400/20 rounded-xl text-sm text-amber-100 hover:bg-amber-400/15 disabled:opacity-40 transition-all">
                      {c}
                    </button>
                  ))}
                </section>
              )}

              {/* Custom Action */}
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <MessageSquarePlus size={12} /> {isTale ? 'Свой вариант' : 'Своё действие'}
                </h3>
                <div className="flex gap-2">
                  <textarea
                    value={actionInput}
                    onChange={(e) => setActionInput(e.target.value)}
                    placeholder={isTale ? 'Что сделает твой герой?' : 'Опиши действие...'}
                    disabled={hasActed || isSending}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all resize-none h-20"
                  />
                  <button
                    onClick={() => sendAction()}
                    disabled={!actionInput.trim() || hasActed || isSending}
                    className="px-4 bg-white text-black rounded-xl font-bold hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1"
                  >
                    <Send size={16} />
                    <span className="text-[10px] uppercase tracking-widest">{isTale ? 'Ок' : 'Ход'}</span>
                  </button>
                </div>
                {!isTale && (
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/40 font-bold">
                    <span>Бросок:</span>
                    {([['', 'нет'], ['classic', 'd20'], ['triple', '3d20'], ['shifted', 'Сдвиг'], ['taint', 'Хаос']] as const)
                      .filter(([id]) => id === '' || id === 'classic' || isMechanicEnabled(id))
                      .map(([id, label]) => (
                        <button key={id} onClick={() => setRollType(id)} className={`px-2 py-1 rounded-md ${rollType === id ? 'bg-white text-black' : 'bg-white/5 hover:bg-white/10'} ${dashboard.suggestedRoll?.type === id ? 'ring-1 ring-amber-400/60' : ''}`}>
                          {label}
                        </button>
                      ))}
                  </div>
                )}
                {hasActed && (
                  <div className="text-xs text-emerald-400 text-center space-y-1">
                    <p className="animate-pulse">{isTale ? 'Твоя идея у сказочника. Ждём продолжения...' : 'Действие отправлено Мастеру. Ждём его решения...'}</p>
                    <p className="text-white/40 italic whitespace-pre-wrap">«{myPending}»</p>
                  </div>
                )}
              </section>

              {!isTale && <>
              {/* Unique Abilities */}
              {character.abilities && character.abilities.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-sky-300/70 font-bold flex items-center gap-2">
                    <Zap size={12} /> Уникальные способности
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {character.abilities.map((ab, idx) => (
                      <div key={idx} className={`p-4 border rounded-2xl ${
                        ab.type === 'curse' ? 'bg-red-500/5 border-red-500/20' :
                        ab.type === 'flavor' ? 'bg-white/5 border-white/10' :
                        ab.type === 'mechanical' ? 'bg-violet-500/5 border-violet-500/20' :
                        'bg-sky-500/5 border-sky-500/20'
                      }`}>
                        <div className="flex justify-between items-start gap-2">
                          <h4 className={`text-base font-bold ${ab.type === 'curse' ? 'text-red-300' : ab.type === 'flavor' ? 'text-white/60' : ab.type === 'mechanical' ? 'text-violet-300' : 'text-sky-200'}`}>
                            {ab.type === 'curse' ? '✚' : '✦'} {ab.name}
                          </h4>
                          <span className="text-[8px] px-1.5 py-0.5 rounded uppercase font-bold bg-white/10 text-white/50 shrink-0">
                            {ab.type || 'boon'}
                          </span>
                        </div>
                        <p className="text-sm text-white/60 mt-1 leading-relaxed">{ab.desc}</p>
                        {ab.effect && ab.effect !== '—' && <p className="text-xs text-white/40 mt-1 italic">{ab.effect}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Actions */}
              {isMechanicEnabled('actions') && (
                <section className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Zap size={12} /> Варианты действий
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {character.actions?.map((action, idx) => (
                      <button 
                        key={idx} 
                        onClick={() => sendAction(`${action.name}: ${action.description}`)}
                        disabled={hasActed || isSending}
                        className="w-full text-left p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex justify-between items-start mb-2">
                          <span className={`text-[8px] px-2 py-0.5 rounded uppercase font-bold ${
                            action.category === 'Искушение' ? 'bg-red-500/20 text-red-400' :
                            action.category === 'Рискованный' ? 'bg-orange-500/20 text-orange-400' :
                            action.category === 'Синергия' ? 'bg-emerald-500/20 text-emerald-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {action.category}
                          </span>
                        </div>
                        <h4 className="text-lg font-bold text-white group-hover:text-amber-400 transition-colors">{action.name}</h4>
                        <p className="text-sm text-white/40 mt-1 leading-relaxed">{action.description}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Inventory */}
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <Shield size={12} /> Инвентарь
                </h3>
                <div className="flex flex-wrap gap-2">
                  {character.inventory?.map((item, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white/60 flex items-center gap-2">
                      {item}
                      {isUsableItem(item) && (
                        <button
                          onClick={async () => {
                            try {
                              await api(`/api/sessions/${sessionId}/use`, { body: { charName, item } });
                            } catch (e) { alert(e instanceof Error ? e.message : 'Не получилось'); }
                          }}
                          className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full text-[10px] font-bold"
                        >
                          Использовать
                        </button>
                      )}
                    </span>
                  ))}
                  {(!character.inventory || character.inventory.length === 0) && (
                    <span className="text-sm text-white/20 italic">Пусто.</span>
                  )}
                </div>
              </section>

              {/* Equipment */}
              {isMechanicEnabled('inventory') && character.equipment && character.equipment.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Shield size={12} /> Снаряжение
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {character.equipment.map((eq, idx) => (
                      <div key={idx} className="bg-black/40 border border-white/10 rounded-lg p-2.5 flex flex-col gap-1">
                        <span className="text-[8px] uppercase tracking-widest text-white/40 font-bold">{eq.slot}</span>
                        <span className={`text-xs ${!itemName(eq.item) || itemName(eq.item) === 'Пусто' ? 'text-white/20 italic' : 'text-emerald-400'}`}>
                          {itemName(eq.item) || 'Пусто'}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}


              </>}
            </motion.div>
          )}

          {activeTab === 'scene' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <h2 className="text-2xl font-display font-bold tracking-tighter border-b border-white/10 pb-4">Сцена</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {isMechanicEnabled('doom_pool') && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <AlertTriangle size={12} /> Doom Pool
                    </h3>
                    <div className="flex gap-2">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <div 
                          key={i} 
                          className={`h-3 flex-1 rounded-sm transition-all ${
                            i < dashboard.doomPool ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : 'bg-white/10'
                          }`} 
                        />
                      ))}
                    </div>
                  </div>
                )}
                
                {isMechanicEnabled('threat') && dashboard.threatLevel !== undefined && (
                  <div className="space-y-2">
                    <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                      <Target size={12} /> Threat Level
                    </h3>
                    <div className="flex items-center gap-4">
                      <span className="text-3xl font-display font-bold text-red-400">{dashboard.threatLevel}</span>
                      <span className="text-xs text-white/40">Current environmental or enemy threat modifier.</span>
                    </div>
                  </div>
                )}
              </div>

              {isMechanicEnabled('clocks') && dashboard.clocks && dashboard.clocks.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Zap size={12} /> Active Clocks
                  </h3>
                  <div className="space-y-3">
                    {dashboard.clocks.map((clock, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="flex justify-between text-[10px] text-white/60 uppercase tracking-widest">
                          <span>{clock.name}</span>
                          <span className="font-mono">{clock.progress}/{clock.total}</span>
                        </div>
                        <div className="flex gap-1">
                          {Array.from({ length: clock.total }).map((_, i) => (
                            <div 
                              key={i} 
                              className={`h-2 flex-1 rounded-sm transition-all ${
                                i < clock.progress ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.3)]' : 'bg-white/10'
                              }`} 
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isMechanicEnabled('scene_aspects') && dashboard.sceneAspects && dashboard.sceneAspects.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Wind size={12} /> Scene Aspects
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {dashboard.sceneAspects.map((aspect, idx) => (
                      <span key={idx} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white/80">
                        {typeof aspect === 'string' ? aspect : (aspect as any).name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'story' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 flex flex-col h-full">
              <div className="flex justify-between items-center border-b border-white/10 pb-4">
                <h2 className="text-2xl font-display font-bold tracking-tighter">Хроника</h2>
                <button 
                  onClick={() => setIsBookView(!isBookView)}
                  className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold transition-all ${isBookView ? 'text-emerald-400' : 'text-white/40 hover:text-white'}`}
                >
                  <Library size={12} /> {isBookView ? 'Режим книги' : 'Книга'}
                </button>
              </div>
              <div className="space-y-8">
                {session.history
                  .filter(msg => msg.role !== 'system')
                  .filter(msg => !isBookView || msg.role === 'assistant')
                  .map((msg, i) => (
                  <div key={i} className={`max-w-3xl mx-auto w-full ${msg.role === 'user' ? 'text-right' : ''}`}>
                    {msg.role === 'user' ? (
                      <div className={`inline-block px-4 py-3 border rounded-2xl font-medium text-sm ${
                        (msg.content || '').includes('[PLAYER ACTION:') 
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                          : 'bg-white/10 border-white/20 text-white/90'
                      }`}>
                        {(msg.content || '').includes('[PLAYER ACTION:') ? (
                          <div className="flex flex-col gap-1 text-left">
                            <span className="text-[8px] uppercase tracking-widest font-bold opacity-60">Ход игрока</span>
                            <span>{(msg.content || '').replace(/\[PLAYER ACTION:.*?\]/, '').trim()}</span>
                            <span className="text-[8px] italic opacity-40">— {(msg.content || '').match(/\[PLAYER ACTION: (.*?)\]/)?.[1]}</span>
                          </div>
                        ) : <span className="whitespace-pre-wrap">{displayUserContent(msg.content)}</span>}
                      </div>
                    ) : (
                      <div className={`narrative-text space-y-4 ${isBookView ? 'text-white/90' : 'text-white/80'} font-serif leading-relaxed`}>
                        {(msg.content || '').split('\n\n').map((p, j) => (
                          <p key={j}>{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {streamingText !== null && (
                  <div className="max-w-3xl mx-auto w-full narrative-text text-white/80 font-serif leading-relaxed whitespace-pre-wrap">
                    {cleanStreamForDisplay(streamingText)}
                    <span className="inline-block w-1.5 h-4 bg-white/50 animate-pulse ml-0.5 align-middle rounded-sm" />
                  </div>
                )}
                {masterBusy && streamingText === null && (
                  <p className="text-center text-xs text-white/40 italic animate-pulse">{isTale ? 'Сказочник подбирает слова...' : 'Мастер думает...'}</p>
                )}
                <div ref={chatEndRef} />
              </div>
            </motion.div>
          )}

          {activeTab === 'lore' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2 border-b border-white/10 pb-4">
                <History size={12} /> {isTale && session.config?.tale?.finished ? 'Книга сказки' : 'Архив истории'}
              </h3>
              <div className="text-sm text-white/80 font-serif leading-relaxed whitespace-pre-wrap">
                {(isTale && session.config?.tale?.finished ? session.archive : session.lore) || 'Пока пусто — история только начинается.'}
              </div>
            </motion.div>
          )}

          {activeTab === 'codex' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <Codex entries={session.codex} />
            </motion.div>
          )}
          <DisclaimerFooter audience="player" className="px-6 pb-6 pt-2" />
        </div>
      </div>
    </div>
  );
};
