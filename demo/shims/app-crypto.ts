// Замена server/crypto.ts для демо.
// Ключи ИИ не попадают в базу демо: база хранит только ссылку «vault:<id>», сам ключ живёт в памяти вкладки.
// Если пользователь отметил «Запомнить на этом устройстве», ключ дополнительно сохраняется в IndexedDB,
// зашифрованным неизвлекаемым ключом WebCrypto (AES-GCM).
import { sha256Hex } from './sha256';

const vault = new Map<string, string>();
const REMEMBER_FLAG = 'nexus_demo_remember_key';
const IDB = 'nexus-demo-vault';

const db = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open(IDB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
const idbGet = async (k: string) => { const d = await db(); return new Promise<any>(res => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); };
const idbSet = async (k: string, v: any) => { const d = await db(); return new Promise<void>(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => res(); }); };
const idbClear = async () => { const d = await db(); return new Promise<void>(res => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = () => res(); }); };

const wrapKey = async (): Promise<CryptoKey> => {
  const existing = await idbGet('wrap');
  if (existing) return existing;
  const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idbSet('wrap', k);
  return k;
};

const remember = () => { try { return localStorage.getItem(REMEMBER_FLAG) === '1'; } catch { return false; } };

const persist = async (id: string, plain: string) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), new TextEncoder().encode(plain));
  await idbSet(`k:${id}`, { iv, data });
};

/** При загрузке ведущей вкладки: поднять запомненные ключи в память. */
export async function loadVault() {
  if (!remember()) return;
  try {
    const d = await db();
    const keys: string[] = await new Promise(res => { const q = d.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result as string[]); q.onerror = () => res([]); });
    const wk = await wrapKey();
    for (const k of keys.filter(k => String(k).startsWith('k:'))) {
      const rec = await idbGet(k);
      const plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, wk, rec.data));
      vault.set(String(k).slice(2), plain);
    }
  } catch (e) { console.warn('[demo] не удалось прочитать сохранённые ключи', e); }
}

/** «Забыть ключ»: стереть из памяти и с устройства. */
export async function forgetVault() {
  vault.clear();
  try { localStorage.removeItem(REMEMBER_FLAG); } catch { /* */ }
  await idbClear().catch(() => undefined);
}

export function initSecret(_dbPath: string) { /* в демо мастер-ключ не нужен */ }
export const encrypt = (plain: string) => {
  const id = crypto.randomUUID();
  vault.set(id, plain);
  if (remember()) void persist(id, plain);
  return `vault:${id}`;
};
export const decrypt = (blob: string | null | undefined) => (blob?.startsWith('vault:') ? vault.get(blob.slice(6)) : undefined);

export const randomToken = (bytes = 32) => {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const sha256 = (s: string) => sha256Hex(s);
export async function hashPassword(password: string) {
  const salt = randomToken(12);
  return `demo$${salt}$${sha256Hex(salt + password)}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [alg, salt, hash] = stored.split('$');
  return alg === 'demo' && sha256Hex(salt + password) === hash;
}
