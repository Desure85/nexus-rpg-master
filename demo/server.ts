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
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const flushSoon = () => { clearTimeout(flushTimer); flushTimer = setTimeout(() => { void flush(); }, 60); };
  const { engine } = buildApi(app, { db, broadcast: (_room, data) => { emit(data); if (data?.type !== 'delta') flushSoon(); } });
  app.use(apiErrorHandler);

  // сохраняем сразу после изменений: вкладку-лидера могут закрыть или перезагрузить в любой момент
  let chain: Promise<void> = Promise.resolve();
  const flush = () => (chain = chain.then(async () => {
    if (stopped || !takeDirty()) return;
    await idbSet('db', (db as any).export() as Uint8Array);
  }).catch(e => console.warn('[demo] save failed', e)));
  setInterval(() => { void flush(); }, 3000);
  addEventListener('pagehide', () => { void flush(); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(); });

  return {
    handle: async r => {
      const out = await app.handle(r);
      await flush(); // дёшево, если ничего не менялось (в т.ч. GET-подтверждение тестовой оплаты)
      return out;
    },
    join: sessionId => {
      const exists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(sessionId);
      return exists ? { type: 'joined', sessionId, busy: engine.isBusy(sessionId) } : null;
    },
    flush,
  };
}
