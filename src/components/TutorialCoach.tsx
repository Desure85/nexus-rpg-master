import React, { useState } from 'react';
import { X } from 'lucide-react';

/** Подсказки обучающей партии: по одной на ход мастера, привязаны к элементам интерфейса. */
export const TUTORIAL_TIPS: { title: string; text: string }[] = [
  { title: 'Как ходить', text: 'Напишите своими словами, что делает герой: «осматриваю повозку», «спрашиваю трактирщика про караван». Или нажмите вариант над полем ввода — он подставится в текст, его можно поправить.' },
  { title: 'Броски кубика', text: 'Когда действие рискованное, над полем ввода появится «🎲 Мастер просит бросок». Нажмите, выберите кубик — и отправьте ход. Исход (успех, успех с ценой, провал) честно считает движок, мастер только описывает последствия.' },
  { title: 'Лист героя', text: 'Во вкладке «Сцена» (справа, на телефоне — вверху) видно здоровье ❤, стресс и жетоны героя. Жетон можно потратить на переброс или удачный поворот — просто напишите об этом в ходе.' },
  { title: 'Предметы и карта', text: 'Предметы из инвентаря используются кнопкой в листе героя — например, выпить зелье. На карте можно отправиться в соседнее место, а в городе — зайти в лавку.' },
  { title: 'Вы играете сами', text: 'Обучение пройдено. Когда захотите закончить, нажмите «Финал» — мастер сведёт сюжет за пару ходов. На главном экране в «Мирах» ждут готовые миры от Nexus и миры игроков.' },
];

const key = (sid: string) => `nx_tutorial_${sid}`;

export const TutorialCoach: React.FC<{ sessionId: string; step: number; onOpenWorlds?: () => void }> = ({ sessionId, step, onOpenWorlds }) => {
  const read = () => { try { return localStorage.getItem(key(sessionId)) || ''; } catch { return ''; } };
  const [seen, setSeen] = useState(read);
  const save = (v: string) => { setSeen(v); try { localStorage.setItem(key(sessionId), v); } catch { /* приватный режим */ } };
  const i = Math.min(step, TUTORIAL_TIPS.length) - 1;
  if (i < 0 || seen === 'off' || seen.split(',').includes(String(i))) return null;
  const tip = TUTORIAL_TIPS[i];
  const last = i === TUTORIAL_TIPS.length - 1;
  return (
    <div data-tutorial-tip={i} className="mb-2 p-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] text-left relative">
      <button onClick={() => save('off')} title="Отключить подсказки" className="absolute top-2 right-2 text-white/30 hover:text-white/70"><X size={14} /></button>
      <p className="text-[10px] uppercase tracking-widest font-bold text-amber-300/80">💡 Подсказка {i + 1}/{TUTORIAL_TIPS.length} · {tip.title}</p>
      <p className="text-xs text-white/75 mt-1 pr-4 leading-relaxed">{tip.text}</p>
      <div className="flex gap-3 mt-2">
        <button onClick={() => save([seen, String(i)].filter(Boolean).join(','))} className="text-xs font-semibold text-amber-300 hover:text-amber-200">Понятно</button>
        {last && onOpenWorlds && <button onClick={() => { save('off'); onOpenWorlds(); }} className="text-xs font-semibold text-white/60 hover:text-white">🌍 Открыть миры</button>}
        {!last && <button onClick={() => save('off')} className="text-xs text-white/40 hover:text-white/70">Я уже умею играть</button>}
      </div>
    </div>
  );
};
