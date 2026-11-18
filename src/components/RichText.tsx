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
