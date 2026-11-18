import React, { useEffect, useState } from 'react';
import { Dices, RefreshCw, Plus, Pencil, Loader2, Check, X } from 'lucide-react';
import { api } from '../api';
import { customPrompt, customConfirm } from './PromptModal';

interface OracleTableView { id: string; title: string; hint: string; rows: string[]; used: number; remaining: number; updatedAt: string | null }

interface Props {
  sessionId: string;
  /** Внешний сигнал «таблицы изменились / идёт генерация» из WebSocket */
  status: { state: 'idle' | 'generating' | 'error'; error?: string; tick: number };
}

/**
 * Таблицы оракула сессии. Движок тянет из них строки без повторов и сам дописывает новые,
 * когда колода на исходе. Мастер может догенерировать, перегенерировать с подсказкой или поправить руками.
 */
export const OraclePanel: React.FC<Props> = ({ sessionId, status }) => {
  const [tables, setTables] = useState<OracleTableView[]>([]);
  const [generating, setGenerating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await api<{ tables: OracleTableView[]; generating: boolean }>(`/api/sessions/${sessionId}/oracle`);
      setTables(r.tables);
      setGenerating(r.generating);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };
  useEffect(() => { load(); }, [sessionId, status.tick]);
  useEffect(() => {
    if (status.state === 'generating') setGenerating(true);
    if (status.state === 'error') { setGenerating(false); setError(status.error || 'Ошибка генерации'); }
  }, [status.state, status.tick]);

  const generate = async (mode: 'extend' | 'replace', tableIds?: string[]) => {
    setError('');
    let hint: string | null | undefined;
    if (mode === 'replace') {
      if (!(await customConfirm(tableIds?.length ? 'Перегенерировать эту таблицу с нуля? Текущие строки пропадут.' : 'Перегенерировать ВСЕ таблицы с нуля? Текущие строки пропадут.'))) return;
      hint = await customPrompt('Пожелание (необязательно): например «партия спустилась в подземный город» или «больше политических интриг»', '');
      if (hint === null) return;
    } else {
      hint = await customPrompt('Пожелание к новым строкам (необязательно):', '');
      if (hint === null) return;
    }
    try {
      await api(`/api/sessions/${sessionId}/oracle/generate`, { body: { mode, tables: tableIds, hint: hint || undefined } });
      setGenerating(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api(`/api/sessions/${sessionId}/oracle/${editing.id}`, { method: 'PUT', body: { rows: editing.text.split('\n') } });
      setEditing(null);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка'); }
  };

  const empty = tables.every(t => t.rows.length === 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] uppercase tracking-widest text-white/40 font-bold flex items-center gap-2"><Dices size={12} /> Оракул сессии</h3>
        <div className="flex gap-1">
          <button disabled={generating} onClick={() => generate('extend')} title="Дописать новые строки во все таблицы" className="p-1.5 bg-white/5 hover:bg-white/10 rounded-md text-white/60 disabled:opacity-40"><Plus size={12} /></button>
          <button disabled={generating} onClick={() => generate('replace')} title="Перегенерировать все таблицы" className="p-1.5 bg-white/5 hover:bg-white/10 rounded-md text-white/60 disabled:opacity-40"><RefreshCw size={12} /></button>
        </div>
      </div>
      <p className="text-[10px] text-white/30 leading-relaxed">
        Мотивы, осложнения и NPC под ваш сеттинг. Движок тянет строки без повторов, когда колода на исходе — дописывает новые сам.
      </p>
      {generating && <p className="text-[11px] text-amber-300 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Генерируем таблицы...</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {empty && !generating && (
        <button onClick={() => generate('replace')} className="w-full py-2 bg-amber-400/10 border border-amber-400/30 rounded-lg text-xs text-amber-200">Сгенерировать таблицы оракула</button>
      )}
      {tables.map(t => (
        <div key={t.id} className="bg-white/5 border border-white/10 rounded-lg">
          <button onClick={() => setOpen(open === t.id ? null : t.id)} className="w-full flex items-center justify-between px-3 py-2 text-left">
            <span className="text-xs text-white/80 font-medium">{t.title}</span>
            <span className={`text-[10px] font-mono ${t.rows.length && t.remaining <= Math.max(2, t.rows.length * 0.2) ? 'text-amber-300' : 'text-white/40'}`}>
              {t.rows.length ? `${t.remaining}/${t.rows.length} в колоде` : 'пусто'}
            </span>
          </button>
          {open === t.id && (
            <div className="px-3 pb-3 space-y-2">
              {editing?.id === t.id ? (
                <>
                  <textarea value={editing.text} onChange={e => setEditing({ ...editing, text: e.target.value })} className="w-full h-48 p-2 bg-black/50 border border-white/10 rounded text-[11px] text-white font-mono" />
                  <p className="text-[10px] text-white/30">Одна строка — один вариант. После сохранения колода перетасуется.</p>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="flex-1 py-1.5 bg-emerald-600 rounded text-[11px] font-bold text-white flex items-center justify-center gap-1"><Check size={12} /> Сохранить</button>
                    <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-white/10 rounded text-[11px] text-white"><X size={12} /></button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="max-h-48 overflow-y-auto space-y-0.5">
                    {t.rows.map((r, i) => <li key={i} className="text-[11px] text-white/60 leading-snug">• {r}</li>)}
                  </ul>
                  <div className="flex gap-1 pt-1">
                    <button disabled={generating} onClick={() => generate('extend', [t.id])} className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white/70 disabled:opacity-40">Догенерировать</button>
                    <button disabled={generating} onClick={() => generate('replace', [t.id])} className="flex-1 py-1.5 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white/70 disabled:opacity-40">Перегенерировать</button>
                    <button onClick={() => setEditing({ id: t.id, text: t.rows.join('\n') })} className="px-2 py-1.5 bg-white/5 hover:bg-white/10 rounded text-white/70" title="Править вручную"><Pencil size={11} /></button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
