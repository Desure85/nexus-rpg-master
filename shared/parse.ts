import type { DashboardData, CodexEntry } from '../src/types';

export interface StateChange { field: 'hp' | 'stress' | 'gold' | 'xp' | 'tokens'; name: string; delta: number }

/** JSON.parse, устойчивый к ```json-обёрткам, хвостовым запятым и мусору вокруг объекта. */
export const safeJsonParse = (raw: string): any => {
  let t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  const first = Math.min(...['{', '['].map(c => { const i = t.indexOf(c); return i < 0 ? Infinity : i; }));
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first !== Infinity && last > first) t = t.slice(first, last + 1);
  t = t.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(t);
};

const asArray = (v: any): any[] | undefined => (v == null ? undefined : Array.isArray(v) ? v : undefined);

/** Модели иногда присылают equipment объектом {"Оружие": "Меч"} или предметы строками — приводим к схеме. */
const normalizeEquipment = (eq: any): any[] | undefined => {
  if (eq == null) return undefined;
  const list = Array.isArray(eq) ? eq : typeof eq === 'object' ? Object.entries(eq).map(([slot, item]) => ({ slot, item })) : [];
  return list.filter(Boolean).map((e: any) => {
    const item = e.item;
    if (typeof item === 'string') return { ...e, item: /^(пусто|empty|нет|-)?$/i.test(item.trim()) ? null : { name: item } };
    return e;
  });
};

export const normalizeCharacter = (c: any) => {
  if (!c || typeof c !== 'object') return c;
  const out = { ...c };
  if ('equipment' in out) out.equipment = normalizeEquipment(out.equipment);
  for (const k of ['inventory', 'actions', 'abilities', 'relationships']) if (k in out && !Array.isArray(out[k])) delete out[k];
  return out;
};

