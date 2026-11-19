import React, { useState } from 'react';

/** Фон по жанру, если автор не загрузил обложку: мягкий градиент и крупный знак мира. */
const GENRE_BG: Record<string, string> = {
  fantasy: 'from-amber-700/40 via-emerald-900/40 to-stone-900',
  horror: 'from-slate-700/40 via-purple-950/50 to-black',
  cyber: 'from-fuchsia-700/40 via-cyan-900/40 to-slate-950',
  space: 'from-indigo-700/40 via-sky-950/50 to-black',
  post: 'from-orange-800/40 via-yellow-950/40 to-stone-950',
  west: 'from-orange-700/40 via-red-950/40 to-stone-950',
};

export const WorldCover: React.FC<{ w: { cover?: string; icon: string; genre: string; title: string }; className?: string; iconSize?: string }> = ({ w, className = 'h-28', iconSize = 'text-5xl' }) => {
  const [broken, setBroken] = useState(false);
  if (w.cover && !broken) return <img src={w.cover} alt="" loading="lazy" onError={() => setBroken(true)} className={`w-full object-cover ${className}`} />;
  return (
    <div className={`w-full bg-gradient-to-br ${GENRE_BG[w.genre] || GENRE_BG.fantasy} flex items-center justify-center ${className}`} aria-hidden>
      <span className={`${iconSize} drop-shadow-lg opacity-90`}>{w.icon}</span>
    </div>
  );
};

/** Ужать картинку в браузере до 1280×720 и ~350 КБ (WebP, если браузер умеет, иначе JPEG). */
export async function resizeCover(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(new Error('Не удалось открыть картинку')); i.src = url; });
    const k = Math.min(1, 1280 / img.naturalWidth, 720 / img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    for (const [type, q] of [['image/webp', 0.82], ['image/webp', 0.65], ['image/jpeg', 0.7], ['image/jpeg', 0.5]] as const) {
      const data = c.toDataURL(type, q);
      if (data.startsWith(`data:${type}`) && data.length * 0.75 < 380 * 1024) return data;
    }
    throw new Error('Картинка слишком тяжёлая — выберите другую');
  } finally { URL.revokeObjectURL(url); }
}
