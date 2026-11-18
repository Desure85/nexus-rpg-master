// «Рассказчик» для демо без ИИ (MOCK_STYLE=demo): правдоподобные ответы в протоколе модели.
// Не умный, но живой: читает действия игроков, подсказки оракула [MUSE], угрозы и слоты действий,
// и отдаёт нарратив + теги механик, чтобы в демо работали урон, лут, опыт, уровни и предметы.
import type { LlmRequest } from "./llm";
import { resolvedOutcomes, type Outcome } from "../shared/resolve";
import { genreOf as sharedGenreOf } from "../shared/genre";

let seed = Date.now() % 100000;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed % 100000) / 100000; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const lastUser = (req: LlmRequest) => [...req.messages].reverse().find(m => m.role === "user")?.content || "";

const dashboardOf = (system: string): any => {
  const m = system.match(/### ТЕКУЩЕЕ СОСТОЯНИЕ ИГРЫ \(DASHBOARD\):\n([\s\S]*?)\nОБЯЗАТЕЛЬНО/);
  try { return m ? JSON.parse(m[1]) : {}; } catch { return {}; }
};

const parseHeroes = (text: string) => [...text.matchAll(/^- ([^(\n:]+?)\s*\(([^)]*)\):\s*(.+)$/gm)]
  .map(m => ({ name: m[1].trim(), female: /Женщ/.test(m[2]), concept: m[3].trim() }));

/** [ACTION SLOTS: Имя: Профильный, Рискованный; Имя2: …] */
const parseSlots = (text: string): Record<string, string[]> => {
  const m = text.match(/\[ACTION SLOTS: ([^\]]+)\]/);
  const out: Record<string, string[]> = {};
  if (!m) return out;
  for (const part of m[1].split(";")) {
    const [name, cats] = part.split(":");
    if (name && cats) out[name.trim()] = cats.split(",").map(c => c.trim()).filter(Boolean);
  }
  return out;
};

const museOf = (text: string) => {
  const m = text.match(/\[MUSE: ([^\]]+)\]/)?.[1] || "";
  return {
    motif: m.match(/«([^»]+)»/)?.[1],
    complication: m.match(/осложнение: ([^;\]]+)/)?.[1]?.trim(),
    npc: m.match(/NPC: ([^;\]]+)/)?.[1]?.trim(),
    detail: m.match(/деталь: ([^;\]]+)/)?.[1]?.trim(),
  };
};

type Genre = "fantasy" | "cyber" | "space" | "post" | "horror" | "west" | "tale";
const genreOf = (text: string): Genre => {
  const t = text.toLowerCase();
  if (/сказк|зайч|ёжик|волшебн/.test(t) && !/фэнтези/.test(t)) return "tale";
  return sharedGenreOf(t) as Genre;
};

