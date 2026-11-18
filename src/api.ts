// Клиент API: подставляет ключ мастера / секрет устройства / токены доступа.
import { useEffect, useRef } from 'react';
import { demoFetch, demoSubscribe } from 'virtual:nexus-transport';

/** Демо-сборка для GitHub Pages: сервер работает прямо в браузере. */
export const IS_DEMO = import.meta.env.VITE_DEMO === '1';
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Абсолютная ссылка на экран приложения (в демо — через хеш-роутинг). */
export const appLink = (path: string) => IS_DEMO ? `${window.location.origin}${BASE}/#${path}` : `${window.location.origin}${path}`;

/** Query-параметры текущего экрана (в демо они живут внутри хеша). */
export const locationSearch = () => IS_DEMO ? (window.location.hash.split('?')[1] || '') : window.location.search.slice(1);
export const clearLocationSearch = () => {
  if (IS_DEMO) window.history.replaceState(null, '', window.location.href.split('?')[0].replace(/#.*$/, '') + '#' + (window.location.hash.slice(1).split('?')[0] || '/'));
  else window.history.replaceState(null, '', window.location.pathname);
};

/** Переход на страницу оплаты. В демо тестовая «оплата» проводится сразу. */
export async function followPaymentUrl(url: string) {
  const m = /\/api\/billing\/mock\/confirm\/([^/?#]+)/.exec(url);
  if (IS_DEMO && m) {
    await demoFetch(url, { method: 'GET', headers: { 'x-nexus-client': '1' } });
    window.location.hash = `#/?payment=${encodeURIComponent(m[1])}`;
    window.location.reload();
    return;
  }
  window.location.href = url;
}

const doFetch = (path: string, init: RequestInit) => (IS_DEMO ? demoFetch(path, init) : fetch(path, init));

const LS = {
  device: 'nexus_device_id',
  workspace: 'nexus_workspace',
};

const readLs = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const writeLs = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватный режим */ } };

/** Секрет устройства игрока (подтверждает, что действие шлёт тот, кто занял персонажа). */
export const getDeviceId = () => {
  let k = readLs(LS.device);
  if (k.length < 16) { k = crypto.randomUUID(); writeLs(LS.device, k); }
  return k;
};

/** Последнее выбранное пространство (на этом устройстве). */
export const getSavedWorkspace = () => readLs(LS.workspace);
export const saveWorkspace = (id: string) => writeLs(LS.workspace, id);

let unauthorizedHandler: (() => void) | null = null;
/** Вызывается, когда сервер ответил 401 (сессия истекла) — приложение покажет экран входа. */
export const onUnauthorized = (fn: (() => void) | null) => { unauthorizedHandler = fn; };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'x-device-id': getDeviceId(),
    'x-nexus-client': '1',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await doFetch(path, { credentials: 'same-origin', method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError('Нет связи с сервером', 0, 'network');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (res.status === 401 && unauthorizedHandler && !path.startsWith('/api/auth/')) unauthorizedHandler();
  if (!res.ok) throw new ApiError(data?.message || data?.tag || data?.error || `HTTP ${res.status}`, res.status, data?.error);
  return data as T;
}

export type SocketEvent =
  | { type: 'joined'; sessionId: string; busy: boolean }
  | { type: 'busy'; sessionId: string; busy: boolean }
  | { type: 'turn_start'; sessionId: string; turnId: string }
  | { type: 'delta'; sessionId: string; turnId: string; text: string }
  | { type: 'turn_end'; sessionId: string; turnId: string; sessionSummary?: string | null; taleFinished?: boolean }
  | { type: 'turn_error'; sessionId: string; error: string; code?: string }
  | { type: 'level_up'; sessionId: string; leveled: string[] }
  | { type: 'achievement'; sessionId: string; codes: string[] }
  | { type: 'oracle'; sessionId: string; status: 'generating' | 'ready' | 'error'; mode: string; changed?: string[]; error?: string }
  | { type: 'update' | 'claims_changed' | 'actions_changed' | 'deleted'; sessionId: string };

/** Подписка на комнату сессии с автопереподключением. */
export function useSessionSocket(sessionId: string | null | undefined, onEvent: (e: SocketEvent) => void, onReconnect?: () => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const reconnectCb = useRef(onReconnect);
  reconnectCb.current = onReconnect;

  useEffect(() => {
    if (!sessionId) return;
    if (IS_DEMO) return demoSubscribe(sessionId, e => handler.current(e));
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socket.onopen = () => {
        if (attempt > 0) reconnectCb.current?.();
        attempt = 0;
        socket?.send(JSON.stringify({ type: 'join', sessionId }));
      };
      socket.onmessage = ev => {
        try {
          const data = JSON.parse(ev.data);
          if (!data.sessionId || data.sessionId === sessionId) handler.current(data);
        } catch { /* ignore */ }
      };
      socket.onclose = () => {
        if (stopped) return;
        attempt++;
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** attempt));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (socket) { socket.onclose = null; socket.close(); }
    };
  }, [sessionId]);
}

export const characterPath = (sessionId: string, charName: string) =>
  `/character/${sessionId}/${encodeURIComponent(btoa(unescape(encodeURIComponent(charName))))}`;
export const characterLink = (sessionId: string, charName: string) => appLink(characterPath(sessionId, charName));