export const parseDashboard = (text: string, currentDashboard: DashboardData): { cleanText: string, dashboard?: DashboardData, codexUpdates?: CodexEntry[], loreUpdate?: string, finalDraft?: string, sessionSummary?: string } => {
  let cleanText = text;
  let dashboard: DashboardData | undefined;
  let codexUpdates: CodexEntry[] | undefined;

  const dashMatch = text.match(/<dashboard_json>([\s\S]*?)<\/dashboard_json>/);
  if (dashMatch) {
    try {
      const parsed = safeJsonParse(dashMatch[1]) || {};
      if (parsed.characters && !Array.isArray(parsed.characters)) delete parsed.characters;
      if (parsed.characters) parsed.characters = parsed.characters.map(normalizeCharacter);
      for (const k of ['threats', 'sceneAspects', 'sceneLoot', 'locations', 'clocks', 'echoes', 'decisionTree']) if (k in parsed && !asArray(parsed[k])) delete parsed[k];
      let mergedCharacters = [...(currentDashboard.characters || [])];
      if (parsed.characters) {
        parsed.characters.forEach((parsedChar: any) => {
          const index = mergedCharacters.findIndex(c => c.name === parsedChar.name);
          if (index >= 0) {
            const currentChar = mergedCharacters[index];
            // Merge equipment by slot name to prevent AI from dropping custom slots
            let mergedEquipment = [...(currentChar.equipment || [])];
            if (parsedChar.equipment && Array.isArray(parsedChar.equipment)) {
              parsedChar.equipment.forEach((parsedEq: any) => {
                const eqIndex = mergedEquipment.findIndex(e => e.slot === parsedEq.slot);
                if (eqIndex >= 0) {
                  mergedEquipment[eqIndex] = { ...mergedEquipment[eqIndex], ...parsedEq };
                } else {
                  mergedEquipment.push(parsedEq);
                }
              });
            }

            // Merge relationships by target name
            let mergedRelationships = [...(currentChar.relationships || [])];
            if (parsedChar.relationships && Array.isArray(parsedChar.relationships)) {
              parsedChar.relationships.forEach((parsedRel: any) => {
                const relIndex = mergedRelationships.findIndex(r => r.target === parsedRel.target);
                if (relIndex >= 0) {
                  mergedRelationships[relIndex] = { ...mergedRelationships[relIndex], ...parsedRel };
                } else {
                  mergedRelationships.push(parsedRel);
                }
              });
            }

            // Способности не теряются, даже если модель перечислила только новые
            const mergedAbilities = [...(currentChar.abilities || [])];
            if (Array.isArray(parsedChar.abilities)) {
              for (const ab of parsedChar.abilities) {
                if (!ab?.name) continue;
                const i = mergedAbilities.findIndex(x => x.name === ab.name);
                if (i >= 0) mergedAbilities[i] = { ...mergedAbilities[i], ...ab };
                else mergedAbilities.push(ab);
              }
            }

            mergedCharacters[index] = {
              ...currentChar,
              ...parsedChar,
              abilities: mergedAbilities,
              inventory: parsedChar.inventory || currentChar.inventory || [],
              equipment: mergedEquipment,
              relationships: mergedRelationships,
              actions: parsedChar.actions || currentChar.actions || []
            };
          } else {
            mergedCharacters.push(parsedChar);
          }
        });
      }

      // Merge locations
      let mergedLocations = [...(currentDashboard.locations || [])];
      if (parsed.locations) {
        parsed.locations.forEach((parsedLoc: any) => {
          const index = mergedLocations.findIndex(l => l.id === parsedLoc.id || l.name === parsedLoc.name);
          if (index >= 0) {
            mergedLocations[index] = { ...mergedLocations[index], ...parsedLoc };
          } else {
            mergedLocations.push(parsedLoc);
          }
        });
      }

      // Merge with current dashboard to prevent dropping arrays if AI omits them
      dashboard = {
        ...currentDashboard,
        ...parsed,
        characters: mergedCharacters,
        threats: parsed.threats || currentDashboard.threats || [],
        sceneAspects: parsed.sceneAspects || currentDashboard.sceneAspects || [],
        sceneLoot: parsed.sceneLoot || currentDashboard.sceneLoot || [],
        locations: mergedLocations,
        currentLocationId: parsed.currentLocationId || currentDashboard.currentLocationId,
        clocks: parsed.clocks || currentDashboard.clocks || [],
        echoes: parsed.echoes || currentDashboard.echoes || [],
        decisionTree: parsed.decisionTree || currentDashboard.decisionTree || [],
      };
    } catch (e) { console.error("Dashboard parse error", e); }
    cleanText = cleanText.replace(/<dashboard_json>[\s\S]*?<\/dashboard_json>/, '').trim();
  }

  const codexMatch = text.match(/<codex_json>([\s\S]*?)<\/codex_json>/);
  if (codexMatch) {
    try {
      const parsedCodex = safeJsonParse(codexMatch[1]);
      codexUpdates = Array.isArray(parsedCodex) ? parsedCodex : [parsedCodex];
    } catch (e) { console.error("Codex parse error", e); }
    cleanText = cleanText.replace(/<codex_json>[\s\S]*?<\/codex_json>/, '').trim();
  }

  const loreMatch = text.match(/<lore_update>([\s\S]*?)<\/lore_update>/i);
  if (loreMatch) {
    cleanText = cleanText.replace(/<lore_update>[\s\S]*?<\/lore_update>/i, '').trim();
  }

  const finalDraftMatch = text.match(/<final_draft>([\s\S]*?)<\/final_draft>/i);
  if (finalDraftMatch) {
    cleanText = cleanText.replace(/<final_draft>[\s\S]*?<\/final_draft>/i, '').trim();
  }

  const sessionSummaryMatch = text.match(/<session_summary>([\s\S]*?)<\/session_summary>/i);
  if (sessionSummaryMatch) {
    cleanText = cleanText.replace(/<session_summary>[\s\S]*?<\/session_summary>/i, '').trim();
  }

  // Незакрытые блоки (обрезанный ответ модели) — не показываем игрокам сырой JSON
  cleanText = cleanText.replace(/<(dashboard_json|codex_json|lore_update|final_draft|session_summary)>[\s\S]*$/i, '').trim();

  // Clean up unwanted headers that the model might still output
  cleanText = cleanText.replace(/^###\s*(Narrative|Нарратив)\s*\n?/i, '').trim();
  cleanText = cleanText.replace(/###\s*(Actions & Rolls|Векторы действий|Действия)[\s\S]*?(?=(<|$))/i, '').trim();

  return { cleanText, dashboard, codexUpdates, loreUpdate: loreMatch ? loreMatch[1].trim() : undefined, finalDraft: finalDraftMatch ? finalDraftMatch[1].trim() : undefined, sessionSummary: sessionSummaryMatch ? sessionSummaryMatch[1].trim() : undefined };
};

const STATE_FIELDS: Record<string, StateChange['field']> = {
  DAMAGE: 'hp', HEAL: 'hp', STRESS: 'stress', GOLD: 'gold', XP: 'xp', TOKEN: 'tokens', TOKENS: 'tokens',
};

/**
 * Теги изменения чисел. Терпимо к вариациям модели: «−»/«–» вместо минуса, запятая или двоеточие
 * после имени, хвост вроде «HP» или «золота». Одно изменение — один тег.
 */
export const parseStateTags = (text: string): { clean: string; changes: StateChange[] } => {
  const changes: StateChange[] = [];
  const clean = text
    .replace(/\[(DAMAGE|HEAL|STRESS|GOLD|XP|TOKENS?):\s*([^\]\d]+?)\s*[,:]?\s*([+\-−–]?)\s*(\d+)[^\]]*\]/gi, (_m, tag: string, rawName: string, sign: string, num: string) => {
      const kind = tag.toUpperCase();
      const name = rawName.replace(/[\s,:+\-−–]+$/, '').trim();
      const n = parseInt(num, 10);
      if (!name || !Number.isFinite(n)) return '';
      const negative = sign === '-' || sign === '−' || sign === '–';
      const delta = kind === 'DAMAGE' ? -Math.abs(n) : kind === 'HEAL' ? Math.abs(n) : negative ? -n : n;
      changes.push({ field: STATE_FIELDS[kind], name, delta });
      return '';
    })
    .replace(/\[(HIT|USE|CLOCK|TAKE|QUEST):[^\]]*\]/gi, '')
    .replace(/\[TROPHY:\s*([^\]|]+)(?:\|([^\]]*))?\]/gi, '')
    .replace(/\[FRONT:\s*([^\]|]+)\|([^\]|]*)\|([^\]|]+)\|([^\]]*)\]/gi, '')
    .replace(/\[MEMORIAL:\s*([^\]|]+)(?:\|([^\]]*))?\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ');
  return { clean, changes };
};

