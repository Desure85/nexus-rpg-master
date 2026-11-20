import { NotificationBell } from './NotificationBell';
import React from 'react';
import { Settings as SettingsIcon, Save, Trash2, Plus, Play, ChevronRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { WorkspaceInfo, CurrentUser } from '../types';
import { Building2, Shield, Wallet } from 'lucide-react';
import { DemoBadge } from './DemoBanner';

export interface SidebarSession { id: string; name: string; mode?: string; updated_at: string; busy?: boolean; author?: string; canManage?: boolean }

interface SidebarProps {
  sessions: SidebarSession[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onOpenSettings: () => void;
  user: CurrentUser | null;
  workspaces: WorkspaceInfo[];
  workspace: WorkspaceInfo | null;
  onSwitchWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: (tab?: 'members' | 'ai' | 'billing' | 'logs') => void;
  onOpenAdmin: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onOpenSettings,
  user,
  workspaces,
  workspace,
  onSwitchWorkspace,
  onCreateWorkspace,
  onOpenWorkspace,
  onOpenAdmin,
}) => {
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  return (
    <div className="w-full lg:w-72 h-full flex flex-col border-r border-white/10 bg-[#1a1614] lg:bg-black/40 backdrop-blur-md">
      <div className="p-6 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight text-white">Fate & Dragons</h1>
        <div className="flex items-center gap-1">
        <NotificationBell onOpenSession={onSelectSession} panelClass="right-0 lg:right-auto lg:left-0" />
        <button 
          onClick={onOpenSettings}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors text-white/60 hover:text-white"
        >
          <SettingsIcon size={20} />
        </button>
        </div>
      </div>

      {workspace && (
        <div className="px-4 mb-4 space-y-2">
          <div className="flex gap-1">
            <select
              value={workspace.id}
              onChange={e => (e.target.value === '__new' ? onCreateWorkspace() : onSwitchWorkspace(e.target.value))}
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-2 py-2 text-xs text-white"
              title="Пространство"
            >
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              <option value="__new">+ Новое пространство</option>
            </select>
            <button onClick={() => onOpenWorkspace('members')} className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/60" title="Участники и настройки пространства"><Building2 size={16} /></button>
          </div>
          <button onClick={() => onOpenWorkspace('billing')} className="w-full flex items-center justify-between px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-[11px] text-white/70" title="Баланс и тариф">
            <span className="flex items-center gap-2"><Wallet size={12} /> {workspace.ai.mode === 'byok' ? 'Свой ключ ИИ' : `${workspace.credits} кредитов`}</span>
            <span className={`text-[10px] uppercase tracking-widest font-bold ${workspace.plan === 'pro' ? 'text-amber-300' : 'text-white/40'}`}>{workspace.limits.title}</span>
          </button>
          {workspace.status === 'suspended' && <p className="text-[10px] text-red-400">Пространство заблокировано администратором</p>}
        </div>
      )}

      <div className="px-4 mb-6">
        <button
          onClick={onNewSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white text-black rounded-xl font-semibold hover:bg-white/90 transition-all active:scale-95"
        >
          <Plus size={18} />
          Новая игра
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        <div className="px-4 py-2 text-[10px] uppercase tracking-widest text-white/40 font-bold">
          Мои игры
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
              <p className="text-[10px] opacity-50 truncate">{session.canManage === false && session.author ? `${session.author} • ` : ''}{session.mode === 'tale' ? '📖 Сказка' : session.mode === 'campaign' ? '🗺️ Кампания' : '⚡ Вечер'} • {new Date(String(session.updated_at).replace(' ', 'T') + (String(session.updated_at).includes('Z') ? '' : 'Z')).toLocaleDateString()}{session.busy ? ' • ✍️' : ''}</p>
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
                      Удалить
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

      <div className="p-4 border-t border-white/10 space-y-1">
        {user?.isSuperadmin && (
          <button onClick={onOpenAdmin} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-amber-300/80 hover:bg-white/5"><Shield size={14} /> Администрирование</button>
        )}
        {user && <p className="px-3 text-[10px] text-white/30 truncate">{user.email}</p>}
        <div className="pt-2"><DemoBadge compact /></div>
      </div>
    </div>
  );
};
