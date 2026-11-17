import type { Request, Response, NextFunction } from "express";

import type { DB } from "./db";
import { sha256 } from "./crypto";

export const SESSION_COOKIE = "nexus_sid";
export const SESSION_DAYS = 30;

export interface AuthUser { id: string; email: string; name: string; isSuperadmin: boolean }

export interface AuthInfo {
  user?: AuthUser;
  /** id auth-сессии (хеш токена из cookie) */
  sid?: string;
  /** секрет устройства игрока: подтверждает, что это тот же игрок, что подавал заявку */
  deviceId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { auth: AuthInfo }
  }
}

export const parseCookies = (header?: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
};

const isHttps = (req: Request) => req.secure || String(req.header("x-forwarded-proto") || "").startsWith("https");

export function setSessionCookie(req: Request, res: Response, token: string, maxAgeSec = SESSION_DAYS * 86400) {
  const secure = process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && isHttps(req));
  res.append("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`);
}

export const clearSessionCookie = (req: Request, res: Response) => setSessionCookie(req, res, "", 0);

/** Достаёт пользователя по cookie-сессии и секрет устройства игрока. */
export function authMiddleware(db: DB) {
  const findSession = db.prepare(`SELECT u.id, u.email, u.name, u.is_superadmin, s.id AS sid FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > datetime('now')`);
  return (req: Request, _res: Response, next: NextFunction) => {
    const deviceId = String(req.header("x-device-id") || "");
    req.auth = { deviceId: deviceId.length >= 16 ? deviceId.slice(0, 128) : undefined };
    const token = parseCookies(req.header("cookie"))[SESSION_COOKIE];
    if (token) {
      const row = findSession.get(sha256(token)) as any;
      if (row) req.auth.user = { id: row.id, email: row.email, name: row.name, isSuperadmin: !!row.is_superadmin };
      if (row) req.auth.sid = row.sid;
    }
    next();
  };
}

/**
 * CSRF: запросы, меняющие состояние и идущие с cookie, обязаны нести заголовок X-Nexus-Client.
 * Кросс-доменная страница не может его поставить без CORS-preflight, который мы не разрешаем.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!req.header("cookie")?.includes(`${SESSION_COOKIE}=`)) return next();
  if (req.path.startsWith("/api/billing/webhook")) return next();
  if (req.header("x-nexus-client")) return next();
  res.status(403).json({ error: "csrf", message: "Запрос отклонён (нет заголовка клиента)" });
}

export const requireUser = (req: Request, res: Response, next: NextFunction) =>
  req.auth.user ? next() : res.status(401).json({ error: "auth_required", message: "Войдите в аккаунт" });

export const requireSuperadmin = (req: Request, res: Response, next: NextFunction) =>
  req.auth.user?.isSuperadmin ? next() : res.status(403).json({ error: "superadmin_required", message: "Только для администратора платформы" });

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
