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

  const hasActed = React.useMemo(() => {
    if (!session || session.history.length === 0) return false;
    const lastMsg = session.history[session.history.length - 1];
    if (lastMsg.role === 'assistant') return false;
    // If the last message is from a user, check if it's from THIS character
    if (lastMsg.role === 'user' && (lastMsg.content || '').includes(`[PLAYER ACTION: ${charName}]`)) {
      return true;
    }
    // If it's from another user, we still let this player act (concurrent actions)
    // Actually, if the DM hasn't responded, maybe we block? Let's just block if THIS player has acted since the DM's last response.
    // Let's find the last assistant message index
    const lastAssistantIdx = session.history.map(m => m.role).lastIndexOf('assistant');
    const messagesSinceDM = session.history.slice(lastAssistantIdx + 1);
    return messagesSinceDM.some(m => (m.content || '').includes(`[PLAYER ACTION: ${charName}]`));
  }, [session, charName]);

  const sendAction = async (actionText: string = actionInput) => {
    if (!actionText.trim() || !session || isSending || hasActed) return;
    setIsSending(true);
    try {
      const actionMsg = `[PLAYER ACTION: ${charName}] ${actionText}`;
      const updatedHistory = [...session.history, { role: 'user', content: actionMsg }];
      
      await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...session,
          history: JSON.stringify(updatedHistory),
          codex: JSON.stringify(session.codex)
        })
      });
      setActionInput('');
    } catch (e) {
      console.error("Send error", e);
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
                    Action submitted. Waiting for Master's response...
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
