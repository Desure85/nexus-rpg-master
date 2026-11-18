/**
 * Оценка промптов на НАСТОЯЩЕЙ модели: прогоняет сценарии через весь движок
 * и проверяет, что модель соблюдает протокол и даёт разнообразные ответы.
 *
 *   LLM_PROVIDER=opencode OPENCODE_API_KEY=... npm run eval:prompts
 *   LLM_PROVIDER=gemini GEMINI_API_KEY=... EVAL_RUNS=3 npm run eval:prompts
 *
 * Результат: таблица в консоли и файл eval-report.md. Код выхода 1, если доля
 * пройденных проверок ниже EVAL_MIN_PASS (по умолчанию 0.8).
 */
import "dotenv/config";
import fs from "fs";
import request from "supertest";
import { createApp } from "../server/app";
import { safeJsonParse, parseTale, parseStateTags } from "../shared/parse";

process.env.RATE_LIMIT_DISABLED = "true";
process.env.FREE_CREDITS = "1000000";
const RUNS = Number(process.env.EVAL_RUNS || 2);
const MIN_PASS = Number(process.env.EVAL_MIN_PASS || 0.8);

type Check = { scenario: string; name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
const check = (scenario: string, name: string, ok: boolean, detail?: string) => checks.push({ scenario, name, ok, detail });

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const grab = (raw: string, tag: string) => raw.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1];
const trigrams = (s: string) => {
  const w = s.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return new Set(w.slice(0, -2).map((_, i) => w.slice(i, i + 3).join(" ")));
};
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter(x => b.has(x)).length;
  return inter / Math.max(1, a.size + b.size - inter);
};
const KID_UNSAFE = /кров|убил|убива|смерт|мёртв|мертв|труп|отрубил|зарезал|казн|ужас(?!но интересн)/i;

