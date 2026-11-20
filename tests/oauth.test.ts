import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;
let profiles: Record<string, any>;

beforeEach(async () => {
  delete process.env.REGISTRATION;
  delete process.env.SUPERADMIN_EMAILS;
  process.env.FREE_CREDITS = '100';
  process.env.APP_URL = 'https://nexus.test';
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec', VK_CLIENT_ID: 'vid', VK_CLIENT_SECRET: 'vsec' });
  delete process.env.YANDEX_CLIENT_ID;
  ctx = await createApp({ dbPath: ':memory:' });
  profiles = {};
  // провайдеры: обмен кода и профиль — подменяем сеть
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
    const u = String(url);
    const json = (b: any, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const body = new URLSearchParams(String(init?.body || ''));
    if (u.includes('oauth2.googleapis.com/token')) return body.get('code_verifier') ? json({ access_token: `g:${body.get('code')}` }) : json({ error: 'invalid_grant' }, 400);
    if (u.includes('openidconnect.googleapis.com')) return json(profiles[String(init.headers.Authorization).replace('Bearer g:', '')]);
    if (u.includes('id.vk.com/oauth2/auth')) return body.get('device_id') ? json({ access_token: `v:${body.get('code')}`, user_id: 7 }) : json({ error: 'no_device' }, 400);
    if (u.includes('id.vk.com/oauth2/user_info')) return json({ user: profiles[String(body.get('access_token')).replace('v:', '')] });
    return json({ error: 'unexpected' }, 500);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const k of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'VK_CLIENT_ID', 'VK_CLIENT_SECRET', 'APP_URL']) delete process.env[k];
  await ctx.close();
});

/** Полный круг входа через провайдера для агента-браузера. */
const login = async (agent: ReturnType<typeof request.agent>, provider: string, code: string, profile: any, extra = '', next = '/') => {
  profiles[code] = profile;
  const start = await agent.get(`/api/auth/oauth/${provider}/start?next=${encodeURIComponent(next)}${extra}`);
  expect(start.status).toBe(302);
  const loc = new URL(start.headers.location);
  const state = loc.searchParams.get('state')!;
  expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
  expect(loc.searchParams.get('redirect_uri')).toBe(`https://nexus.test/api/auth/oauth/${provider}/callback`);
  return agent.get(`/api/auth/oauth/${provider}/callback?code=${code}&state=${state}${provider === 'vk' ? '&device_id=dev1' : ''}`);
};

