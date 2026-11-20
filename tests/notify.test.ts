import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock('../server/mailer', () => ({
  mailConfigured: () => true,
  sendMail: async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; },
}));
const { createApp } = await import('../server/app');

let ctx: Awaited<ReturnType<typeof createApp>>;
const C = { 'x-nexus-client': '1' };
const account = async (email: string) => {
  const agent = request.agent(ctx.app);
  await agent.post('/api/auth/register').set(C).send({ email, password: 'password123', name: email.split('@')[0] });
  const me = (await agent.get('/api/auth/me')).body;
  return { me, get: (u: string) => agent.get(u), post: (u: string, b: any = {}) => agent.post(u).set(C).send(b), put: (u: string, b: any = {}) => agent.put(u).set(C).send(b) };
};
const dev = (d: string) => ({ post: (u: string, b: any = {}) => request(ctx.app).post(u).set('x-device-id', d).send(b) });

beforeEach(async () => {
  sent.length = 0;
  process.env.APP_URL = 'https://play.example.com';
  process.env.FREE_CREDITS = '1000';
  ctx = await createApp({ dbPath: ':memory:' });
});
afterEach(async () => { await ctx.close(); delete process.env.APP_URL; });

const age = (minutes: number) => ctx.db.prepare("UPDATE notifications SET created_at = datetime('now', ?)").run(`-${minutes} minutes`);

describe('уведомления', () => {
  it('мастеру: заявка на героя и действия игроков (раз в час на партию); прочитать', async () => {
    const gm = await account('gm@example.com');
    const sid = (await gm.post('/api/sessions', { workspaceId: gm.me.workspaces[0].id, setup: { worldId: 'starter-crossroads', scenarioId: 'karavan', characters: [{ name: 'Ласка', concept: 'Охранница', gender: 'Ж' }] } })).body.id;
    await ctx.engine.whenIdle(sid);
    const p = dev('device-player-0001');
    expect((await p.post(`/api/sessions/${sid}/claim`, { charName: 'Ласка', playerName: 'Аня' })).body.status).toBe('pending');
    let n = (await gm.get('/api/notifications')).body;
    expect(n.unread).toBe(1);
    expect(n.items[0]).toMatchObject({ kind: 'mp', title: 'Аня хочет играть за Ласка', url: `/?session=${sid}` });
    const claim = ctx.db.prepare('SELECT id FROM claims WHERE session_id = ?').get(sid) as any;
    await gm.post(`/api/sessions/${sid}/claims/${claim.id}/approve`);
    await p.post(`/api/sessions/${sid}/actions`, { charName: 'Ласка', action: 'Осматриваю повозку' });
    n = (await gm.get('/api/notifications')).body;
    expect(n.items[0].title).toMatch(/^Игроки ждут хода в «.+»$/);
    expect(n.items[0].body).toBe('Аня (Ласка): Осматриваю повозку');
    await p.post(`/api/sessions/${sid}/actions`, { charName: 'Ласка', action: 'Ещё раз' }); // уже ждёт мастера — 409, и уведомление не дублируется
    expect(n.unread).toBe(2);
    await gm.post('/api/notifications/read', { ids: [n.items[0].id] });
    expect((await gm.get('/api/notifications')).body.unread).toBe(1);
    await gm.post('/api/notifications/read');
    expect((await gm.get('/api/notifications')).body.unread).toBe(0);
  });

  it('автору мира: покупка и отзыв; письмо-дайджест через 10 минут, отписка по ссылке', async () => {
    const author = await account('author@example.com');
    const fan = await account('fan@example.com');
    const w = (await author.post('/api/worlds', { title: 'Соль', description: 'Подземный город соледобытчиков.', visibility: 'public', price: 50, data: { setting: 'Копи', scenarios: [{ id: 's', title: 'Обвал', mode: 'short', hook: 'Обвал в штольне.' }], cards: [{ name: 'Грюн', text: 'Старшина' }] } })).body;
    expect((await fan.post(`/api/worlds/${w.id}/buy`, { workspaceId: fan.me.workspaces[0].id })).status).toBe(200);
    await fan.post('/api/sessions', { workspaceId: fan.me.workspaces[0].id, setup: { worldId: w.id, scenarioId: 's', characters: [{ name: 'Тара', concept: 'Соледобытчица', gender: 'Ж' }] } });
    await fan.put(`/api/worlds/${w.id}/review`, { rating: 5, text: 'Солёно' });
    const items = (await author.get('/api/notifications')).body.items;
    expect(items.map((i: any) => i.title)).toEqual(['Отзыв на мир «Соль»: ★★★★★', 'Мир «Соль» купили']);
    // свежее — не шлём (вдруг увидит в игре); через 10 минут — один дайджест
    expect(await ctx.notifier.sendDigests()).toBe(0);
    age(11);
    expect(await ctx.notifier.sendDigests()).toBe(1);
    expect(sent[0]).toMatchObject({ to: 'author@example.com', subject: 'Отзыв на мир «Соль»: ★★★★★ и ещё 1' });
    expect(sent[0].text).toContain(`https://play.example.com/world/${w.id}`);
    expect(await ctx.notifier.sendDigests()).toBe(0); // уже отправлено
    // отписка: чужая подпись — нет; своя — да
    const link = sent[0].text.match(/https:\/\/play\.example\.com(\/api\/notifications\/unsubscribe\?[^\s]+)/)![1];
    expect((await request(ctx.app).get(link.replace(/s=[0-9a-f]+/, 's=' + '0'.repeat(32)))).text).toContain('недействительна');
    expect((await request(ctx.app).get(link)).text).toContain('Готово');
    expect((await author.get('/api/notifications/prefs')).body.prefs.worlds).toBe(false);
    await fan.put(`/api/worlds/${w.id}/review`, { rating: 4, text: 'Чуть хуже' }); // тот же dedupe — не дублируем
    ctx.db.prepare("UPDATE users SET last_digest_at = datetime('now', '-7 hours')").run();
    age(11);
    expect(await ctx.notifier.sendDigests()).toBe(0); // отписался от «миров»
  });

  it('незаконченная партия ждёт: через неделю без игры — одно уведомление', async () => {
    const gm = await account('idle@example.com');
    const sid = (await gm.post('/api/sessions', { workspaceId: gm.me.workspaces[0].id, setup: { worldId: 'starter-velsk', scenarioId: 'shestoy', characters: [{ name: 'Аглая', concept: 'Курсистка', gender: 'Ж' }] } })).body.id;
    await ctx.engine.whenIdle(sid);
    for (let i = 0; i < 3; i++) ctx.db.prepare("INSERT INTO usage (workspace_id, session_id, user_id, kind, mode) VALUES (?, ?, ?, 'turn', 'platform')").run(gm.me.workspaces[0].id, sid, gm.me.user.id);
    expect(ctx.notifier.comebackScan()).toBe(0);
    ctx.db.prepare("UPDATE sessions SET updated_at = datetime('now', '-8 days')").run();
    expect(ctx.notifier.comebackScan()).toBe(1);
    ctx.notifier.comebackScan();
    const items = (await gm.get('/api/notifications')).body.items;
    expect(items.filter((i: any) => i.kind === 'comeback').length).toBe(1);
    // испытание дня — только кто включил
    expect(ctx.notifier.dailyScan()).toBe(0);
    await gm.put('/api/notifications/prefs', { prefs: { daily: true } });
    expect(ctx.notifier.dailyScan()).toBe(1);
  });
});