/** Часы [CLOCK: Название +N] и подбор добычи [TAKE: Герой|Предмет]. */
export const parseDramaTags = (text: string): { clocks: { name: string; delta: number }[]; takes: { name: string; item: string }[]; quests: { title: string; status: 'active' | 'done' | 'failed' }[] } => {
  const clocks: { name: string; delta: number }[] = [];
  const takes: { name: string; item: string }[] = [];
  for (const m of text.matchAll(/\[CLOCK:\s*([^\]]+?)\s*([+\-−–])\s*(\d+)\s*\]/gi)) {
    const n = parseInt(m[3], 10);
    if (n) clocks.push({ name: m[1].replace(/[«»"]/g, '').trim(), delta: m[2] === '+' ? n : -n });
  }
  for (const m of text.matchAll(/\[TAKE:\s*([^\]|]+)\|([^\]]+)\]/gi)) takes.push({ name: m[1].trim(), item: m[2].trim() });
  const quests: { title: string; status: 'active' | 'done' | 'failed' }[] = [];
  const QS: Record<string, 'active' | 'done' | 'failed'> = { active: 'active', 'принят': 'active', done: 'done', 'выполнен': 'done', failed: 'failed', 'провален': 'failed' };
  for (const m of text.matchAll(/\[QUEST:\s*([^\]|]+)\|\s*([^\]]+?)\s*\]/gi)) {
    const st = QS[m[2].toLowerCase()];
    if (st) quests.push({ title: m[1].replace(/[«»"]/g, '').trim(), status: st });
  }
  return { clocks, takes, quests };
};

/** Урон по врагам [HIT: Враг -N] и использование расходников [USE: Герой|Предмет]. */
export const parseCombatTags = (text: string): { hits: { name: string; delta: number }[]; uses: { name: string; item: string }[] } => {
  const hits: { name: string; delta: number }[] = [];
  const uses: { name: string; item: string }[] = [];
  for (const m of text.matchAll(/\[HIT:\s*([^\]\d]+?)\s*[,:]?\s*([+\-−–]?)\s*(\d+)[^\]]*\]/gi)) {
    const name = m[1].replace(/[\s,:+\-−–]+$/, '').trim();
    const n = parseInt(m[3], 10);
    if (name && n) hits.push({ name, delta: m[2] === '+' ? n : -n });
  }
  for (const m of text.matchAll(/\[USE:\s*([^\]|]+)\|([^\]]+)\]/gi)) {
    const name = m[1].trim();
    const item = m[2].trim();
    if (name && item) uses.push({ name, item });
  }
  return { hits, uses };
};

