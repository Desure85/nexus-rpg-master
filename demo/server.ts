// Сервер игры, работающий внутри вкладки браузера (только в ведущей вкладке).
import './env';
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { setSqlJs, takeDirty } from './shims/better-sqlite3';
import type { DemoRequest, DemoResponse } from './express-shim';

const IDB_NAME = 'nexus-demo';
const idb = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(IDB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const idbGet = async (k: string) => {
  const db = await idb();
  return new Promise<any>(res => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
};
const idbSet = async (k: string, v: any) => {
  const db = await idb();
  return new Promise<void>(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); });
};
let stopped = false;
export const resetDemoStorage = async () => { stopped = true; const db = await idb(); await new Promise<void>(res => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); }); };

export interface DemoServer {
  handle: (r: DemoRequest) => Promise<DemoResponse>;
  join: (sessionId: string) => { type: 'joined'; sessionId: string; busy: boolean } | null;
  flush: () => Promise<void>;
}

export async function bootServer(emit: (data: any) => void): Promise<DemoServer> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = await idbGet('db');
  setSqlJs(SQL, saved instanceof Uint8Array ? saved : null);

  const [{ openDatabase }, { buildApi, apiErrorHandler }, { createApp }] = await Promise.all([
    import('../server/db'), import('../server/api'), import('./express-shim'),
  ]);
  const db = openDatabase(':memory:');
  const app = createApp();
  const { engine } = buildApi(app, { db, broadcast: (_room, data) => emit(data) });
  app.use(apiErrorHandler);

  let saving: Promise<void> | null = null;
  const flush = async () => {
    if (stopped || !takeDirty()) return;
    const data = (db as any).export() as Uint8Array;
    saving = idbSet('db', data);
    await saving;
  };
  setInterval(() => { if (!saving) flush().finally(() => { saving = null; }); }, 1500);
  addEventListener('pagehide', () => { void flush(); });

  return {
    handle: async r => { const out = await app.handle(r); return out; },
    join: sessionId => {
      const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
      return exists ? { type: 'joined', sessionId, busy: engine.isBusy(sessionId) } : null;
    },
    flush,
  };
}
