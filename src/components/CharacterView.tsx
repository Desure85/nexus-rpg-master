import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { GameSession, Character, DashboardData, MechanicConfig } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Shield, Zap, Target, Wind, AlertTriangle, RotateCcw, ZapOff, MessageSquarePlus, Trash2, Plus, Send, LayoutDashboard, Library, History, User, BookOpen, Type } from 'lucide-react';
import { Codex } from './Codex';

export const CharacterView: React.FC = () => {
  const { sessionId, charName: rawCharName } = useParams<{ sessionId: string; charName: string }>();
  const [session, setSession] = useState<GameSession | null>(null);
  const [character, setCharacter] = useState<Character | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [mechanics, setMechanics] = useState<MechanicConfig[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [actionInput, setActionInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState<'character' | 'scene' | 'story' | 'lore' | 'codex'>('character');
  const [isBookView, setIsBookView] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const chatEndRef = React.useRef<HTMLDivElement>(null);

  // --- Multiplayer: claim (закрепление персонажа за игроком) ---
  const deviceId = React.useMemo(() => {
    let id = localStorage.getItem('nexus_device_id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('nexus_device_id', id); }
    return id;
  }, []);
  const [claimState, setClaimState] = useState<'loading' | 'unclaimed' | 'pending' | 'approved' | 'rejected' | 'other'>('loading');
  const [claimOwner, setClaimOwner] = useState('');
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('nexus_player_name') || '');
  const [myPending, setMyPending] = useState(false);

  const fetchPending = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/pending`);
      const pending = await res.json();
      setMyPending(pending.some((p: any) => p.char_name === charName));
    } catch (e) { console.error("Pending fetch error", e); }
  };

  const fetchClaims = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/claims`);
      const claims = await res.json();
      const mine = claims.filter((c: any) => c.char_name === charName).sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
      const mineByDevice = mine.find((c: any) => c.device_id === deviceId);
      const others = mine.filter((c: any) => c.device_id !== deviceId && c.status === 'approved');
      if (mineByDevice?.status === 'approved') { setClaimState('approved'); }
      else if (mineByDevice?.status === 'pending') { setClaimState('pending'); }
      else if (mineByDevice?.status === 'rejected') { setClaimState('rejected'); }
      else if (others.length > 0) { setClaimState('other'); setClaimOwner(others[0].player_name); }
      else { setClaimState('unclaimed'); }
    } catch (e) { console.error("Claims fetch error", e); }
  };

  const submitClaim = async () => {
    const name = playerName.trim();
    if (!name) return;
    localStorage.setItem('nexus_player_name', name);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charName, playerName: name, deviceId })
      });
      const data = await res.json();
      if (data.status === 'pending' || data.status === 'approved') { setClaimState(data.status); }
    } catch (e) { console.error("Claim error", e); }
  };

  // Decode character name safely (handle both Base64 and legacy URI encoded)
  const charName = React.useMemo(() => {
    if (!rawCharName) return '';
    try {
      // Try Base64 decode first
      return decodeURIComponent(escape(atob(rawCharName)));
    } catch (e) {
      // Fallback to standard URI decode (for legacy links)
      return decodeURIComponent(rawCharName);
    }
  }, [rawCharName]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.mechanics) {
        setMechanics(JSON.parse(data.mechanics));
      }
    } catch (e) {
      console.error("Fetch settings error", e);
    }
  };

  const isMechanicEnabled = (id: string) => {
    if (mechanics.length === 0) return true; // Default to true if not loaded yet
    const mech = mechanics.find(m => m.id === id);
    return mech ? mech.enabled : true;
  };

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      const data = await res.json();
      if (data) {
        const history = JSON.parse(data.history);
        const lastDashboard = history.slice().reverse().find((m: any) => m.dashboard)?.dashboard;
        setSession({ ...data, history, codex: JSON.parse(data.codex) });
        setDashboard(lastDashboard);
        const char = lastDashboard?.characters?.find((c: any) => c.name === charName);
        setCharacter(char || null);
      }
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSettings();
    fetchClaims();
    fetchPending();

    let socket: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}`);
      
      socket.onopen = () => {
        console.log('CharacterView WebSocket Connected');
        socket.send(JSON.stringify({ type: 'join', sessionId }));
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'update') {
          console.log('CharacterView received update');
          fetchData();
        }
        if (data.type === 'claims_changed' || data.type === 'actions_changed') {
          fetchClaims();
          fetchPending();
        }
      };

      socket.onclose = () => {
        console.log('CharacterView WebSocket Disconnected. Reconnecting in 3s...');
        reconnectTimeout = setTimeout(connect, 3000);
      };

      setWs(socket);
    };

    connect();

    return () => {
      if (socket) {
        socket.onclose = null; // Prevent reconnect on unmount
        socket.close();
      }
      clearTimeout(reconnectTimeout);
    };
  }, [sessionId, charName]);

  const handleManualRefresh = () => {
    fetchData();
    fetchSettings();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'join', sessionId }));
    } else {
      // Try to reconnect if closed
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}`);
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'join', sessionId }));
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'update') fetchData();
      };
      setWs(socket);
    }
  };

  const hasActed = React.useMemo(() => myPending, [myPending]);

  const sendAction = async (actionText: string = actionInput) => {
    if (!actionText.trim() || !session || isSending || hasActed || claimState !== 'approved') return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charName, deviceId, action: actionText })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'action rejected');
      }
      setActionInput('');
    } catch (e) {
      console.error("Send error", e);
      alert(`Не удалось отправить: ${e instanceof Error ? e.message : 'неизвестная ошибка'}`);
    } finally {
      setIsSending(false);
    }
  };

  if (!character || !dashboard || !session) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0502] text-white font-sans space-y-4">
        {!session ? (
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-amber-400"></div>
        ) : null}
        <p className="text-white/60 italic">
          {session ? `Character "${charName}" not found in this session.` : "Loading character data..."}
        </p>
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-[#0a0502] text-white font-sans overflow-hidden">
      {/* Top Navigation */}
      <div className="flex border-b border-white/5 p-2 bg-black/40 backdrop-blur-md shrink-0 gap-2">
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
          <User size={14} /> Character
        </button>
        <button 
          onClick={() => setActiveTab('scene')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'scene' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <LayoutDashboard size={14} /> Scene
        </button>
        <button 
          onClick={() => setActiveTab('story')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'story' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <BookOpen size={14} /> Story
        </button>
        <button 
          onClick={() => setActiveTab('lore')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'lore' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <History size={14} /> Lore
        </button>
        <button 
          onClick={() => setActiveTab('codex')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] uppercase tracking-widest font-bold transition-all ${activeTab === 'codex' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
        >
          <Library size={14} /> Codex
        </button>
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
                  {isMechanicEnabled('condition') && (
                    <>
                      <p className="text-[10px] uppercase tracking-widest text-white/20 font-bold mb-1">Condition</p>
                      <p className="text-sm italic text-orange-300">{character.condition}</p>
                    </>
                  )}
                </div>
              </header>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-6">
                {isMechanicEnabled('hp') && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/40">
                      <span>Health Points</span>
                      <span className="text-emerald-400">{character.hp}</span>
                    </div>
                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-500" 
                        style={{ width: `${(parseInt(character.hp.split('/')[0]) / parseInt(character.hp.split('/')[1])) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {isMechanicEnabled('stress') && (
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2">
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/40">
                      <span>Stress Level</span>
                      <span className="text-orange-400">{character.stress}/10</span>
                    </div>
                    <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-orange-500 transition-all duration-500" 
                        style={{ width: `${(character.stress / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Tokens */}
              {isMechanicEnabled('tokens') && (
                <div className="p-4 bg-amber-400/5 border border-amber-400/20 rounded-2xl flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-widest text-amber-400/60 font-bold">Fate Tokens</span>
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

              {/* Custom Action */}
              <section className="space-y-4">
                <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                  <MessageSquarePlus size={12} /> Custom Action
                </h3>
                <div className="flex gap-2">
                  <textarea
                    value={actionInput}
                    onChange={(e) => setActionInput(e.target.value)}
                    placeholder="Describe your action..."
                    disabled={hasActed || isSending}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all resize-none h-20"
                  />
                  <button
                    onClick={() => sendAction()}
                    disabled={!actionInput.trim() || hasActed || isSending}
                    className="px-4 bg-white text-black rounded-xl font-bold hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex flex-col items-center justify-center gap-1"
                  >
                    <Send size={16} />
                    <span className="text-[10px] uppercase tracking-widest">Act</span>
                  </button>
                </div>
                {hasActed && (
                  <p className="text-xs text-emerald-400 text-center animate-pulse">
                    Действие отправлено Мастеру. Ждём его решения...
                  </p>
                )}
              </section>

              {/* Actions */}
              {isMechanicEnabled('actions') && (
                <section className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Zap size={12} /> Available Actions
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {character.actions?.map((action, idx) => (
                      <button 
                        key={idx} 
                        onClick={() => sendAction(`I perform ${action.name}: ${action.description}`)}
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
                  <Shield size={12} /> Inventory
                </h3>
                <div className="flex flex-wrap gap-2">
                  {character.inventory?.map((item, idx) => (
                    <span key={idx} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-full text-xs text-white/60">
                      {item}
                    </span>
                  ))}
                  {(!character.inventory || character.inventory.length === 0) && (
                    <span className="text-sm text-white/20 italic">No items carried.</span>
                  )}
                </div>
              </section>

              {/* Equipment */}
              {isMechanicEnabled('inventory') && character.equipment && character.equipment.length > 0 && (
                <section className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Shield size={12} /> Equipment
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {character.equipment.map((eq, idx) => (
                      <div key={idx} className="bg-black/40 border border-white/10 rounded-lg p-2.5 flex flex-col gap-1">
                        <span className="text-[8px] uppercase tracking-widest text-white/40 font-bold">{eq.slot}</span>
                        <span className={`text-xs ${eq.item === 'Пусто' ? 'text-white/20 italic' : 'text-emerald-400'}`}>
                          {eq.item}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}


            </motion.div>
          )}

          {activeTab === 'scene' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
              <h2 className="text-2xl font-display font-bold tracking-tighter border-b border-white/10 pb-4">Scene Status</h2>
              
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
                <h2 className="text-2xl font-display font-bold tracking-tighter">The Chronicle</h2>
                <button 
                  onClick={() => setIsBookView(!isBookView)}
                  className={`flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold transition-all ${isBookView ? 'text-emerald-400' : 'text-white/40 hover:text-white'}`}
                >
                  <Library size={12} /> {isBookView ? 'Book Mode Active' : 'Switch to Book Mode'}
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
                            <span className="text-[8px] uppercase tracking-widest font-bold opacity-60">Player Action</span>
                            <span>{(msg.content || '').replace(/\[PLAYER ACTION:.*?\]/, '').trim()}</span>
                            <span className="text-[8px] italic opacity-40">— {(msg.content || '').match(/\[PLAYER ACTION: (.*?)\]/)?.[1]}</span>
                          </div>
                        ) : msg.content}
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
                <div ref={chatEndRef} />
              </div>
            </motion.div>
          )}

          {activeTab === 'lore' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2 border-b border-white/10 pb-4">
                <History size={12} /> Story Archive
              </h3>
              <div className="text-sm text-white/80 font-serif leading-relaxed whitespace-pre-wrap">
                {session.lore || "No lore recorded yet. The story is just beginning."}
              </div>
            </motion.div>
          )}

          {activeTab === 'codex' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <Codex entries={session.codex} />
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
};
