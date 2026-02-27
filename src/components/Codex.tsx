import React from 'react';
import { CodexEntry } from '../types';
import { User, MapPin, Sword, Scroll, Search } from 'lucide-react';
import { motion } from 'motion/react';

interface CodexProps {
  entries: CodexEntry[];
}

export const Codex: React.FC<CodexProps> = ({ entries }) => {
  const [search, setSearch] = React.useState('');
  
  const filtered = entries.filter(e => 
    e.name.toLowerCase().includes(search.toLowerCase()) || 
    e.description.toLowerCase().includes(search.toLowerCase())
  );

  const getTypeIcon = (type: CodexEntry['type']) => {
    switch (type) {
      case 'npc': return <User size={14} />;
      case 'location': return <MapPin size={14} />;
      case 'item': return <Sword size={14} />;
      default: return <Scroll size={14} />;
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" size={14} />
        <input 
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Codex..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-xs text-white focus:outline-none focus:border-white/30 transition-all"
        />
      </div>

      <div className="space-y-4">
        {filtered.length > 0 ? (
          filtered.map((entry, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              key={entry.id || entry.name}
              className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-2 hover:bg-white/10 transition-all cursor-default"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-white/80">
                  <span className="text-white/40">{getTypeIcon(entry.type)}</span>
                  <h4 className="font-display font-bold text-sm">{entry.name}</h4>
                </div>
                {entry.status && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-white/40 uppercase tracking-tighter">
                    {entry.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-white/50 leading-relaxed font-serif italic">
                {entry.description}
              </p>
            </motion.div>
          ))
        ) : (
          <div className="text-center py-12 text-white/20 italic text-sm">
            The archives are empty...
          </div>
        )}
      </div>
    </div>
  );
};
