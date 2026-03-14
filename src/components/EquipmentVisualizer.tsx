import React from 'react';
import { EquipmentSlot, Item } from '../types';
import { Shield, Sword, User, Zap, HardHat, Shirt } from 'lucide-react';
import { customPrompt } from './PromptModal';

interface Props {
  equipment?: EquipmentSlot[];
  onUpdate?: (slot: string, item: Item | string | null) => void;
}

const SLOT_ICONS: Record<string, React.ReactNode> = {
  'head': <HardHat size={14} />,
  'body': <Shirt size={14} />,
  'main-hand': <Sword size={14} />,
  'off-hand': <Shield size={14} />,
  'accessory': <Zap size={14} />,
};

const SLOT_LABELS: Record<string, string> = {
  'head': 'Head',
  'body': 'Body',
  'main-hand': 'Main Hand',
  'off-hand': 'Off Hand',
  'accessory': 'Accessory',
};

export const EquipmentVisualizer: React.FC<Props> = ({ equipment = [], onUpdate }) => {
  const getSlot = (slotName: string) => equipment.find(s => s.slot === slotName);

  const renderSlot = (slotName: string) => {
    const slot = getSlot(slotName);
    const item = slot?.item;
    const isObject = typeof item === 'object' && item !== null;
    const itemName = isObject ? (item as Item).name : (item as string) || 'Empty';
    const bonus = isObject ? (item as Item).bonus : null;

    return (
      <div 
        key={slotName}
        className="group relative flex items-center gap-3 p-2 bg-white/5 border border-white/10 rounded-lg hover:border-white/30 transition-all cursor-pointer"
        onClick={async () => {
          if (!onUpdate) return;
          const name = await customPrompt(`Enter item name for ${SLOT_LABELS[slotName]} (leave empty to clear):`, itemName === 'Empty' ? '' : itemName);
          if (name === null) return;
          if (name === '') {
            onUpdate(slotName, null);
          } else {
            const bonus = await customPrompt(`Enter bonus for ${name} (e.g. +1 Armor):`, isObject ? (item as Item).bonus || '' : '');
            onUpdate(slotName, {
              name,
              description: isObject ? (item as Item).description : '',
              bonus: bonus || '',
              rarity: isObject ? (item as Item).rarity : 'common'
            });
          }
        }}
      >
        <div className={`p-2 rounded-md ${item ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/20'}`}>
          {SLOT_ICONS[slotName] || <User size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[8px] uppercase tracking-widest text-white/30 font-bold">{SLOT_LABELS[slotName]}</p>
          <p className={`text-[10px] font-medium truncate ${item ? 'text-white' : 'text-white/20 italic'}`}>
            {itemName}
          </p>
          {bonus && (
            <p className="text-[9px] text-emerald-400 font-bold flex items-center gap-1">
              <Zap size={8} /> {bonus}
            </p>
          )}
        </div>
        
        {isObject && (item as Item).description && (
          <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-[#1a1614] border border-white/10 rounded-lg shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
            <p className="text-[10px] text-white font-bold mb-1">{(item as Item).name}</p>
            <p className="text-[9px] text-white/60 leading-relaxed">{(item as Item).description}</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[10px] uppercase tracking-[0.2em] text-white/40 font-black">Equipment</h4>
      </div>
      
      <div className="grid grid-cols-1 gap-2">
        {/* Top: Head */}
        <div className="flex justify-center">
          <div className="w-full max-w-[180px]">{renderSlot('head')}</div>
        </div>
        
        {/* Middle: Hands & Body */}
        <div className="grid grid-cols-3 gap-2">
          {renderSlot('main-hand')}
          {renderSlot('body')}
          {renderSlot('off-hand')}
        </div>
        
        {/* Bottom: Accessory */}
        <div className="flex justify-center">
          <div className="w-full max-w-[180px]">{renderSlot('accessory')}</div>
        </div>
      </div>
    </div>
  );
};