const WORLD: Record<Genre, { place: string[]; enemy: string[]; loot: string[]; npc: string[]; sense: string[]; weapon: string[] }> = {
  fantasy: {
    place: ["Приречье", "Шепчущий лес", "Руины сторожевой башни", "Пещера Слепого Ручья", "Курган Трёх Королей"],
    enemy: ["Мародёр", "Тенистый волк", "Гоблин-разведчик", "Костяной страж", "Болотная ведьма"],
    loot: ["Зелье лечения", "Серебряный кинжал", "Свиток света", "Старая карта", "Амулет из волчьего клыка"],
    npc: ["трактирщица Ведана", "старый мельник Остап", "бродячий монах Лука", "капитан стражи Ярема"],
    sense: ["пахнет сырой землёй и дымом", "где-то воет ветер в печной трубе", "под ногами хрустит иней", "в кронах перекликаются вороны"],
    weapon: ["Меч", "Кинжал", "Посох", "Лук"],
  },
  cyber: {
    place: ["Нижний Сектор-9", "Неоновый рынок", "Башня «Аркадия»", "Заброшенная станция метро", "Серверная ферма"],
    enemy: ["Боевой дрон", "Наёмник корпорации", "Кибер-пёс", "Взломщик-призрак", "Охранный турель-бот"],
    loot: ["Стимулятор", "Чип доступа", "Глушилка", "Кредитный ключ", "Нейрошунт"],
    npc: ["фиксер Сая", "уличный док Рен", "бармен-андроид Пятый", "журналистка Ли"],
    sense: ["неон мигает сквозь кислотный дождь", "гудят трансформаторы", "пахнет озоном и лапшой", "в динамиках шипит реклама"],
    weapon: ["Пистолет", "Моноструна", "Шокер", "Кибер-клинок"],
  },
  space: {
    place: ["Станция «Гелиос»", "Грузовой отсек", "Пояс астероидов", "Мостик фрегата", "Заброшенная колония"],
    enemy: ["Пират-абордажник", "Ксеноморф", "Сбойный дроид", "Охотник за головами", "Рой нано-жуков"],
    loot: ["Аптечка", "Плазменная ячейка", "Ключ-карта капитана", "Звёздная карта", "Щит-генератор"],
    npc: ["навигатор Тесс", "механик Борн", "посол Ирриан", "квартирмейстер Окто"],
    sense: ["за иллюминатором плывёт туманность", "гудит рециркулятор воздуха", "мигает аварийная подсветка", "металл переборок звенит от удара"],
    weapon: ["Бластер", "Вибронож", "Импульсная винтовка", "Гравимолот"],
  },
  post: {
    place: ["Ржавый форпост", "Пустошь", "Бункер №7", "Мёртвый город", "Сухое водохранилище"],
    enemy: ["Рейдер", "Мутант-падальщик", "Дикий пёс", "Ржавый голем", "Культист пустоши"],
    loot: ["Антирад", "Фляга чистой воды", "Самодельный обрез", "Счётчик Гейгера", "Ящик консервов"],
    npc: ["торговка Мара", "старик-сталкер Гром", "механик Ржавчина", "дети с маяка"],
    sense: ["ветер гонит пыль по пустой трассе", "трещит счётчик Гейгера", "пахнет гарью и бензином", "небо цвета старого синяка"],
    weapon: ["Обрез", "Мачете", "Арбалет", "Труба с гвоздями"],
  },
  horror: {
    place: ["Особняк Блэквуд", "Туманная набережная", "Часовня на холме", "Анатомический театр", "Катакомбы"],
    enemy: ["Одержимый", "Тень в зеркале", "Культист", "Гуль", "Призрак гувернантки"],
    loot: ["Нюхательная соль", "Серебряная пуля", "Дневник профессора", "Освящённая свеча", "Ключ от склепа"],
    npc: ["инспектор Грейвз", "медиум мадам Вейл", "дворецкий Хиггинс", "доктор Морроу"],
    sense: ["газовые фонари едва пробивают туман", "часы бьют не в свой час", "пахнет воском и формалином", "где-то скрипит половица"],
    weapon: ["Трость-шпага", "Револьвер", "Скальпель", "Распятие"],
  },
  west: {
    place: ["Городок Пыльный Ручей", "Салун «Последний патрон»", "Каньон Мертвеца", "Заброшенный рудник", "Железнодорожная станция"],
    enemy: ["Бандит", "Оборотень-койот", "Шериф-мертвец", "Гремучник", "Призрачный всадник"],
    loot: ["Виски-лекарство", "Коробка патронов", "Серебряная звезда", "Карта рудника", "Талисман шамана"],
    npc: ["шериф Мэйбл", "гробовщик Сайлас", "торговец Чен", "шаман Седое Облако"],
    sense: ["перекати-поле катится по улице", "солнце печёт затылок", "скрипит вывеска салуна", "вдали воют койоты"],
    weapon: ["Револьвер", "Винчестер", "Нож боуи", "Лассо"],
  },
  tale: {
    place: ["Солнечная поляна", "Дом под старым дубом", "Звёздный мост", "Медовый ручей", "Облачный замок"],
    enemy: ["Ворчливый тролль", "Колючий куст", "Хитрая лиса", "Туча-плакса", "Каменный сторож"],
    loot: ["Волшебное яблочко", "Светлячок в баночке", "Клубок-проводник", "Пёрышко ветра", "Сладкий пряник"],
    npc: ["мудрая сова Уху", "ёж-почтальон", "добрая фея Ромашка", "медвежонок Бу"],
    sense: ["пахнет земляникой", "в траве стрекочут кузнечики", "облака похожи на барашков", "ручеёк что-то напевает"],
    weapon: ["Палочка", "Корзинка", "Фонарик", "Зонтик"],
  },
};

const OPEN = [
  (w: string) => `Над этим краем стелется тревожная тишина — ${w}.`,
  (w: string) => `Вечер опускается медленно, и ${w}.`,
  (w: string) => `Мир будто затаил дыхание: ${w}.`,
];

const reaction = (action: string) => {
  const a = action.toLowerCase();
  if (/атак|бь[юёе]|удар|стреля|руб|сраж|напад|кол[юе]|режу/.test(a)) return "fight";
  if (/осматр|ищ|обыск|исслед|изуча|провер|подбира|подобра/.test(a)) return "search";
  if (/зель|пь[юёе]|лечу|перевяз|отдых|лечит|аптечк|стимулятор|антирад/.test(a)) return "heal";
  if (/говор|спрос|убежд|догов|торгу|угрожа|обман|рассказ/.test(a)) return "talk";
  if (/пряч|крад|тих|незамет|прокрад/.test(a)) return "sneak";
  if (/беж|уход|отступ|бег/.test(a)) return "flee";
  return "other";
};

const NARR: Record<string, string[]> = {
  fight: ["Сталь встречает сталь — удар выходит точным и злым.", "Противник не ожидал такой ярости и отшатывается.", "Короткая схватка: пыль, крик и звон оружия."],
  search: ["Пальцы нащупывают то, что пропустили другие.", "Внимательный взгляд выхватывает странную деталь.", "Тайник оказывается там, где никто бы не стал искать."],
  heal: ["Тепло разливается по телу, раны перестают ныть.", "Пара минут передышки — и мир снова обретает краски."],
  talk: ["Собеседник щурится, но слова попадают в цель.", "Разговор идёт трудно, но в конце звучит важное признание.", "В ответ — долгая пауза и неожиданная откровенность."],
  sneak: ["Шаг за шагом, в тени — никто не замечает движения.", "Тень скрывает героя, но сердце стучит громко."],
  flee: ["Рывок — и опасность остаётся позади, хотя и ненадолго.", "Отступление выходит поспешным, но спасительным."],
  other: ["Решение приведено в действие, и мир отвечает на него.", "Последствия не заставляют себя ждать.", "Задуманное удаётся — пусть и не совсем так, как планировалось."],
};

