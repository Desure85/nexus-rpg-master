// Оракул сессии: таблицы под сеттинг генерирует модель, а бросает по ним движок.
// Строки тянутся «колодой» — без повторов, пока колода не кончится. Когда остаётся мало,
// движок сам догенерирует новые строки; мастер может догенерировать или перегенерировать
// таблицы с подсказкой («перешли в подземный мир») и править их вручную.
import type { DB } from "./db";
import type { StoredSession } from "./store";
import { safeJsonParse } from "../shared/parse";
import {
  MUSE_ACTIONS, MUSE_SUBJECTS, GENTLE_ACTIONS, GENTLE_SUBJECTS, TALE_HELPERS, TALE_WONDERS, TALE_TRIALS,
} from "../shared/oracle";

type Rng = () => number;

export interface OracleTableDef { id: string; title: string; hint: string; count: number }

/** Таблицы RPG-сессии. count — сколько строк просим за одну генерацию. */
export const RPG_TABLES: OracleTableDef[] = [
  { id: "actions", title: "Действия", hint: "глаголы-действия для поворотов сюжета (1–2 слова: «предать», «выкупить долг»)", count: 30 },
  { id: "subjects", title: "Темы", hint: "существительные-темы, привязанные к сеттингу (1–4 слова: «гильдия ныряльщиков», «чёрный рынок воды»)", count: 30 },
  { id: "complications", title: "Осложнения", hint: "неожиданные осложнения сцены одной фразой (до 12 слов)", count: 20 },
  { id: "npcs", title: "NPC", hint: "NPC одной фразой: кто, чего хочет и чем выделяется (до 14 слов)", count: 20 },
  { id: "details", title: "Детали мест", hint: "яркие детали локаций: звук, запах, предмет, примета (до 10 слов)", count: 20 },
];

export const TALE_TABLES: OracleTableDef[] = [
  { id: "helpers", title: "Помощники", hint: "сказочные помощники одной фразой (до 8 слов)", count: 15 },
  { id: "wonders", title: "Чудеса", hint: "волшебные предметы и чудеса (до 10 слов)", count: 15 },
  { id: "trials", title: "Испытания", hint: "добрые испытания и загадки без страха (до 10 слов)", count: 15 },
];

const FALLBACK: Record<string, readonly string[]> = {
  actions: MUSE_ACTIONS, subjects: MUSE_SUBJECTS, gentle_actions: GENTLE_ACTIONS, gentle_subjects: GENTLE_SUBJECTS,
  helpers: TALE_HELPERS, wonders: TALE_WONDERS, trials: TALE_TRIALS,
};

/** Максимум строк в таблице: дальше колода просто перетасовывается. */
export const MAX_ROWS = Number(process.env.ORACLE_MAX_ROWS || 150);
/** Догенерация, когда в колоде осталось меньше этой доли. */
const LOW_WATERMARK = 0.2;

export interface OracleTable { id: string; title: string; rows: string[]; used: number[]; updatedAt?: string }

export const tablesFor = (s: Pick<StoredSession, "mode">) => (s.mode === "tale" ? TALE_TABLES : RPG_TABLES);

