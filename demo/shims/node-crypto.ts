// Минимальная замена node:crypto для браузерного демо.
import { sha256Hex } from './sha256';

const randomBytes = (n: number) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return {
    bytes: a,
    toString: (enc: string) => (enc === 'hex' ? [...a].map(b => b.toString(16).padStart(2, '0')).join('') : btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')),
  };
};

const createHash = (_alg: string) => {
  let data = '';
  const h = {
    update(s: string) { data += s; return h; },
    digest(_enc: string) { return sha256Hex(data); },
  };
  return h;
};

const timingSafeEqual = (a: any, b: any) => String(a) === String(b);
const randomUUID = () => crypto.randomUUID();

export default { randomUUID, randomBytes, createHash, timingSafeEqual };
export { randomUUID, randomBytes, createHash, timingSafeEqual };
