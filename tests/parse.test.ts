import { describe, it, expect } from 'vitest';
import { parseDashboard, parseStateTags, parseSideTags, parseTale, safeJsonParse, cleanStreamForDisplay, displayUserContent } from '../shared/parse';
import { INITIAL_DASHBOARD } from '../shared/rules';
import { rollTag } from '../shared/dice';

const base = { ...INITIAL_DASHBOARD, characters: [{ name: 'Арн', hp: '10/10', stress: 0, tokens: 1, condition: '', goal: '', inventory: ['меч'] }] };

describe('parseDashboard', () => {
  it('сливает персонажей и вырезает JSON из текста', () => {
    const r = parseDashboard('Текст сцены.\n<dashboard_json>{"characters":[{"name":"Арн","condition":"ранен"}],"atmosphere":"мрак"}</dashboard_json>', base as any);
    expect(r.cleanText).toBe('Текст сцены.');
    expect(r.dashboard?.atmosphere).toBe('мрак');
    expect(r.dashboard?.characters[0].condition).toBe('ранен');
    expect(r.dashboard?.characters[0].inventory).toEqual(['меч']);
  });

  it('терпит ```json-обёртку и хвостовые запятые', () => {
    const r = parseDashboard('Ок <dashboard_json>```json\n{"atmosphere":"x",}\n```</dashboard_json>', base as any);
    expect(r.dashboard?.atmosphere).toBe('x');
  });

  it('не показывает сломанный или незакрытый JSON игрокам', () => {
    expect(parseDashboard('Сцена <dashboard_json>{сломано</dashboard_json>', base as any).cleanText).toBe('Сцена');
    expect(parseDashboard('Сцена <dashboard_json>{"a":', base as any).cleanText).toBe('Сцена');
  });

  it('достаёт лор, финальный драфт и итоги', () => {
    const r = parseDashboard('A<lore_update>L</lore_update><final_draft>F</final_draft><session_summary>S</session_summary>', base as any);
    expect([r.cleanText, r.loreUpdate, r.finalDraft, r.sessionSummary]).toEqual(['A', 'L', 'F', 'S']);
  });
});

describe('state tags', () => {
  it('разбирает изменения чисел и вычищает теги', () => {
    const r = parseStateTags('Удар! [DAMAGE: Арн -3] [GOLD: Лиса +10] [XP: Арн +5]');
    expect(r.changes).toEqual([
      { field: 'hp', name: 'Арн', delta: -3 },
      { field: 'gold', name: 'Лиса', delta: 10 },
      { field: 'xp', name: 'Арн', delta: 5 },
    ]);
    expect(r.clean.trim()).toBe('Удар!');
  });

  it('разбирает трофеи, фронты, мемориал', () => {
    const r = parseSideTags('[TROPHY: Клык|редкий] [FRONT: Культ|власть|а;б;в|конец] [MEMORIAL: Борис|пал в бою]');
    expect(r.trophies[0]).toEqual({ name: 'Клык', desc: 'редкий' });
    expect(r.fronts[0].portents).toEqual(['а', 'б', 'в']);
    expect(r.memorials[0].name).toBe('Борис');
  });
});

describe('tale', () => {
  it('выделяет варианты, название и мораль', () => {
    const r = parseTale('Глава.\n<choices_json>["Налево", "Направо"]</choices_json><lore_update>память</lore_update>');
    expect(r).toMatchObject({ text: 'Глава.', choices: ['Налево', 'Направо'], lore: 'память' });
    const f = parseTale('Конец.<tale_title>Сказка</tale_title><tale_moral>Будь добр</tale_moral>');
    expect(f).toMatchObject({ text: 'Конец.', title: 'Сказка', moral: 'Будь добр', choices: [] });
  });

  it('понимает варианты списком, если JSON сломан', () => {
    expect(parseTale('x<choices_json>1. Налево\n2. Направо</choices_json>').choices).toEqual(['Налево', 'Направо']);
  });
});

describe('display helpers', () => {
  it('прячет служебные блоки в стриме', () => {
    expect(cleanStreamForDisplay('Текст [DAMAGE: Арн -2] дальше <dashboard_json>{"a"')).toBe('Текст  дальше');
  });
  it('прячет теги движка в репликах игрока', () => {
    expect(displayUserContent('Иду\n\n[ENCOUNTER: d6=6]\n\n[STATE: ⚔️ Арн HP 1/2]')).toBe('Иду');
    expect(displayUserContent('[TALE_CHOICE] Налево')).toBe('✦ Налево');
  });
  it('safeJsonParse вытаскивает объект из мусора', () => {
    expect(safeJsonParse('вот: {"a": [1,2,],} конец')).toEqual({ a: [1, 2] });
  });
});

describe('dice', () => {
  it('формирует теги в формате Dice Roller', () => {
    const seq = [0.5, 0.1, 0.95, 0.3];
    let i = 0;
    const rng = () => seq[i++ % seq.length];
    expect(rollTag({ type: 'classic', charName: 'Арн', actionName: 'удар' }, rng)).toBe('**Арн** performs *удар*: [ROLL: 1d20 = 11]');
    expect(rollTag({ type: 'triple', charName: 'Арн', actionName: 'x', stress: 0 }, rng)).toMatch(/Stress Resonance \(3d20\) = \[\d+,\d+,\d+\] \| Stress: \+2/);
  });
});
