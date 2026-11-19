// Сквозной прогон всех режимов через настоящий интерфейс (Playwright) — на любом ИИ-провайдере сервера.
// Локально: LLM_PROVIDER=mock MOCK_STYLE=demo npm start; BASE_URL=http://localhost:3000 node e2e/play.mjs
// В CI (workflow «Real AI play-test»): сервер на opencode/OpenRouter/Gemini, отчёт и скриншоты — в артефактах.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const OUT = path.resolve(process.env.OUT_DIR || 'e2e-report');
const TURN_TIMEOUT = Number(process.env.TURN_TIMEOUT_MS || 240_000);
fs.mkdirSync(OUT, { recursive: true });

const report = [];
const checks = [];
let shot = 0;
const log = (...a) => { console.log(...a); };
const check = (name, ok, detail = '') => { checks.push({ name, ok: !!ok, detail }); log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };
const snap = async (page, name) => { const f = `${String(++shot).padStart(2, '0')}_${name}.png`; await page.screenshot({ path: path.join(OUT, f), fullPage: false }); return f; };

const api = async (page, url, opts = {}) => page.evaluate(async ([u, o]) => {
  const r = await fetch(u, { credentials: 'same-origin', headers: { 'x-nexus-client': '1', 'Content-Type': 'application/json', 'x-device-id': localStorage.getItem('nexus_device_id') || 'e2e-device-0000000001' }, ...o });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [url, opts]);

/** Ждём конца хода мастера: сессия не занята и последний ответ — от мастера. */
const waitTurn = async (page, sid, minAssistant) => {
  const t0 = Date.now();
  for (;;) {
    const r = await api(page, `/api/sessions/${sid}`);
    const s = r.body;
    const n = (s?.history || []).filter(m => m.role === 'assistant').length;
    if (s && !s.busy && n >= minAssistant) return { s, ms: Date.now() - t0 };
    if (page.__failed) throw new Error(`ошибка в интерфейсе: ${page.__failed}`);
    const err = await page.locator('text=/^(Ошибка хода|Не удалось|Модель не ответила)/').first().textContent({ timeout: 200 }).catch(() => null);
    if (err && Date.now() - t0 > 5000) throw new Error(`ошибка хода: ${err.slice(0, 200)}`);
    if (Date.now() - t0 > TURN_TIMEOUT) throw new Error(`ход не завершился за ${TURN_TIMEOUT / 1000} с`);
    await page.waitForTimeout(1500);
  }
};

const RAW_TAGS = /<\/?(dashboard_json|codex_json|lore_update|choices_json|session_summary|final_draft)|\[(DAMAGE|HEAL|STRESS|GOLD|XP|TOKEN|HIT|USE|CLOCK|TAKE|QUEST):/;
const lastAssistant = s => [...s.history].reverse().find(m => m.role === 'assistant');
const lastDash = s => [...s.history].reverse().find(m => m.dashboard)?.dashboard;
const assistantTexts = s => s.history.filter(m => m.role === 'assistant').map(m => m.content);

const recordTurn = (title, s, ms) => {
  const a = lastAssistant(s);
  report.push(`### ${title} (${(ms / 1000).toFixed(1)} с)\n\n${process.env.FULL_REPORT ? (a?.content || '') : (a?.content || '').slice(0, 900)}\n`);
  check(`${title}: нет сырых тегов в тексте`, !RAW_TAGS.test(a?.content || ''), (a?.content || '').match(RAW_TAGS)?.[0]);
};

/** alert() в интерфейсе = ошибка (генерация, ход). Фиксируем и падаем сразу, а не через таймаут. */
const watchDialogs = page => page.on('dialog', async d => {
  check(`интерфейс показал ошибку`, false, d.message().slice(0, 200));
  await d.dismiss().catch(() => undefined);
  page.__failed = d.message();
});

/** Мягкие метрики качества текста (в отчёт, не валят прогон). */
function qualityMetrics(title, texts, hero) {
  const narr = texts.map(t => t.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\[[A-Z ]+:[^\]]*\]/g, '').trim());
  const len = narr.map(t => t.length);
  const words = t => t.toLowerCase().match(/[а-яё]{4,}/g) || [];
  const tri = t => { const w = words(t); return new Set(w.slice(2).map((x, i) => `${w[i]} ${w[i + 1]} ${x}`)); };
  let overlap = 0;
  for (let i = 1; i < narr.length; i++) { const a = tri(narr[i - 1]), b = tri(narr[i]); const inter = [...b].filter(x => a.has(x)).length; overlap = Math.max(overlap, b.size ? inter / b.size : 0); }
  const openings = narr.map(t => t.split(/\s+/).slice(0, 3).join(' ').toLowerCase());
  const latin = narr.join(' ').match(/\b[a-z]{4,}\b/gi) || [];
  const dialog = narr.filter(t => /(^|\n)\s*[—–-]\s|«[^»]{5,}»/.test(t)).length;
  const youActs = !hero ? 0 : narr.filter(t => new RegExp(`${hero}[^.]{0,40}(решает|думает|чувствует|понимает)`).test(t)).length;
  const m = [
    `длина ответа: мин ${Math.min(...len)}, средн ${Math.round(len.reduce((a, b) => a + b, 0) / len.length)}, макс ${Math.max(...len)} симв.`,
    `макс. повтор фраз между соседними ответами: ${(overlap * 100).toFixed(0)}%`,
    `одинаковых зачинов: ${openings.length - new Set(openings).size}`,
    `ответов с прямой речью NPC: ${dialog}/${narr.length}`,
    `латиница в тексте: ${latin.length ? latin.slice(0, 8).join(', ') : 'нет'}`,
    `мастер решает за героя (эвристика): ${youActs}`,
  ];
  report.push(`### Метрики качества — ${title}\n\n${m.map(x => `- ${x}`).join('\n')}\n`);
  log(`📊 ${title}: ${m.join(' | ')}`);
}