/** Стресс из меток бросков ([ROLL: ... | Stress: +2 ...]) и дубли Хаоса — применяет движок, а не модель. */
export const extractRollEffects = (text: string): { stress: { name: string; delta: number }[]; doomDoubles: number } => {
  const stress: { name: string; delta: number }[] = [];
  let doomDoubles = 0;
  let currentActor = '';
  for (const line of text.split('\n')) {
    const actor = line.match(/\[PLAYER ACTION: ([^\](]+?)\s*(?:\(|\])/)?.[1];
    if (actor) currentActor = actor.trim();
    if (!line.includes('[ROLL:')) continue;
    if (/DOUBLE!/i.test(line)) doomDoubles++;
    const m = line.match(/Stress:\s*([+\-−]?\d+)/);
    if (!m) continue;
    const name = line.match(/\*\*(.+?)\*\*/)?.[1] || currentActor;
    if (name) stress.push({ name: name.trim(), delta: parseInt(m[1].replace('−', '-'), 10) });
  }
  return { stress, doomDoubles };
};

export interface SideTags {
  trophies: { name: string; desc: string }[];
  fronts: { name: string; impulse: string; portents: string[]; doom: string }[];
  memorials: { name: string; desc: string }[];
}

export const parseSideTags = (text: string): SideTags => {
  const out: SideTags = { trophies: [], fronts: [], memorials: [] };
  for (const m of text.matchAll(/\[TROPHY:\s*([^\]|]+)(?:\|([^\]]*))?\]/gi)) {
    const name = m[1].trim();
    if (name) out.trophies.push({ name, desc: (m[2] || '').trim() });
  }
  for (const m of text.matchAll(/\[FRONT:\s*([^\]|]+)\|([^\]|]*)\|([^\]|]+)\|([^\]]*)\]/gi)) {
    const name = m[1].trim();
    const portents = m[3].split(';').map(s => s.trim()).filter(Boolean);
    if (name && portents.length) out.fronts.push({ name, impulse: m[2].trim(), portents, doom: m[4].trim() });
  }
  for (const m of text.matchAll(/\[MEMORIAL:\s*([^\]|]+)(?:\|([^\]]*))?\]/gi)) {
    const name = m[1].trim();
    if (name) out.memorials.push({ name, desc: (m[2] || '').trim() });
  }
  return out;
};

