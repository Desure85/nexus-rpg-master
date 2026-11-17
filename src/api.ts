// Клиент API: подставляет ключ мастера / секрет устройства / токены доступа.
import { useEffect, useRef } from 'react';

const LS = {
  owner: 'nexus_owner_key',
  device: 'nexus_device_id',
  access: 'nexus_access_code',
  admin: 'nexus_admin_token',
};

const readLs = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const writeLs = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватный режим */ } };
const randomKey = () => `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

/** Ключ мастера: по нему сервер узнаёт «ваши» сессии. Перенос на другое устройство — через настройки. */
export const getOwnerKey = () => {
  let k = readLs(LS.owner);
  if (k.length < 16) { k = randomKey(); writeLs(LS.owner, k); }
  return k;
};
export const setOwnerKey = (k: string) => writeLs(LS.owner, k.trim());

/** Секрет устройства игрока (подтверждает, что действие шлёт тот, кто занял персонажа). */
export const getDeviceId = () => {
  let k = readLs(LS.device);
  if (k.length < 16) { k = crypto.randomUUID(); writeLs(LS.device, k); }
  return k;
};

export const getAccessCode = () => readLs(LS.access);
export const setAccessCode = (v: string) => writeLs(LS.access, v.trim());
export const getAdminToken = () => readLs(LS.admin);
export const setAdminToken = (v: string) => writeLs(LS.admin, v.trim());

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'x-owner-key': getOwnerKey(),
    'x-device-id': getDeviceId(),
  };
  const access = getAccessCode();
  if (access) headers['x-access-code'] = access;
  const admin = getAdminToken();
  if (admin) headers['x-admin-token'] = admin;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError('Нет связи с сервером', 0, 'network');
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(data?.message || data?.error || `HTTP ${res.status}`, res.status, data?.error);
  return data as T;
}

export type SocketEvent =
  | { type: 'joined'; sessionId: string; busy: boolean }
  | { type: 'busy'; sessionId: string; busy: boolean }
  | { type: 'turn_start'; sessionId: string; turnId: string }
  | { type: 'delta'; sessionId: string; turnId: string; text: string }
  | { type: 'turn_end'; sessionId: string; turnId: string; sessionSummary?: string | null; taleFinished?: boolean }
  | { type: 'turn_error'; sessionId: string; error: string }
  | { type: 'update' | 'claims_changed' | 'actions_changed' | 'deleted'; sessionId: string };

/** Подписка на комнату сессии с автопереподключением. */
export function useSessionSocket(sessionId: string | null | undefined, onEvent: (e: SocketEvent) => void, onReconnect?: () => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const reconnectCb = useRef(onReconnect);
  reconnectCb.current = onReconnect;

  useEffect(() => {
    if (!sessionId) return;
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

export const characterLink = (sessionId: string, charName: string) =>
  `${window.location.origin}/character/${sessionId}/${encodeURIComponent(btoa(unescape(encodeURIComponent(charName))))}`;