async function register(page) {
  watchDialogs(page);
  await page.goto(BASE);
  await page.getByText('РЕГИСТРАЦИЯ', { exact: false }).click();
  await page.fill("input[placeholder='Как вас называть']", 'Тестовый мастер');
  await page.fill('input[type=email]', `gm-${Date.now()}@e2e.local`);
  await page.fill('input[type=password]', 'password123');
  await page.locator('form button[type=submit]').click();
  await page.waitForTimeout(1500);
  const ack = page.getByText('Понятно, играть');
  if (await ack.count()) await ack.click();
}

async function newGame(page, mode, setting, heroes, { tale = false } = {}) {
  await page.getByText(mode, { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByText(setting, { exact: true }).first().click();
  // завязку и героев генерирует ИИ — проверяем и эти кнопки
  await page.getByText('СГЕНЕРИРОВАТЬ ИИ', { exact: false }).nth(1).click();
  await page.waitForFunction(() => (document.querySelectorAll('textarea')[1]?.value || '').length > 10, null, { timeout: TURN_TIMEOUT });
  for (let i = 0; i < heroes; i++) {
    if (i > 0) await page.getByText('Добавить', { exact: false }).first().click();
    await page.locator("button[title='Сгенерировать персонажа']").nth(i).click();
    await page.waitForFunction(i2 => (document.querySelectorAll("input[placeholder='Имя персонажа']")[i2])?.value.length > 1, i, { timeout: TURN_TIMEOUT });
  }
  await snap(page, `${tale ? 'tale' : mode.slice(0, 4)}_setup`);
  await page.getByText(tale ? 'Начать сказку' : 'Начать приключение').click();
  await page.waitForURL(/.*/);
  await page.waitForTimeout(1500);
  const me = (await api(page, '/api/auth/me')).body;
  const sessions = (await api(page, `/api/workspaces/${me.workspaces[0].id}/sessions`)).body;
  return [...sessions].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0]?.id;
}

async function gmTurn(page, sid, text, n) {
  const ta = page.locator('textarea').first();
  await ta.fill(text);
  await ta.press('Enter');
  const { s, ms } = await waitTurn(page, sid, n);
  await page.waitForTimeout(800);
  return { s, ms };
}

async function solo(browser) {
  log('\n== Соло ==');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await register(page);
  const t0 = Date.now();
  const sid = await newGame(page, 'Соло-приключение', 'Тёмное фэнтези', 1);
  check('соло: сессия создана', !!sid);
  let { s, ms } = await waitTurn(page, sid, 1);
  ms = Date.now() - t0;
  recordTurn('Соло: старт', s, ms);
  const d = lastDash(s);
  check('старт: герой в дашборде с HP', d?.characters?.[0]?.hp && /\d+\/\d+/.test(d.characters[0].hp), d?.characters?.[0]?.hp);
  check('старт: есть локация и currentLocationId', (d?.locations || []).some(l => l.id === d.currentLocationId));
  check('старт: варианты действий', (d?.characters?.[0]?.actions || []).length > 0);
  check('старт: suggestedRoll с DC', typeof d?.suggestedRoll?.dc === 'number', JSON.stringify(d?.suggestedRoll));
  await snap(page, 'solo_start');
  const hero = d?.characters?.[0]?.name || '';

  const turns = [
    `${hero} осматривается и ищет следы, расспрашивает первого встречного`,
    `${hero} атакует ближайшего противника`,
    ...(process.env.LONG ? [
      `${hero} заговаривает с самым подозрительным персонажем и пытается выведать, что тот скрывает`,
      `${hero} пытается обмануть стражу, выдав себя за посланника`,
      `${hero} осматривает добычу и решает, что взять с собой`,
      `${hero} идёт туда, где по слухам скрывается главный враг`,
    ] : []),
  ];
  let n = 1;
  for (const t of turns) {
    ({ s, ms } = await gmTurn(page, sid, t, ++n));
    recordTurn(`Соло: «${t.slice(0, 50)}»`, s, ms);
    await snap(page, `solo_turn${n}`);
  }

  // бросок мастера через лоток кубиков
  await page.locator("button[title='Кубики: бросок за героя']").click();
  await page.locator('text=Кто действует').locator('xpath=following::button[1]').click();
  await page.locator('text=Выбор действия').locator('xpath=following::button[1]').click();
  await page.getByText('Обычный', { exact: true }).click();
  await page.waitForTimeout(1200);
  await snap(page, 'solo_dice');
  ({ s, ms } = await gmTurn(page, sid, `${hero} действует решительно`, ++n));
  recordTurn('Соло: ход с броском', s, ms);
  const rolled = s.history.filter(m => m.role === 'user').map(m => m.content).find(c => c.includes('[ROLL:'));
  check('бросок: движок дописал итог и исход', /Итог: -?\d+ = .* против DC \d+ → /.test(rolled || ''), (rolled || '').match(/\[ROLL:[^\]]*\]/)?.[0]);
  check('бросок: плашка исхода видна', await page.locator('text=/УСПЕХ|ПРОВАЛ/').count() > 0);
  await snap(page, 'solo_roll_result');

  // единство чисел: дашборд = состояние движка
  const st = (await api(page, `/api/sessions/${sid}/state`)).body?.characters?.[hero];
  const dc = lastDash(s)?.characters?.find(c => c.name === hero);
  check('числа героя совпадают с движком', st && dc && dc.hp === `${st.hp_cur}/${st.hp_max}`, `${dc?.hp} vs ${st?.hp_cur}/${st?.hp_max}`);
  qualityMetrics('Соло', assistantTexts(s), hero);
  check('ИИ отвечает на разные ходы по-разному', new Set(assistantTexts(s).map(t => t.slice(0, 80))).size === assistantTexts(s).length);
  await ctx.close();
}