export interface TaleParse { text: string; choices: string[]; title?: string; moral?: string; lore?: string }

export const parseTale = (raw: string): TaleParse => {
  let text = raw;
  let choices: string[] = [];
  const grab = (tag: string) => {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = text.match(re);
    if (m) text = text.replace(re, '');
    return m ? m[1].trim() : undefined;
  };
  const choicesRaw = grab('choices_json');
  if (choicesRaw) {
    try {
      const parsed = JSON.parse(choicesRaw);
      if (Array.isArray(parsed)) choices = parsed.map(String).map(s => s.trim()).filter(Boolean).slice(0, 4);
    } catch {
      choices = choicesRaw.split(/\n|;/).map(s => s.replace(/^[-*\d.)\s"]+|["\s]+$/g, '')).filter(Boolean).slice(0, 4);
    }
  }
  const title = grab('tale_title');
  const moral = grab('tale_moral');
  const lore = grab('lore_update');
  // на всякий случай срезаем RPG-блоки, если модель их всё же вывела
  text = text.replace(/<(dashboard_json|codex_json|final_draft|session_summary)>[\s\S]*?<\/\1>/gi, '');
  text = text.replace(/\[(DAMAGE|HEAL|STRESS|GOLD|XP|TOKEN|ROLL)[^\]]*\]/gi, '');
  return { text: text.trim(), choices, title, moral, lore };
};

const HIDDEN_BLOCK_RE = /<(dashboard_json|codex_json|lore_update|final_draft|session_summary|choices_json|tale_title|tale_moral)[\s\S]*$/i;
const ENGINE_TAG_RE = /\[(DAMAGE|HEAL|STRESS|GOLD|XP|TOKEN|TROPHY|FRONT|MEMORIAL|HIT|USE):[^\]]*\]?/gi;

/** Очищает частично полученный стрим для показа игрокам: прячет JSON-блоки и движковые теги. */
export const cleanStreamForDisplay = (text: string): string =>
  text.replace(HIDDEN_BLOCK_RE, '').replace(ENGINE_TAG_RE, '').replace(/^###\s*(Narrative|Нарратив)\s*\n?/i, '').trimEnd();

/** Убирает из реплик игрока служебные теги движка и длинные системные команды. */
export const displayUserContent = (content: string): string => {
  const c = content || '';
  if (c.startsWith('[SYSTEM COMMAND: GAME START]')) return '▶ Начало приключения';
  if (c.startsWith('[TALE_START]')) return '▶ Начало сказки';
  if (c.startsWith('[TALE_END]')) return '🌙 Пора заканчивать сказку';
  if (c.startsWith('[TALE_CHOICE] Слушатели решили')) return '✦ Выборы слушателей';
  return c
    .replace(/^\[TALE_CHOICE\]\s*/, '✦ ')
    .replace(/^\[ROUND\][\s\S]*/, '⚔ Ход раунда')
    .replace(/^\[TRAVEL[^\]]*\][^«]*«([^»]+)»[\s\S]*/, '🧭 В путь: «$1»')
    .replace(/^\[EXPLORE\][^«]*«([^»]+)»[\s\S]*/, '🔎 Исследуем «$1»')
    .replace(/^\[SAVE_CHAPTER\][\s\S]*/, '💾 Сохранить главу')
    .replace(/^\[FINALE\][\s\S]*/, '🏁 Финал вечера')
    .replace(/^\[SESSION SUMMARY\][\s\S]*/, '🏆 Итоги партии')
    .replace(/^\[LEVEL UP\]([^.]*)\.[\s\S]*/, '⬆ Новый уровень:$1')
    .replace(/\n*\[(STATE|ENCOUNTER|WORLD EVENT|MUSE|ACTION SLOTS)[^\]]*\]/g, '')
    .replace(/\n*\[WORLD NEWS\][\s\S]*?\[\/WORLD NEWS\]/g, '')
    .trim();
};