describe('вход через VK, Яндекс, Google', () => {
  it('список провайдеров — только настроенные', async () => {
    expect((await request(ctx.app).get('/api/auth/providers')).body.map((p: any) => p.id)).toEqual(['vk', 'google']);
    expect((await request(ctx.app).get('/api/auth/oauth/yandex/start')).status).toBe(404);
  });

  it('Google: новый аккаунт с пространством, повторный вход — тот же, переход на next', async () => {
    const a = request.agent(ctx.app);
    const cb = await login(a, 'google', 'c1', { sub: 'g-1', email: 'Ann@Example.com', email_verified: true, name: 'Анна' }, '', '/world/abc');
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/world/abc');
    const me = (await a.get('/api/auth/me')).body;
    expect(me.user.email).toBe('ann@example.com');
    expect(me.user.name).toBe('Анна');
    expect(me.workspaces).toHaveLength(1);
    const b = request.agent(ctx.app);
    await login(b, 'google', 'c2', { sub: 'g-1', email: 'ann@example.com', email_verified: true, name: 'Анна' });
    expect((await b.get('/api/auth/me')).body.user.id).toBe(me.user.id);
  });

  it('подтверждённая почта Google входит в существующий аккаунт; неподтверждённая VK — нет', async () => {
    const reg = request.agent(ctx.app);
    await reg.post('/api/auth/register').set('x-nexus-client', '1').send({ email: 'old@example.com', password: 'password123', name: 'Старый' });
    const oldId = (await reg.get('/api/auth/me')).body.user.id;
    const g = request.agent(ctx.app);
    await login(g, 'google', 'c3', { sub: 'g-2', email: 'old@example.com', email_verified: true, name: 'X' });
    expect((await g.get('/api/auth/me')).body.user.id).toBe(oldId);
    const v = request.agent(ctx.app);
    await login(v, 'vk', 'c4', { user_id: 42, email: 'old@example.com', first_name: 'Иван', last_name: 'Петров' });
    const vme = (await v.get('/api/auth/me')).body.user;
    expect(vme.id).not.toBe(oldId);
    expect(vme.email).toBe('vk_42@oauth.local');
    expect(vme.name).toBe('Иван Петров');
  });

  it('next — только путь своего сайта (нет открытого редиректа)', async () => {
    for (const [next, want] of [['/world/abc?x=1', '/world/abc?x=1'], ['//evil.com', '/'], ['/\\evil.com', '/'], ['https://evil.com', '/'], ['/ok\\..\\x', '/']]) {
      const start = await request(ctx.app).get(`/api/auth/oauth/google/start?next=${encodeURIComponent(next)}`);
      const state = new URL(start.headers.location).searchParams.get('state');
      expect((ctx.db.prepare('SELECT next FROM oauth_states WHERE state = ?').get(state) as any).next, next).toBe(want);
    }
  });

  it('подмена state или чужой браузер — отказ', async () => {
    const a = request.agent(ctx.app);
    profiles.c5 = { sub: 'g-3', email: 'z@example.com', email_verified: true };
    const start = await a.get('/api/auth/oauth/google/start');
    const state = new URL(start.headers.location).searchParams.get('state');
    const stranger = await request(ctx.app).get(`/api/auth/oauth/google/callback?code=c5&state=${state}`);
    expect(stranger.headers.location).toMatch(/auth_error=/);
    const bad = await a.get('/api/auth/oauth/google/callback?code=c5&state=forged');
    expect(bad.headers.location).toMatch(/auth_error=/);
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('привязка второго способа, отвязка последнего запрещена, пароль задаётся без текущего', async () => {
    const a = request.agent(ctx.app);
    await login(a, 'vk', 'c6', { user_id: 5, first_name: 'Ольга' });
    const uid = (await a.get('/api/auth/me')).body.user.id;
    let ids = (await a.get('/api/auth/identities')).body;
    expect(ids.hasPassword).toBe(false);
    expect(ids.identities.map((i: any) => i.provider)).toEqual(['vk']);
    expect((await a.delete('/api/auth/identities/vk').set('x-nexus-client', '1')).status).toBe(400);
    await login(a, 'google', 'c7', { sub: 'g-9', email: 'olga@example.com', email_verified: true }, '&link=1', '/settings');
    expect((await a.get('/api/auth/me')).body.user.id).toBe(uid);
    ids = (await a.get('/api/auth/identities')).body;
    expect(ids.identities.map((i: any) => i.provider).sort()).toEqual(['google', 'vk']);
    expect((await a.delete('/api/auth/identities/vk').set('x-nexus-client', '1')).status).toBe(200);
    expect((await a.post('/api/auth/password').set('x-nexus-client', '1').send({ newPassword: 'newpassword1' })).status).toBe(200);
    expect((await a.get('/api/auth/identities')).body.hasPassword).toBe(true);
  });

  it('закрытая регистрация не пускает новых через провайдера', async () => {
    const first = request.agent(ctx.app);
    await first.post('/api/auth/register').set('x-nexus-client', '1').send({ email: 'admin@example.com', password: 'password123' });
    process.env.REGISTRATION = 'closed';
    const a = request.agent(ctx.app);
    const cb = await login(a, 'google', 'c8', { sub: 'g-10', email: 'new2@example.com', email_verified: true });
    expect(decodeURIComponent(cb.headers.location)).toMatch(/Регистрация закрыта/);
    delete process.env.REGISTRATION;
  });
});