const ACTION_IDEAS: Record<string, (g: Genre, hero: string) => { name: string; description: string }> = {
  "Профильный": (g) => ({ name: pick(["Использовать опыт", "Прочесть следы", "Применить ремесло"]), description: `Опереться на сильную сторону — ${pick(WORLD[g].sense)}` }),
  "Рискованный": (g) => ({ name: pick(["Броситься вперёд", "Сыграть ва-банк", "Перехватить инициативу"]), description: `Высокая ставка: ${pick(WORLD[g].enemy).toLowerCase()} может ответить жёстко` }),
  "Синергия": () => ({ name: pick(["Прикрыть союзника", "Совместный манёвр", "Отвлечь на себя"]), description: "Действовать вместе — бонус к броску союзника" }),
  "Искушение": (g) => ({ name: pick(["Взять чужое", "Сделка с тенью", "Срезать путь"]), description: `Быстрая выгода: ${pick(WORLD[g].loot)}, но с ценой (+1 к Doom)` }),
  "Loot": (g) => ({ name: `Подобрать ${pick(WORLD[g].loot)}`, description: "Забрать добычу из сцены" }),
};
const actionsFor = (g: Genre, hero: string, cats?: string[]) => {
  const seen = new Set<string>();
  return (cats?.length ? cats : ["Профильный", "Рискованный"]).map(c => {
    let a = (ACTION_IDEAS[c] || ACTION_IDEAS["Профильный"])(g, hero);
    for (let i = 0; i < 6 && seen.has(a.name); i++) a = (ACTION_IDEAS[c] || ACTION_IDEAS["Профильный"])(g, hero);
    seen.add(a.name);
    return { category: c, ...a };
  });
};

const startItems = (g: Genre, concept: string) => {
  const c = concept.toLowerCase();
  const items = [pick(WORLD[g].loot)];
  if (/травни|лекар|жриц|док|медик/.test(c)) items.push(g === "cyber" ? "Стимулятор" : g === "space" ? "Аптечка" : "Зелье лечения");
  else items.push(pick(WORLD[g].loot));
  return [...new Set(items)];
};

function gameStart(req: LlmRequest, user: string) {
  const heroes = parseHeroes(user);
  const setting = user.match(/Сеттинг: (.+)/)?.[1] || "";
  const hook = user.match(/Завязка: (.+)/)?.[1] || "";
  const g = genreOf(setting + " " + hook);
  const W = WORLD[g];
  const slots = parseSlots(user);
  const [home, near, far] = [W.place[0], W.place[1], W.place[2]];
  const chars = heroes.map(h => {
    const hp = between(10, 14);
    return {
      name: h.name, hp: `${hp}/${hp}`, stress: 0, tokens: 1, gold: between(5, 20), xp: 0, condition: "Полон сил", goal: h.concept,
      inventory: startItems(g, h.concept),
      equipment: [
        { slot: "main-hand", item: { name: pick(W.weapon), description: "Верное оружие", bonus: "+1 к атаке", rarity: "common" } },
        { slot: "body", item: chance(0.5) ? { name: "Дорожный плащ", description: "Потёртый, но тёплый", bonus: "+1 к скрытности", rarity: "common" } : null },
      ],
      actions: actionsFor(g, h.name, slots[h.name]),
    };
  });
  const npc = pick(W.npc);
  const dash = {
    characters: chars,
    threats: [],
    sceneAspects: [pick(W.sense).replace(/^./, c => c.toUpperCase()), "Чужие следы"],
    sceneLoot: [pick(W.loot)],
    locations: [
      { id: "loc-1", name: home, description: `Отсюда начинается история: ${pick(W.sense)}.`, dangerLevel: 1, status: "visited", type: "city", services: ["market", "tavern", "inn", "healer", "questboard"], coordinates: { x: 45, y: 55 }, connections: ["loc-2"] },
      { id: "loc-2", name: near, description: "Место, о котором ходят слухи", dangerLevel: 2, status: "known", type: "wilderness", services: [], coordinates: { x: 62, y: 38 }, connections: ["loc-1", "loc-3"] },
      { id: "loc-3", name: far, description: "Говорят, туда лучше не ходить", dangerLevel: 3, status: "rumored", type: "dungeon", services: [], coordinates: { x: 78, y: 22 }, connections: ["loc-2"] },
    ],
    currentLocationId: "loc-1", clocks: [{ name: "Угроза крепнет", progress: 1, total: 6 }], doomPool: 0, echoes: [],
    atmosphere: "Тревожное ожидание", suggestedRoll: { type: "classic", reason: "Внимательность", dc: 12 },
  };
  const who = heroes.map(h => h.name);
  const meet = who.length > 1 ? `${who.slice(0, -1).join(", ")} и ${who.at(-1)} встречаются` : `${who[0] || "Герой"} ${heroes[0]?.female ? "оказалась" : "оказался"}`;
  const text = `${pick(OPEN)(pick(W.sense))} ${meet} в месте под названием «${home}».

${hook || `Здесь давно творится неладное, и ${npc} явно знает больше, чем говорит.`} Собеседник подходит ближе и понижает голос: «Если вы ищете неприятности — вы их нашли».

Что вы сделаете первым делом?

<dashboard_json>${JSON.stringify(dash)}</dashboard_json>
<codex_json>${JSON.stringify([
    { name: home, type: "location", description: `Стартовая точка: ${pick(W.sense)}.`, status: "visited" },
    { name: npc.replace(/^\S+\s/, ""), type: "npc", description: `${npc}: хочет, чтобы беда обошла стороной; боится, что правда выйдет наружу`, status: "знаком" },
  ])}</codex_json>
<lore_update>Герои оказались в ${home}. ${hook}</lore_update>`;
  return text;
}

