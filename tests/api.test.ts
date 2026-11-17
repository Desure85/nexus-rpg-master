import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'net';
import { createApp } from '../server/app';

const GM = 'gm-key-0123456789abcdef';
const OTHER = 'other-key-0123456789abcd';
const DEV_A = 'device-a-0123456789abcdef';
const DEV_B = 'device-b-0123456789abcdef';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;

beforeEach(async () => {
  delete process.env.ADMIN_TOKEN;
  delete process.env.GM_ACCESS_CODE;
  ctx = await createApp({ dbPath: ':memory:' });
});
afterEach(async () => {
  await ctx.close();
});

const gm = (key = GM) => ({
  get: (u: string) => request(ctx.app).get(u).set('x-owner-key', key),
  post: (u: string, b: any = {}) => request(ctx.app).post(u).set('x-owner-key', key).send(b),
  patch: (u: string, b: any = {}) => request(ctx.app).patch(u).set('x-owner-key', key).send(b),
  del: (u: string) => request(ctx.app).delete(u).set('x-owner-key', key),
});
const player = (dev: string) => ({
  get: (u: string) => request(ctx.app).get(u).set('x-device-id', dev),
  post: (u: string, b: any = {}) => request(ctx.app).post(u).set('x-device-id', dev).send(b),
});

const createSession = async (setup: any, config: any = {}) => {
  const res = await gm().post('/api/sessions', { setup, config });
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

  it('повышение уровня запускает отдельный ход со способностями', async () => {
    const id = await createSession(rpgSetup());
    await gm().post(`/api/sessions/${id}/turn`, { content: 'Тренируюсь #xp' });
    await ctx.engine.whenIdle(id);
    const s = (await gm().get(`/api/sessions/${id}`)).body;
    expect(s.history.some((m: any) => m.role === 'user' && m.content.startsWith('[LEVEL UP] Арн → уровень 2'))).toBe(true);
    expect(s.history[s.history.length - 1].role).toBe('assistant');
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
  it('чужой мастер не видит и не меняет сессию', async () => {
    const id = await createSession(rpgSetup());
    expect((await gm(OTHER).get('/api/sessions')).body).toEqual([]);
    expect((await gm().get('/api/sessions')).body.map((s: any) => s.id)).toEqual([id]);
    expect((await gm(OTHER).del(`/api/sessions/${id}`)).status).toBe(403);
    expect((await gm(OTHER).post(`/api/sessions/${id}/turn`, { content: 'взлом' })).status).toBe(403);
    expect((await gm(OTHER).post(`/api/sessions/${id}/economy`, { action: 'rest', charName: 'Арн' })).status).toBe(403);
    const viewer = (await gm(OTHER).get(`/api/sessions/${id}`)).body;
    expect(viewer.isOwner).toBe(false);
    expect(viewer.config.systemPrompt).toBeUndefined();
  });

  it('без ключа мастера сессию не создать; с GM_ACCESS_CODE нужен код', async () => {
    expect((await request(ctx.app).post('/api/sessions').send({ setup: rpgSetup() })).status).toBe(401);
    process.env.GM_ACCESS_CODE = 'secret';
    expect((await gm().post('/api/sessions', { setup: rpgSetup() })).status).toBe(403);
    const ok = await request(ctx.app).post('/api/sessions').set('x-owner-key', GM).set('x-access-code', 'secret').send({ setup: rpgSetup() });
    expect(ok.status).toBe(201);
    await ctx.engine.whenIdle(ok.body.id);
  });

  it('с ADMIN_TOKEN настройки ИИ меняет только админ и ключи не утекают', async () => {
    process.env.ADMIN_TOKEN = 'admin-secret';
    expect((await gm().post('/api/settings', { provider: 'local' })).status).toBe(403);
    expect((await gm().get('/api/logs')).status).toBe(403);
    const saved = await request(ctx.app).post('/api/settings').set('x-admin-token', 'admin-secret').send({ provider: 'gemini', apiKey: 'AIzaSECRETKEY1234' });
    expect(saved.status).toBe(200);
    expect(saved.body.apiKey).toBe('••••1234');
    const pub = (await request(ctx.app).get('/api/settings')).body;
    expect(JSON.stringify(pub)).not.toContain('SECRET');
    expect(pub.canEdit).toBe(false);
    // маска при повторном сохранении ключ не затирает
    await request(ctx.app).post('/api/settings').set('x-admin-token', 'admin-secret').send({ apiKey: '••••1234' });
    expect((await request(ctx.app).get('/api/settings').set('x-admin-token', 'admin-secret')).body.apiKey).toBe('••••1234');
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
    expect((await gm(OTHER).post(`/api/sessions/${id}/claims/${claims[0].id}/approve`)).status).toBe(403);
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
