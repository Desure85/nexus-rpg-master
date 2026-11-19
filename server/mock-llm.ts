// Детерминированный «ИИ» для тестов, CI и демо без ключей (LLM_PROVIDER=mock).
// Отвечает в том же протоколе, что и настоящая модель: нарратив + JSON-блоки.
import type { LlmRequest } from "./llm";
import { demoReply } from "./mock-demo";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Всё, что игроки написали после последнего ответа мастера (normalizeMessages склеивает реплики). */
const lastUser = (req: LlmRequest) => [...req.messages].reverse().find(m => m.role === "user")?.content || "";

const parseHeroes = (text: string): { name: string; concept: string }[] => {
  const out: { name: string; concept: string }[] = [];
  for (const m of text.matchAll(/^- ([^(\n:]+?)\s*\([^)]*\):\s*(.+)$/gm)) out.push({ name: m[1].trim(), concept: m[2].trim() });
  return out;
};

const namesFromDashboard = (system: string): string[] => {
  const m = system.match(/### ТЕКУЩЕЕ СОСТОЯНИЕ ИГРЫ \(DASHBOARD\):\n([\s\S]*?)\nОБЯЗАТЕЛЬНО/);
  if (!m) return [];
  try { return (JSON.parse(m[1]).characters || []).map((c: any) => c.name); } catch { return []; }
};

function taleReply(req: LlmRequest): string {
  const user = lastUser(req);
  const chapter = Number(req.system.match(/Сейчас глава (\d+) из (\d+)/)?.[1] || 1);
  const isFinal = /ФИНАЛЬНАЯ глава/.test(req.system);
  const heroes = parseHeroes(req.messages.map(m => m.content).join("\n"));
  const who = heroes.map(h => h.name).join(" и ") || "Герой";
  const choice = user.match(/\[TALE_CHOICE\]\s*(.+)/)?.[1]?.trim();
  if (isFinal) {
    return `${choice ? `Герои решили: ${choice}. ` : ""}И вот ${who} вернулись домой, где их ждали тёплый чай и пироги. Все тревоги остались позади, а в небе зажглась новая звезда — в честь их доброго сердца.

<tale_title>Сказка о том, как ${who} нашли звезду</tale_title>
<tale_moral>Доброта освещает путь лучше любого фонаря.</tale_moral>
<lore_update>${who} прошли путь из ${chapter} глав и вернулись домой.</lore_update>`;
  }
  return `Глава ${chapter}. ${choice ? `${who} выбрали: «${choice}». ` : `Жили-были ${who}. `}Над лесом поднялась луна, и тропинка сама побежала вперёд, переливаясь серебром. У старого дуба сидела сова и что-то шептала про потерянную звезду.

${/#nochoices/.test(user) ? "" : `<choices_json>["Спросить сову о звезде", "Пойти по серебряной тропинке", "Позвать на помощь друзей"]</choices_json>`}
<lore_update>${who} ищут потерянную звезду. Глава ${chapter}.</lore_update>`;
}

function rpgReply(req: LlmRequest): string {
  const user = lastUser(req);
  if (/GAME START/.test(user) && /#nodash/.test(user)) return "Начинаем. Ветер гонит листья по пустой площади.";
  if (/GAME START/.test(user)) {
    const heroes = parseHeroes(user);
    const chars = heroes.map(h => ({
      name: h.name, hp: "12/12", stress: 0, tokens: 3, gold: 10, xp: 0, condition: "Готов к приключению", goal: h.concept,
      inventory: ["Факел", "Фляга воды"],
      actions: [{ category: "Профильный", name: "Осмотреться", description: "Изучить окрестности" }],
    }));
    const dash = {
      characters: chars, threats: [], sceneAspects: ["Туман над рекой"], sceneLoot: [],
      locations: [
        { id: "loc-town", name: "Приречье", description: "Тихий городок у реки", dangerLevel: 1, status: "visited", type: "city", services: ["market", "tavern", "inn", "healer", "questboard"], coordinates: { x: 50, y: 50 }, connections: ["loc-woods"] },
        { id: "loc-woods", name: "Шепчущий лес", description: "Тёмный лес за рекой", dangerLevel: 2, status: "known", type: "wilderness", services: [], coordinates: { x: 65, y: 40 }, connections: ["loc-town"] },
      ],
      currentLocationId: "loc-town", clocks: [], doomPool: 0, echoes: [], atmosphere: "Тревожное ожидание",
      suggestedRoll: { type: "classic", reason: "Внимательность" },
    };
    return `Над Приречьем стелется туман. ${heroes.map(h => h.name).join(", ")} встречаются у старой мельницы, где кто-то оставил странную записку.

<dashboard_json>${JSON.stringify(dash)}</dashboard_json>
<codex_json>[{"name": "Приречье", "type": "location", "description": "Тихий городок у реки", "status": "visited"}]</codex_json>
<lore_update>Герои собрались в Приречье и нашли загадочную записку.</lore_update>`;
  }
  if (/Архивариус/.test(req.system)) {
    return `Это известно в Кодексе: ответ на вопрос «${user.replace(/^\[CLARIFY\]\s*/, "").slice(0, 80)}».

<codex_json>[{"name": "Записка", "type": "item", "description": "Написана выцветшими чернилами", "status": "у героев"}]</codex_json>
<dashboard_json>{}</dashboard_json>`;
  }
  const names = namesFromDashboard(req.system);
  const actions = [...user.matchAll(/\[PLAYER ACTION: ([^\]]+)\]\s*([^\n]+)/g)].map(m => `${m[1]} — ${m[2].replace(/#\w+/g, "").trim()}`);
  if (/#cut/.test(user)) return "Мастер начинает рассказ, и голос его крепнет. Туман сгущается над площадью, фонари гаснут один за другим, над крышами плывёт колокольный звон. Вдруг из-за поворота пока";
  let body = /ответ оборвался/.test(user) ? "Из-за поворота выходит ночной патруль." : actions.length
    ? `Мастер разбирает ход. ${actions.join("; ")}. Мир откликается на каждое решение.`
    : `Мастер отвечает: «${user.split("\n")[0].slice(0, 120)}». Ветер доносит запах дыма.`;
  if (/#xp/.test(user) && names[0]) body += ` [XP: ${names[0]} +60]`;
  if (/#hurt/.test(user) && names[0]) body += ` [DAMAGE: ${names[0]} -3]`;
  if (/#hit/.test(user)) body += ` [HIT: Мародёр -${user.match(/#hit(\d+)/)?.[1] || 5}]`;
  if (/#potion/.test(user) && names[0]) body += ` [USE: ${names[0]}|Зелье лечения]`;
  if (/#clock/.test(user)) body += ` [CLOCK: Тревога +${user.match(/#clock(\d+)/)?.[1] || 1}]`;
  if (/#take/.test(user) && names[0]) body += ` [TAKE: ${names[0]}|Ключ]`;
  if (/#questdone/.test(user)) body += ` [QUEST: Найти мельника|done]`;
  const dash: any = { atmosphere: "Напряжение растёт" };
  // модель «пытается» переписать прогресс часов — движок не даст
  if (/#clock/.test(user)) dash.clocks = [{ name: "Тревога", progress: 0, total: 4 }];
  // угроза: при [ENCOUNTER] или по тестовому триггеру; модель «пытается» переписать HP — движок не даст
  if ((/\[ENCOUNTER:/.test(user) && !/тишина/.test(user)) || /#enemy|#hit/.test(user)) dash.threats = [{ name: "Мародёр", hp: "10/10", features: ["Ржавый тесак"] }];
  const thr = user.match(/#threat:([^:#\n]+):(\d+)/);
  if (thr) dash.threats = [{ name: thr[1].trim(), hp: `${thr[2]}/${thr[2]}`, features: [] }];
  let tail = `\n\n<dashboard_json>${JSON.stringify(dash)}</dashboard_json>`;
  if (/\[(SESSION SUMMARY|FINALE)\]/.test(user)) tail += `\n<session_summary>Герои прошли через туман и раскрыли тайну записки.</session_summary>`;
  if (/\[SAVE_CHAPTER\]/.test(user)) tail += `\n<lore_update>Архив: герои раскрыли тайну записки.</lore_update>\n<final_draft>Глава о тумане и записке.</final_draft>`;
  return body + tail;
}

function ideaReply(req: LlmRequest): string {
  const user = lastUser(req);
  if (/Имя: Концепт/.test(user)) return "Мира: Странствующая травница с говорящим вороном";
  if (/завязк/i.test(user)) return "В колодце на площади по ночам кто-то поёт колыбельные.";
  return "Город на спине гигантской черепахи, плывущей сквозь туманы.";
}

let oracleCounter = 0;
const MOCK_ROWS: Record<string, string[]> = {
  actions: ["предать", "спрятать", "выкупить долг", "освободить", "подделать", "защитить", "разрушить", "выменять", "разоблачить", "преследовать", "обещать", "украсть", "исцелить", "заманить", "вернуть"],
  subjects: ["гильдия ныряльщиков", "старая карта", "чужое имя", "клятва", "сигнальный огонь", "ключ от маяка", "семейная тайна", "морской зверь", "разводной мост", "песня туманов", "письмо без подписи", "наследство", "треснувшее зеркало", "контрабанда", "призрак смотрителя"],
  complications: ["Мост обрушивается под весом", "Свидетель внезапно исчезает", "Союзник требует плату вперёд", "Туман скрывает тропу", "Стража перекрывает выход", "Ценный предмет оказывается подделкой", "Начинается шторм", "Кто-то идёт по следу", "Огонь перекидывается на склад", "Проводник лжёт о дороге"],
  npcs: ["Старая рыбачка, хочет вернуть сына, говорит загадками", "Юный стражник, мечтает о славе, боится темноты", "Купец-полиглот, копит долги, всегда улыбается", "Слепой звонарь, слышит ложь, просит о тишине", "Беглая жрица, ищет реликвию, носит чужое имя", "Контрабандист, хочет уйти на покой, шутит невпопад"],
  details: ["Запах мокрой пеньки", "Скрип ставен на ветру", "Свежие царапины на двери", "Капающий воск свечи", "Крик чаек вдалеке", "Солёная корка на камнях", "Детский рисунок углём"],
  helpers: ["Мудрая черепаха", "Болтливая сорока", "Сонный дракончик", "Добрый великан", "Звёздный мотылёк", "Лунный заяц"],
  wonders: ["Поющий цветок", "Карта, которая рисуется сама", "Колокольчик, зовущий ветер", "Клубок-проводник", "Зеркальце правды"],
  trials: ["Загадка у моста", "Потерявшийся малыш", "Заколдованная тропинка", "Обида, которую надо простить", "Буря, которую надо переждать"],
};
/** Таблицы оракула: правдоподобные уникальные строки; пожелание мастера попадает в строки (для тестов). */
function oracleReply(req: LlmRequest): string {
  const user = lastUser(req);
  const hint = user.match(/ПОЖЕЛАНИЕ МАСТЕРА \(главное\): ([^\n]+)/)?.[1]?.trim();
  const out: Record<string, string[]> = {};
  for (const m of user.matchAll(/^"(\w+)": (\d+) строк/gm)) {
    const base = MOCK_ROWS[m[1]] || [m[1]];
    out[m[1]] = Array.from({ length: Number(m[2]) }, () => {
      const n = ++oracleCounter;
      return `${base[n % base.length]} #${n}${hint ? ` (${hint})` : ""}`;
    });
  }
  return JSON.stringify(out);
}

export async function mockComplete(req: LlmRequest, onDelta: (d: string) => void): Promise<string> {
  const text = process.env.MOCK_STYLE === "demo" ? demoReply(req)
    : /дизайнер таблиц оракула/.test(req.system) ? oracleReply(req)
    : /Сказочник/.test(req.system) ? taleReply(req)
    : /креативный помощник/.test(req.system) ? ideaReply(req)
    : rpgReply(req);
  const delay = Number(process.env.MOCK_LLM_DELAY_MS ?? 15);
  for (let i = 0; i < text.length; i += 24) {
    onDelta(text.slice(i, i + 24));
    if (delay > 0) await sleep(delay);
  }
  return text;
}