function turn(req: LlmRequest, user: string) {
  const dash = dashboardOf(req.system);
  const chars: any[] = dash.characters || [];
  const names = chars.map(c => c.name);
  const start = req.messages.find(m => m.role === "user" && /GAME START/.test(m.content))?.content || "";
  const g = genreOf((start.match(/Сеттинг: (.+)/)?.[1] || "") + " " + (start.match(/Завязка: (.+)/)?.[1] || "") || JSON.stringify(dash.locations || ""));
  const W = WORLD[g];
  const muse = museOf(user);
  const slots = parseSlots(user);

  // действия: мультиплеер [PLAYER ACTION: Имя] текст или соло-реплика
  let acts = [...user.matchAll(/\[PLAYER ACTION: ([^\](]+?)\s*(?:\([^)]*\))?\]\s*([^\n]+)/g)].map(m => ({ who: m[1].trim(), text: m[2] }));
  if (!acts.length) {
    const plain = user.split("\n").filter(l => l.trim() && !l.startsWith("[")).join(" ").trim() || user.replace(/\[[^\]]*\]/g, "").trim();
    const who = names.find(n => plain.includes(n)) || names[0] || "Герой";
    acts = [{ who, text: plain }];
  }
  const threats: any[] = (dash.threats || []).filter((t: any) => Number(String(t.hp).split("/")[0]) > 0);
  const tags: string[] = [];
  const parts: string[] = [];
  const newThreats: any[] = [];
  let loot: string[] = dash.sceneLoot || [];

  const travel = user.match(/^\[TRAVEL[^\]]*\][^«]*«([^»]+)»/m)?.[1];
  const explore = user.match(/^\[EXPLORE\][^«]*«([^»]+)»/m)?.[1];
  if (travel) parts.push(`Дорога до места «${travel}» занимает время: ${pick(W.sense)}. Наконец впереди показывается цель.`);
  if (explore) parts.push(`Герои прочёсывают «${explore}» шаг за шагом. ${pick(NARR.search)}`);

  const outcomes = resolvedOutcomes(user);
  const OUT: Record<Outcome, string[]> = {
    crit: ["Всё складывается идеально — лучше, чем можно было мечтать.", "Время будто замедляется: каждое движение точно и красиво."],
    success: ["Чисто и уверенно — задуманное удаётся.", "Получилось, и без всяких подвохов."],
    partial: ["Получилось — но не даром.", "Цель достигнута, хотя цена ощутима."],
    fail: ["Не вышло: в последний миг всё идёт наперекосяк.", "Расчёт оказался неверным, и мир отвечает жёстко."],
    critfail: ["Хуже некуда: ошибка оборачивается новой бедой.", "Провал настолько громкий, что его услышали все вокруг."],
  };
  const newEchoes: string[] = [];
  const firstClock = (dash.clocks || [])[0]?.name;
  for (const m of user.matchAll(/\[ECHO RETURN: «([^»]+)»\]/g)) parts.push(`Прошлое напоминает о себе: ${m[1].charAt(0).toLowerCase() + m[1].slice(1)} — и это меняет расклад.`);
  for (const m of user.matchAll(/\[CLOCK FILLED: «([^»]+)»\]/g)) parts.push(`Часы «${m[1]}» пробили. То, чего все боялись, случилось: ${pick(["ворота распахиваются", "в городе бьют тревогу", "враг выходит из тени", "мост рушится"])}.`);
  for (const m of user.matchAll(/\[(ECONOMY|CAROUSE|TRAIN|BASE|EXPEDITION|IDLE|FRONT NEWS|PARTY|ITEM USED): ([^\]]+)\]/g)) {
    const t = m[2].replace(/\s*—\s*придумай[^\]]*$/, "").trim();
    parts.push(`${t.charAt(0).toUpperCase() + t.slice(1)}.`);
  }
  for (const m of user.matchAll(/\[LOOT TAKEN: ([^\]]+)\]/g)) parts.push(`${m[1].replace(/забирает/, "прячет в сумку")}.`);
  const spent = [...user.matchAll(/\[TOKEN SPENT: ([^→\]]+)→ ([^\]:]+)(?::\s*([^\]]+))?\]/g)];
  for (const m of spent) parts.push(m[2].trim() === "флешбэк" ? `*Вспышка памяти.* ${m[1].trim()} вспоминает: ${m[3] || "подготовка не прошла даром"} — и сейчас это решает дело.` : m[2].trim() === "право на истину" ? `Оказывается, ${m[3] || "мир устроен чуть иначе, чем казалось"}.` : `${m[1].trim()} рывком поднимает союзника на ноги.`);
  for (const a of acts) {
    if (/\[FLASHBACK/.test(a.text)) { parts.push(`*Вспышка памяти.* **${a.who}** ${a.text.replace(/\[[^\]]*\]\s*/g, "").replace(/^./, c => c.toLowerCase())} — и вот теперь это пригодилось.`); tags.push(`[XP: ${a.who} +10]`); continue; }
    if (/\[NARRATIVE RIGHT/.test(a.text)) { parts.push(`Мир послушно меняется: ${a.text.replace(/\[[^\]]*\]\s*/g, "").replace(/^./, c => c.toLowerCase())}. **${a.who}** знал это с самого начала.`); continue; }
    const takeItem = /подобра|забира|бер[уё]|взять|возьм/i.test(a.text) ? (dash.sceneLoot || []).find((l: string) => a.text.toLowerCase().includes(l.toLowerCase().split(" ")[0].slice(0, 5))) : undefined;
    if (takeItem) { parts.push(`**${a.who}** забирает ${takeItem}.`); tags.push(`[TAKE: ${a.who}|${takeItem}]`); continue; }
    const kind = reaction(a.text);
    const rolled = outcomes.find(o => o.actor === a.who) || (acts.length === 1 ? outcomes[0] : undefined);
    const good = !rolled || rolled.outcome === "crit" || rolled.outcome === "success" || rolled.outcome === "partial";
    if (rolled?.deathSave) {
      parts.push(rolled.deathSave === "stabilized" ? `**${a.who}** с хрипом открывает глаза — жив, хоть и еле держится.` : `**${a.who}** не приходит в себя. Если никто не поможет — это конец.`);
      continue;
    }
    if (rolled) {
      parts.push(`**${a.who}**: ${pick(OUT[rolled.outcome])}`);
      if (!good) {
        if (firstClock) tags.push(`[CLOCK: ${firstClock} +1]`);
        tags.push(`[DAMAGE: ${a.who} -${rolled.outcome === "critfail" ? between(3, 5) : between(1, 3)}]`);
        if (chance(0.5)) tags.push(`[STRESS: ${a.who} +1]`);
        tags.push(`[XP: ${a.who} +${between(5, 10)}]`);
        continue;
      }
      if (rolled.outcome === "partial") tags.push(chance(0.5) ? `[STRESS: ${a.who} +1]` : `[DAMAGE: ${a.who} -1]`);
      if (rolled.outcome === "crit") newEchoes.push(`${a.who} совершил то, о чём будут говорить`);
    }
    const clean = a.text.replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
    const short = clean.length > 70 ? clean.slice(0, 70) + "…" : clean;
    void short;
    if (!rolled) parts.push(`**${a.who}**: ${pick(NARR[kind])}`);
    else parts.push(pick(NARR[kind]));
    if (kind === "fight") {
      let target = threats[0] || newThreats[0];
      if (!target) { target = { name: pick(W.enemy), hp: "10/10", features: [pick(["Быстрый", "Бронированный", "Хитрый"])] }; newThreats.push(target); }
      tags.push(`[HIT: ${target.name} -${between(2, 5)}]`);
      if (!rolled && chance(0.5)) { tags.push(`[DAMAGE: ${a.who} -${between(1, 3)}]`); parts.push(`${target.name} огрызается и задевает героя.`); }
    } else if (kind === "search") {
      if (chance(0.5)) { tags.push(`[GOLD: ${a.who} +${between(3, 12)}]`); parts.push("В пыли блестят монеты."); }
      else { const item = pick(W.loot); loot = [...new Set([...loot, item])]; parts.push(`Находка: ${item} — можно забрать.`); }
    } else if (kind === "heal") {
      const hero = chars.find(c => c.name === a.who);
      const healing = (hero?.inventory || []).find((i: any) => /зель|аптеч|стимул|виски|антирад|яблоч|пряник/i.test(typeof i === "string" ? i : i?.name || ""));
      if (healing) tags.push(`[USE: ${a.who}|${typeof healing === "string" ? healing : healing.name}]`);
      else tags.push(`[HEAL: ${a.who} +2]`);
    } else if (kind === "sneak" && chance(0.3)) {
      tags.push(`[STRESS: ${a.who} +1]`);
    }
    tags.push(`[XP: ${a.who} +${between(15, 30)}]`);
  }

  if (/^\[ROUND\]/m.test(user)) {
    for (const n of names) if (!acts.some(a => a.who === n)) parts.push(`**${n}** ${pick(["держится чуть позади и прикрывает остальных", "осматривается, не теряя бдительности", "переводит дух и ждёт подходящего момента"])}.`);
  }
  if (muse.motif) { const [verb, subj] = muse.motif.split(" — "); parts.push(subj ? `Где-то рядом завязывается новая нить: «${verb}», и как-то с этим связано «${subj}».` : `Новая нить сюжета: ${muse.motif}.`); }
  if (muse.npc) parts.push(`Из толпы выходит незнакомец — ${muse.npc.charAt(0).toLowerCase() + muse.npc.slice(1)}.`);
  if (muse.complication) parts.push(`Но тут — осложнение: ${muse.complication.charAt(0).toLowerCase() + muse.complication.slice(1)}.`);
  if (muse.detail) parts.push(`Деталь, которую трудно не заметить: ${muse.detail.charAt(0).toLowerCase() + muse.detail.slice(1)}.`);

  const encounter = /\[ENCOUNTER:/.test(user) && !/тишина/.test(user);
  if (encounter && !threats.length && !newThreats.length) {
    const e = { name: pick(W.enemy), hp: "8/8", features: [pick(["Засада", "Ядовитый укус", "Не знает страха"])] };
    newThreats.push(e);
    parts.push(`Внезапно из-за поворота появляется ${e.name.toLowerCase()} — бой неизбежен!`);
  }
  parts.push(pick(["Что дальше?", "Ваш ход.", "Как поступите?", "Время решать."]));

  const out: any = {
    atmosphere: pick(["Напряжение растёт", "Короткая передышка", "Опасность рядом", "Тайна сгущается"]),
    sceneLoot: loot,
    suggestedRoll: { type: pick(["classic", "triple", "shifted"]), reason: pick(["Ловкость", "Сила воли", "Внимательность", "Хитрость"]), dc: pick([10, 12, 12, 15]) },
  };
  if (newEchoes.length || /talk/.test(acts.map(a => reaction(a.text)).join())) out.echoes = [...(dash.echoes || []), ...newEchoes, ...(acts.some(a => reaction(a.text) === "talk") ? [`${acts[0].who} дал слово, и его запомнили`] : [])].slice(-6);
  if (newThreats.length) out.threats = [...(dash.threats || []), ...newThreats];
  if (Object.keys(slots).length) out.characters = chars.map(c => ({ name: c.name, actions: actionsFor(g, c.name, slots[c.name]) }));
  let tail = `\n\n<dashboard_json>${JSON.stringify(out)}</dashboard_json>`;
  if (/\[(SESSION SUMMARY|FINALE)\]/.test(user)) tail += `\n<session_summary>Герои прошли через опасности, нашли союзников и стали ближе к разгадке.</session_summary>`;
  if (/\[SAVE_CHAPTER\]/.test(user)) tail += `\n<lore_update>Глава завершена: герои продвинулись в расследовании.</lore_update>\n<final_draft>Глава, в которой герои шли сквозь туман и выбирали, кому верить.</final_draft>`;
  return `${parts.join("\n\n")} ${tags.join(" ")}${tail}`;
}

function clarify(user: string) {
  const q = user.replace(/^\[CLARIFY\]\s*/, "").trim();
  return `Хроники хранят немного: «${q.slice(0, 80)}» — об этом знают немногие, но след ведёт к местным старожилам.\n\n<dashboard_json>{}</dashboard_json>`;
}

// ---------------------------- сказка ----------------------------
const TALE_SCENES: [string, string[]][] = [
  ["у старого дуба сидела сова и шептала о потерянной звезде", ["Спросить сову, где искать звезду", "Пойти по серебряной тропинке", "Позвать на помощь друзей"]],
  ["в ручье плыл крошечный кораблик из листа с запиской «помогите»", ["Поймать кораблик и прочитать записку", "Пойти вдоль ручья", "Построить свой кораблик и отправить ответ"]],
  ["на поляне выросли грибы, которые звенели, как колокольчики", ["Позвонить в грибные колокольчики", "Найти, кто их посадил", "Спеть вместе с ними"]],
  ["из облака свесилась верёвочная лестница", ["Забраться по лестнице", "Крикнуть «Кто там?»", "Подождать, кто спустится"]],
  ["ветер принёс песенку, которую никто раньше не слышал", ["Пойти на звук песенки", "Подпеть ветру", "Записать песенку на бересте"]],
  ["на тропинке сидел ёжик и горько плакал над рассыпанными яблоками", ["Помочь собрать яблоки", "Спросить, что случилось", "Угостить ёжика своим пирожком"]],
  ["над рекой вырос мост из радуги, но одна полоска была серой", ["Найти потерянный цвет", "Перейти мост осторожно", "Спросить у реки, кто украл краску"]],
];
let taleDeck: number[] = [];
const nextScene = () => {
  if (!taleDeck.length) taleDeck = TALE_SCENES.map((_, i) => i).sort(() => rnd() - 0.5);
  return TALE_SCENES[taleDeck.pop()!];
};
function taleReply(req: LlmRequest, user: string) {
  const chapter = Number(req.system.match(/Сейчас глава (\d+) из (\d+)/)?.[1] || 1);
  const isFinal = /ФИНАЛЬНАЯ глава/.test(req.system);
  const all = req.messages.map(m => m.content).join("\n") + "\n" + req.system;
  let heroes = parseHeroes(all).map(h => ({ name: h.name, female: h.female || /\(она\)/.test(all.match(new RegExp(`- ${h.name} \\([^)]*\\)`))?.[0] || "") }));
  if (!heroes.length) {
    const remembered = all.match(/Героям? сказки: ([^.\n]+)/)?.[1];
    if (remembered) heroes = remembered.split(/, | и /).map(n => ({ name: n.trim(), female: false }));
  }
  const who = heroes.map(h => h.name).join(" и ") || "Наш герой";
  const many = heroes.length > 1;
  const v = (m: string, f: string, pl: string) => (many ? pl : heroes[0]?.female ? f : m);
  const choice = user.match(/\[TALE_CHOICE\]\s*(.+)/)?.[1]?.trim();
  const helper = user.match(/помощник[^:]*: ([^;\]\n]+)/i)?.[1];
  const memo = `Героям сказки: ${heroes.map(h => h.name).join(", ") || who}.`;
  if (isFinal) {
    return `${choice ? `Так и ${v("решил", "решила", "решили")}: ${choice.charAt(0).toLowerCase() + choice.slice(1)}. ` : ""}И тогда случилось чудо: всё, что было сделано по дороге, — каждая добрая мысль и каждый смелый шаг — сложилось в яркий тёплый свет. ${who} ${v("вернулся", "вернулась", "вернулись")} домой, где ${many ? "их" : heroes[0]?.female ? "её" : "его"} ждали чай и пироги, а в небе зажглась новая звезда.

<tale_title>Сказка о том, как ${who} ${v("нашёл", "нашла", "нашли")} свою звезду</tale_title>
<tale_moral>Доброта и смелость освещают путь лучше любого фонаря.</tale_moral>
<lore_update>${memo} Путь из ${chapter} глав завершён.</lore_update>`;
  }
  const [ev, choices] = nextScene();
  const opening = choice
    ? `${pick(["Сказано — сделано", "Так и поступили", "Решение принято"])}: ${choice.charAt(0).toLowerCase() + choice.slice(1)}.`
    : `Жил${v("", "а", "и")}-был${v("", "а", "и")} ${who}.`;
  return `${opening} ${pick(["Долго ли, коротко ли", "Не успело солнце и глазом моргнуть", "Прошло совсем немного времени"])} — и вдруг ${ev}. ${helper ? `Рядом оказался ${helper.toLowerCase()} и предложил помощь. ` : ""}Стало и страшновато, и любопытно одновременно.

<choices_json>${JSON.stringify(choices)}</choices_json>
<lore_update>${memo} Глава ${chapter}: ${ev}.</lore_update>`;
}

// ---------------------------- идеи для формы ----------------------------
const NAMES = {
  m: ["Гаррет", "Ивор", "Тамир", "Бран", "Сайрус", "Кай", "Ратибор", "Лео"],
  f: ["Мира", "Ялена", "Сая", "Вейла", "Ирма", "Тесса", "Агния", "Рия"],
  tale: { m: ["Ёжик Тимоша", "Зайчонок Пух", "Медвежонок Бо", "Кот Василий"], f: ["Белочка Ната", "Совушка Ушка", "Лисичка Фима", "Мышка Пи"] },
};
const CONCEPTS: Record<Genre, string[]> = {
  fantasy: ["Странствующая травница с говорящим вороном", "Угрюмый наёмник с долгом перед гильдией", "Бывший храмовник, потерявший веру", "Вор-тень из портовых трущоб"],
  cyber: ["Нетраннер с выжженным имплантом", "Уличный самурай в долгах у якудзы", "Корпоративный беглец с секретом в голове", "Рипер-док без лицензии"],
  space: ["Пилот-контрабандист с говорящим кораблём", "Ксенобиолог в изгнании", "Бывший штурмовик Конфедерации", "Механик с запрещённым ИИ-компаньоном"],
  post: ["Сталкер с картой довоенных бункеров", "Механик-самоучка с собакой", "Медичка караванов", "Бывший рейдер, ищущий искупления"],
  horror: ["Медиум, слышащий мёртвых", "Хирург с тёмным прошлым", "Охотник на культистов", "Журналистка «Таймс», знающая слишком много"],
  west: ["Стрелок с серебряными пулями", "Беглая проповедница", "Картёжник с проклятой колодой", "Следопыт-полукровка"],
  tale: ["Любопытный и очень храбрый", "Добрый, но немного трусишка", "Знает все-все песенки", "Всегда находит дорогу домой"],
};
const SETTINGS = [
  "Город на спине гигантской черепахи, плывущей сквозь туманы.",
  "Вечная осень в королевстве, где короли выбираются по жребию воронов.",
  "Мегаполис под куполом, где воздух продаётся по подписке.",
  "Пограничная станция у кротовой норы, через которую приходят странные корабли.",
  "Пустошь через сто лет после того, как замолчало радио.",
];
const HOOKS: Record<Genre, string[]> = {
  fantasy: ["В колодце на площади по ночам кто-то поёт колыбельные.", "Мельник нашёл в зерне человеческий зуб, а утром исчез.", "Король обещал награду тому, кто вернёт украденную тень принцессы."],
  cyber: ["Кто-то взламывает рекламные экраны и показывает лица пропавших.", "Заказ: украсть воспоминание из головы мёртвого директора.", "Весь сектор теряет электричество ровно на 13 минут каждую ночь."],
  space: ["Грузовой корабль вернулся из прыжка без экипажа, но с тёплым кофе на столе.", "Станция получает сигнал SOS от самой себя — из будущего.", "Посол чужой расы просит убежища и отказывается говорить, от кого бежит."],
  post: ["На старой радиовышке снова заиграла музыка.", "Караван пропал в трёх часах пути от форпоста — остались только следы босых ног.", "Дети с маяка говорят, что видели живое дерево."],
  horror: ["В особняке покойного профессора каждую ночь зажигается свет в запертой комнате.", "Все часы в городе остановились в 3:17.", "Пропавшая гувернантка пишет письма из закрытой церкви."],
  west: ["Шериф уехал в каньон и вернулся, но тень у него больше не его.", "На рудник пришёл поезд, которого нет в расписании.", "Индейский шаман просит вернуть украденную у духов песню."],
  tale: ["С неба упала звёздочка и плачет — она потеряла дорогу домой.", "У лесного ручья пропал голос, и теперь он не может петь.", "Кто-то каждую ночь раскрашивает радугу в серый цвет."],
};
function ideaReply(user: string) {
  const g = genreOf(user);
  if (/Имя: Концепт/.test(user)) {
    const female = /Пол[^:]*: Женщ|Пол[^:]*: Ж\b|женск/i.test(user);
    const tale = /сказочного героя/.test(user);
    const name = tale ? pick(female ? NAMES.tale.f : NAMES.tale.m) : pick(female ? NAMES.f : NAMES.m);
    return `${name}: ${pick(CONCEPTS[tale ? "tale" : g])}`;
  }
  if (/завязк/i.test(user)) return pick(HOOKS[g]);
  return pick(SETTINGS);
}

/** Строки таблиц оракула: из пулов жанра, уникальные за счёт сочетаний. */
const ORACLE_POOLS: Record<string, [string[], string[]]> = {
  actions: [["предать", "спрятать", "выкупить", "освободить", "подделать", "защитить", "разрушить", "выменять", "разоблачить", "преследовать", "пообещать", "украсть", "исцелить", "заманить", "вернуть"], ["тайно", "любой ценой", "без свидетелей", "ради долга", "до рассвета", "назло врагу"]],
  subjects: [["старая карта", "чужое имя", "клятва", "сигнальный огонь", "ключ от маяка", "семейная тайна", "письмо без подписи", "наследство", "треснувшее зеркало", "контрабанда", "призрак смотрителя", "долговая книга"], ["гильдии", "мертвеца", "стражи", "ведьмы", "капитана", "купца"]],
  complications: [["Мост обрушивается", "Свидетель исчезает", "Союзник требует плату", "Туман скрывает тропу", "Стража перекрывает выход", "Находка оказывается подделкой", "Начинается шторм", "Кто-то идёт по следу", "Вспыхивает пожар", "Проводник лжёт"], ["в самый неудачный момент", "прямо на глазах у толпы", "и это чья-то ловушка", "и время на исходе"]],
  npcs: [["Старая рыбачка", "Юный стражник", "Купец-полиглот", "Слепой звонарь", "Беглая жрица", "Контрабандист", "Уставший палач", "Девочка-картограф"], ["хочет вернуть сына, говорит загадками", "мечтает о славе, боится темноты", "копит долги, всегда улыбается", "слышит ложь, просит о тишине", "ищет реликвию, носит чужое имя", "хочет на покой, шутит невпопад"]],
  details: [["Запах мокрой пеньки", "Скрип ставен", "Свежие царапины на двери", "Капающий воск", "Крик чаек", "Солёная корка на камнях", "Детский рисунок углём", "Обрывок красной ленты"], ["у самого порога", "в дальнем углу", "на уровне глаз", "под ногами"]],
  helpers: [["Мудрая черепаха", "Болтливая сорока", "Сонный дракончик", "Добрый великан", "Звёздный мотылёк", "Лунный заяц"], ["с фонариком", "в смешной шляпе", "который всё забывает", "с тайной"]],
  wonders: [["Поющий цветок", "Карта, что рисуется сама", "Колокольчик ветра", "Клубок-проводник", "Зеркальце правды"], ["из бабушкиного сундука", "с облака", "со дна ручья", "из сна"]],
  trials: [["Загадка у моста", "Потерявшийся малыш", "Заколдованная тропинка", "Обида, которую надо простить", "Буря, которую надо переждать"], ["в сумерках", "под дождём", "на краю леса", "у самого дома"]],
};
function oracleReply(user: string) {
  const out: Record<string, string[]> = {};
  const hint = user.match(/ПОЖЕЛАНИЕ МАСТЕРА \(главное\): ([^\n]+)/)?.[1]?.trim();
  for (const m of user.matchAll(/^"(\w+)": (\d+) строк/gm)) {
    const [a, b] = ORACLE_POOLS[m[1]] || [[m[1]], ["…"]];
    const rows = new Set<string>();
    let guard = 0;
    while (rows.size < Number(m[2]) && guard++ < 500) rows.add(`${pick(a)} ${pick(b)}${hint && chance(0.4) ? ` (${hint})` : ""}`);
    out[m[1]] = [...rows];
  }
  return JSON.stringify(out);
}

export function demoReply(req: LlmRequest): string {
  const user = lastUser(req);
  if (/дизайнер таблиц оракула/.test(req.system)) return oracleReply(user);
  if (/Сказочник/.test(req.system)) return taleReply(req, user);
  if (/креативный помощник/.test(req.system)) return ideaReply(user);
  if (/GAME START/.test(user)) return gameStart(req, user);
  if (/Архивариус/.test(req.system) || /^\[CLARIFY\]/.test(user)) return clarify(user);
  return turn(req, user);
}
