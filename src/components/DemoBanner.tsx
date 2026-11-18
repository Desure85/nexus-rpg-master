import React from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { demoReset } from 'virtual:nexus-transport';
import { IS_DEMO } from '../api';
import { customConfirm } from './PromptModal';

/** Плашка демо-версии: где лежат данные и как начать заново. */
export const DemoBadge: React.FC<{ compact?: boolean }> = ({ compact }) => {
  if (!IS_DEMO) return null;
  const reset = async () => {
    if (await customConfirm('Стереть все игры и аккаунты демо в этом браузере и начать заново?')) await demoReset();
  };
  return (
    <div className={`rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-100/80 ${compact ? 'p-2.5' : 'p-3'} text-[11px] leading-snug space-y-1.5`}>
      <div className="flex items-center gap-1.5 font-bold text-violet-200"><FlaskConical size={12} /> Демо-версия</div>
      <p>Всё работает прямо в браузере: вместо ИИ — заготовки, оплата тестовая. Мультиплеер — между вкладками.</p>
      <button onClick={reset} className="flex items-center gap-1 text-violet-300 hover:text-white"><RotateCcw size={11} /> Начать заново</button>
    </div>
  );
};

export default DemoBadge;
