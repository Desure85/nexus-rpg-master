import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createApp } from '../server/app';

type Ctx = Awaited<ReturnType<typeof createApp>>;
let ctx: Ctx;
let dir: string;

const account = async (email: string) => {
  const agent = request.agent(ctx.app);
  await agent.post('/api/auth/register').set('x-nexus-client', '1').send({ email, password: 'password123', name: email.split('@')[0] });
  const me = (await agent.get('/api/auth/me')).body;
  return { me, agent, post: (u: string, b: any = {}) => agent.post(u).set('x-nexus-client', '1').send(b) };
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ops-'));
  process.env.FREE_CREDITS = '100';
  process.env.ALERT_WEBHOOK_URL = 'https://hooks.test/alert';
  process.env.BACKUP_KEEP = '2';
  ctx = await createApp({ dbPath: path.join(dir, 'game.db') });
});
afterEach(async () => {
  await ctx.close();
  vi.restoreAllMocks();
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.BACKUP_KEEP;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('эксплуатация', () => {
  it('сводка только суперадмину: ходы, ошибки, p50/p95, бэкап', async () => {
    const admin = await account('admin@example.com');
    const user = await account('user@example.com');
    expect((await user.agent.get('/api/admin/ops')).status).toBe(403);
    const s0 = (await admin.agent.get('/api/admin/ops')).body;
    expect(s0).toMatchObject({ hour: { turns: 0, errors: 0 }, backup: { enabled: true, keep: 2 } });
    expect(s0.dbSizeMb).toBeGreaterThan(0);
  });

  it('события ходов: время, ошибки системы считаются, ошибки игрока — нет', async () => {
    const admin = await account('admin@example.com');
    const { ops } = ctx as any;
    ops.onEvent({ type: 'turn_start', sessionId: 's1' });
    ops.onEvent({ type: 'turn_end', sessionId: 's1' });
    ops.onEvent({ type: 'turn_start', sessionId: 's2' });
    ops.onEvent({ type: 'turn_error', sessionId: 's2', code: 'llm_error', error: 'Модель не ответила' });
    ops.onEvent({ type: 'turn_start', sessionId: 's3' });
    ops.onEvent({ type: 'turn_error', sessionId: 's3', code: 'insufficient_credits', error: 'Нет кредитов' });
    const s = (await admin.agent.get('/api/admin/ops')).body;
    expect(s.hour).toMatchObject({ turns: 2, errors: 1, errorRate: 50, lastErrors: ['llm_error Модель не ответила'] });
    expect(s.hour.p50).toBeGreaterThanOrEqual(0);
  });

  it('бэкап по кнопке: файл-копия базы, старые удаляются (хранить 2)', async () => {
    const admin = await account('admin@example.com');
    for (let i = 0; i < 3; i++) {
      const r = await admin.post('/api/admin/ops/backup');
      expect(r.status).toBe(200);
      expect(r.body.size).toBeGreaterThan(0);
      await new Promise(r => setTimeout(r, 5));
    }
    const files = fs.readdirSync(path.join(dir, 'backups'));
    expect(files.length).toBe(2);
    // копия — рабочая база с тем же админом
    const Database = (await import('better-sqlite3')).default;
    const copy = new Database(path.join(dir, 'backups', files.sort().at(-1)!), { readonly: true });
    expect((copy.prepare('SELECT email FROM users').all() as any[]).map(u => u.email)).toContain('admin@example.com');
    copy.close();
    expect((await admin.agent.get('/api/admin/ops')).body.backup.last).toMatchObject({ ok: true });
  });

  it('алерт при всплеске ошибок уходит в вебхук не чаще раза в час', async () => {
    const sent: any[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('ok'); });
    const { ops } = ctx as any;
    for (let i = 0; i < 6; i++) { ops.onEvent({ type: 'turn_start', sessionId: `e${i}` }); ops.onEvent({ type: 'turn_error', sessionId: `e${i}`, code: 'llm_error', error: 'timeout' }); }
    await ops.checkAlerts();
    await ops.checkAlerts();
    const errorsAlerts = sent.filter(s => /ходов с ошибкой/.test(s.body.text));
    expect(errorsAlerts.length).toBe(1);
    expect(errorsAlerts[0]).toMatchObject({ url: 'https://hooks.test/alert' });
    expect(errorsAlerts[0].body.text).toContain('6 из 6');
  });
});
