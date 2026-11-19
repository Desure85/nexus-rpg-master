/**
 * Мобильный аудит: проходит основные экраны на 390×844 и 360×740, снимает скриншоты
 * и ищет горизонтальное переполнение (элементы шире экрана, прокрутка вбок).
 * Запуск: BASE_URL=http://127.0.0.1:3000 OUT_DIR=mobile node e2e/mobile.mjs (сервер с LLM_PROVIDER=mock)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT = process.env.OUT_DIR || 'mobile-report';
fs.mkdirSync(OUT, { recursive: true });
let shot = 0, failed = 0;
const lines = [];
const log = s => { console.log(s); lines.push(s); };

const api = async (page, url, opts = {}) => page.evaluate(async ([u, o]) => {
  const r = await fetch(u, { credentials: 'same-origin', headers: { 'x-nexus-client': '1', 'Content-Type': 'application/json', 'x-device-id': localStorage.getItem('nexus_device_id') || 'e2e-device-0000000001' }, ...o });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [url, opts]);

/** Что вылезает за правый край: прокрутка страницы вбок и видимые элементы шире экрана (без прокручиваемых контейнеров). */
const overflow = page => page.evaluate(() => {
  const W = window.innerWidth;
  const out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push(`страница шире экрана: ${document.documentElement.scrollWidth}px`);
  const scrollsX = el => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed' && r.width >= W) continue;
    // целиком за краем — это спрятанная панель (меню, шторка), а не переполнение
    if (r.right <= 1 || r.left >= W - 1) continue;
    if ((r.right > W + 2 || r.left < -2) && !scrollsX(el)) {
      const name = `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} «${(el.textContent || '').trim().slice(0, 40)}»`;
      out.push(`${name}: ${Math.round(r.left)}…${Math.round(r.right)}`);
    }
  }
  // мелкие кнопки, в которые трудно попасть пальцем
  const tiny = [...document.querySelectorAll('button, a, [role=button]')].filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight && (r.width < 24 || r.height < 24); }).length;
  return { out: [...new Set(out)].slice(0, 12), tiny };
});

const snap = async (page, name) => {
  await page.waitForTimeout(400);
  const f = `${String(++shot).padStart(2, '0')}_${page.viewportSize().width}_${name}.png`;
  await page.screenshot({ path: path.join(OUT, f) });
  const { out, tiny } = await overflow(page);
  if (out.length) { failed++; log(`❌ ${name} (${page.viewportSize().width}px): ${out.join(' | ')}`); }
  else log(`✅ ${name} (${page.viewportSize().width}px)${tiny ? ` · мелких кнопок: ${tiny}` : ''}`);
};

const click = async (page, text, opts = {}) => { const l = (text instanceof RegExp ? page.locator('button', { hasText: text }) : page.getByText(text, { exact: true, ...opts })).first(); if (await l.count()) { await l.click(); await page.waitForTimeout(400); return true; } log(`   (нет «${text}»)`); return false; };
/** Закрыть верхнее окно: Escape, а если не помогло — крестик в самом верхнем модальном слое. */
const close = async page => {
  const layers = () => page.locator('div.fixed.inset-0').count();
  const before = await layers();
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  if (await layers() < before) return;
  noEsc.add(await page.evaluate(() => document.querySelectorAll('div.fixed.inset-0').length));
  const top = page.locator('div.fixed.inset-0').last();
  const x = top.locator('button:has(svg.lucide-x)').first();
  if (await x.count()) await x.click().catch(() => undefined);
  await page.waitForTimeout(300);
};
const noEsc = new Set();

