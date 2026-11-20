import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../server/app';

let ctx: Awaited<ReturnType<typeof createApp>>;
let dir: string;
const C = { 'x-nexus-client': '1' };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-landing-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html><head><meta name="description" content="x" /><title>Nexus</title><meta property="og:title" content="old" /></head><body></body></html>');
  process.env.APP_URL = 'https://play.example.com';
  ctx = await createApp({ dbPath: ':memory:', staticDir: dir });
});
afterEach(async () => { await ctx.close(); delete process.env.APP_URL; fs.rmSync(dir, { recursive: true, force: true }); });

const register = async (email: string, cookie?: string) => {
  const agent = request.agent(ctx.app);
  const r = agent.post('/api/auth/register').set(C);
  if (cookie) r.set('Cookie', cookie);
  await r.send({ email, password: 'password123', name: email.split('@')[0] });
  return { agent, me: (await agent.get('/api/auth/me')).body };
};

describe('лендинг и воронка', () => {
  it('публичные миры без входа: только каталог, без лора; приватный — 404', async () => {
    const list = (await request(ctx.app).get('/api/public/worlds')).body;
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list[0]).toMatchObject({ official: true });
    expect(list[0].scenarios.length).toBeGreaterThan(0);
    expect(JSON.stringify(list)).not.toMatch(/"cards"|"core"|"enemies"/);
    const { agent } = await register('author@example.com');
    const priv = (await agent.post('/api/worlds').set(C).send({ title: 'Тайный', data: { setting: 'x', cards: [{ name: 'Секрет', text: 'Тайна' }] } })).body;
    expect((await request(ctx.app).get(`/api/public/worlds/${priv.id}`)).status).toBe(404);
    expect((await request(ctx.app).get('/api/public/worlds/starter-velsk')).body).toMatchObject({ title: 'Мглистый Вельск' });
  });

  it('ссылка на мир отдаёт og-теги для превью в мессенджерах; robots и sitemap', async () => {
    const html = (await request(ctx.app).get('/world/starter-mercy')).text;
    expect(html).toContain('<title>Каньон Мерси — мир для игры с ИИ-мастером</title>');
    expect(html).toContain('<meta property="og:url" content="https://play.example.com/world/starter-mercy" />');
    expect(html).not.toContain('content="old"');
    expect((await request(ctx.app).get('/world/<script>')).text).not.toContain('<script>');
    expect((await request(ctx.app).get('/robots.txt')).text).toContain('Sitemap: https://play.example.com/sitemap.xml');
    expect((await request(ctx.app).get('/sitemap.xml')).text).toContain('https://play.example.com/world/starter-crossroads');
  });

  it('воронка: визиты раз в день, источник из ссылки, шаги до оплаты', async () => {
    await request(ctx.app).post('/api/public/visit').send({ anonId: 'anon-aaaaaaaa', source: 'vk' });
    await request(ctx.app).post('/api/public/visit').send({ anonId: 'anon-aaaaaaaa', source: 'vk' });
    await request(ctx.app).post('/api/public/visit').send({ anonId: 'anon-bbbbbbbb' });
    await request(ctx.app).post('/api/public/visit').send({ anonId: '<bad>' });
    const admin = await register('admin@example.com');
    const fan = await register('fan@example.com', 'nx_src=VK');
    expect((ctx.db.prepare('SELECT source FROM users WHERE email = ?').get('fan@example.com') as any).source).toBe('vk');
    // fan: начал игру, 3 хода, вернулся на следующий день, оплатил
    const ws = fan.me.workspaces[0].id;
    const sid = (await fan.agent.post('/api/sessions').set(C).send({ workspaceId: ws, setup: { worldId: 'starter-crossroads', scenarioId: 'karavan', characters: [{ name: 'Ласка', concept: 'Охранница', gender: 'Ж' }] } })).body.id;
    for (let i = 0; i < 3; i++) ctx.db.prepare("INSERT INTO usage (workspace_id, session_id, user_id, kind, mode, created_at) VALUES (?, ?, ?, 'turn', 'platform', datetime('now', '+1 day'))").run(ws, sid, fan.me.user.id);
    ctx.db.prepare("INSERT INTO payments (id, workspace_id, provider, product_id, amount, credits, status) VALUES ('p1', ?, 'mock', 'credits_s', '100.00', 500, 'succeeded')").run(ws);
    expect((await fan.agent.get('/api/admin/funnel')).status).toBe(403);
    const f = (await admin.agent.get('/api/admin/funnel?days=7')).body;
    expect(f).toMatchObject({ visits: 2, signups: 2, started: 1, played: 1, returned: 1, paid: 1 });
    expect(f.bySource.find((r: any) => r.source === 'vk')).toMatchObject({ visits: 1, signups: 1, paid: 1 });
  });
});
