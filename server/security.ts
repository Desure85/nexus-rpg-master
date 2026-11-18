import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

export const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export interface AuthInfo {
  /** sha256 ключа мастера (браузер ГМа хранит сам ключ в localStorage) */
  ownerHash?: string;
  /** секрет устройства игрока: подтверждает, что это тот же игрок, что подавал заявку */
  deviceId?: string;
  isAdmin: boolean;
  /** прошёл ли код доступа для создания игр (GM_ACCESS_CODE) */
  hasAccess: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth: AuthInfo }
  }
}

export const adminConfigured = () => !!process.env.ADMIN_TOKEN;

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const ownerKey = String(req.header("x-owner-key") || "");
  const deviceId = String(req.header("x-device-id") || "");
  const adminToken = process.env.ADMIN_TOKEN || "";
  const accessCode = process.env.GM_ACCESS_CODE || "";
  const adminByToken = !!adminToken && safeEqual(String(req.header("x-admin-token") || ""), adminToken);
  // Без ADMIN_TOKEN сервер в «локальном режиме»: настройки может менять любой
  const isAdmin = adminToken ? adminByToken : true;
  req.auth = {
    ownerHash: ownerKey.length >= 16 ? hashKey(ownerKey) : undefined,
    deviceId: deviceId.length >= 16 ? deviceId : undefined,
    isAdmin,
    hasAccess: !accessCode || adminByToken || safeEqual(String(req.header("x-access-code") || ""), accessCode),
  };
  next();
}

export const requireAdmin = (req: Request, res: Response, next: NextFunction) =>
  req.auth.isAdmin ? next() : res.status(403).json({ error: "admin_required", message: "Нужен токен администратора" });

export const requireAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.auth.ownerHash) return res.status(401).json({ error: "owner_key_required", message: "Нет ключа мастера" });
  if (!req.auth.hasAccess) return res.status(403).json({ error: "access_code_required", message: "Нужен код доступа мастера" });
  next();
};

/** Простой in-memory лимитер (скользящее окно) — защищает платные вызовы ИИ от злоупотреблений. */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, number[]>();
  const timer = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, v] of hits) {
      const kept = v.filter(t => t > cutoff);
      if (kept.length) hits.set(k, kept); else hits.delete(k);
    }
  }, opts.windowMs);
  timer.unref?.();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.RATE_LIMIT_DISABLED === "true") return next();
    const k = opts.key ? opts.key(req) : req.ip || "unknown";
    const now = Date.now();
    const arr = (hits.get(k) || []).filter(t => t > now - opts.windowMs);
    if (arr.length >= opts.max) {
      res.setHeader("Retry-After", Math.ceil(opts.windowMs / 1000));
      return res.status(429).json({ error: "rate_limited", message: "Слишком много запросов, подождите немного" });
    }
    arr.push(now);
    hits.set(k, arr);
    next();
  };
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
