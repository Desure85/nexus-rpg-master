// Вход через VK ID, Яндекс ID и Google (OAuth 2.0 / 2.1 + PKCE).
// Провайдер включается, когда заданы его ключи в окружении; без ключей кнопка не показывается.
import crypto from "crypto";
import type { Express, Request, Response } from "express";
import type { DB } from "./db";
import type { Tenancy } from "./tenancy";
import { registrationMode } from "./tenancy";
import { parseCookies, rateLimit } from "./security";

export type OAuthProviderId = "vk" | "yandex" | "google";

interface Profile { subject: string; email?: string; emailVerified: boolean; name: string }

interface ProviderDef {
  id: OAuthProviderId;
  name: string;
  env: [string, string];
  authorizeUrl: string;
  scope: string;
  pkce: boolean;
  /** код → профиль пользователя */
  exchange: (p: { code: string; verifier: string; redirectUri: string; clientId: string; secret: string; query: Record<string, string> }) => Promise<Profile>;
}

const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
const postForm = async (url: string, body: Record<string, string>, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", ...headers }, body: form(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${url}: ${j.error_description || j.error || r.status}`);
  return j;
};

const PROVIDERS: ProviderDef[] = [
  {
    id: "vk", name: "VK ID", env: ["VK_CLIENT_ID", "VK_CLIENT_SECRET"],
    authorizeUrl: "https://id.vk.com/authorize", scope: "vkid.personal_info email", pkce: true,
    // VK ID: OAuth 2.1, обмен кода с PKCE и device_id из колбэка
    exchange: async ({ code, verifier, redirectUri, clientId, query }) => {
      const tok = await postForm("https://id.vk.com/oauth2/auth", {
        grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri,
        device_id: query.device_id || "", state: query.state || "",
      });
      const info = await postForm("https://id.vk.com/oauth2/user_info", { client_id: clientId, access_token: tok.access_token });
      const u = info.user || {};
      // VK не сообщает, подтверждена ли почта, — по ней аккаунты не склеиваем
      return { subject: String(u.user_id || tok.user_id), email: u.email || undefined, emailVerified: false, name: [u.first_name, u.last_name].filter(Boolean).join(" ") };
    },
  },
  {
    id: "yandex", name: "Яндекс ID", env: ["YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET"],
    authorizeUrl: "https://oauth.yandex.ru/authorize", scope: "login:email login:info", pkce: true,
    exchange: async ({ code, verifier, clientId, secret }) => {
      const tok = await postForm("https://oauth.yandex.ru/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, client_secret: secret });
      const r = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${tok.access_token}` } });
      const u: any = await r.json();
      if (!r.ok || !u.id) throw new Error("Яндекс не вернул профиль");
      return { subject: String(u.id), email: u.default_email || undefined, emailVerified: !!u.default_email, name: u.real_name || u.display_name || u.login || "" };
    },
  },
  {
    id: "google", name: "Google", env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", scope: "openid email profile", pkce: true,
    exchange: async ({ code, verifier, redirectUri, clientId, secret }) => {
      const tok = await postForm("https://oauth2.googleapis.com/token", { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, client_secret: secret, redirect_uri: redirectUri });
      const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
      const u: any = await r.json();
      if (!r.ok || !u.sub) throw new Error("Google не вернул профиль");
      return { subject: String(u.sub), email: u.email || undefined, emailVerified: !!u.email_verified, name: u.name || "" };
    },
  },
];

const configured = () => PROVIDERS.filter(p => process.env[p.env[0]] && process.env[p.env[1]]);
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const STATE_COOKIE = "nx_oauth";

export function registerOAuthRoutes(app: Express, db: DB, t: Tenancy) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_identities (
      provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, subject)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, next TEXT NOT NULL DEFAULT '/',
      link_user_id TEXT, invite TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.AUTH_ATTEMPTS_PER_15MIN || 20) });
  const baseUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const redirectUri = (req: Request, id: string) => `${baseUrl(req)}/api/auth/oauth/${id}/callback`;
  // только путь своего сайта: без «//», «/\» (браузеры читают как другой хост) и управляющих символов
  const safeNext = (v: unknown) => (typeof v === "string" && /^\/(?![/\\])[^\s\\]*$/.test(v) ? v.slice(0, 300) : "/");
  const fail = (res: Response, msg: string) => res.redirect(`/?auth_error=${encodeURIComponent(msg)}`);

  app.get("/api/auth/providers", (_req, res) => res.json(configured().map(p => ({ id: p.id, name: p.name }))));

  app.get("/api/auth/oauth/:provider/start", limiter, (req, res) => {
    const p = configured().find(x => x.id === req.params.provider);
    if (!p) return res.status(404).json({ error: "provider_disabled", message: "Этот способ входа не настроен" });
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
    const linkUser = req.query.link === "1" && req.auth.user ? req.auth.user.id : null;
    db.prepare("DELETE FROM oauth_states WHERE created_at < datetime('now', '-15 minutes')").run();
    db.prepare("INSERT INTO oauth_states (state, provider, verifier, next, link_user_id, invite) VALUES (?, ?, ?, ?, ?, ?)")
      .run(state, p.id, verifier, safeNext(req.query.next), linkUser, typeof req.query.invite === "string" ? req.query.invite.slice(0, 200) : null);
    // cookie привязывает поток к этому браузеру (защита от подмены входа)
    res.append("Set-Cookie", `${STATE_COOKIE}=${state}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=900`);
    const params: Record<string, string> = { response_type: "code", client_id: process.env[p.env[0]]!, redirect_uri: redirectUri(req, p.id), state, scope: p.scope };
    if (p.pkce) Object.assign(params, { code_challenge: challenge, code_challenge_method: "S256" });
    if (p.id === "google") params.prompt = "select_account";
    if (p.id === "yandex") params.force_confirm = "no";
    res.redirect(`${p.authorizeUrl}?${form(params)}`);
  });

  app.get("/api/auth/oauth/:provider/callback", limiter, async (req, res) => {
    const p = configured().find(x => x.id === req.params.provider);
    if (!p) return fail(res, "Этот способ входа не настроен");
    const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, String(v)]));
    if (q.error) return fail(res, "Вход отменён");
    const row = db.prepare("SELECT * FROM oauth_states WHERE state = ? AND provider = ? AND created_at > datetime('now', '-15 minutes')").get(q.state || "", p.id) as any;
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(q.state || "");
    res.append("Set-Cookie", `${STATE_COOKIE}=; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0`);
    if (!row || parseCookies(req.header("cookie"))[STATE_COOKIE] !== q.state || !q.code) return fail(res, "Сессия входа устарела — попробуйте ещё раз");
    let prof: Profile;
    try {
      prof = await p.exchange({ code: q.code, verifier: row.verifier, redirectUri: redirectUri(req, p.id), clientId: process.env[p.env[0]]!, secret: process.env[p.env[1]]!, query: q });
    } catch (e) {
      console.warn(`[oauth] ${p.id}:`, (e as Error).message);
      return fail(res, `${p.name} не подтвердил вход — попробуйте ещё раз`);
    }
    const email = prof.email?.toLowerCase().trim();
    const known = db.prepare("SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?").get(p.id, prof.subject) as any;

    // привязка способа входа к уже вошедшему пользователю
    if (row.link_user_id) {
      if (known && known.user_id !== row.link_user_id) return res.redirect(`${row.next}${row.next.includes("?") ? "&" : "?"}auth_error=${encodeURIComponent(`Этот аккаунт ${p.name} уже привязан к другому пользователю`)}`);
      db.prepare("INSERT OR IGNORE INTO user_identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)").run(p.id, prof.subject, row.link_user_id, email || null);
      return res.redirect(row.next);
    }

    let userId: string | undefined = known?.user_id;
    // склеиваем с существующим аккаунтом только по подтверждённой почте
    if (!userId && email && prof.emailVerified) userId = (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id;
    if (!userId) {
      const firstUser = !(db.prepare("SELECT 1 FROM users WHERE id != 'system-nexus' LIMIT 1").get());
      const invite = row.invite ? t.inviteByToken(row.invite) : null;
      const mode = registrationMode();
      if (!firstUser && !invite && mode !== "open") return fail(res, mode === "invite" ? "Регистрация только по приглашению" : "Регистрация закрыта");
      userId = crypto.randomUUID();
      // почта нужна как логин; если её нет или она занята — служебная (вход только через провайдера)
      const freeEmail = email && !db.prepare("SELECT 1 FROM users WHERE email = ?").get(email) ? email : `${p.id}_${prof.subject}@oauth.local`;
      const name = (prof.name || freeEmail.split("@")[0]).slice(0, 60);
      const superEmails = (process.env.SUPERADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
      const isSuper = superEmails.length ? superEmails.includes(freeEmail) : firstUser;
      db.prepare("INSERT INTO users (id, email, name, password_hash, is_superadmin) VALUES (?, ?, ?, '', ?)").run(userId, freeEmail, name, isSuper ? 1 : 0);
      if (invite) t.acceptInvite(invite, userId);
      else t.createWorkspace(`Пространство ${name}`, userId);
    }
    db.prepare("INSERT OR IGNORE INTO user_identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?)").run(p.id, prof.subject, userId, email || null);
    t.startSession(req, res, userId);
    res.redirect(row.next);
  });

  // привязанные способы входа
  app.get("/api/auth/identities", (req, res) => {
    if (!req.auth.user) return res.status(401).json({ error: "auth_required" });
    const rows = db.prepare("SELECT provider, email, created_at FROM user_identities WHERE user_id = ?").all(req.auth.user.id);
    const hasPassword = !!(db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.auth.user.id) as any)?.password_hash;
    res.json({ identities: rows, hasPassword, available: configured().map(p => ({ id: p.id, name: p.name })) });
  });

  app.delete("/api/auth/identities/:provider", (req, res) => {
    if (!req.auth.user) return res.status(401).json({ error: "auth_required" });
    const uid = req.auth.user.id;
    const n = (db.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?").get(uid) as any).n;
    const hasPassword = !!(db.prepare("SELECT password_hash FROM users WHERE id = ?").get(uid) as any)?.password_hash;
    if (n <= 1 && !hasPassword) return res.status(400).json({ error: "last_login_method", message: "Это единственный способ входа — сначала задайте пароль или привяжите другой" });
    db.prepare("DELETE FROM user_identities WHERE user_id = ? AND provider = ?").run(uid, req.params.provider);
    res.json({ ok: true });
  });
}
