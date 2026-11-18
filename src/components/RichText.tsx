import React from 'react';

// Лёгкий рендер «повествовательного» markdown от модели: **жирный**, *курсив*, «> цитата», списки «- ».
// Без HTML — только текстовые узлы, так что инъекции невозможны.
const INLINE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;

export const renderInline = (text: string, keyBase = 'i'): React.ReactNode[] =>
  text.split(INLINE).filter(Boolean).map((part, i) => {
    const k = `${keyBase}-${i}`;
    if (/^\*\*.+\*\*$|^__.+__$/.test(part)) return <strong key={k} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
    if (/^\*.+\*$|^_.+_$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return <React.Fragment key={k}>{part}</React.Fragment>;
  });

export const RichParagraphs: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <>
    {text.replace(/\r/g, '').split(/\n{2,}/).map((block, j) => {
      const lines = block.split('\n').filter(l => l.trim());
      if (!lines.length) return null;
      if (lines.every(l => /^\s*[-•*]\s+/.test(l))) {
        return <ul key={j} className={`list-disc pl-5 space-y-1 ${className || ''}`}>{lines.map((l, k) => <li key={k}>{renderInline(l.replace(/^\s*[-•*]\s+/, ''), `${j}-${k}`)}</li>)}</ul>;
      }
      if (lines.every(l => /^\s*>/.test(l))) {
        return <blockquote key={j} className={`border-l-2 border-white/20 pl-4 italic text-white/70 ${className || ''}`}>{renderInline(lines.map(l => l.replace(/^\s*>\s?/, '')).join(' '), `${j}`)}</blockquote>;
      }
      const heading = /^#{1,4}\s+(.+)$/.exec(lines[0]);
      return (
        <p key={j} className={className}>
          {heading ? <strong className="block font-display text-white">{heading[1]}</strong> : null}
          {(heading ? lines.slice(1) : lines).map((l, k, arr) => (
            <React.Fragment key={k}>{renderInline(l, `${j}-${k}`)}{k < arr.length - 1 ? <br /> : null}</React.Fragment>
          ))}
        </p>
      );
    })}
  </>
);

const ROLL_NAMES: Record<string, string> = { '1d20': 'd20', 'Stress Resonance': 'Резонанс', 'Fate Shift': 'Сдвиг судьбы', 'Chaos Roll': 'Хаос' };
const OUTCOME_STYLE: Record<string, string> = {
  'КРИТ. УСПЕХ': 'bg-amber-400/20 text-amber-200 border-amber-400/40',
  'УСПЕХ': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  'УСПЕХ С ЦЕНОЙ': 'bg-sky-500/15 text-sky-200 border-sky-500/30',
  'ПРОВАЛ': 'bg-red-500/15 text-red-300 border-red-500/30',
  'КРИТ. ПРОВАЛ': 'bg-red-600/25 text-red-200 border-red-500/50',
};

/** Компактная плашка броска вместо сырого тега [ROLL: …]. */
export const RollChip: React.FC<{ tag: string }> = ({ tag }) => {
  const kind = Object.keys(ROLL_NAMES).find(k => tag.includes(k)) || '1d20';
  const values = tag.match(/=\s*(\[[\d,\s]+\]|\d+)/)?.[1] || '';
  const total = tag.match(/Итог: (-?\d+)/)?.[1];
  const math = tag.match(/Итог: -?\d+ = ([^→]+?) против/)?.[1];
  const dc = tag.match(/против DC (\d+)/)?.[1];
  const outcome = tag.match(/→ (КРИТ\. УСПЕХ|УСПЕХ С ЦЕНОЙ|КРИТ\. ПРОВАЛ|УСПЕХ|ПРОВАЛ)/)?.[1];
  const stress = tag.match(/Stress: ([+−-]?\d+)/)?.[1];
  const dbl = /DOUBLE!/.test(tag);
  const death = tag.match(/Спасбросок: ([^|\]]+)/)?.[1]?.trim();
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1 rounded-lg border text-[11px] font-sans not-italic align-middle ${outcome ? OUTCOME_STYLE[outcome] : 'bg-white/5 text-white/70 border-white/10'}`} title={tag.replace(/^\[|\]$/g, '')}>
      <span>🎲 {ROLL_NAMES[kind]} {values}</span>
      {total && (() => {
        const mods = (math || '').trim().replace(/^\d+ \([^)]*\)\s*/, '');
        const picked = (math || '').match(/^\d+ \(([^)]*)\)/)?.[1];
        return <span className="font-mono opacity-85">{picked && picked !== 'd20' ? `${picked} ` : ''}{mods ? `${mods} · ` : ''}итог <b>{total}</b>{dc ? ` (нужно ${dc})` : ''}</span>;
      })()}
      {outcome && <b className="uppercase tracking-wide">{outcome}</b>}
      {stress && <span className="opacity-80">стресс {stress}</span>}
      {dbl && <span className="opacity-80">дубль: Doom +1</span>}
      {death && <span className="font-bold">💀 {death}</span>}
    </span>
  );
};

/** Текст хода игрока: обычный текст + плашки бросков. */
export const UserContent: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.replace(/^### GM Rolls:\s*/m, '').split(/(\[ROLL:[^\]]*\])/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith('[ROLL:')
        ? <RollChip key={i} tag={p} />
        : <React.Fragment key={i}>{renderInline(p.replace(/\s*performs\s*/g, ' — ').replace(/:\s*$/, ''), `u${i}`)}</React.Fragment>)}
    </>
  );
};
