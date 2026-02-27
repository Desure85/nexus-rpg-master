import React, { useState } from 'react';
import { Dices, RotateCcw, Zap, ShieldAlert, Binary, User, Activity, Plus, Star, Flame, Users, Ghost, CheckCircle2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Character, MechanicConfig } from '../types';

export type RollType = 'classic' | 'triple' | 'shifted' | 'taint';

interface DiceRollerProps {
  onRoll: (result: string) => void;
  onClose?: () => void;
  suggested?: {
    type: RollType;
    reason: string;
  };
  characters?: Character[];
  pendingRolls?: Record<string, string>;
  onRollComplete?: (charName: string, rollResult: string) => void;
  threatLevel?: number;
  enabledMechanics?: MechanicConfig[];
}

export const DiceRoller: React.FC<DiceRollerProps> = ({ onRoll, onClose, suggested, characters = [], pendingRolls = {}, onRollComplete, threatLevel = 0, enabledMechanics }) => {
  const [lastRoll, setLastRoll] = useState<{ type: RollType, values: number[], total?: number, shift?: number } | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [selectedChar, setSelectedChar] = useState<string>('');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [customActionInput, setCustomActionInput] = useState<string>('');

  const isMechanicEnabled = (id: string) => {
    if (!enabledMechanics) return true;
    const mech = enabledMechanics.find(m => m.id === id);
    return mech ? mech.enabled : true;
  };

  const rollDice = (type: RollType) => {
    if (!selectedChar || !selectedAction) return;
    if (selectedAction === 'Custom Action' && !customActionInput.trim()) return;
    
    setIsRolling(true);
    setLastRoll(null);
    
    setTimeout(() => {
      let result = '';
      let values: number[] = [];
      
      const charObj = characters.find(c => c.name === selectedChar);
      const actionObj = charObj?.actions?.find(a => a.name === selectedAction);
      
      let actionName = selectedAction;
      let actionCategory = '';
      
      if (selectedAction === 'Custom Action') {
        actionName = customActionInput;
        actionCategory = ' (Custom)';
      } else if (actionObj) {
        actionCategory = ` (${actionObj.category})`;
      }

      const charPrefix = selectedChar ? `**${selectedChar}** performs *${actionName}*${actionCategory}: ` : '';
      
      let threatStr = '';
      let threatRoll = 0;
      if (threatLevel > 0) {
        threatRoll = Math.floor(Math.random() * threatLevel) + 1;
        threatStr = ` | Threat d${threatLevel} = -${threatRoll}`;
      }

      const currentStress = charObj ? charObj.stress : 0;
      let stressModStr = '';
      if (type === 'triple' || type === 'shifted') {
        if (currentStress <= 1) {
          stressModStr = ' | Stress: +2 (Max used)';
        } else if (currentStress <= 4) {
          stressModStr = ' | Stress: +1 (Mid used)';
        } else {
          stressModStr = ' | Stress: -2 (Min used, Catharsis)';
        }
      }

      if (type === 'classic') {
        const val = Math.floor(Math.random() * 20) + 1;
        values = [val];
        result = `${charPrefix}[ROLL: 1d20 = ${val}${threatStr}]`;
      } else if (type === 'triple') {
        values = [
          Math.floor(Math.random() * 20) + 1,
          Math.floor(Math.random() * 20) + 1,
          Math.floor(Math.random() * 20) + 1
        ].sort((a, b) => a - b);
        result = `${charPrefix}[ROLL: Stress Resonance (3d20) = ${JSON.stringify(values)}${stressModStr}${threatStr}]`;
      } else if (type === 'shifted') {
        values = [
          Math.floor(Math.random() * 20) + 1,
          Math.floor(Math.random() * 20) + 1,
          Math.floor(Math.random() * 20) + 1
        ].sort((a, b) => a - b);
        const shift = Math.floor(Math.random() * 6) + 1;
        const shiftMod = shift <= 2 ? -1 : shift <= 4 ? 0 : 1;
        result = `${charPrefix}[ROLL: Fate Shift (3d20 + 1d6) = ${JSON.stringify(values)} | d6: ${shift} (Mod: ${shiftMod})${stressModStr}${threatStr}]`;
        setLastRoll({ type, values, shift: shiftMod });
      } else if (type === 'taint') {
        values = [
          Math.floor(Math.random() * 20) + 1,
          Math.floor(Math.random() * 20) + 1
        ];
        const isDouble = values[0] === values[1];
        const doubleStr = isDouble ? ' | DOUBLE! +1 to Doom Pool' : '';
        result = `${charPrefix}[ROLL: Chaos Roll (2d20) = ${JSON.stringify(values)}${doubleStr}${threatStr}]`;
      }

      if (type !== 'shifted') setLastRoll({ type, values });
      
      if (selectedChar && onRollComplete) {
        onRollComplete(selectedChar, result);
        setSelectedChar('');
        setSelectedAction('');
        setCustomActionInput('');
      } else {
        onRoll(result);
      }
      
      setIsRolling(false);
    }, 800);
  };

  const currentChar = characters.find(c => c.name === selectedChar);

  return (
    <div className="p-1 bg-[#151619] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[70vh] lg:max-h-[80vh] flex flex-col">
      <div className="bg-black/40 p-4 space-y-4 overflow-y-auto flex-1 custom-scrollbar">
        <div className="flex items-center justify-between border-b border-white/5 pb-3 sticky top-0 bg-black/40 z-20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <h3 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold">
              Nexus.Dice_Engine v4.8
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {lastRoll && (
              <button 
                onClick={() => setLastRoll(null)}
                className="p-1 hover:bg-white/5 rounded transition-colors text-white/20 hover:text-white/60"
              >
                <RotateCcw size={12} />
              </button>
            )}
            {onClose && (
              <button 
                onClick={onClose}
                className="p-1 hover:bg-white/5 rounded transition-colors text-white/20 hover:text-white/60 lg:hidden"
              >
                <Plus size={14} className="rotate-45" />
              </button>
            )}
          </div>
        </div>

        {/* Character Selection */}
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-[8px] uppercase tracking-[0.2em] text-white/30 font-bold">
            <User size={10} /> Select Operative
          </label>
          <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar no-scrollbar">
            {characters.map(c => {
              const hasActed = !!pendingRolls[c.name];
              const isDead = c.hp === '0' || c.stress >= 10 || c.condition?.toLowerCase().includes('мертв');
              const isDisabled = hasActed || isDead;
              const isSelected = selectedChar === c.name;
              return (
                <button
                  key={c.name}
                  disabled={isDisabled}
                  onClick={() => {
                    setSelectedChar(c.name);
                    setSelectedAction('');
                    setCustomActionInput('');
                  }}
                  className={`flex-shrink-0 w-24 p-2 rounded-xl border transition-all relative group ${
                    isSelected 
                      ? 'bg-emerald-500/20 border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.2)]' 
                      : isDisabled 
                        ? 'bg-white/5 border-white/5 opacity-40 grayscale cursor-not-allowed' 
                        : 'bg-white/5 border-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex flex-col items-center gap-1 text-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isSelected ? 'bg-emerald-500 text-black' : 'bg-white/10 text-white/40'}`}>
                      <User size={16} />
                    </div>
                    <span className={`text-[10px] font-bold truncate w-full ${isSelected ? 'text-emerald-400' : 'text-white/60'}`}>
                      {c.name}
                    </span>
                    {hasActed && (
                      <div className="absolute top-1 right-1">
                        <CheckCircle2 size={10} className="text-emerald-500" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Selection */}
        <AnimatePresence mode="wait">
          {selectedChar && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-2"
            >
              <label className="flex items-center gap-1 text-[8px] uppercase tracking-[0.2em] text-white/30 font-bold">
                <Activity size={10} /> Vector Selection
              </label>
              <div className="grid grid-cols-1 gap-2">
                {currentChar?.actions?.map(a => {
                  const isSelected = selectedAction === a.name;
                  const getCategoryStyle = (cat: string) => {
                    switch (cat) {
                      case 'Профильный': return { color: 'text-blue-400', bg: 'bg-blue-400/10', border: 'border-blue-400/30', icon: <Star size={12} /> };
                      case 'Рискованный': return { color: 'text-orange-400', bg: 'bg-orange-400/10', border: 'border-orange-400/30', icon: <Flame size={12} /> };
                      case 'Синергия': return { color: 'text-purple-400', bg: 'bg-purple-400/10', border: 'border-purple-400/30', icon: <Users size={12} /> };
                      case 'Искушение': return { color: 'text-red-400', bg: 'bg-red-400/10', border: 'border-red-400/30', icon: <Ghost size={12} /> };
                      default: return { color: 'text-white/60', bg: 'bg-white/5', border: 'border-white/10', icon: <Info size={12} /> };
                    }
                  };
                  const style = getCategoryStyle(a.category);
                  
                  return (
                    <button
                      key={a.name}
                      onClick={() => {
                        setSelectedAction(a.name);
                        setCustomActionInput('');
                      }}
                      className={`p-3 rounded-xl border text-left transition-all group relative overflow-hidden ${
                        isSelected 
                          ? `${style.bg} ${style.border} shadow-[0_0_15px_rgba(255,255,255,0.05)]` 
                          : 'bg-white/5 border-white/10 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-start gap-3 relative z-10">
                        <div className={`mt-0.5 p-1.5 rounded-lg ${isSelected ? style.bg : 'bg-white/5'} ${style.color}`}>
                          {style.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[8px] uppercase tracking-widest font-bold ${style.color}`}>
                              {a.category}
                            </span>
                            {isSelected && <motion.div layoutId="active-dot" className={`w-1 h-1 rounded-full ${style.color} bg-current`} />}
                          </div>
                          <p className={`text-[11px] font-bold leading-tight ${isSelected ? 'text-white' : 'text-white/80'}`}>
                            {a.name}
                          </p>
                          {a.description && (
                            <div className={`overflow-hidden transition-all duration-300 ${isSelected ? 'max-h-40 opacity-100 mt-1.5' : 'max-h-0 opacity-0 group-hover:max-h-40 group-hover:opacity-100 group-hover:mt-1.5'}`}>
                              <p className={`text-[9px] leading-snug ${isSelected ? 'text-white/70' : 'text-white/40'}`}>
                                {a.description}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Decorative background element */}
                      {isSelected && (
                        <motion.div 
                          layoutId="active-bg"
                          className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent pointer-events-none" 
                        />
                      )}
                    </button>
                  );
                })}
                
                {/* Custom Action Option */}
                <button
                  onClick={() => setSelectedAction('Custom Action')}
                  className={`p-3 rounded-xl border border-dashed text-left transition-all ${
                    selectedAction === 'Custom Action' 
                      ? 'bg-white/10 border-white/40' 
                      : 'bg-transparent border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 rounded-lg bg-white/5 text-white/40">
                      <Plus size={12} />
                    </div>
                    <span className="text-[11px] text-white/40 italic">Custom Action...</span>
                  </div>
                </button>
              </div>

              {selectedAction === 'Custom Action' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-2"
                >
                  <textarea
                    value={customActionInput}
                    onChange={(e) => setCustomActionInput(e.target.value)}
                    placeholder="Describe your action..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-all resize-none h-20"
                    autoFocus
                  />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Threat Die Display */}
        {threatLevel > 0 && isMechanicEnabled('threat') && (
          <div className="space-y-2">
            <label className="flex items-center gap-1 text-[8px] uppercase tracking-[0.2em] text-white/30 font-bold">
              <ShieldAlert size={10} /> Active Threat Level
            </label>
            <div className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between">
              <span className="text-xs text-red-400 font-bold">Enemy Resistance</span>
              <span className="text-xs text-red-400 font-mono bg-red-500/20 px-2 py-0.5 rounded">d{threatLevel}</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {isMechanicEnabled('classic') && (
            <RollButton 
              label="Classic Flow" 
              sub="1d20 + Mod"
              icon={<Binary size={14} />}
              onClick={() => rollDice('classic')}
              disabled={isRolling || !selectedChar || !selectedAction || (selectedAction === 'Custom Action' && !customActionInput.trim())}
              isSuggested={suggested?.type === 'classic'}
            />
          )}
          {isMechanicEnabled('triple') && (
            <RollButton 
              label="Stress Resonance" 
              sub="3d20 [Min/Mid/Max]"
              icon={<Zap size={14} />}
              onClick={() => rollDice('triple')}
              disabled={isRolling || !selectedChar || !selectedAction || (selectedAction === 'Custom Action' && !customActionInput.trim())}
              isSuggested={suggested?.type === 'triple'}
            />
          )}
          {isMechanicEnabled('shifted') && (
            <RollButton 
              label="Fate Shift" 
              sub="Triple + 1d6 Shift"
              icon={<Dices size={14} />}
              onClick={() => rollDice('shifted')}
              disabled={isRolling || !selectedChar || !selectedAction || (selectedAction === 'Custom Action' && !customActionInput.trim())}
              isSuggested={suggested?.type === 'shifted'}
            />
          )}
          {isMechanicEnabled('taint') && (
            <RollButton 
              label="Chaos Roll" 
              sub="2d20 + Doom Check"
              icon={<ShieldAlert size={14} />}
              onClick={() => rollDice('taint')}
              disabled={isRolling || !selectedChar || !selectedAction || (selectedAction === 'Custom Action' && !customActionInput.trim())}
              isSuggested={suggested?.type === 'taint'}
            />
          )}
        </div>

        {suggested && !lastRoll && !isRolling && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg"
          >
            <div className="flex items-center gap-2 text-[9px] text-emerald-400 font-bold uppercase tracking-widest">
              <Zap size={10} /> Master's Suggestion
            </div>
            <p className="text-[10px] text-emerald-200/60 italic mt-1">{suggested.reason}</p>
          </motion.div>
        )}

        <div className="relative h-24 bg-black/60 rounded-xl border border-dashed border-white/10 flex items-center justify-center overflow-hidden">
          <AnimatePresence mode="wait">
            {isRolling ? (
              <motion.div 
                key="rolling"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center gap-2"
              >
                <div className="flex gap-2">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      animate={{ 
                        rotate: [0, 90, 180, 270, 360],
                        scale: [1, 1.1, 1]
                      }}
                      transition={{ 
                        duration: 0.4, 
                        repeat: Infinity, 
                        delay: i * 0.1 
                      }}
                      className="w-8 h-8 border border-emerald-500/30 rounded flex items-center justify-center text-emerald-500/50 font-mono text-xs"
                    >
                      ?
                    </motion.div>
                  ))}
                </div>
                <span className="font-mono text-[8px] uppercase tracking-widest text-emerald-500/40">Calculating Probability...</span>
              </motion.div>
            ) : lastRoll ? (
              <motion.div 
                key="result"
                initial={{ opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="flex flex-col items-center"
              >
                <div className="flex gap-3 items-center">
                  {lastRoll.values.map((v, i) => (
                    <div key={i} className="relative group">
                      <div className="absolute -inset-2 bg-white/5 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span className="relative font-display text-3xl font-bold text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
                        {v}
                      </span>
                    </div>
                  ))}
                  {lastRoll.shift !== undefined && (
                    <div className="flex items-center gap-1 ml-2 pl-4 border-l border-white/10">
                      <span className="font-mono text-[10px] text-white/20 uppercase">Shift</span>
                      <span className={`font-display text-2xl font-bold ${lastRoll.shift > 0 ? 'text-emerald-400' : lastRoll.shift < 0 ? 'text-red-400' : 'text-white/40'}`}>
                        {lastRoll.shift > 0 ? `+${lastRoll.shift}` : lastRoll.shift === 0 ? '±0' : lastRoll.shift}
                      </span>
                    </div>
                  )}
                </div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-widest text-white/30">
                  {lastRoll.type.replace('_', ' ')} sequence complete
                </div>
              </motion.div>
            ) : (
              <div className="font-mono text-[9px] uppercase tracking-widest text-white/10">
                Awaiting Input Signal
              </div>
            )}
          </AnimatePresence>
          
          {/* Decorative scanline */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-transparent via-white/5 to-transparent h-1/2 w-full animate-scanline" />
        </div>
      </div>
    </div>
  );
};

const RollButton: React.FC<{ label: string, sub: string, icon: React.ReactNode, onClick: () => void, disabled: boolean, isSuggested?: boolean }> = ({ label, sub, icon, onClick, disabled, isSuggested }) => (
  <button 
    onClick={onClick}
    disabled={disabled}
    className={`group relative p-3 border rounded-xl text-left transition-all disabled:opacity-50 active:scale-[0.98] ${
      isSuggested 
        ? 'bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]' 
        : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
    }`}
  >
    <div className="flex items-center justify-between mb-1">
      <span className={`${isSuggested ? 'text-emerald-400' : 'text-white/40 group-hover:text-white/80'} transition-colors`}>{icon}</span>
      <div className={`w-1 h-1 rounded-full transition-colors ${isSuggested ? 'bg-emerald-500 animate-pulse' : 'bg-white/10 group-hover:bg-emerald-500'}`} />
    </div>
    <div className={`font-mono text-[10px] font-bold transition-colors ${isSuggested ? 'text-emerald-400' : 'text-white/80 group-hover:text-white'}`}>{label}</div>
    <div className={`font-mono text-[8px] transition-colors uppercase tracking-tighter ${isSuggested ? 'text-emerald-400/60' : 'text-white/20 group-hover:text-white/40'}`}>{sub}</div>
    {isSuggested && (
      <div className="absolute -top-1 -right-1">
        <div className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
        </div>
      </div>
    )}
  </button>
);
