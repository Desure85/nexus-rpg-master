// Транспорт демо: fetch и «веб-сокет» поверх сервера в ведущей вкладке.
// Одна вкладка (лидер, navigator.locks) держит сервер; остальные ходят к ней через BroadcastChannel.
import type { DemoRequest, DemoResponse } from './express-shim';
import type { DemoServer } from './server';

const CHANNEL = 'nexus-demo-bus';
const COOKIE_KEY = 'nexus_demo_cookies';
const bus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null;
const tabId = crypto.randomUUID();

let server: DemoServer | null = null;
let leaderReady: Promise<void> | null = null;
const listeners = new Set<(e: any) => void>();
const deliver = (e: any) => { for (const l of listeners) l(e); };

const emitAll = (data: any) => { deliver(data); bus?.postMessage({ kind: 'event', data }); };

async function becomeLeader() {
  const { bootServer } = await import('./server');
  server = await bootServer(emitAll);
  (window as any).__nexusDemoLeader = true;
}

function electLeader() {
  if (leaderReady) return leaderReady;
  leaderReady = new Promise<void>(resolveReady => {
    const locks = (navigator as any).locks;
    if (!locks || !bus) { becomeLeader().then(resolveReady); return; }
    // если лидер уже есть — мы ведомые; лок достанется нам, когда он закроется
    locks.request('nexus-demo-leader', async () => {
      await becomeLeader();
      resolveReady();
      bus.postMessage({ kind: 'leader' });
      await new Promise(() => undefined); // держим лок, пока вкладка жива
    });
    // ведомая вкладка готова сразу: запросы пойдут через шину
    locks.query?.().then((s: any) => { if (s.held?.some((l: any) => l.name === 'nexus-demo-leader')) resolveReady(); });
    setTimeout(resolveReady, 1500);
  });
  return leaderReady;
}

// --- RPC между вкладками ---
const pending = new Map<string, (r: DemoResponse) => void>();
bus?.addEventListener('message', async ev => {
  const m = ev.data;
  if (m.kind === 'event') deliver(m.data);
  else if (m.kind === 'req' && server) {
    const res = await server.handle(m.req);
    bus.postMessage({ kind: 'res', id: m.id, to: m.from, res });
  } else if (m.kind === 'join' && server) {
    const j = server.join(m.sessionId);
    if (j) bus.postMessage({ kind: 'event', data: j });
  } else if (m.kind === 'res' && m.to === tabId) {
    pending.get(m.id)?.(m.res);
    pending.delete(m.id);
  } else if (m.kind === 'leader') {
    // новый лидер: переотправляем то, что могло потеряться
    for (const [id] of pending) resend.get(id)?.();
  }
});
const resend = new Map<string, () => void>();

async function call(req: DemoRequest): Promise<DemoResponse> {
  await electLeader();
  if (server) return server.handle(req);
  return new Promise(resolve => {
    const id = crypto.randomUUID();
    const send = () => bus!.postMessage({ kind: 'req', id, from: tabId, req });
    pending.set(id, r => { resend.delete(id); resolve(r); });
    resend.set(id, send);
    send();
    // страховка: если лидер сменился без уведомления
    const retry = setInterval(() => { if (!pending.has(id)) clearInterval(retry); else if (server) { clearInterval(retry); pending.delete(id); server.handle(req).then(resolve); } }, 3000);
  });
}

// --- cookie jar (общий для вкладок, как настоящие cookie) ---
const readCookies = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(COOKIE_KEY) || '{}'); } catch { return {}; } };
const storeCookies = (setCookies: string[] = []) => {
  if (!setCookies.length) return;
  const jar = readCookies();
  for (const sc of setCookies) {
    const [pair, ...attrs] = sc.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = attrs.some(a => /max-age=0\b/i.test(a.trim())) || !value;
    if (expired) delete jar[name]; else jar[name] = value;
  }
  localStorage.setItem(COOKIE_KEY, JSON.stringify(jar));
};

export async function demoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> || {}) };
  const jar = readCookies();
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookie) headers.cookie = cookie;
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  const out = await call({ method: init.method || 'GET', url: path, headers, body });
  storeCookies(out.headers['set-cookie']);
  const text = out.body === undefined ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
  return new Response(text, { status: out.status, headers: { 'content-type': 'application/json' } });
}

/** Подписка на события «комнаты». Возвращает функцию отписки. */
export function demoSubscribe(sessionId: string, onEvent: (e: any) => void) {
  const l = (e: any) => { if (!e.sessionId || e.sessionId === sessionId) onEvent(e); };
  listeners.add(l);
  electLeader().then(() => {
    if (server) { const j = server.join(sessionId); if (j) onEvent(j); }
    else bus?.postMessage({ kind: 'join', sessionId });
  });
  return () => { listeners.delete(l); };
}

export async function demoReset() {
  const { resetDemoStorage } = await import('./server');
  await resetDemoStorage();
  localStorage.removeItem(COOKIE_KEY);
  bus?.postMessage({ kind: 'reset' });
  location.reload();
}
bus?.addEventListener('message', async ev => {
  if (ev.data?.kind !== 'reset') return;
  if (server) { const { resetDemoStorage } = await import('./server'); await resetDemoStorage(); }
  location.reload();
});

// стартуем выборы сразу, чтобы первая отрисовка не ждала
void electLeader();

/** «Забыть ключ ИИ»: стираем ключи в ведущей вкладке (где живёт сервер) и на устройстве. */
export async function demoForgetKeys() {
  if (server) { const { forgetVault } = await import('./shims/app-crypto'); await forgetVault(); }
  else bus?.postMessage({ kind: 'forget-keys' });
  try { localStorage.removeItem('nexus_demo_remember_key'); } catch { /* */ }
}
bus?.addEventListener('message', async ev => {
  if (ev.data?.kind !== 'forget-keys' || !server) return;
  const { forgetVault } = await import('./shims/app-crypto');
  await forgetVault();
});
