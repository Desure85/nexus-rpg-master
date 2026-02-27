import React from 'react';
import { Settings as SettingsIcon, Save, Trash2, Plus, Play, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GameSession, AppSettings } from '../types';

interface SidebarProps {
  sessions: GameSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenSettings,
}) => {
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  return (
    <div className="w-full lg:w-72 h-full flex flex-col border-r border-white/10 bg-[#1a1614] lg:bg-black/40 backdrop-blur-md">
      <div className="p-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight text-white">Nexus Prime</h1>
        <button 
          onClick={onOpenSettings}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      <div className="px-4 mb-6">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl font-semibold hover:bg-white/90 transition-all active:scale-95"
        >
          <Plus size={18} />
          New Story
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-white/40 font-bold">
          Chronicles
        </div>
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all ${
              currentSessionId === session.id 
                ? 'bg-white/10 text-white' 
                : 'text-white/60 hover:bg-white/5 hover:text-white'
            }`}
            onClick={() => onSelectSession(session.id)}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.name || 'Untitled Story'}</p>
              <p className="text-[10px] opacity-50 truncate">{session.genre} • {new Date(session.updated_at).toLocaleDateString()}</p>
            </div>
            
            <div className="flex items-center gap-1">
              <AnimatePresence mode="wait">
                {deletingId === session.id ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={() => {
                        onDeleteSession(session.id);
                        setDeletingId(null);
                      }}
                      className="px-2 py-1 bg-red-500 text-white text-[9px] font-bold uppercase rounded hover:bg-red-600 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeletingId(null)}
                      className="px-2 py-1 bg-white/10 text-white/60 text-[9px] font-bold uppercase rounded hover:bg-white/20 transition-colors"
                    >
                      No
                    </button>
                  </motion.div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingId(session.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded-md transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
