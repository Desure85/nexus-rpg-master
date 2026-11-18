// Замена server/crypto.ts для демо. Безопасность здесь условная: всё живёт в браузере пользователя.
import { sha256Hex } from './sha256';

export function initSecret(_dbPath: string) { /* в демо ключ не нужен */ }
export const encrypt = (plain: string) => `demo:${btoa(unescape(encodeURIComponent(plain)))}`;
export const decrypt = (blob: string | null | undefined) => {
  if (!blob?.startsWith('demo:')) return undefined;
  try { return decodeURIComponent(escape(atob(blob.slice(5)))); } catch { return undefined; }
};
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