const norm = (x: string) => x.toLowerCase().replace(/ё/g, "е").replace(/[«»"'.!?]/g, "").replace(/\s+/g, " ").trim();

/** Чистка ответа модели: строки, без дублей (в т.ч. с уже существующими), разумной длины. */
export const cleanRows = (rows: unknown, existing: string[] = []): string[] => {
  if (!Array.isArray(rows)) return [];
  const seen = new Set(existing.map(norm));
  const out: string[] = [];
  for (const r of rows) {
    if (typeof r !== "string") continue;
    const t = r.replace(/^[-*\d.)\s]+/, "").trim();
    if (t.length < 2 || t.length > 120) continue;
    const k = norm(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
};

export function createOracleStore(db: DB) {
  const load = (sessionId: string): Record<string, OracleTable> => {
    const rows = db.prepare("SELECT * FROM oracle_tables WHERE session_id = ?").all(sessionId) as any[];
    return Object.fromEntries(rows.map(r => [r.table_id, { id: r.table_id, title: r.title, rows: JSON.parse(r.rows || "[]"), used: JSON.parse(r.used || "[]"), updatedAt: r.updated_at }]));
  };

  const save = (sessionId: string, t: OracleTable) => {
    db.prepare(`INSERT INTO oracle_tables (session_id, table_id, title, rows, used, updated_at) VALUES (?,?,?,?,?, CURRENT_TIMESTAMP)
      ON CONFLICT(session_id, table_id) DO UPDATE SET title = excluded.title, rows = excluded.rows, used = excluded.used, updated_at = CURRENT_TIMESTAMP`)
      .run(sessionId, t.id, t.title, JSON.stringify(t.rows), JSON.stringify(t.used));
  };

  /**
   * Вытянуть строку без повторов. Возвращает строку и признак «колода на исходе».
   * Если своей таблицы нет — берём из общего запасного набора (без учёта повторов).
   */
  const draw = (sessionId: string, tableId: string, rng: Rng = Math.random, fallbackId = tableId): { value: string; low: boolean; source: "session" | "default" } | null => {
    const t = load(sessionId)[tableId];
    if (!t || t.rows.length === 0) {
      const fb = FALLBACK[fallbackId];
      return fb ? { value: fb[Math.floor(rng() * fb.length) % fb.length], low: false, source: "default" } : null;
    }
    let free = t.rows.map((_, i) => i).filter(i => !t.used.includes(i));
    if (free.length === 0) {
      // колода кончилась — перетасовываем, но последние выпавшие не повторяем сразу
      const recent = t.used.slice(-Math.min(5, Math.floor(t.rows.length / 2)));
      t.used = [];
      free = t.rows.map((_, i) => i).filter(i => !recent.includes(i));
      if (!free.length) free = t.rows.map((_, i) => i);
    }
    const idx = free[Math.floor(rng() * free.length) % free.length];
    t.used.push(idx);
    save(sessionId, t);
    const remaining = t.rows.length - t.used.length;
    return { value: t.rows[idx], low: remaining <= Math.max(2, Math.floor(t.rows.length * LOW_WATERMARK)) && t.rows.length < MAX_ROWS, source: "session" };
  };

  /** Записать результат генерации: replace — заменить, extend — дописать (без дублей, с потолком MAX_ROWS). */
  const apply = (sessionId: string, defs: OracleTableDef[], data: Record<string, unknown>, mode: "replace" | "extend") => {
    const current = load(sessionId);
    const changed: string[] = [];
    for (const def of defs) {
      const prev = current[def.id];
      if (mode === "replace") {
        const rows = cleanRows(data[def.id]).slice(0, MAX_ROWS);
        if (rows.length < 3) continue;
        save(sessionId, { id: def.id, title: def.title, rows, used: [] });
        changed.push(def.id);
      } else {
        const add = cleanRows(data[def.id], prev?.rows || []);
        if (!add.length) continue;
        let rows = [...(prev?.rows || []), ...add];
        let used = prev?.used || [];
        if (rows.length > MAX_ROWS) {
          // вытесняем самые старые уже выпавшие строки
          const drop = rows.length - MAX_ROWS;
          const dropIdx = new Set(used.slice(0, drop));
          const keep = rows.map((r, i) => ({ r, i })).filter(x => !dropIdx.has(x.i));
          const remap = new Map(keep.map((x, j) => [x.i, j]));
          rows = keep.map(x => x.r).slice(0, MAX_ROWS);
          used = used.filter(i => remap.has(i)).map(i => remap.get(i)!).filter(i => i < rows.length);
        }
        save(sessionId, { id: def.id, title: def.title, rows, used });
        changed.push(def.id);
      }
    }
    return changed;
  };

  const setRows = (sessionId: string, def: OracleTableDef, rows: string[]) => {
    const clean = cleanRows(rows).slice(0, MAX_ROWS);
    save(sessionId, { id: def.id, title: def.title, rows: clean, used: [] });
    return clean;
  };

  return { load, save, draw, apply, setRows };
}

export type OracleStore = ReturnType<typeof createOracleStore>;

/** Промпт генерации таблиц. existing — уже имеющиеся строки, чтобы модель не повторялась. */
export const buildOraclePrompt = (s: StoredSession, defs: OracleTableDef[], mode: "replace" | "extend", hint: string | undefined, existing: Record<string, OracleTable>) => {
  const kids = s.mode === "tale" || s.style === "fairytale";
  const codexNames = (s.codex || []).slice(-30).map(c => c.name).join(", ");
  const system = `Ты дизайнер таблиц оракула для ${s.mode === "tale" ? "интерактивных сказок" : "соло- и групповых НРИ (в духе Mythic GME)"}.
Строки таблиц — короткие, конкретные, разнообразные зацепки, по которым движок случайно выбирает вдохновение для мастера.
Требования:
- Строго в тоне и лексике сеттинга: никаких элементов чужого жанра.
- Разнообразие: разные масштабы (личное, местное, глобальное), настроения и типы событий. Никаких повторов и почти-синонимов.
- Строки самодостаточны и понятны без контекста, без нумерации.${kids ? "\n- Детская безопасность: никаких смертей, крови, жестокости и настоящего страха." : ""}
- Ответ — ТОЛЬКО JSON-объект без markdown, ключи — id таблиц, значения — массивы строк.`;
  const tables = defs.map(d => `"${d.id}": ${d.count} строк — ${d.hint}`).join("\n");
  const avoid = mode === "extend"
    ? defs.map(d => (existing[d.id]?.rows.length ? `"${d.id}" уже есть (НЕ повторяй и не перефразируй): ${existing[d.id].rows.slice(-60).join("; ")}` : "")).filter(Boolean).join("\n")
    : "";
  const user = `${mode === "extend" ? "Допиши НОВЫЕ строки в таблицы" : "Создай таблицы оракула"} для сессии.
Сеттинг: ${s.setting}
Стиль: ${s.style}${s.lore ? `\nСюжет на сейчас: ${s.lore.slice(0, 1500)}` : ""}${codexNames ? `\nИзвестные имена и места: ${codexNames}` : ""}${hint ? `\nПОЖЕЛАНИЕ МАСТЕРА (главное): ${hint}` : ""}

Таблицы:
${tables}
${avoid ? `\n${avoid}\n` : ""}
Ответ: {${defs.map(d => `"${d.id}": [...]`).join(", ")}}`;
  return { system, user };
};

export const parseOracleResponse = (text: string): Record<string, unknown> | null => {
  try {
    const obj = safeJsonParse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
};
