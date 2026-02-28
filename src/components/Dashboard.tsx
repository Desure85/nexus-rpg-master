import React, { useState } from 'react';
import { DashboardData, MechanicConfig, Character } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Activity, Shield, Zap, Target, Wind, AlertTriangle, MoreHorizontal, RotateCcw, ZapOff, MessageSquarePlus, Edit2, Plus, Trash2, ScrollText, Share2, Gem, Download, X } from 'lucide-react';
import { customPrompt, customConfirm } from './PromptModal';

interface DashboardProps {
  data: DashboardData;
  sessionId?: string;
  enabledMechanics?: MechanicConfig[];
  onUpdate?: (newData: DashboardData) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ data, sessionId, enabledMechanics, onUpdate }) => {
  const [activeTokenMenu, setActiveTokenMenu] = useState<string | null>(null);

  const isMechanicEnabled = (id: string) => {
    if (!enabledMechanics) return true;
    const mech = enabledMechanics.find(m => m.id === id);
    return mech ? mech.enabled : true;
  };

  const updateChar = (name: string, updates: Partial<Character>) => {
    if (!onUpdate) return;
    const newChars = data.characters.map(c => 
      c.name === name ? { ...c, ...updates } : c
    );
    onUpdate({ ...data, characters: newChars });
  };

  const updateDoom = (val: number) => {
    if (!onUpdate) return;
    onUpdate({ ...data, doomPool: Math.max(0, val) });
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto max-h-full">
      {/* Characters */}
      <section>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
            <Activity size={12} /> Party Status
          </h3>
          <button 
            onClick={async () => {
              const name = await customPrompt("Character Name");
              if (name) {
                onUpdate?.({ 
                  ...data, 
                  characters: [...(data.characters || []), { 
                    name, 
                    hp: "10/10", 
                    stress: 0, 
                    tokens: 0, 
                    condition: "Healthy", 
                    goal: "Survive",
                    inventory: [],
                    equipment: [],
                    relationships: [],
                    actions: []
                  }] 
                });
              }
            }}
            className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
          >
            <Plus size={12} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {data.characters.map((char, i) => (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.1 }}
              key={char.name} 
              className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3"
            >
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={async () => {
                          if (!sessionId) return;
                          // Use Base64 encoding for the character name to handle special characters safely
                          // We must encodeURIComponent the Base64 string because it can contain '/' which breaks routing
                          const encodedName = encodeURIComponent(btoa(unescape(encodeURIComponent(char.name))));
                          const url = `${window.location.origin}/character/${sessionId}/${encodedName}`;
                          navigator.clipboard.writeText(url);
                          alert(`Link for ${char.name} copied to clipboard!`);
                        }}
                        className="p-1 hover:bg-white/10 rounded text-white/20 hover:text-emerald-400 transition-all"
                        title="Share Character Link"
                      >
                        <Share2 size={12} />
                      </button>
                      <h4 className="font-display text-lg text-white flex items-center gap-2 group">
                        {char.name}
                        <button 
                          onClick={async () => {
                            const next = await customPrompt(`Rename ${char.name}`, char.name);
                            if (next) updateChar(char.name, { name: next });
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-white/10 rounded"
                        >
                          <Edit2 size={10} className="text-white/40" />
                        </button>
                      </h4>
                    </div>
                    {isMechanicEnabled('goal') && (
                      <p 
                        className="text-[10px] text-white/40 uppercase tracking-tighter cursor-pointer hover:text-white transition-colors"
                        onClick={async () => {
                          const next = await customPrompt(`Update goal for ${char.name}`, char.goal);
                          if (next) updateChar(char.name, { goal: next });
                        }}
                      >
                        {char.goal}
                      </p>
                    )}
                  </div>
                </div>
                {isMechanicEnabled('tokens') && (
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <div 
                        className="flex gap-2 cursor-pointer group/tokens p-1 hover:bg-white/5 rounded-lg transition-all" 
                        onClick={() => setActiveTokenMenu(activeTokenMenu === char.name ? null : char.name)}
                      >
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div 
                            key={i} 
                            className={`w-2 h-2 rounded-full transition-all ${
                              i < char.tokens 
                                ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]' 
                                : 'bg-white/10 border border-white/10'
                            }`} 
                          />
                        ))}
                      </div>

                      <AnimatePresence>
                        {activeTokenMenu === char.name && (
                          <motion.div 
                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                            className="absolute right-0 top-full mt-2 w-48 bg-[#1a1614] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                          >
                            <div className="p-2 border-b border-white/5 bg-white/5">
                              <p className="text-[8px] uppercase tracking-widest text-white/40 font-bold">Token Actions</p>
                            </div>
                            <div className="p-1">
                              <button 
                                onClick={async () => {
                                  if (char.tokens > 0) updateChar(char.name, { tokens: char.tokens - 1 });
                                  setActiveTokenMenu(null);
                                }}
                                disabled={char.tokens === 0}
                                className="w-full flex items-center gap-3 px-3 py-2 text-[10px] text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-all disabled:opacity-30"
                              >
                                <RotateCcw size={12} /> Use for Reroll
                              </button>
                              <button 
                                onClick={async () => {
                                  if (char.tokens > 0) updateChar(char.name, { tokens: char.tokens - 1 });
                                  setActiveTokenMenu(null);
                                }}
                                disabled={char.tokens === 0}
                                className="w-full flex items-center gap-3 px-3 py-2 text-[10px] text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-all disabled:opacity-30"
                              >
                                <ZapOff size={12} /> Use for Flashback
                              </button>
                              <button 
                                onClick={async () => {
                                  if (char.tokens > 0) updateChar(char.name, { tokens: char.tokens - 1 });
                                  setActiveTokenMenu(null);
                                }}
                                disabled={char.tokens === 0}
                                className="w-full flex items-center gap-3 px-3 py-2 text-[10px] text-white/70 hover:bg-white/5 hover:text-white rounded-lg transition-all disabled:opacity-30"
                              >
                                <MessageSquarePlus size={12} /> Narrative Right
                              </button>
                              <div className="h-px bg-white/5 my-1" />
                              <button 
                                onClick={async () => {
                                  const next = await customPrompt(`Set tokens for ${char.name} (0-3)`, char.tokens.toString());
                                  if (next !== null) updateChar(char.name, { tokens: Math.min(3, Math.max(0, parseInt(next))) });
                                  setActiveTokenMenu(null);
                                }}
                                className="w-full flex items-center gap-3 px-3 py-2 text-[10px] text-amber-400/70 hover:bg-amber-400/10 hover:text-amber-400 rounded-lg transition-all"
                              >
                                <MoreHorizontal size={12} /> Manual Set
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <button 
                      onClick={async () => {
                        if (await customConfirm(`Delete character ${char.name}?`)) {
                          onUpdate?.({ ...data, characters: data.characters.filter(c => c.name !== char.name) });
                        }
                      }}
                      className="p-1 hover:bg-red-500/10 rounded text-white/10 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                {isMechanicEnabled('hp') && (
                  <div className="space-y-1 group/stat cursor-pointer" onClick={async () => {
                    const current = parseInt(char.hp.split('/')[0]);
                    const max = parseInt(char.hp.split('/')[1]);
                    const next = await customPrompt(`Update HP for ${char.name} (Current: ${char.hp})`, char.hp);
                    if (next) updateChar(char.name, { hp: next });
                  }}>
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/60">
                      <span>HP</span>
                      <span className="group-hover/stat:text-emerald-400 transition-colors">{char.hp}</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-500" 
                        style={{ width: `${(parseInt(char.hp.split('/')[0]) / parseInt(char.hp.split('/')[1])) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
                {isMechanicEnabled('stress') && (
                  <div className="space-y-1 group/stat cursor-pointer" onClick={async () => {
                    const next = await customPrompt(`Update Stress for ${char.name} (0-10)`, char.stress.toString());
                    if (next !== null) updateChar(char.name, { stress: Math.min(10, Math.max(0, parseInt(next))) });
                  }}>
                    <div className="flex justify-between text-[10px] uppercase font-bold text-white/60">
                      <span>Stress</span>
                      <span className="group-hover/stat:text-orange-400 transition-colors">{char.stress}/10</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-orange-500 transition-all duration-500" 
                        style={{ width: `${(char.stress / 10) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              
              {isMechanicEnabled('condition') && char.condition && (
                <div 
                  className="text-[10px] italic text-orange-300/80 bg-orange-500/10 px-2 py-1 rounded border border-orange-500/20 cursor-pointer hover:bg-orange-500/20 transition-all"
                  onClick={async () => {
                    const next = await customPrompt(`Update condition for ${char.name}`, char.condition);
                    if (next !== null) updateChar(char.name, { condition: next });
                  }}
                >
                  {char.condition}
                </div>
              )}

              {isMechanicEnabled('inventory') && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <h5 className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Inventory</h5>
                    <button 
                      onClick={async () => {
                        const next = await customPrompt(`Add item to ${char.name}'s inventory`);
                        if (next) updateChar(char.name, { inventory: [...(char.inventory || []), next] });
                      }}
                      className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {char.inventory && char.inventory.length > 0 ? char.inventory.map((item, idx) => (
                      <span 
                        key={idx} 
                        className="group/item px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] text-white/50 flex items-center gap-1"
                      >
                        {item}
                        <button 
                          onClick={async () => {
                            const newInv = [...(char.inventory || [])];
                            newInv.splice(idx, 1);
                            updateChar(char.name, { inventory: newInv });
                          }}
                          className="opacity-0 group-hover/item:opacity-100 transition-opacity hover:text-red-400"
                        >
                          <Trash2 size={8} />
                        </button>
                      </span>
                    )) : (
                      <span className="text-[9px] text-white/10 italic">Empty</span>
                    )}
                  </div>
                </div>
              )}

              {isMechanicEnabled('inventory') && (
                <div className="space-y-1 pt-2 border-t border-white/5">
                  <div className="flex justify-between items-center">
                    <h5 className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Equipment</h5>
                    <button 
                      onClick={async () => {
                        const slot = await customPrompt("New slot name (e.g. Ring, Spirit Bone):");
                        if (slot) {
                          const newEq = [...(char.equipment || []), { slot, item: "Пусто" }];
                          updateChar(char.name, { equipment: newEq });
                        }
                      }}
                      className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {(char.equipment || []).map((eq, eqIdx) => (
                      <div key={eqIdx} className="group/eq flex items-center justify-between bg-black/20 border border-white/5 rounded p-1.5">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <span 
                            className="text-[9px] text-white/40 uppercase font-bold cursor-pointer hover:text-white truncate min-w-[50px]"
                            onClick={async () => {
                              const next = await customPrompt(`Rename slot:`, eq.slot);
                              if (next) {
                                const newEq = [...(char.equipment || [])];
                                newEq[eqIdx] = { ...eq, slot: next };
                                updateChar(char.name, { equipment: newEq });
                              }
                            }}
                          >
                            {eq.slot}
                          </span>
                          <span 
                            className="text-[10px] text-white/80 cursor-pointer hover:text-emerald-400 truncate"
                            onClick={async () => {
                              const next = await customPrompt(`Equip item in ${eq.slot}:`, eq.item);
                              if (next !== null) {
                                const newEq = [...(char.equipment || [])];
                                newEq[eqIdx] = { ...eq, item: next || "Пусто" };
                                updateChar(char.name, { equipment: newEq });
                              }
                            }}
                          >
                            {eq.item}
                          </span>
                        </div>
                        <button 
                          onClick={async () => {
                            const newEq = [...(char.equipment || [])];
                            newEq.splice(eqIdx, 1);
                            updateChar(char.name, { equipment: newEq });
                          }}
                          className="opacity-0 group-hover/eq:opacity-100 p-1 text-white/20 hover:text-red-400 transition-all"
                        >
                          <Trash2 size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isMechanicEnabled('relationships') && (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <h5 className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Relationships</h5>
                    <button 
                      onClick={async () => {
                        const target = await customPrompt("NPC Name");
                        const status = await customPrompt("Status (e.g. Friend, Enemy)", "Neutral");
                        const level = await customPrompt("Level (-10 to 10)", "0");
                        if (target && status && level) {
                          updateChar(char.name, { 
                            relationships: [...(char.relationships || []), { target, status, level: parseInt(level) }] 
                          });
                        }
                      }}
                      className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {char.relationships && char.relationships.length > 0 ? char.relationships.map((rel, idx) => (
                      <div key={idx} className="group/rel flex items-center justify-between text-[9px]">
                        <span 
                          className="text-white/60 cursor-pointer hover:text-white"
                          onClick={async () => {
                            const next = await customPrompt(`Rename NPC ${rel.target}`, rel.target);
                            if (next) {
                              const newRels = [...(char.relationships || [])];
                              newRels[idx] = { ...newRels[idx], target: next };
                              updateChar(char.name, { relationships: newRels });
                            }
                          }}
                        >
                          {rel.target}
                        </span>
                        <div className="flex items-center gap-2">
                          <span 
                            className={`italic cursor-pointer ${rel.level > 0 ? 'text-emerald-400' : rel.level < 0 ? 'text-red-400' : 'text-white/40'}`}
                            onClick={async () => {
                              const nextStatus = await customPrompt(`Update status for ${rel.target}`, rel.status);
                              const nextLevel = await customPrompt(`Update level for ${rel.target} (-10 to 10)`, rel.level.toString());
                              if (nextStatus && nextLevel) {
                                const newRels = [...(char.relationships || [])];
                                newRels[idx] = { ...newRels[idx], status: nextStatus, level: parseInt(nextLevel) };
                                updateChar(char.name, { relationships: newRels });
                              }
                            }}
                          >
                            {rel.status}
                          </span>
                          <span className="text-white/20">({rel.level})</span>
                          <button 
                            onClick={async () => {
                              const newRels = [...(char.relationships || [])];
                              newRels.splice(idx, 1);
                              updateChar(char.name, { relationships: newRels });
                            }}
                            className="opacity-0 group-hover/rel:opacity-100 transition-opacity text-white/10 hover:text-red-400"
                          >
                            <Trash2 size={8} />
                          </button>
                        </div>
                      </div>
                    )) : (
                      <span className="text-[9px] text-white/10 italic">No connections</span>
                    )}
                  </div>
                </div>
              )}
              {isMechanicEnabled('actions') && char.actions && char.actions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-white/5">
                  <h5 className="text-[8px] uppercase tracking-widest text-white/30 font-bold">Available Actions</h5>
                  <div className="grid grid-cols-1 gap-2">
                    {char.actions.map((action, idx) => (
                      <div 
                        key={idx} 
                        className="p-2 bg-white/5 border border-white/10 rounded-lg group/action relative"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className={`text-[8px] px-1 rounded uppercase font-bold ${
                            action.category === 'Искушение' ? 'bg-red-500/20 text-red-400' :
                            action.category === 'Рискованный' ? 'bg-orange-500/20 text-orange-400' :
                            action.category === 'Синергия' ? 'bg-emerald-500/20 text-emerald-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {action.category}
                          </span>
                          <button 
                            onClick={async () => {
                              const newActions = [...(char.actions || [])];
                              newActions.splice(idx, 1);
                              updateChar(char.name, { actions: newActions });
                            }}
                            className="opacity-0 group-hover/action:opacity-100 transition-opacity text-white/20 hover:text-red-400"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                        <h6 
                          className="text-xs font-bold text-white/80 cursor-pointer hover:text-white"
                          onClick={async () => {
                            const next = await customPrompt(`Rename action ${action.name}`, action.name);
                            if (next) {
                              const newActions = [...(char.actions || [])];
                              newActions[idx] = { ...newActions[idx], name: next };
                              updateChar(char.name, { actions: newActions });
                            }
                          }}
                        >
                          {action.name}
                        </h6>
                        <p 
                          className="text-[10px] text-white/40 leading-tight cursor-pointer hover:text-white/60"
                          onClick={async () => {
                            const next = await customPrompt(`Update description for ${action.name}`, action.description);
                            if (next) {
                              const newActions = [...(char.actions || [])];
                              newActions[idx] = { ...newActions[idx], description: next };
                              updateChar(char.name, { actions: newActions });
                            }
                          }}
                        >
                          {action.description}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* Threats & Clocks */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {isMechanicEnabled('threats_dash') && (
          <section>
            <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-4 flex items-center gap-2">
              <Shield size={12} /> Active Threats
            </h3>
            <div className="space-y-2">
              {data.threats.map((threat, idx) => (
                <div key={threat.name} className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg group/threat">
                  <div className="flex justify-between items-center mb-1">
                    <span 
                      className="text-sm font-medium text-red-200 cursor-pointer hover:text-white"
                      onClick={async () => {
                        const next = await customPrompt(`Rename threat ${threat.name}`, threat.name);
                        if (next) {
                          const newThreats = [...(data.threats || [])];
                          newThreats[idx] = { ...newThreats[idx], name: next };
                          onUpdate?.({ ...data, threats: newThreats });
                        }
                      }}
                    >
                      {threat.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span 
                        className="text-xs font-mono text-red-400 cursor-pointer hover:text-red-300"
                        onClick={async () => {
                          const next = await customPrompt(`Update HP for ${threat.name}`, threat.hp);
                          if (next) {
                            const newThreats = [...(data.threats || [])];
                            newThreats[idx] = { ...newThreats[idx], hp: next };
                            onUpdate?.({ ...data, threats: newThreats });
                          }
                        }}
                      >
                        {threat.hp}
                      </span>
                      <button 
                        onClick={async () => {
                          const newThreats = [...(data.threats || [])];
                          newThreats.splice(idx, 1);
                          onUpdate?.({ ...data, threats: newThreats });
                        }}
                        className="opacity-0 group-hover/threat:opacity-100 transition-opacity text-red-400/40 hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <p 
                    className="text-[10px] text-white/40 cursor-pointer hover:text-white/60"
                    onClick={async () => {
                      const currentFeatures = Array.isArray(threat.features) ? threat.features.join(', ') : threat.features;
                      const next = await customPrompt(`Update features for ${threat.name}`, currentFeatures);
                      if (next) {
                        const newThreats = [...(data.threats || [])];
                        newThreats[idx] = { ...newThreats[idx], features: [next] };
                        onUpdate?.({ ...data, threats: newThreats });
                      }
                    }}
                  >
                    {Array.isArray(threat.features) ? threat.features.join(', ') : threat.features}
                  </p>
                </div>
              ))}
              <button 
                onClick={async () => {
                  const name = await customPrompt("Threat Name");
                  if (name) {
                    onUpdate?.({ ...data, threats: [...(data.threats || []), { name, hp: "10/10", features: ["New threat"] }] });
                  }
                }}
                className="w-full py-2 border border-dashed border-white/10 rounded-lg text-[10px] text-white/20 hover:text-white/40 hover:border-white/20 transition-all flex items-center justify-center gap-2"
              >
                <Plus size={12} /> Add Threat
              </button>
            </div>
          </section>
        )}

        {isMechanicEnabled('clocks') && (
          <section>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                <Zap size={12} /> Clocks
              </h3>
              <button 
                onClick={async () => {
                  const name = await customPrompt("Clock Name");
                  const total = await customPrompt("Total Segments", "4");
                  if (name && total) {
                    onUpdate?.({ ...data, clocks: [...(data.clocks || []), { name, progress: 0, total: parseInt(total) }] });
                  }
                }}
                className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
              >
                <Plus size={10} />
              </button>
            </div>
            <div className="space-y-3">
              {data.clocks.map((clock, idx) => (
                <div key={clock.name} className="space-y-1 group/clock">
                  <div className="flex justify-between text-[10px] text-white/60">
                    <span 
                      className="cursor-pointer hover:text-white"
                      onClick={async () => {
                        const next = await customPrompt(`Rename clock ${clock.name}`, clock.name);
                        if (next) {
                          const newClocks = [...(data.clocks || [])];
                          newClocks[idx] = { ...newClocks[idx], name: next };
                          onUpdate?.({ ...data, clocks: newClocks });
                        }
                      }}
                    >
                      {clock.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{clock.progress}/{clock.total}</span>
                      <button 
                        onClick={async () => {
                          const newClocks = [...(data.clocks || [])];
                          newClocks.splice(idx, 1);
                          onUpdate?.({ ...data, clocks: newClocks });
                        }}
                        className="opacity-0 group-hover/clock:opacity-100 transition-opacity text-white/20 hover:text-red-400"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1 cursor-pointer" onClick={async () => {
                    const newClocks = [...(data.clocks || [])];
                    newClocks[idx] = { ...newClocks[idx], progress: (clock.progress + 1) % (clock.total + 1) };
                    onUpdate?.({ ...data, clocks: newClocks });
                  }}>
                    {Array.from({ length: clock.total }).map((_, i) => (
                      <div 
                        key={i} 
                        className={`h-1.5 flex-1 rounded-sm transition-all ${
                          i < clock.progress ? 'bg-white' : 'bg-white/10'
                        }`} 
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Doom Pool, Threat Level & Aspects */}
      {(isMechanicEnabled('doom_pool') || isMechanicEnabled('scene_aspects') || data.threatLevel !== undefined) && (
        <section className="p-4 bg-black/40 border border-white/5 rounded-xl space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isMechanicEnabled('doom_pool') && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <AlertTriangle size={12} /> Doom Pool
                  </h3>
                  {data.doomPool > 0 && (
                    <div className="flex gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); updateDoom(data.doomPool - 1); }}
                        className="text-[10px] text-white/20 hover:text-white transition-colors"
                        title="Decrement Doom Pool"
                      >
                        -1
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); updateDoom(0); }}
                        className="text-[10px] text-white/20 hover:text-red-400 transition-colors"
                        title="Reset Doom Pool to 0"
                      >
                        Reset
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 cursor-pointer" onClick={() => updateDoom(data.doomPool + 1)}>
                  {Array.from({ length: Math.max(5, data.doomPool) }).map((_, i) => (
                    <div 
                      key={i} 
                      className={`w-3 h-3 rounded-full border transition-all ${
                        i < data.doomPool 
                          ? 'bg-red-600 border-red-400 shadow-[0_0_10px_rgba(220,38,38,0.5)]' 
                          : 'bg-transparent border-white/20'
                      }`} 
                    />
                  ))}
                </div>
              </div>
            )}

            {isMechanicEnabled('threat') && data.threatLevel !== undefined && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                    <Target size={12} /> Threat Level
                  </h3>
                  <button 
                    onClick={async () => {
                      const next = await customPrompt("Update Threat Level (0, 4, 6, 8, 12)", data.threatLevel?.toString());
                      if (next !== null) onUpdate?.({ ...data, threatLevel: parseInt(next) });
                    }}
                    className="text-[10px] text-white/20 hover:text-white transition-colors"
                  >
                    Edit
                  </button>
                </div>
                <div className="flex items-end gap-2">
                  <span className={`text-3xl font-display font-bold ${
                    data.threatLevel >= 12 ? 'text-red-500' :
                    data.threatLevel >= 8 ? 'text-orange-500' :
                    data.threatLevel >= 4 ? 'text-amber-500' :
                    'text-white/20'
                  }`}>
                    {data.threatLevel}
                  </span>
                  <span className="text-[10px] text-white/20 uppercase mb-1">Penalty</span>
                </div>
              </div>
            )}
          </div>

          {data.suggestedRoll && (
            <div className="p-3 bg-white/5 border border-white/10 rounded-lg space-y-2 relative group/suggest">
              <button 
                onClick={async () => onUpdate?.({ ...data, suggestedRoll: undefined })}
                className="absolute top-2 right-2 opacity-0 group-hover/suggest:opacity-100 transition-opacity text-white/20 hover:text-white"
              >
                <Trash2 size={12} />
              </button>
              <div className="flex items-center gap-2">
                <Zap size={12} className="text-amber-400" />
                <span className="text-[10px] uppercase tracking-widest text-amber-400 font-bold">Suggested Roll</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-white capitalize">{data.suggestedRoll.type} Roll</span>
                <p className="text-xs text-white/60 italic leading-relaxed">"{data.suggestedRoll.reason}"</p>
              </div>
            </div>
          )}
          
          {isMechanicEnabled('scene_aspects') && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="text-[10px] uppercase tracking-widest text-white/20 font-bold">Scene Aspects</h4>
                <button 
                  onClick={async () => {
                    const name = await customPrompt("Aspect Name");
                    if (name) {
                      onUpdate?.({ ...data, sceneAspects: [...(data.sceneAspects || []), name] });
                    }
                  }}
                  className="p-1 hover:bg-white/5 rounded text-white/10 hover:text-white transition-all"
                >
                  <Plus size={10} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.sceneAspects.map((aspect, idx) => (
                  <span 
                    key={idx} 
                    className="group/aspect px-2 py-1 bg-white/5 border border-white/10 rounded text-[10px] text-white/60 italic flex items-center gap-2"
                  >
                    <span 
                      className="cursor-pointer hover:text-white"
                      onClick={async () => {
                        const next = await customPrompt(`Edit aspect`, typeof aspect === 'string' ? aspect : (aspect as any).name);
                        if (next) {
                          const newAspects = [...(data.sceneAspects || [])];
                          newAspects[idx] = next;
                          onUpdate?.({ ...data, sceneAspects: newAspects });
                        }
                      }}
                    >
                      "{typeof aspect === 'string' ? aspect : (aspect as any).name}"
                    </span>
                    <button 
                      onClick={async () => {
                        const newAspects = [...(data.sceneAspects || [])];
                        newAspects.splice(idx, 1);
                        onUpdate?.({ ...data, sceneAspects: newAspects });
                      }}
                      className="opacity-0 group-hover/aspect:opacity-100 transition-opacity text-white/20 hover:text-red-400"
                    >
                      <Trash2 size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {isMechanicEnabled('loot') && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <h4 className="text-[10px] uppercase tracking-widest text-emerald-400/60 font-bold flex items-center gap-1.5">
                  <Gem size={10} /> Scene Loot
                </h4>
                <button 
                  onClick={async () => {
                    const name = await customPrompt("Add Loot Item");
                    if (name) {
                      onUpdate?.({ ...data, sceneLoot: [...(data.sceneLoot || []), name] });
                    }
                  }}
                  className="p-1 hover:bg-white/5 rounded text-white/10 hover:text-white transition-all"
                >
                  <Plus size={10} />
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(data.sceneLoot || []).map((item, idx) => (
                  <span 
                    key={idx} 
                    className="group/loot px-2 py-1 bg-emerald-900/20 border border-emerald-500/20 rounded text-[10px] text-emerald-400 flex items-center gap-2"
                  >
                    <span 
                      className="cursor-pointer hover:text-emerald-300"
                      onClick={async () => {
                        const next = await customPrompt(`Edit loot`, item);
                        if (next) {
                          const newLoot = [...(data.sceneLoot || [])];
                          newLoot[idx] = next;
                          onUpdate?.({ ...data, sceneLoot: newLoot });
                        }
                      }}
                    >
                      {item}
                    </span>
                    <button 
                      onClick={async () => {
                        const charNames = data.characters.map(c => c.name).join(', ');
                        const charName = await customPrompt(`Who takes "${item}"?\nAvailable: ${charNames}`);
                        if (charName) {
                          const char = data.characters.find(c => c.name.toLowerCase() === charName.toLowerCase());
                          if (char) {
                            const newLoot = [...(data.sceneLoot || [])];
                            newLoot.splice(idx, 1);
                            const newChars = data.characters.map(c => 
                              c.name === char.name ? { ...c, inventory: [...(c.inventory || []), item] } : c
                            );
                            onUpdate?.({ ...data, sceneLoot: newLoot, characters: newChars });
                          } else {
                            alert("Character not found.");
                          }
                        }
                      }}
                      className="opacity-0 group-hover/loot:opacity-100 transition-opacity text-emerald-500/50 hover:text-emerald-400"
                      title="Take item"
                    >
                      <Download size={10} />
                    </button>
                    <button 
                      onClick={async () => {
                        const newLoot = [...(data.sceneLoot || [])];
                        newLoot.splice(idx, 1);
                        onUpdate?.({ ...data, sceneLoot: newLoot });
                      }}
                      className="opacity-0 group-hover/loot:opacity-100 transition-opacity text-emerald-500/50 hover:text-red-400"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {(!data.sceneLoot || data.sceneLoot.length === 0) && (
                  <span className="text-[10px] text-white/20 italic">No loot...</span>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Echoes & Atmosphere */}
      <section className="space-y-4">
        {data.echoes && data.echoes.length > 0 && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
                <ScrollText size={12} /> Narrative Echoes
              </h3>
              <button 
                onClick={async () => {
                  const next = await customPrompt("Add Echo");
                  if (next) onUpdate?.({ ...data, echoes: [...(data.echoes || []), next] });
                }}
                className="p-1 hover:bg-white/5 rounded text-white/20 hover:text-white transition-all"
              >
                <Plus size={10} />
              </button>
            </div>
            <div className="space-y-2">
              {data.echoes.map((echo, idx) => (
                <div key={idx} className="flex gap-3 group/echo">
                  <div className="w-1 h-1 rounded-full bg-white/20 mt-1.5 shrink-0" />
                  <p 
                    className="text-[10px] text-white/60 leading-relaxed cursor-pointer hover:text-white"
                    onClick={async () => {
                      const next = await customPrompt("Edit Echo", echo);
                      if (next) {
                        const newEchoes = [...(data.echoes || [])];
                        newEchoes[idx] = next;
                        onUpdate?.({ ...data, echoes: newEchoes });
                      }
                    }}
                  >
                    {echo}
                  </p>
                  <button 
                    onClick={async () => {
                      const newEchoes = [...(data.echoes || [])];
                      newEchoes.splice(idx, 1);
                      onUpdate?.({ ...data, echoes: newEchoes });
                    }}
                    className="opacity-0 group-hover/echo:opacity-100 transition-opacity text-white/10 hover:text-red-400"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 border-t border-white/10 group/atmo">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2">
              <Wind size={12} /> Atmosphere
            </h3>
            <button 
              onClick={async () => {
                const next = await customPrompt("Update Atmosphere", data.atmosphere);
                if (next) onUpdate?.({ ...data, atmosphere: next });
              }}
              className="opacity-0 group-hover/atmo:opacity-100 transition-opacity p-1 hover:bg-white/5 rounded text-white/20 hover:text-white"
            >
              <Edit2 size={12} />
            </button>
          </div>
          <p className="text-xs italic text-white/50 leading-relaxed">
            {data.atmosphere}
          </p>
        </div>
      </section>
    </div>
  );
};