async function main() {
  const ctx = await createApp({ dbPath: ":memory:" });
  const agent = request.agent(ctx.app);
  const h = (r: any) => r.set("x-nexus-client", "1");
  await h(agent.post("/api/auth/register")).send({ email: "eval@example.com", password: "password123", name: "Eval" });
  const me = (await agent.get("/api/auth/me")).body;
  const wid = me.workspaces[0].id;
  await h(agent.post("/api/settings")).send({ loggingEnabled: true });
  const provider = (await agent.get("/api/config")).body.llm.provider;
  console.log(`Провайдер: ${provider}, прогонов: ${RUNS}`);

  const lastLog = (sid: string) => ctx.db.prepare("SELECT request, response FROM logs WHERE session_id = ? ORDER BY id DESC LIMIT 1").get(sid) as { request: string; response: string } | undefined;
  const session = async (sid: string) => (await agent.get(`/api/sessions/${sid}`)).body;
  const dash = (s: any) => [...s.history].reverse().find((m: any) => m.dashboard)?.dashboard;

  const create = async (setup: any) => {
    const r = await h(agent.post("/api/sessions")).send({ workspaceId: wid, setup });
    if (r.status !== 201) throw new Error(`create: ${r.status} ${JSON.stringify(r.body)}`);
    await ctx.engine.whenIdle(r.body.id);
    return r.body.id as string;
  };
  const turn = async (sid: string, content: string, rolls: string[] = []) => {
    await h(agent.post(`/api/sessions/${sid}/turn`)).send({ content, rolls });
    await ctx.engine.whenIdle(sid);
    return lastLog(sid);
  };

  /** Общие проверки ответа RPG-мастера. */
  const rpgChecks = (scenario: string, log: { request: string; response: string } | undefined, names: string[], opts: { clarify?: boolean } = {}) => {
    if (!log) { check(scenario, "ответ получен", false, "нет ответа модели (см. turn_error)"); return; }
    const raw = log.response;
    const req = JSON.parse(log.request);
    const userMsg: string = req.messages[req.messages.length - 1]?.content || "";
    const dashRaw = grab(raw, "dashboard_json");
    let d: any = null;
    try { d = dashRaw ? safeJsonParse(dashRaw) : null; } catch { /* невалидный */ }
    check(scenario, "есть <dashboard_json>", !!dashRaw);
    check(scenario, "dashboard — валидный JSON", !!d, dashRaw ? dashRaw.slice(0, 120) : undefined);
    let strict = false;
    try { JSON.parse(dashRaw || ""); strict = true; } catch { /* */ }
    check(scenario, "JSON строгий (без починки)", strict);
    const tail = raw.replace(/[\s\S]*<\/(dashboard_json|codex_json|lore_update|final_draft|session_summary)>/, "").trim();
    check(scenario, "нет текста после блоков", tail.length === 0, tail.slice(0, 80));
    const narrative = raw.split("<")[0];
    check(scenario, "без заголовков ###", !/^#{2,}/m.test(narrative));
    if (opts.clarify) {
      check(scenario, "CLARIFY: обновлён кодекс", /<codex_json>/.test(raw));
      check(scenario, "CLARIFY: нет lore_update", !/<lore_update>/.test(raw));
      return;
    }
    const nw = words(parseStateTags(narrative).clean);
    check(scenario, "длина нарратива 60–450 слов", nw >= 60 && nw <= 450, `${nw} слов`);
    if (d) {
      const got = (d.characters || []).map((c: any) => c.name);
      check(scenario, "все герои в dashboard", names.every(n => got.includes(n)), `есть: ${got.join(", ")}`);
      check(scenario, "есть suggestedRoll", !!d.suggestedRoll?.type);
      const slots = userMsg.match(/\[ACTION SLOTS: ([^\]]+)\]/)?.[1];
      if (slots) {
        const want = Object.fromEntries(slots.split(";").map(p => p.trim().split(":")).map(([n, c]) => [n.trim(), c.split(",").map(x => x.trim()).sort()]));
        const bad = Object.entries(want).filter(([n, cats]) => {
          const ch = (d.characters || []).find((c: any) => c.name === n);
          const have = (ch?.actions || []).map((a: any) => a.category).sort();
          return JSON.stringify(have) !== JSON.stringify(cats);
        });
        check(scenario, "действия строго по [ACTION SLOTS]", bad.length === 0, bad.map(([n]) => n).join(", "));
      }
      if (/\[ENCOUNTER:/.test(userMsg) && !/тишина/.test(userMsg)) check(scenario, "[ENCOUNTER] → есть угроза", (d.threats || []).length > 0);
      if (/\[WORLD EVENT/.test(userMsg)) check(scenario, "[WORLD EVENT] → doomPool обнулён", Number(d.doomPool) === 0);
    }
    const { changes } = parseStateTags(raw);
    const unknown = changes.filter(c => !names.some(n => n.toLowerCase().includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(n.toLowerCase())));
    check(scenario, "теги чисел только для героев", unknown.length === 0, unknown.map(c => c.name).join(", "));
    check(scenario, "не выдумывает бросков", !/\[ROLL:/.test(narrative));
  };

  const heroes = [{ name: "Арн", concept: "угрюмый наёмник с секирой", gender: "М" }, { name: "Лиса", concept: "воровка-акробатка", gender: "Ж" }];
  const names = heroes.map(h => h.name);
  const openings: string[] = [];
  const actionNames: string[] = [];

  for (let run = 1; run <= RUNS; run++) {
    // --- 1. Стандартная партия: старт, исследование, провал, стресс-бросок, уточнение, раунд
    const sid = await create({ setting: "Портовый город Сольград, где туман шепчет имена", plotHook: "Пропал смотритель маяка", style: "balanced", mode: "short", characters: heroes });
    const start = lastLog(sid);
    rpgChecks(`старт (balanced) #${run}`, start, names);
    const s0 = await session(sid);
    openings.push(s0.history.find((m: any) => m.role === "assistant")?.content || "");
    for (const c of dash(s0)?.characters || []) for (const a of c.actions || []) actionNames.push(a.name);
    const d0 = dash(s0);
    check(`старт (balanced) #${run}`, "стартовые числа в разумных пределах", (d0?.characters || []).every((c: any) => /^(1[0-6]|[89])\/(1[0-6]|[89])$/.test(c.hp)), (d0?.characters || []).map((c: any) => c.hp).join(", "));
    check(`старт (balanced) #${run}`, "стартовая локация с сервисами", !!d0?.currentLocationId && (d0?.locations || []).some((l: any) => l.id === d0.currentLocationId));

    rpgChecks(`исследование #${run}`, await turn(sid, "Арн осматривает причал, Лиса расспрашивает рыбаков"), names);
    const failLog = await turn(sid, "Арн пытается выбить дверь маяка", ["**Арн** performs *выбить дверь*: [ROLL: 1d20 = 2]"]);
    rpgChecks(`провал броска #${run}`, failLog, names);
    if (failLog) {
      const ch = parseStateTags(failLog.response).changes;
      const s = await session(sid);
      const doomUp = Number(dash(s)?.doomPool || 0) > 0;
      check(`провал броска #${run}`, "у провала есть цена (урон/стресс/doom)", ch.some(c => (c.field === "hp" && c.delta < 0) || c.field === "stress") || doomUp, JSON.stringify(ch));
    }
    rpgChecks(`успех с запасом #${run}`, await turn(sid, "Лиса взбирается по стене", ["**Лиса** performs *подъём*: [ROLL: 1d20 = 20]"]), names);
    rpgChecks(`уточнение #${run}`, await turn(sid, "[CLARIFY] Кто такой смотритель маяка?"), names, { clarify: true });

    // --- 2. Боевой стиль
    const cs = await create({ setting: "Руины крепости в пустоши", plotHook: "Орда мародёров идёт к лагерю", style: "combat", mode: "short", characters: heroes });
    rpgChecks(`старт (combat) #${run}`, lastLog(cs), names);
    rpgChecks(`атака (combat) #${run}`, await turn(cs, "Арн рубит ближайшего мародёра", ["**Арн** performs *удар секирой*: [ROLL: 1d20 = 15]"]), names);

    // --- 3. Детская сказка как стиль RPG
    const ks = await create({ setting: "Пряничная деревня у Говорящего леса", plotHook: "Пропали все колокольчики", style: "fairytale", mode: "short", characters: [{ name: "Тимоша", concept: "ёжик-изобретатель", gender: "М" }] });
    const kl = lastLog(ks);
    rpgChecks(`детский стиль #${run}`, kl, ["Тимоша"]);
    const kl2 = await turn(ks, "Тимоша заходит в тёмный лес", ["**Тимоша** performs *идти в лес*: [ROLL: 1d20 = 1]"]);
    check(`детский стиль #${run}`, "без жестокости и смерти", ![kl, kl2].some(l => l && KID_UNSAFE.test(l.response.split("<")[0])));

    // --- 4. Режим «Сказка»
    const ts = await create({ setting: "Облачное королевство", plotHook: "", mode: "tale", characters: [{ name: "Маша", concept: "любопытная девочка", gender: "Ж" }, { name: "Пушок", concept: "говорящий кот", gender: "М" }], tale: { age: "6-8", chapters: 3 } });
    for (let ch = 1; ch <= 3; ch++) {
      const log = lastLog(ts);
      const sc = `сказка: глава ${ch} #${run}`;
      if (!log) { check(sc, "ответ получен", false); break; }
      const t = parseTale(log.response);
      const final = ch === 3;
      check(sc, "длина главы 100–400 слов", words(t.text) >= 100 && words(t.text) <= 400, `${words(t.text)} слов`);
      check(sc, "без игровых тегов и цифр HP", !/\[(ROLL|DAMAGE|STATE)|HP|<dashboard_json>/.test(log.response));
      check(sc, "детская безопасность", !KID_UNSAFE.test(t.text));
      check(sc, "герои по именам", /Маша/.test(t.text) && /Пушок/.test(t.text));
      if (!final) {
        check(sc, "2–3 варианта выбора", t.choices.length >= 2 && t.choices.length <= 3, JSON.stringify(t.choices));
        check(sc, "варианты различаются", new Set(t.choices.map(c => c.toLowerCase())).size === t.choices.length && Math.max(0, ...t.choices.map((a, i) => Math.max(0, ...t.choices.filter((_, j) => j !== i).map(b => jaccard(trigrams(a), trigrams(b)))))) < 0.5);
        await turn(ts, `[TALE_CHOICE] ${t.choices[0] || "Идти дальше"}`);
      } else {
        check(sc, "финал: название и мораль", !!t.title && !!t.moral, `${t.title} / ${t.moral}`);
        check(sc, "финал: без развилки", t.choices.length === 0);
      }
    }
  }

  // --- Вариативность стартов одинаковой партии
  if (openings.length >= 2) {
    const sims: number[] = [];
    for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) sims.push(jaccard(trigrams(openings[i]), trigrams(openings[j])));
    const avg = sims.reduce((a, b) => a + b, 0) / sims.length;
    check("вариативность", "разные старты одной партии (сходство триграмм < 0.15)", avg < 0.15, `среднее сходство ${avg.toFixed(3)}`);
  }
  if (actionNames.length) {
    const uniq = new Set(actionNames.map(a => a.toLowerCase())).size / actionNames.length;
    check("вариативность", "уникальность названий действий > 0.7", uniq > 0.7, `${(uniq * 100).toFixed(0)}% из ${actionNames.length}`);
  }

  await ctx.close();

  // --- Отчёт
  const byScenario = new Map<string, Check[]>();
  for (const c of checks) byScenario.set(c.scenario.replace(/ #\d+$/, ""), [...(byScenario.get(c.scenario.replace(/ #\d+$/, "")) || []), c]);
  const byCheck = new Map<string, Check[]>();
  for (const c of checks) byCheck.set(c.name, [...(byCheck.get(c.name) || []), c]);
  const passed = checks.filter(c => c.ok).length;
  const rate = passed / Math.max(1, checks.length);
  const lines = [
    `# Оценка промптов — ${provider}`, "",
    `Прогонов: ${RUNS}. Пройдено проверок: **${passed}/${checks.length} (${(rate * 100).toFixed(0)}%)**.`, "",
    "## По проверкам", "", "| Проверка | Пройдено | Провалы (пример) |", "|---|---|---|",
    ...[...byCheck.entries()].sort((a, b) => a[1].filter(c => c.ok).length / a[1].length - b[1].filter(c => c.ok).length / b[1].length)
      .map(([name, cs]) => `| ${name} | ${cs.filter(c => c.ok).length}/${cs.length} | ${(cs.find(c => !c.ok)?.detail || "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 100)} |`),
    "", "## По сценариям", "", "| Сценарий | Пройдено |", "|---|---|",
    ...[...byScenario.entries()].map(([s, cs]) => `| ${s} | ${cs.filter(c => c.ok).length}/${cs.length} |`),
  ];
  const report = lines.join("\n");
  fs.writeFileSync("eval-report.md", report + "\n");
  console.log("\n" + report);
  process.exit(rate >= MIN_PASS ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
