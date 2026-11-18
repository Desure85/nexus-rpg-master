import crypto from "crypto";
import fs from "fs";
import path from "path";

let key: Buffer | null = null;

/**
 * Ключ шифрования секретов (BYOK-ключи ИИ). Берётся из APP_SECRET; если его нет —
 * генерируется и сохраняется рядом с базой (data/secret.key), чтобы переживать рестарты.
 */
export function initSecret(dbPath: string) {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv) { key = crypto.createHash("sha256").update(fromEnv).digest(); return; }
  if (dbPath === ":memory:") { key = crypto.randomBytes(32); return; }
  const file = path.join(path.dirname(path.resolve(dbPath)), "secret.key");
  if (fs.existsSync(file)) key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString("hex"), { mode: 0o600 });
    console.warn(`[nexus] APP_SECRET не задан — сгенерирован ключ ${file}. Не теряйте его: без него не расшифровать ключи ИИ пространств.`);
  }
}

const getKey = () => {
  if (!key) key = crypto.randomBytes(32);
  return key;
};

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(blob: string | null | undefined): string | undefined {
  if (!blob) return undefined;
  try {
    const [v, iv, tag, data] = blob.split(":");
    if (v !== "v1") return undefined;
    const d = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise<Buffer>((res, rej) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const got = await new Promise<Buffer>((res, rej) => crypto.scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}