async function run(browser, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => undefined));
  await page.goto(BASE);
  await snap(page, 'auth');
  await page.getByText('РЕГИСТРАЦИЯ', { exact: false }).click();
  await page.fill("input[placeholder='Как вас называть']", 'Мобильный мастер');
  await page.fill('input[type=email]', `m-${width}-${Date.now()}@e2e.local`);
  await page.fill('input[type=password]', 'password123');
  await page.locator('form button[type=submit]').click();
  await page.waitForTimeout(1500);
  if (await page.getByText('Понятно, играть').count()) await page.getByText('Понятно, играть').click();
  await snap(page, 'home');
  await page.mouse.wheel(0, 900); await snap(page, 'home_scrolled'); await page.mouse.wheel(0, -2000);

  // новая игра
  if (await click(page, 'Соло-приключение')) { await snap(page, 'setup'); await page.mouse.wheel(0, 1200); await snap(page, 'setup_bottom'); await close(page); await page.goto(BASE); await page.waitForTimeout(800); }

  // миры: каталог, мир, редактор
  if (await click(page, 'Миры')) {
    await snap(page, 'worlds_mine');
    await click(page, 'Каталог'); await snap(page, 'worlds_catalog');
    await page.getByRole('button', { name: 'Играть', exact: true }).first().click({ timeout: 3000 }).catch(() => undefined);
    await snap(page, 'world_play');
    await close(page);
    await click(page, 'Создать');
    for (const tab of ['Паспорт', 'Лор', 'Места', 'Сюжеты', 'Герои', 'Враги', 'Предметы', 'Фракции']) {
      if (await click(page, new RegExp(`^${tab}`))) { if (tab !== 'Паспорт') await page.getByText('Добавить', { exact: false }).first().click({ timeout: 2000 }).catch(() => undefined); await snap(page, `editor_${tab}`); }
    }
    await close(page); await close(page);
  }
  await page.goto(BASE); await page.waitForTimeout(800);

  // партия из стартового мира: игра, сцена, кубики, лавка, карта
  const me = (await api(page, '/api/auth/me')).body;
  const ws = me.workspaces[0].id;
  const created = (await api(page, '/api/sessions', { method: 'POST', body: JSON.stringify({ workspaceId: ws, setup: { worldId: 'starter-crossroads', scenarioId: 'karavan', style: 'balanced', characters: [{ name: 'Ласка', concept: 'Охранница караванов', gender: 'Ж', archetype: 'rogue' }, { name: 'Бранд', concept: 'Бывший рыцарь', gender: 'М', archetype: 'warrior' }] } }) })).body;
  for (let i = 0; i < 60; i++) { const s = (await api(page, `/api/sessions/${created.id}`)).body; if (!s.busy && s.history?.some(m => m.role === 'assistant')) break; await page.waitForTimeout(500); }
  await api(page, `/api/sessions/${created.id}/turn`, { method: 'POST', body: JSON.stringify({ content: 'Ласка осматривает повозку #enemy #npc:Борн Медяк:3' }) });
  for (let i = 0; i < 60; i++) { const s = (await api(page, `/api/sessions/${created.id}`)).body; if (!s.busy && s.history?.filter(m => m.role === 'assistant').length >= 2) break; await page.waitForTimeout(500); }
  await page.evaluate(id => localStorage.setItem('nexus_last_session', id), created.id);
  await page.goto(BASE); await page.waitForTimeout(2000);
  await snap(page, 'game_story');
  await page.mouse.wheel(0, 3000); await snap(page, 'game_story_bottom');
  if (await click(page, /^сцена$/i)) {
    await snap(page, 'game_scene');
    await page.mouse.wheel(0, 700); await snap(page, 'game_scene_2');
    await page.mouse.wheel(0, 900); await snap(page, 'game_scene_3');
    await click(page, /^история$/i);
  }
  if (await page.getByTestId('roll-prompt').count()) { await page.getByTestId('roll-prompt').click(); await snap(page, 'dice_tray'); await close(page); }
  for (const t of ['Лавка', 'Карта', 'Инвентарь']) {
    const b = page.locator(`button[title*='${t}']`).first();
    if (await b.count()) { await b.click({ timeout: 3000 }).catch(() => undefined); await snap(page, `game_${t}`); await close(page); }
  }
  await page.locator('button[title*="Настройки"], button[aria-label*="Настройки"]').first().click({ timeout: 3000 }).catch(() => undefined);
  await snap(page, 'settings'); await close(page);
  await page.locator('header button').first().click({ timeout: 3000 }).catch(() => undefined);
  await snap(page, 'menu'); await close(page);
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  await run(browser, 390, 844);
  await run(browser, 360, 740);
} finally { await browser.close(); }
if (noEsc.size) log(`ℹ️ окна не закрываются по Escape: ${noEsc.size}`);
fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
log(failed ? `\nПереполнение на ${failed} экранах` : '\nПереполнения нет');
process.exit(failed ? 1 : 0);