async function multiplayer(browser) {
  log('\n== С друзьями ==');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const gm = await ctx.newPage();
  await register(gm);
  const sid = await newGame(gm, 'Игра с друзьями', 'Киберпанк', 2);
  let { s, ms } = await waitTurn(gm, sid, 1);
  recordTurn('Мультиплеер: старт', s, ms);
  const heroes = lastDash(s).characters.map(c => c.name);
  await gm.getByText('Ссылка').first().click();
  const link = await gm.evaluate(() => navigator.clipboard.readText());
  check('ссылка на героя', /\/character\//.test(link), link);

  // игрок — отдельный браузер (другое устройство), телефонный экран
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pl = await pctx.newPage();
  await pl.goto(link);
  await pl.waitForTimeout(1500);
  if (await pl.getByText('Понятно, играть').count()) await pl.getByText('Понятно, играть').click();
  await pl.locator('input').first().fill('Аня');
  await pl.getByText('Запросить персонажа').click();
  // кнопка именно в карточке заявки — у живой модели «Принять …» бывает и среди вариантов действий
  const approve = gm.locator('div', { hasText: 'хочет' }).getByRole('button', { name: 'Принять', exact: true }).last();
  await approve.waitFor({ timeout: 15000 });
  check('мастер сразу видит заявку игрока', await gm.getByText(/хочет играть за/).count() > 0);
  await approve.click();
  // ждём лист героя; если не появился — перезагрузка (одобрение могло прийти до подписки)
  for (let i = 0; i < 3 && !(await pl.locator('textarea').count()); i++) {
    await pl.waitForTimeout(4000);
    if (await pl.getByText('Понятно, играть').count()) await pl.getByText('Понятно, играть').click();
    if (!(await pl.locator('textarea').count()) && i === 1) await pl.reload();
  }
  await snap(pl, 'mp_player_sheet');
  if (!(await pl.locator('textarea').count())) log('   экран игрока: ' + (await pl.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '));
  await pl.locator('textarea').first().fill('Взламываю терминал у двери, чтобы открыть проход');
  await pl.getByRole('button', { name: 'd20', exact: true }).click();
  await pl.getByRole('button').filter({ hasText: /^\s*Ход\s*$/ }).first().click();
  await pl.waitForTimeout(1500);
  const sent = await pl.locator('body').innerText();
  check('игрок видит исход своего броска сразу', /УСПЕХ|ПРОВАЛ/.test(sent));
  await snap(pl, 'mp_player_sent');

  await gm.getByText(/Подтвердить ход/).click();
  ({ s, ms } = await waitTurn(gm, sid, 2));
  recordTurn('Мультиплеер: раунд', s, ms);
  check('раунд: ответ упоминает героя игрока', lastAssistant(s).content.includes(heroes[0]) || lastAssistant(s).content.includes(heroes[0].split(' ')[0]));
  await gm.waitForTimeout(1000);
  await snap(gm, 'mp_gm_round');
  await pl.waitForTimeout(2500);
  await pl.getByRole('button').filter({ hasText: /История/ }).first().click().catch(() => undefined);
  await snap(pl, 'mp_player_story');
  await pctx.close();
  await ctx.close();
}

async function tale(browser) {
  log('\n== Сказка ==');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await register(page);
  const sid = await newGame(page, 'Сказка', 'Волшебный лес', 1, { tale: true });
  let { s, ms } = await waitTurn(page, sid, 1);
  recordTurn('Сказка: глава 1', s, ms);
  const chapters = s.config?.tale?.chapters || 6;
  for (let i = 2; i <= chapters; i++) {
    const a = lastAssistant(s);
    check(`глава ${i - 1}: есть 2–3 варианта`, (a.choices || []).length >= 2 && a.choices.length <= 3, JSON.stringify(a.choices));
    const btn = page.locator('button.text-left.px-4.py-3').first();
    await btn.click();
    ({ s, ms } = await waitTurn(page, sid, i));
    recordTurn(`Сказка: глава ${i}`, s, ms);
  }
  check('сказка закончилась и собрана книга', s.config?.tale?.finished && (s.archive || '').length > 200, s.config?.tale?.title);
  qualityMetrics('Сказка', assistantTexts(s), '');
  await page.waitForTimeout(1200);
  await snap(page, 'tale_book');
  await ctx.close();
}

async function worldPlay(browser) {
  log('\n== Мир автора ==');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await register(page);
  const body = {
    title: 'Туманные Острова', icon: '🌫️', genre: 'horror', description: 'Архипелаг, где туман крадёт имена.', visibility: 'link',
    data: {
      setting: 'Северный архипелаг: маяки, рыбацкие деревни, контрабандисты. Туман живой.',
      core: 'Туман живой и забирает имена у тех, кто остаётся в нём после заката. Маяки — единственная защита. Безымянные бродят по отмелям и зовут родных.',
      tone: 'Меланхолично и таинственно, без жестоких сцен.',
      cards: [
        { kind: 'npc', name: 'Смотритель Ивар', keys: ['смотритель', 'маяк'], text: 'Старик с повязкой на глазу, хранит последний огонь Северного маяка. Боится темноты, говорит загадками, всегда носит связку медных ключей.' },
        { kind: 'faction', name: 'Гильдия ныряльщиков', keys: ['ныряльщик', 'гильдия'], text: 'Достают со дна утраченные имена и продают их.' },
      ],
      locations: [
        { id: 'port', name: 'Порт Сольвей', description: 'Причалы и рыбный рынок', services: ['market', 'tavern'], connections: ['lighthouse'] },
        { id: 'lighthouse', name: 'Северный маяк', description: 'Старая башня на скале' },
      ],
      scenarios: [{ id: 'dark', title: 'Погасший маяк', hook: 'Этой ночью Северный маяк погас впервые за сто лет, и туман двинулся к порту. Смотритель Ивар не отвечает.', mode: 'short', startLocationId: 'port' }],
      heroes: [{ name: 'Рина', concept: 'Лоцман, знает все отмели', gender: 'Ж', archetype: 'scout' }],
      enemies: [{ name: 'Безымянный', tier: 'regular', hp: 11, traits: 'Бледная фигура из тумана, зовёт голосами родных, боится огня' }],
      items: [{ name: 'Свеча маяка', kind: 'consumable', heal: 4, price: 9, inShop: true, rarity: 'common' }],
      currency: 'раковины', shopReplace: true,
      factions: [{ id: 'guild', name: 'Гильдия ныряльщиков', desc: 'Достают и продают чужие имена', attitude: -1 }, { id: 'keepers', name: 'Смотрители маяков', desc: 'Хранят огонь и порядок', attitude: 1 }],
      clocks: [{ id: 'fog', name: 'Туман наступает', max: 6, value: 2, onFull: 'Туман дошёл до порта — причалы опустели.' }],
    },
  };
  // ИИ-конструктор мира: черновик из абзаца
  {
    const me0 = (await api(page, '/api/auth/me')).body;
    const t0 = Date.now();
    const g = await api(page, '/api/worlds/generate', { method: 'POST', body: JSON.stringify({ workspaceId: me0.workspaces[0].id, prompt: 'Город-улей на спине гигантской черепахи. Касты, воздушные шары, черепаха умирает, и никто не знает почему.' }) });
    const d = g.body?.data || {};
    check('конструктор мира: черновик собран', g.status === 200 && d.cards?.length >= 5 && d.locations?.length >= 3 && d.scenarios?.length >= 1, `${g.status} ${g.body?.message || ''} карточек ${d.cards?.length}, мест ${d.locations?.length}, сюжетов ${d.scenarios?.length}, врагов ${d.enemies?.length}, предметов ${d.items?.length}`);
    report.push(`### Конструктор мира (${((Date.now() - t0) / 1000).toFixed(1)} с)\n\n**${g.body?.icon || ''} ${g.body?.title || '—'}** — ${g.body?.description || ''}\n\n${(d.cards || []).slice(0, 4).map(c => `- ${c.name}: ${c.text}`).join('\n')}\n\nСюжеты: ${(d.scenarios || []).map(x => x.title).join('; ')}\nВраги: ${(d.enemies || []).map(x => `${x.name} (${x.tier})`).join(', ')}\n`);
  }
  const w = (await api(page, '/api/worlds', { method: 'POST', body: JSON.stringify(body) })).body;
  check('мир создан', !!w?.id);
  await page.getByText('Миры', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Играть', exact: true }).first().click();
  await snap(page, 'world_play_dialog');
  await page.getByRole('button', { name: /^Играть \(/ }).click();
  await page.waitForTimeout(1500);
  const me = (await api(page, '/api/auth/me')).body;
  const sid = (await api(page, `/api/workspaces/${me.workspaces[0].id}/sessions`)).body?.[0]?.id;
  check('мир: партия создана', !!sid);
  let { s, ms } = await waitTurn(page, sid, 1);
  recordTurn('Мир: старт', s, ms);
  const cur = (lastDash(s)?.locations || []).find(l => l.id === lastDash(s)?.currentLocationId);
  check('мир: стартовое место из сценария', /Сольвей/.test(cur?.name || ''), cur?.name);
  check('мир: лор скрыт от клиента', !JSON.stringify(s.config || {}).includes('Безымянные'));
  ({ s, ms } = await gmTurn(page, sid, 'Рина идёт к маяку и зовёт смотрителя', 2));
  recordTurn('Мир: ход про смотрителя', s, ms);
  const txt = lastAssistant(s)?.content || '';
  // тестовая модель лор не читает — проверка только на живом ИИ
  if (process.env.LIVE) check('мир: мастер опирается на карточку (Ивар/ключи/повязка)', /Ивар|ключ|повязк/i.test(txt), txt.slice(0, 120));
  await snap(page, 'world_turn');
  const shop = (await api(page, `/api/sessions/${sid}/shop`)).body;
  check('мир: лавка продаёт предметы мира', JSON.stringify(shop.map(i => i.name)) === JSON.stringify(['Свеча маяка (+4 HP)']), JSON.stringify(shop).slice(0, 120));
  ({ s, ms } = await gmTurn(page, sid, 'Из тумана выходит безымянный и зовёт Рину голосом матери. Рина поднимает фонарь и бьёт его багром', 3));
  recordTurn('Мир: бой с безымянным', s, ms);
  const nameless = (lastDash(s)?.threats || []).find(t => /безымян/i.test(t.name));
  if (nameless) check('мир: HP безымянного из бестиария (11 минус удары)', /\/11$/.test(String(nameless.hp)), nameless.hp);
  else log('   (безымянный не остался на сцене — HP не проверить)');
  // живой мир: итоги партии → хроника → канон → новая партия о нём знает
  ({ s, ms } = await gmTurn(page, sid, '[SESSION SUMMARY] Подведи итоги партии', 4));
  recordTurn('Мир: итоги партии', s, ms);
  await page.waitForTimeout(1000);
  const chron = (await api(page, `/api/worlds/${w.id}/chronicle`)).body || [];
  check('живой мир: итоги партии в хронике', chron.length === 1 && chron[0].status === 'new', JSON.stringify(chron[0] || {}).slice(0, 160));
  if (process.env.LIVE) check('живой мир: запись летописи короткая (до 600 симв.)', (chron[0]?.summary || '').length > 20 && (chron[0]?.summary || '').length <= 600, (chron[0]?.summary || '').slice(0, 200));
  const sNow = (await api(page, `/api/sessions/${sid}`)).body;
  log(`   мир в партии: ${JSON.stringify({ f: sNow.config?.world?.factions, c: sNow.config?.world?.clocks })}`);
  report.push(`### Состояние мира после партии\n\n\`${JSON.stringify({ factions: sNow.config?.world?.factions, clocks: sNow.config?.world?.clocks, chronicleDelta: chron[0]?.delta })}\`\n`);
  if (chron[0]) {
    await api(page, `/api/worlds/${w.id}/chronicle/${chron[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'canon' }) });
    const me2 = (await api(page, '/api/auth/me')).body;
    const created = await api(page, '/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: me2.workspaces[0].id, setup: { worldId: w.id, scenarioId: 'dark', style: 'balanced', characters: [{ name: 'Тарн', concept: 'Ныряльщик гильдии', gender: 'М' }] } }) });
    const s2 = created.body;
    let r2 = await waitTurn(page, s2.id, 1);
    await api(page, `/api/sessions/${s2.id}/turn`, { method: 'POST', body: JSON.stringify({ content: 'Тарн расспрашивает в порту, что случилось той ночью на маяке и кто такая Рина' }) });
    r2 = await waitTurn(page, s2.id, 2);
    recordTurn('Живой мир: новая партия расспрашивает о прошлой', r2.s, r2.ms);
    if (process.env.LIVE) check('живой мир: новая партия помнит прошлую (Рина)', /Рин/.test(lastAssistant(r2.s)?.content || ''), (lastAssistant(r2.s)?.content || '').slice(0, 140));
  }
  await ctx.close();
}

async function learn(browser) {
  log('\n== Обучение новичка ==');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await register(page);
  check('обучение: на главной «Миры от Nexus»', await page.getByText('Миры от Nexus').count() > 0);
  check('обучение: кнопка обучающей партии', await page.getByTestId('start-tutorial').count() > 0);
  await snap(page, 'learn_home');
  await page.getByTestId('start-tutorial').click();
  await page.waitForTimeout(1500);
  const me = (await api(page, '/api/auth/me')).body;
  const sid = (await api(page, `/api/workspaces/${me.workspaces[0].id}/sessions`)).body[0]?.id;
  check('обучение: партия создана', !!sid);
  let { s } = await waitTurn(page, sid, 1);
  check('обучение: флаг и стартовый мир', s.config?.tutorial === true && s.config?.world?.id === 'starter-crossroads');
  await page.waitForTimeout(800);
  check('обучение: подсказка 1', await page.locator('[data-tutorial-tip="0"]').count() > 0);
  await snap(page, 'learn_tip1');
  await page.getByText('Понятно', { exact: true }).click();
  check('обучение: подсказка скрывается', await page.locator('[data-tutorial-tip="0"]').count() === 0);
  ({ s } = await gmTurn(page, sid, 'Ласка расспрашивает Борна Медяка, где видели караван в последний раз', 2));
  report.push(`### Обучение, ход 2\n${(s.history.filter(m => m.role === 'assistant').pop()?.content || '').slice(0, 1500)}\n`);
  check('обучение: подсказка 2 после хода', await page.locator('[data-tutorial-tip="1"]').count() > 0);
  await snap(page, 'learn_tip2');
  // мастер просит бросок → плашка над вводом, герой и действие выбраны заранее, остаётся кубик
  let rolledInTutorial = false;
  for (let k = 0; k < 2 && !rolledInTutorial; k++) {
    if (await page.getByTestId('roll-prompt').count()) {
      await page.getByText('Понятно', { exact: true }).click().catch(() => undefined);
      await page.getByTestId('roll-prompt').click();
      const btn = page.locator('button[data-suggested="1"]').first();
      await (await btn.count() ? btn : page.getByText('Обычный', { exact: true })).click();
      await page.waitForTimeout(1500);
      await snap(page, 'learn_roll');
      const n0 = s.history.filter(m => m.role === 'assistant').length;
      ({ s } = await gmTurn(page, sid, 'Ласка рискует', n0 + 1));
      rolledInTutorial = s.history.some(m => m.role === 'user' && /\[ROLL:[^\]]*Итог/.test(m.content));
      report.push(`### Обучение, ход с броском\n${(s.history.filter(m => m.role === 'assistant').pop()?.content || '').slice(0, 1500)}\n`);
    } else if (k === 0) {
      ({ s } = await gmTurn(page, sid, 'Ласка идёт по следу каравана на Медовый тракт', 3));
    }
  }
  check('обучение: мастер попросил бросок, бросок в один клик', rolledInTutorial || !process.env.LIVE, rolledInTutorial ? '' : 'плашки броска не было');
  if (process.env.LONG) {
    const acts = ['Ласка идёт по следу каравана на Медовый тракт', 'Ласка уворачивается и бьёт кинжалом', 'Ласка обыскивает место стычки', 'Ласка возвращается к Борну с находкой'];
    for (let i = 0; i < acts.length; i++) {
      await page.getByText('Понятно', { exact: true }).click().catch(() => undefined);
      const n0 = s.history.filter(m => m.role === 'assistant').length;
      ({ s } = await gmTurn(page, sid, acts[i], n0 + 1));
      report.push(`### Обучение, ход ${n0 + 1}\n${(s.history.filter(m => m.role === 'assistant').pop()?.content || '').slice(0, 1500)}\n`);
    }
  } else await page.getByText('Я уже умею играть').click();
  if (!process.env.LONG) check('обучение: подсказки отключаются', await page.locator('[data-tutorial-tip]').count() === 0);
  await ctx.close();
}

const main = async () => {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const only = (process.env.ONLY || 'solo,mp,tale,world,learn').split(',');
  const t0 = Date.now();
  for (const [id, fn] of [['solo', solo], ['mp', multiplayer], ['tale', tale], ['world', worldPlay], ['learn', learn]]) {
    if (!only.includes(id)) continue;
    try { await fn(browser); } catch (e) { check(`${id}: сценарий прошёл без ошибок`, false, String(e?.message || e).slice(0, 300)); }
  }
  await browser.close();
  const failed = checks.filter(c => !c.ok);
  const md = [
    `# Прогон на ИИ: ${process.env.REPORT_TITLE || BASE}`,
    `Время: ${((Date.now() - t0) / 1000).toFixed(0)} с · проверок: ${checks.length} · провалено: ${failed.length}`,
    '', '## Проверки', ...checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — \`${String(c.detail).slice(0, 160)}\`` : ''}`),
    '', '## Ответы мастера', ...report,
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  log(`\nОтчёт: ${path.join(OUT, 'report.md')}`);
  process.exit(failed.length ? 1 : 0);
};
main();
