import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { createApp } from '../server/app';

const DEV_A = 'device-a-0123456789abcdef';
const DEV_B = 'device-b-0123456789abcdef';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;

beforeEach(async () => {
  delete process.env.REGISTRATION;
  delete process.env.SUPERADMIN_EMAILS;
  delete process.env.PAYMENTS_PROVIDER;
  process.env.FREE_CREDITS = '1000';
  ctx = await createApp({ dbPath: ':memory:' });
});
afterEach(async () => {
  await ctx.close();
});

/** Зарегистрированный пользователь с cookie-сессией. */
const account = async (email: string, extra: any = {}) => {
  const agent = request.agent(ctx.app);
  const r = await agent.post('/api/auth/register').set('x-nexus-client', '1').send({ email, password: 'password123', name: email.split('@')[0], ...extra });
  if (r.status !== 201) throw new Error(`register ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = (await agent.get('/api/auth/me')).body;
  const h = (t: any) => t.set('x-nexus-client', '1');
  return {
    me,
    wid: me.workspaces[0]?.id as string,
    get: (u: string) => agent.get(u),
    post: (u: string, b: any = {}) => h(agent.post(u)).send(b),
    patch: (u: string, b: any = {}) => h(agent.patch(u)).send(b),
    del: (u: string) => h(agent.delete(u)),
  };
};
type Account = Awaited<ReturnType<typeof account>>;
let gmAcc: Account;
const gm = () => gmAcc;
beforeEach(async () => { gmAcc = await account('gm@example.com'); });

const player = (dev: string) => ({
  get: (u: string) => request(ctx.app).get(u).set('x-device-id', dev),
  post: (u: string, b: any = {}) => request(ctx.app).post(u).set('x-device-id', dev).send(b),
});

const createSession = async (setup: any, config: any = {}, who: Account = gm()) => {
  const res = await who.post('/api/sessions', { setup, config, workspaceId: who.wid });
  expect(res.status).toBe(201);
  await ctx.engine.whenIdle(res.body.id);
  return res.body.id as string;
};

const rpgSetup = (mode = 'short') => ({
  setting: 'Тёмный лес', plotHook: 'Пропал мельник', style: 'balanced', mode,
  characters: [{ name: 'Арн', concept: 'воин', gender: 'М' }, { name: 'Лиса', concept: 'воровка', gender: 'Ж' }],
});

const lastDash = (s: any) => [...s.history].reverse().find((m: any) => m.dashboard)?.dashboard;

describe('соло', () => {
  it('создаёт сессию, сервер сам проводит стартовый ход', async () => {
    const id = await createSession(rpgSetup());
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.isOwner).toBe(true);
    expect(s.busy).toBe(false);
    expect(s.history.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(lastDash(s).characters.map((c: any) => c.name)).toEqual(['Арн', 'Лиса']);
    expect(s.history[1].content).not.toContain('<dashboard_json>');
    expect(s.owner_hash).toBeUndefined();
  });

  it('ход мастера: проверка встречи и состояние добавляются сервером, движок владеет числами', async () => {
    const id = await createSession(rpgSetup());
    const r = await gm().post(`/api/sessions/${id}/turn`, { content: 'Арн рубит дверь #hurt', rolls: ['**Арн**: [ROLL: 1d20 = 15]'] });
    expect(r.status).toBe(202);
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    const user = s.history[2].content;
    expect(user).toContain('### GM Rolls:');
    expect(user).toMatch(/\[STATE: .*Арн HP 12\/12/);
    expect(lastDash(s).characters.find((c: any) => c.name === 'Арн').hp).toBe('9/12');
    const state = (await gm().get(`/api/sessions/${id}/state`)).body;
    expect(state.characters['Арн'].hp_cur).toBe(9);
  });

  it('итоги партии попадают в архив', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: '[SESSION SUMMARY] подведи итоги' });
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.archive).toContain('# Итоги партии');
  });

  it('ручная правка дашборда синхронизирует движок', async () => {
    const id = await createSession(rpgSetup());
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    const dash = lastDash(s);
    dash.characters[0].hp = '5/12';
    dash.characters[0].gold = 99;
    expect((await gm().post(`/api/sessions/${id}/dashboard`, { dashboard: dash })).status).toBe(200);
    const st = (await gm().get(`/api/sessions/${id}/state`)).body.characters['Арн'];
    expect([st.hp_cur, st.gold]).toEqual([5, 99]);
  });

  it('экономика работает только в локации с сервисом', async () => {
    const id = await createSession(rpgSetup('campaign'));
    const ok = await gm().post(`/api/sessions/${id}/economy`, { action: 'rest', charName: 'Арн' });
    expect(ok.status).toBe(200);
    expect(ok.body.gold).toBe(0);
    const broke = await gm().post(`/api/sessions/${id}/economy`, { action: 'rest', charName: 'Арн' });
    expect(broke.status).toBe(400);
  });
});

describe('доступ', () => {
  it('чужой мастер из другого пространства не видит и не меняет сессию', async () => {
    const id = await createSession(rpgSetup());
    const other = await account('other@example.com');
    expect((await other.get(`/api/workspaces/${gm().wid}/sessions`)).status).toBe(403);
    expect((await other.get(`/api/workspaces/${other.wid}/sessions`)).body).toEqual([]);
    expect((await gm().get(`/api/workspaces/${gm().wid}/sessions`)).body.map((s: any) => s.id)).toEqual([id]);
    expect((await other.del(`/api/sessions/${id}`)).status).toBe(403);
    expect((await other.post(`/api/sessions/${id}/turn`, { content: 'взлом' })).status).toBe(403);
    expect((await other.post(`/api/sessions/${id}/economy`, { action: 'rest', charName: 'Арн' })).status).toBe(403);
    expect((await other.post('/api/sessions', { setup: rpgSetup(), workspaceId: gm().wid })).status).toBe(403);
    const viewer = (await other.get(`/api/sessions/${id}`)).body;
    expect(viewer.isOwner).toBe(false);
    expect(viewer.config.systemPrompt).toBeUndefined();
  });

  it('без входа нельзя создать сессию; мутирующие запросы с cookie требуют заголовок клиента', async () => {
    expect((await request(ctx.app).post('/api/sessions').send({ setup: rpgSetup() })).status).toBe(401);
    const agent = request.agent(ctx.app);
    await agent.post('/api/auth/login').set('x-nexus-client', '1').send({ email: 'gm@example.com', password: 'password123' });
    const noHeader = await agent.post('/api/sessions').send({ setup: rpgSetup(), workspaceId: gm().wid });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error).toBe('csrf');
  });

  it('вход, неверный пароль, выход', async () => {
    const agent = request.agent(ctx.app);
    expect((await agent.post('/api/auth/login').set('x-nexus-client', '1').send({ email: 'gm@example.com', password: 'wrong-pass' })).status).toBe(401);
    expect((await agent.post('/api/auth/login').set('x-nexus-client', '1').send({ email: 'GM@example.com', password: 'password123' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('gm@example.com');
    await agent.post('/api/auth/logout').set('x-nexus-client', '1');
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('первый пользователь — суперадмин, остальные нет; регистрация по приглашению', async () => {
    expect(gm().me.user.isSuperadmin).toBe(true);
    const u2 = await account('u2@example.com');
    expect(u2.me.user.isSuperadmin).toBe(false);
    expect((await u2.get('/api/admin/workspaces')).status).toBe(403);
    process.env.REGISTRATION = 'invite';
    expect((await request(ctx.app).post('/api/auth/register').send({ email: 'x@example.com', password: 'password123' })).status).toBe(403);
    const inv = (await gm().post(`/api/workspaces/${gm().wid}/invites`, { role: 'gm' })).body;
    expect((await request(ctx.app).get(`/api/invites/${inv.token}`)).body.workspace).toContain('Пространство');
    const u3 = await account('u3@example.com', { invite: inv.token });
    expect(u3.me.workspaces.map((w: any) => w.id)).toEqual([gm().wid]);
    expect(u3.me.workspaces[0].role).toBe('gm');
  });

  it('роли: гм видит сессии пространства, но управляет только своими; админ — всеми', async () => {
    const inv = (await gm().post(`/api/workspaces/${gm().wid}/invites`, { role: 'gm' })).body;
    const colleague = await account('colleague@example.com', { invite: inv.token });
    const id = await createSession(rpgSetup());
    const list = (await colleague.get(`/api/workspaces/${gm().wid}/sessions`)).body;
    expect(list[0]).toMatchObject({ id, canManage: false });
    expect((await colleague.post(`/api/sessions/${id}/turn`, { content: 'x' })).status).toBe(403);
    const own = await createSession(rpgSetup(), {}, colleague);
    expect((await gm().post(`/api/sessions/${own}/turn`, { content: 'админ может' })).status).toBe(202);
    await ctx.engine.whenIdle(own);
    // гм не может приглашать и менять ИИ
    expect((await colleague.post(`/api/workspaces/${gm().wid}/invites`, { role: 'admin' })).status).toBe(403);
    expect((await colleague.patch(`/api/workspaces/${gm().wid}`, { ai: { mode: 'platform' } })).status).toBe(403);
    // последний владелец не может уйти
    expect((await gm().del(`/api/workspaces/${gm().wid}/members/${gm().me.user.id}`)).status).toBe(400);
  });

  it('несуществующая сессия — 404, мусор в WebSocket не роняет сервер', async () => {
    expect((await gm().get('/api/sessions/nope')).status).toBe(404);
    await new Promise<void>(resolve => ctx.server.listen(0, resolve));
    const port = (ctx.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise(r => ws.once('open', r));
    ws.send('{не json');
    ws.send(JSON.stringify({ type: 'join', sessionId: 'nope' }));
    await new Promise(r => setTimeout(r, 50));
    expect((await request(ctx.app).get('/api/health')).body.status).toBe('ok');
    ws.close();
  });
});

describe('ИИ пространства и биллинг', () => {
  it('ключ ИИ платформы и логи — только суперадмину, ключи не утекают', async () => {
    const u2 = await account('u2@example.com');
    expect((await u2.post('/api/settings', { provider: 'local' })).status).toBe(403);
    expect((await u2.get('/api/logs')).status).toBe(403);
    const saved = await gm().post('/api/settings', { provider: 'gemini', apiKey: 'AIzaSECRETKEY1234' });
    expect(saved.body.apiKey).toBe('••••1234');
    expect(JSON.stringify((await u2.get('/api/settings')).body)).not.toContain('SECRET');
    await gm().post('/api/settings', { apiKey: '••••1234' });
    expect((await gm().get('/api/settings')).body.apiKey).toBe('••••1234');
  });

  it('BYOK: ключ шифруется, отдаётся маской, ходы не тратят кредиты', async () => {
    const r = await gm().patch(`/api/workspaces/${gm().wid}`, { ai: { mode: 'byok', provider: 'openrouter', model: 'x/y', key: 'sk-or-SECRET9999' } });
    expect(r.status).toBe(200);
    expect(r.body.ai).toMatchObject({ mode: 'byok', provider: 'openrouter', key: '••••9999' });
    const raw = ctx.db.prepare('SELECT ai_key_enc FROM workspaces WHERE id = ?').get(gm().wid) as any;
    expect(raw.ai_key_enc).toMatch(/^v1:/);
    expect(raw.ai_key_enc).not.toContain('SECRET');
    // провайдер «свой URL» запрещён без ALLOW_BYOK_CUSTOM_URL (защита от SSRF)
    expect((await gm().patch(`/api/workspaces/${gm().wid}`, { ai: { mode: 'byok', provider: 'local', url: 'http://169.254.169.254/' } })).status).toBe(400);
    // в тестах LLM_PROVIDER=mock принудительно, поэтому проверяем учёт: режим byok → 0 кредитов
    const before = (await gm().get(`/api/workspaces/${gm().wid}`)).body.credits;
    await createSession(rpgSetup());
    const after = (await gm().get(`/api/workspaces/${gm().wid}`)).body.credits;
    expect(after).toBe(before);
    const usage = ctx.db.prepare('SELECT mode, credits FROM usage WHERE workspace_id = ?').all(gm().wid) as any[];
    expect(usage.every(u => u.mode === 'byok' && u.credits === 0)).toBe(true);
  });

  it('ключ платформы: ходы списывают кредиты, без кредитов — 402', async () => {
    const before = (await gm().get(`/api/workspaces/${gm().wid}`)).body.credits;
    const id = await createSession(rpgSetup());
    const after = (await gm().get(`/api/workspaces/${gm().wid}`)).body.credits;
    expect(after).toBeLessThan(before);
    const billing = (await gm().get(`/api/workspaces/${gm().wid}/billing`)).body;
    expect(billing.ledger[0].reason).toBe('usage:turn');
    // обнуляем баланс
    ctx.db.prepare('UPDATE workspaces SET credits = 0 WHERE id = ?').run(gm().wid);
    const blocked = await gm().post('/api/sessions', { setup: rpgSetup(), workspaceId: gm().wid });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe('insufficient_credits');
    // ход в существующей сессии — ошибка хода с кодом, а не падение
    await new Promise<void>(resolve => ctx.server.listen(0, resolve));
    const port = (ctx.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const events: any[] = [];
    ws.on('message', d => events.push(JSON.parse(d.toString())));
    await new Promise(r => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'join', sessionId: id }));
    await new Promise(r => setTimeout(r, 30));
    await gm().post(`/api/sessions/${id}/turn`, { content: 'ещё ход' });
    await ctx.engine.whenIdle(id);
    await new Promise(r => setTimeout(r, 50));
    expect(events.find(e => e.type === 'turn_error')).toMatchObject({ code: 'insufficient_credits' });
    ws.close();
  });

  it('оплата (mock-провайдер): пакет и подписка зачисляются один раз', async () => {
    process.env.PAYMENTS_PROVIDER = 'mock';
    const products = (await gm().get('/api/billing/products')).body;
    expect(products.products.map((p: any) => p.id)).toContain('pack_s');
    const before = (await gm().get(`/api/workspaces/${gm().wid}`)).body.credits;
    const co = (await gm().post(`/api/workspaces/${gm().wid}/checkout`, { productId: 'sub_master' })).body;
    expect(co.confirmationUrl).toMatch(/^\/api\/billing\/mock\/confirm\//);
    await request(ctx.app).get(co.confirmationUrl).expect(302);
    await request(ctx.app).get(co.confirmationUrl).expect(302); // повторное подтверждение не начисляет дважды
    const ws = (await gm().get(`/api/workspaces/${gm().wid}`)).body;
    expect(ws.credits).toBe(before + 4000);
    expect(ws.plan).toBe('pro');
    expect(ws.limits.maxHeroes).toBe(8);
    const u2 = await account('u2@example.com');
    expect((await u2.post(`/api/workspaces/${gm().wid}/checkout`, { productId: 'pack_s' })).status).toBe(403);
  });

  it('лимиты бесплатного тарифа: не больше 4 героев', async () => {
    const setup = { ...rpgSetup(), characters: ['А', 'Б', 'В', 'Г', 'Д'].map(n => ({ name: n, concept: 'x' })) };
    const r = await gm().post('/api/sessions', { setup, workspaceId: gm().wid });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe('plan_limit');
  });

  it('суперадмин: начисление кредитов и блокировка пространства', async () => {
    const u2 = await account('u2@example.com');
    const list = (await gm().get('/api/admin/workspaces')).body.workspaces;
    expect(list.length).toBe(2);
    await gm().post(`/api/admin/workspaces/${u2.wid}/credits`, { delta: 500, reason: 'промо' });
    expect((await u2.get(`/api/workspaces/${u2.wid}`)).body.credits).toBe(1500);
    await gm().post(`/api/admin/workspaces/${u2.wid}/status`, { status: 'suspended' });
    const r = await u2.post('/api/sessions', { setup: rpgSetup(), workspaceId: u2.wid });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('workspace_suspended');
  });
});

describe('движок после аудита промптов', () => {
  it('стресс из метки броска и +2 max HP за уровень применяет движок', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Арн бьёт', rolls: ['**Арн** performs *удар*: [ROLL: Stress Resonance (3d20) = [3,9,17] | Stress: +2 (Max used)]'] });
    await ctx.engine.whenIdle(id);
    let st = (await gm().get(`/api/sessions/${id}/state`)).body.characters['Арн'];
    expect(st.stress).toBe(2);
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Тренируюсь #xp' });
    await ctx.engine.whenIdle(id);
    st = (await gm().get(`/api/sessions/${id}/state`)).body.characters['Арн'];
    expect(st.hp_max).toBe(14);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    const userMsg = s.history.find((m: any) => m.content.startsWith('Тренируюсь')).content;
    expect(userMsg).toMatch(/\[ACTION SLOTS: Арн: [^;]+; Лиса: /);
  });

  it('дубль Хаоса поднимает Пул Рока', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Лиса рискует', rolls: ['**Лиса** performs *прыжок*: [ROLL: Chaos Roll (2d20) = [9,9] | DOUBLE! Doom +1]'] });
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(lastDash(s).doomPool).toBe(1);
  });
});

describe('мультиплеер', () => {
  it('заявка → одобрение → действия → раунд: ИИ видит действия игроков', async () => {
    const id = await createSession(rpgSetup());
    const claim = await player(DEV_A).post(`/api/sessions/${id}/claim`, { charName: 'Арн', playerName: 'Петя' });
    expect(claim.body.status).toBe('pending');

    // секрет устройства не раскрывается
    const claims = (await request(ctx.app).get(`/api/sessions/${id}/claims`)).body;
    expect(JSON.stringify(claims)).not.toContain(DEV_A);
    expect(claims[0].mine).toBe(false);
    expect((await player(DEV_A).get(`/api/sessions/${id}/claims`)).body[0].mine).toBe(true);

    // до одобрения ходить нельзя, одобрять может только мастер
    expect((await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'иду' })).status).toBe(403);
    expect((await (await account('other@example.com')).post(`/api/sessions/${id}/claims/${claims[0].id}/approve`)).status).toBe(403);
    expect((await gm().post(`/api/sessions/${id}/claims/${claims[0].id}/approve`)).status).toBe(200);

    // второй игрок не может занять того же героя и ходить за него
    expect((await player(DEV_B).post(`/api/sessions/${id}/claim`, { charName: 'Арн', playerName: 'Вася' })).status).toBe(409);
    expect((await player(DEV_B).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'подстава' })).status).toBe(403);

    const act = await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'Иду к мельнице', roll: 'classic' });
    expect(act.status).toBe(200);
    expect(act.body.action).toMatch(/\[ROLL: 1d20 = \d+\]/);
    expect((await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'ещё' })).status).toBe(409);

    await gm().post(`/api/sessions/${id}/gm-action`, { charName: 'Лиса', action: 'Прячусь в тени' });

    const commit = await gm().post(`/api/sessions/${id}/commit`);
    expect(commit.status).toBe(202);
    expect(commit.body.committed).toBe(2);
    await ctx.engine.whenIdle(id);

    const s = (await gm().get(`/api/sessions/${id}`)).body;
    const texts = s.history.map((m: any) => m.content);
    expect(texts.some((t: string) => t.startsWith('[PLAYER ACTION: Арн (Петя)] Иду к мельнице'))).toBe(true);
    expect(texts.some((t: string) => t.startsWith('[PLAYER ACTION: Лиса (ГМ)] Прячусь в тени'))).toBe(true);
    const reply = s.history[s.history.length - 1];
    expect(reply.role).toBe('assistant');
    expect(reply.content).toContain('Арн (Петя) — Иду к мельнице');
    expect(reply.content).toContain('Лиса (ГМ) — Прячусь в тени');
    expect((await request(ctx.app).get(`/api/sessions/${id}/pending`)).body).toEqual([]);
  });

  it('автоодобрение и освобождение персонажа', async () => {
    const id = await createSession(rpgSetup(), { autoApprove: true });
    expect((await player(DEV_A).post(`/api/sessions/${id}/claim`, { charName: 'Лиса', playerName: 'Аня' })).body.status).toBe('approved');
    const cid = (await request(ctx.app).get(`/api/sessions/${id}/claims`)).body[0].id;
    await gm().post(`/api/sessions/${id}/claims/${cid}/release`);
    expect((await player(DEV_B).post(`/api/sessions/${id}/claim`, { charName: 'Лиса', playerName: 'Оля' })).body.status).toBe('approved');
    expect((await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Лиса', action: 'x' })).status).toBe(403);
  });

  it('игроки получают стрим ответа по WebSocket', async () => {
    const id = await createSession(rpgSetup());
    await new Promise<void>(resolve => ctx.server.listen(0, resolve));
    const port = (ctx.server.address() as AddressInfo).port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const events: any[] = [];
    ws.on('message', d => events.push(JSON.parse(d.toString())));
    await new Promise(r => ws.once('open', r));
    ws.send(JSON.stringify({ type: 'join', sessionId: id }));
    await new Promise(r => setTimeout(r, 30));
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Осматриваюсь' });
    await ctx.engine.whenIdle(id);
    await new Promise(r => setTimeout(r, 150));
    const types = events.map(e => e.type);
    expect(types).toContain('joined');
    expect(types).toContain('turn_start');
    expect(types).toContain('turn_end');
    expect(events.filter(e => e.type === 'delta').map(e => e.text).join('')).toContain('Мастер отвечает');
    ws.close();
  });
});

describe('сказка', () => {
  const taleSetup = { setting: 'Волшебный лес', plotHook: '', mode: 'tale', characters: [{ name: 'Ёжик', concept: 'храбрый', gender: 'М' }], tale: { age: '3-5', chapters: 3, moral: 'Дружба важнее' } };

  it('главы с выборами, финал собирает книгу', async () => {
    const id = await createSession(taleSetup);
    let s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.mode).toBe('tale');
    expect(s.config.tale).toMatchObject({ age: '3-5', chapters: 3, moral: 'Дружба важнее' });
    const ch1 = s.history[s.history.length - 1];
    expect(ch1.role).toBe('assistant');
    expect(ch1.choices.length).toBeGreaterThan(1);
    expect(ch1.content).not.toContain('choices_json');
    // героя можно занять с телефона — он есть в «дашборде»
    expect((await player(DEV_A).post(`/api/sessions/${id}/claim`, { charName: 'Ёжик', playerName: 'Маша' })).status).toBe(200);

    await gm().post(`/api/sessions/${id}/turn`, { content: `[TALE_CHOICE] ${ch1.choices[0]}` });
    await ctx.engine.whenIdle(id);
    // глава 3 из 3 — финальная автоматически
    await gm().post(`/api/sessions/${id}/turn`, { content: '[TALE_CHOICE] Позвать друзей' });
    await ctx.engine.whenIdle(id);
    s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.config.tale.finished).toBe(true);
    expect(s.archive.startsWith('# Сказка о том, как Ёжик нашли звезду')).toBe(true);
    expect(s.archive).toContain('*Доброта освещает путь лучше любого фонаря.*');
    expect(s.history.filter((m: any) => m.role === 'assistant').length).toBe(3);
    expect(s.name).toContain('Сказка о том');
    // после конца ходить нельзя
    expect((await gm().post(`/api/sessions/${id}/turn`, { content: '[TALE_CHOICE] ещё' })).status).toBe(409);
  });

  it('досрочный конец по [TALE_END]', async () => {
    const id = await createSession({ ...taleSetup, tale: { age: '6-8', chapters: 10 } });
    await gm().post(`/api/sessions/${id}/turn`, { content: '[TALE_END] Заверши сказку.' });
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.config.tale.finished).toBe(true);
  });
});

describe('доработки механик', () => {
  const dashOf = async (id: string) => lastDash((await gm().get(`/api/sessions/${id}`)).body);
  const setDash = async (id: string, fn: (d: any) => void) => {
    const d = await dashOf(id);
    fn(d);
    expect((await gm().post(`/api/sessions/${id}/dashboard`, { dashboard: d })).status).toBe(200);
  };

  it('idle и экспедиции не делают отдельного хода ИИ: вести уходят со следующим ходом', async () => {
    const id = await createSession(rpgSetup('campaign'));
    ctx.db.prepare("INSERT INTO idle (session_id, last_seen) VALUES (?, datetime('now','-3 hours')) ON CONFLICT(session_id) DO UPDATE SET last_seen = datetime('now','-3 hours')").run(id);
    const usageBefore = (ctx.db.prepare('SELECT COUNT(*) n FROM usage').get() as any).n;
    const idle = (await gm().post(`/api/sessions/${id}/idle`)).body;
    expect(idle.idleGold).toBeGreaterThan(0);
    expect(idle.queued).toBe(true);
    await ctx.engine.whenIdle(id);
    expect((ctx.db.prepare('SELECT COUNT(*) n FROM usage').get() as any).n).toBe(usageBefore);
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Идём на рынок' });
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    const userMsg = s.history.find((m: any) => m.content.startsWith('Идём на рынок')).content;
    expect(userMsg).toContain('[WORLD NEWS]');
    expect(userMsg).toContain('[IDLE:');
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM world_news WHERE session_id = ?').get(id)).toMatchObject({ n: 0 });
  });

  it('новый уровень: без отдельного хода, [LEVEL UP] приходит со следующим', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Тренируюсь #xp' });
    await ctx.engine.whenIdle(id);
    let s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.history.filter((m: any) => m.role === 'assistant').length).toBe(2);
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Дальше' });
    await ctx.engine.whenIdle(id);
    s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.history.find((m: any) => m.content.startsWith('Дальше')).content).toContain('[LEVEL UP] Арн → уровень 2');
  });

  it('путешествие: исход бросает сервер, закрытые и текущие локации отклоняются', async () => {
    const id = await createSession(rpgSetup());
    expect((await gm().post(`/api/sessions/${id}/travel`, { locationId: 'loc-town' })).status).toBe(400);
    const r = await gm().post(`/api/sessions/${id}/travel`, { locationId: 'loc-woods' });
    expect(r.status).toBe(202);
    expect(['encounter', 'discovery', 'safe']).toContain(r.body.type);
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.history.some((m: any) => /^\[TRAVEL/.test(m.content) && m.content.includes('Шепчущий лес'))).toBe(true);
    await setDash(id, d => { d.locations[1].status = 'locked'; });
    expect((await gm().post(`/api/sessions/${id}/travel`, { locationId: 'loc-woods' })).status).toBe(400);
    expect((await gm().post(`/api/sessions/${id}/explore`, {})).status).toBe(202);
    await ctx.engine.whenIdle(id);
  });

  it('HP врагов хранит движок: [HIT] уменьшает, модель не перезаписывает, при 0 враг уходит', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Из кустов выходит враг #enemy' });
    await ctx.engine.whenIdle(id);
    expect((await dashOf(id)).threats).toEqual([expect.objectContaining({ name: 'Мародёр', hp: '10/10' })]);
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Арн бьёт #hit4' });
    await ctx.engine.whenIdle(id);
    expect((await dashOf(id)).threats[0].hp).toBe('6/10'); // мок снова прислал 10/10 — движок не принял
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Добиваем #hit9' });
    await ctx.engine.whenIdle(id);
    expect((await dashOf(id)).threats).toEqual([]);
  });

  it('расходники: эффект из названия, предмет исчезает; игрок — только за своего героя', async () => {
    const id = await createSession(rpgSetup());
    await setDash(id, d => { d.characters[0].hp = '4/12'; d.characters[0].inventory = ['Факел', 'Зелье лечения (восстанавливает 5 HP)']; });
    expect((await gm().post(`/api/sessions/${id}/use`, { charName: 'Арн', item: 'Факел' })).status).toBe(400);
    const r = await gm().post(`/api/sessions/${id}/use`, { charName: 'Арн', item: 'Зелье лечения' });
    expect(r.status).toBe(200);
    expect(r.body.tag).toContain('HP 4→9');
    const d = await dashOf(id);
    expect(d.characters[0].inventory).toEqual(['Факел']);
    expect(d.characters[0].hp).toBe('9/12');
    // игрок с телефона
    await player(DEV_A).post(`/api/sessions/${id}/claim`, { charName: 'Лиса', playerName: 'Аня' });
    const cid = (await request(ctx.app).get(`/api/sessions/${id}/claims`)).body[0].id;
    await gm().post(`/api/sessions/${id}/claims/${cid}/approve`);
    await setDash(id, dd => { dd.characters[1].inventory = ['Отвар мяты (снимает 2 Стресса)']; dd.characters[1].stress = 3; });
    expect((await player(DEV_A).post(`/api/sessions/${id}/use`, { charName: 'Арн', item: 'Факел' })).status).toBe(403);
    const pr = await player(DEV_A).post(`/api/sessions/${id}/use`, { charName: 'Лиса', item: 'Отвар мяты' });
    expect(pr.status).toBe(200);
    expect((await gm().get(`/api/sessions/${id}/state`)).body.characters['Лиса'].stress).toBe(1);
  });

  it('[USE] от модели тоже применяется движком', async () => {
    const id = await createSession(rpgSetup());
    await setDash(id, d => { d.characters[0].hp = '3/12'; d.characters[0].inventory = ['Зелье лечения (восстанавливает 5 HP)']; });
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Арн пьёт зелье #potion' });
    await ctx.engine.whenIdle(id);
    const st = (await gm().get(`/api/sessions/${id}/state`)).body.characters['Арн'];
    expect(st.hp_cur).toBe(8);
    expect((await dashOf(id)).characters[0].inventory).toEqual([]);
  });

  it('«Повержен»: 0 HP блокирует ходы игрока, лечение возвращает в строй', async () => {
    const id = await createSession(rpgSetup());
    await player(DEV_A).post(`/api/sessions/${id}/claim`, { charName: 'Арн', playerName: 'Петя' });
    const cid = (await request(ctx.app).get(`/api/sessions/${id}/claims`)).body[0].id;
    await gm().post(`/api/sessions/${id}/claims/${cid}/approve`);
    await setDash(id, d => { d.characters[0].hp = '2/12'; d.characters[0].inventory = ['Зелье лечения (восстанавливает 5 HP)']; });
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Удар по Арну #hurt' });
    await ctx.engine.whenIdle(id);
    expect((await dashOf(id)).characters[0].status).toBe('downed');
    const blocked = await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'встаю' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('downed');
    await gm().post(`/api/sessions/${id}/use`, { charName: 'Арн', item: 'Зелье' });
    expect((await dashOf(id)).characters[0].status).toBe('active');
    expect((await player(DEV_A).post(`/api/sessions/${id}/actions`, { charName: 'Арн', action: 'встаю' })).status).toBe(200);
  });

  it('сброс пароля: ссылка от суперадмина, старые сессии выходят, ссылка одноразовая', async () => {
    const u2 = await account('u2@example.com');
    const forgot = await request(ctx.app).post('/api/auth/forgot').send({ email: 'u2@example.com' });
    expect(forgot.body).toEqual({ ok: true, mail: false });
    expect((await u2.post('/api/admin/users/reset-link', { email: 'gm@example.com' })).status).toBe(403);
    const { link } = (await gm().post('/api/admin/users/reset-link', { email: 'u2@example.com' })).body;
    const token = link.split('/reset/')[1];
    const agent = request.agent(ctx.app);
    expect((await agent.post('/api/auth/reset').set('x-nexus-client', '1').send({ token, password: 'short' })).status).toBe(400);
    expect((await agent.post('/api/auth/reset').set('x-nexus-client', '1').send({ token, password: 'newpassword1' })).status).toBe(200);
    expect((await agent.get('/api/auth/me')).body.user.email).toBe('u2@example.com');
    expect((await u2.get('/api/auth/me')).status).toBe(401); // старая сессия разлогинена
    expect((await request(ctx.app).post('/api/auth/reset').send({ token, password: 'another12' })).status).toBe(400);
    expect((await request(ctx.app).post('/api/auth/login').send({ email: 'u2@example.com', password: 'newpassword1' })).status).toBe(200);
  });
});
