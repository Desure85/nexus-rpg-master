import type { Express, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import type { DB } from "./db";
import { deleteWorkspaceCascade } from "./db";
import { hashPassword, verifyPassword, randomToken, sha256, encrypt, decrypt } from "./crypto";
import { requireUser, rateLimit, setSessionCookie, clearSessionCookie, SESSION_DAYS } from "./security";
import { effectivePlan, PLANS, paymentsProvider, type Billing } from "./billing";
import { completeWithUsage, describeProvider, PROVIDERS, type LlmSettings, type Provider } from "./llm";
import { readSettings } from "./store";
import { sendMail, mailConfigured } from "./mailer";
import { requireSuperadmin } from "./security";

export type Role = "owner" | "admin" | "gm";
const ROLE_RANK: Record<Role, number> = { gm: 1, admin: 2, owner: 3 };
export const ROLES: Role[] = ["owner", "admin", "gm"];

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Провайдеры, которые пространство может подключить своим ключом. Свой URL — только на self-host (защита от SSRF). */
export const byokProviders = (): Provider[] => {
  const list: Provider[] = ["gemini", "openrouter", "opencode"];
  if (process.env.ALLOW_BYOK_CUSTOM_URL === "true") list.push("local");
  if (process.env.NODE_ENV !== "production" || process.env.LLM_PROVIDER === "mock") list.push("mock");
  return list;
};

export const registrationMode = (): "open" | "invite" | "closed" => {
  const m = (process.env.REGISTRATION || "open").toLowerCase();
  return m === "invite" || m === "closed" ? m : "open";
};

const mask = (v?: string) => (v ? `••••${v.slice(-4)}` : "");

export function createTenancy(db: DB, billing: Billing) {
  const membership = (workspaceId: string, userId: string) =>
    db.prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?").get(workspaceId, userId) as { role: Role } | undefined;

  const roleAtLeast = (role: Role | undefined, min: Role) => !!role && ROLE_RANK[role] >= ROLE_RANK[min];

  /** Middleware: пользователь — участник пространства :wid с ролью не ниже min (суперадмин проходит всегда). */
  const requireWsRole = (min: Role) => (req: Request, res: Response, next: NextFunction) => {
    const wid = req.params.wid;
    const user = req.auth.user!;
    if (!db.prepare("SELECT 1 FROM workspaces WHERE id = ?").get(wid)) return res.status(404).json({ error: "workspace_not_found", message: "Пространство не найдено" });
    const m = membership(wid, user.id);
    if (!user.isSuperadmin && !roleAtLeast(m?.role, min)) return res.status(403).json({ error: "forbidden", message: "Недостаточно прав в пространстве" });
    (req as any).wsRole = m?.role || (user.isSuperadmin ? "owner" : undefined);
    next();
  };

  const createWorkspace = (name: string, ownerId: string, credits = Number(process.env.FREE_CREDITS ?? 50)) => {
    const id = crypto.randomUUID();
    db.transaction(() => {
      db.prepare("INSERT INTO workspaces (id, name) VALUES (?, ?)").run(id, name.slice(0, 80) || "Моё пространство");
      db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?,?, 'owner')").run(id, ownerId);
      if (credits > 0) billing.adjustCredits(id, credits, "welcome");
    })();
    return id;
  };

  /** Настройки ИИ пространства: свой ключ (BYOK) или ключ платформы с оплатой кредитами. */
  const resolveLlm = (workspaceId: string | null | undefined): { llm: LlmSettings; mode: "byok" | "platform" } => {
    const ws = workspaceId ? billing.getWs(workspaceId) : null;
    if (ws?.ai_mode === "byok" && ws.ai_provider) {
      const key = decrypt(ws.ai_key_enc);
      return {
        mode: "byok",
        llm: {
          provider: ws.ai_provider as Provider,
          modelName: ws.ai_model || undefined,
          openRouterModel: ws.ai_provider === "openrouter" ? ws.ai_model || undefined : undefined,
          modelUrl: ws.ai_provider === "local" ? ws.ai_url || undefined : undefined,
          apiKey: ws.ai_provider === "openrouter" ? undefined : key,
          openRouterApiKey: ws.ai_provider === "openrouter" ? key : undefined,
        },
      };
    }
    return { mode: "platform", llm: readSettings(db).llm };
  };

  const workspaceView = (ws: any, role: Role | undefined) => {
    const plan = effectivePlan(ws);
    const platform = describeProvider(readSettings(db).llm);
    return {
      id: ws.id, name: ws.name, status: ws.status, role,
      credits: ws.credits, plan, planExpiresAt: ws.plan_expires_at, limits: PLANS[plan],
      ai: {
        mode: ws.ai_mode, provider: ws.ai_provider || "", model: ws.ai_model || "", url: ws.ai_url || "",
        key: roleAtLeast(role, "admin") ? mask(decrypt(ws.ai_key_enc)) : "",
        providers: byokProviders(),
      },
      platformAi: { available: platform.keyPresent, provider: platform.provider },
      payments: paymentsProvider(),
    };
  };

  const userWorkspaces = (userId: string) =>
    (db.prepare(`SELECT w.*, m.role FROM memberships m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ? ORDER BY m.created_at`).all(userId) as any[])
      .map(w => workspaceView(w, w.role));

  const startSession = (req: Request, res: Response, userId: string) => {
    const token = randomToken();
    db.prepare("INSERT INTO auth_sessions (id, user_id, expires_at, user_agent) VALUES (?, ?, datetime('now', ?), ?)")
      .run(sha256(token), userId, `+${SESSION_DAYS} days`, str(req.header("user-agent"), 200));
    db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId);
    db.prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now')").run();
    setSessionCookie(req, res, token);
  };

  /** Старые сессии без пространства (до мультитенантности) забирает себе первый суперадмин. */
  const adoptLegacySessions = (userId: string) => {
    const ws = db.prepare("SELECT workspace_id FROM memberships WHERE user_id = ? AND role = 'owner' ORDER BY created_at LIMIT 1").get(userId) as any;
    if (ws) db.prepare("UPDATE sessions SET workspace_id = ?, created_by = ? WHERE workspace_id IS NULL").run(ws.workspace_id, userId);
  };

  const inviteByToken = (token: string) =>
    db.prepare(`SELECT i.*, w.name AS workspace_name FROM invites i JOIN workspaces w ON w.id = i.workspace_id
      WHERE i.token_hash = ? AND i.revoked = 0 AND i.expires_at > datetime('now') AND i.uses < i.max_uses`).get(sha256(token)) as any;

  const acceptInvite = (inv: any, userId: string) => {
    db.transaction(() => {
      const existing = membership(inv.workspace_id, userId);
      if (!existing) db.prepare("INSERT INTO memberships (workspace_id, user_id, role) VALUES (?,?,?)").run(inv.workspace_id, userId, inv.role);
      else if (ROLE_RANK[inv.role as Role] > ROLE_RANK[existing.role]) db.prepare("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?").run(inv.role, inv.workspace_id, userId);
      db.prepare("UPDATE invites SET uses = uses + 1 WHERE token_hash = ?").run(inv.token_hash);
    })();
  };

  return { membership, roleAtLeast, requireWsRole, createWorkspace, resolveLlm, workspaceView, userWorkspaces, startSession, adoptLegacySessions, inviteByToken, acceptInvite };
}

export type Tenancy = ReturnType<typeof createTenancy>;

export function registerTenancyRoutes(app: Express, db: DB, t: Tenancy, billing: Billing) {
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.AUTH_ATTEMPTS_PER_15MIN || 20) });

  // ------------------------------- аккаунт -------------------------------
  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const email = str(req.body?.email, 200).trim().toLowerCase();
    const password = str(req.body?.password, 200);
    const name = str(req.body?.name, 60).trim() || email.split("@")[0];
    const inviteToken = str(req.body?.invite, 200);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "bad_email", message: "Некорректный email" });
    if (password.length < 8) return res.status(400).json({ error: "weak_password", message: "Пароль — минимум 8 символов" });
    const invite = inviteToken ? t.inviteByToken(inviteToken) : null;
    if (inviteToken && !invite) return res.status(400).json({ error: "bad_invite", message: "Приглашение недействительно или истекло" });
    const firstUser = !(db.prepare("SELECT 1 FROM users WHERE id != 'system-nexus' LIMIT 1").get());
    const mode = registrationMode();
    if (!firstUser && !invite && mode !== "open") return res.status(403).json({ error: "registration_closed", message: mode === "invite" ? "Регистрация только по приглашению" : "Регистрация закрыта" });
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) return res.status(409).json({ error: "email_taken", message: "Такой email уже зарегистрирован" });

    const superEmails = (process.env.SUPERADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    const isSuper = superEmails.length ? superEmails.includes(email) : firstUser;
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, email, name, password_hash, is_superadmin) VALUES (?,?,?,?,?)").run(id, email, name, await hashPassword(password), isSuper ? 1 : 0);
    if (invite) t.acceptInvite(invite, id);
    else t.createWorkspace(`Пространство ${name}`, id);
    if (isSuper) t.adoptLegacySessions(id);
    t.startSession(req, res, id);
    res.status(201).json({ ok: true });
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = str(req.body?.email, 200).trim().toLowerCase();
    const password = str(req.body?.password, 200);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as any;
    // одинаковое время ответа для существующих и несуществующих email
    const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "=="), false);
    if (!user || !ok) return res.status(401).json({ error: "bad_credentials", message: "Неверный email или пароль" });
    t.startSession(req, res, user.id);
    if (user.is_superadmin) t.adoptLegacySessions(user.id);
    res.json({ ok: true });
  });

  app.post("/api/auth/logout", (req, res) => {
    if (req.auth.sid) db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(req.auth.sid);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const u = req.auth.user;
    if (!u) return res.status(401).json({ error: "auth_required", registration: registrationMode() });
    res.json({ user: u, workspaces: t.userWorkspaces(u.id) });
  });

  app.post("/api/auth/password", requireUser, authLimiter, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.user!.id) as any;
    const next = str(req.body?.newPassword, 200);
    // вошедшие через VK/Яндекс/Google задают пароль впервые без текущего
    if (user.password_hash && !(await verifyPassword(str(req.body?.currentPassword, 200), user.password_hash))) return res.status(400).json({ error: "bad_password", message: "Текущий пароль неверен" });
    if (next.length < 8) return res.status(400).json({ error: "weak_password", message: "Пароль — минимум 8 символов" });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(next), user.id);
    // разлогиниваем остальные устройства
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND id != ?").run(user.id, req.auth.sid);
    res.json({ ok: true });
  });

  // ------------------------------- восстановление пароля -------------------------------
  const appUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  const createResetToken = (userId: string, hours: number) => {
    const token = randomToken(24);
    db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))").run(sha256(token), userId, `+${hours} hours`);
    return token;
  };

  app.post("/api/auth/forgot", authLimiter, async (req, res) => {
    const email = str(req.body?.email, 200).trim().toLowerCase();
    const user = db.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as any;
    if (user && mailConfigured()) {
      const link = `${appUrl(req)}/reset/${createResetToken(user.id, 1)}`;
      await sendMail(user.email, "Восстановление пароля — Nexus RPG", `Чтобы задать новый пароль, откройте ссылку (действует 1 час):\n${link}\n\nЕсли вы не запрашивали сброс — просто проигнорируйте письмо.`);
    }
    // Ответ одинаковый для любых email — нельзя узнать, кто зарегистрирован
    res.json({ ok: true, mail: mailConfigured() });
  });

  app.post("/api/auth/reset", authLimiter, async (req, res) => {
    const token = str(req.body?.token, 200);
    const password = str(req.body?.password, 200);
    if (password.length < 8) return res.status(400).json({ error: "weak_password", message: "Пароль — минимум 8 символов" });
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')").get(sha256(token)) as any;
    if (!row) return res.status(400).json({ error: "bad_token", message: "Ссылка недействительна или устарела" });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(password), row.user_id);
    db.prepare("UPDATE password_resets SET used = 1 WHERE user_id = ?").run(row.user_id);
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(row.user_id);
    t.startSession(req, res, row.user_id);
    res.json({ ok: true });
  });

  // Без почты: админ платформы выдаёт ссылку сброса вручную
  app.post("/api/admin/users/reset-link", requireUser, requireSuperadmin, (req, res) => {
    const email = str(req.body?.email, 200).trim().toLowerCase();
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    if (!user) return res.status(404).json({ error: "user_not_found", message: "Пользователь не найден" });
    res.json({ link: `${appUrl(req)}/reset/${createResetToken(user.id, 24)}` });
  });

  // ------------------------------- пространства -------------------------------
  app.post("/api/workspaces", requireUser, rateLimit({ windowMs: 60 * 60_000, max: 10 }), (req, res) => {
    const name = str(req.body?.name, 80).trim();
    if (!name) return res.status(400).json({ error: "name_required", message: "Укажите название" });
    const id = t.createWorkspace(name, req.auth.user!.id, 0);
    res.status(201).json(t.workspaceView(billing.getWs(id), "owner"));
  });

  app.get("/api/workspaces/:wid", requireUser, t.requireWsRole("gm"), (req, res) => {
    res.json(t.workspaceView(billing.getWs(req.params.wid), (req as any).wsRole));
  });

  app.patch("/api/workspaces/:wid", requireUser, t.requireWsRole("admin"), (req, res) => {
    const wid = req.params.wid;
    const b = req.body || {};
    if (typeof b.name === "string" && b.name.trim()) db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(b.name.trim().slice(0, 80), wid);
    if (b.ai && typeof b.ai === "object") {
      const mode = b.ai.mode === "byok" ? "byok" : "platform";
      if (mode === "byok") {
        const provider = b.ai.provider as Provider;
        if (!byokProviders().includes(provider)) return res.status(400).json({ error: "provider_not_allowed", message: "Этот провайдер нельзя подключить своим ключом" });
        if (provider === "local") {
          try {
            const u = new URL(str(b.ai.url, 300));
            if (!/^https?:$/.test(u.protocol)) throw new Error();
          } catch { return res.status(400).json({ error: "bad_url", message: "Некорректный URL модели" }); }
        }
        db.prepare("UPDATE workspaces SET ai_mode = 'byok', ai_provider = ?, ai_model = ?, ai_url = ? WHERE id = ?")
          .run(provider, str(b.ai.model, 120) || null, provider === "local" ? str(b.ai.url, 300) : null, wid);
        // маска «••••1234» — ключ не менять; пустая строка — удалить
        if (typeof b.ai.key === "string" && !b.ai.key.startsWith("••••")) {
          db.prepare("UPDATE workspaces SET ai_key_enc = ? WHERE id = ?").run(b.ai.key.trim() ? encrypt(b.ai.key.trim()) : null, wid);
        }
        const ws = billing.getWs(wid);
        if (provider !== "local" && provider !== "mock" && !decrypt(ws.ai_key_enc)) {
          return res.status(400).json({ error: "key_required", message: "Укажите API-ключ провайдера" });
        }
      } else {
        db.prepare("UPDATE workspaces SET ai_mode = 'platform' WHERE id = ?").run(wid);
      }
    }
    res.json(t.workspaceView(billing.getWs(wid), (req as any).wsRole));
  });

  app.delete("/api/workspaces/:wid", requireUser, t.requireWsRole("owner"), (req, res) => {
    const owned = db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?").get(req.auth.user!.id) as any;
    if (owned.n <= 1 && !req.auth.user!.isSuperadmin) return res.status(400).json({ error: "last_workspace", message: "Нельзя удалить единственное пространство" });
    deleteWorkspaceCascade(db, req.params.wid);
    res.json({ ok: true });
  });

  app.post("/api/workspaces/:wid/ai/test", requireUser, t.requireWsRole("admin"), rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
    const { llm, mode } = t.resolveLlm(req.params.wid);
    const started = Date.now();
    try {
      if (mode === "platform") billing.assertCanSpend(req.params.wid, mode);
      const r = await completeWithUsage(llm, { system: "Ответь одним словом.", messages: [{ role: "user", content: "Скажи «готов»." }], maxTokens: 1024 });
      billing.recordUsage({ workspaceId: req.params.wid, userId: req.auth.user!.id, kind: "test", mode, llm, usage: r.usage });
      res.json({ ok: true, ms: Date.now() - started, sample: r.text.slice(0, 80), provider: r.provider, model: r.model, mode });
    } catch (e: any) {
      res.json({ ok: false, ms: Date.now() - started, error: e?.message, mode });
    }
  });

  // ------------------------------- участники -------------------------------
  app.get("/api/workspaces/:wid/members", requireUser, t.requireWsRole("gm"), (req, res) => {
    res.json(db.prepare(`SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ? ORDER BY m.created_at`).all(req.params.wid));
  });

  const ownersLeft = (wid: string, exceptUser: string) =>
    (db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner' AND user_id != ?").get(wid, exceptUser) as any).n;

  app.patch("/api/workspaces/:wid/members/:uid", requireUser, t.requireWsRole("admin"), (req, res) => {
    const role = req.body?.role as Role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: "bad_role" });
    const actor = (req as any).wsRole as Role;
    const target = t.membership(req.params.wid, req.params.uid);
    if (!target) return res.status(404).json({ error: "member_not_found" });
    // админ не может назначать владельцев и трогать владельцев
    if (actor !== "owner" && (role === "owner" || target.role === "owner")) return res.status(403).json({ error: "forbidden", message: "Только владелец управляет владельцами" });
    if (target.role === "owner" && role !== "owner" && !ownersLeft(req.params.wid, req.params.uid)) return res.status(400).json({ error: "last_owner", message: "В пространстве должен остаться владелец" });
    db.prepare("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, req.params.wid, req.params.uid);
    res.json({ ok: true });
  });

  app.delete("/api/workspaces/:wid/members/:uid", requireUser, t.requireWsRole("gm"), (req, res) => {
    const self = req.params.uid === req.auth.user!.id;
    const actor = (req as any).wsRole as Role;
    const target = t.membership(req.params.wid, req.params.uid);
    if (!target) return res.status(404).json({ error: "member_not_found" });
    if (!self && !t.roleAtLeast(actor, "admin")) return res.status(403).json({ error: "forbidden" });
    if (!self && actor !== "owner" && target.role === "owner") return res.status(403).json({ error: "forbidden" });
    if (target.role === "owner" && !ownersLeft(req.params.wid, req.params.uid)) return res.status(400).json({ error: "last_owner", message: "В пространстве должен остаться владелец" });
    db.prepare("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?").run(req.params.wid, req.params.uid);
    res.json({ ok: true });
  });

  // ------------------------------- приглашения -------------------------------
  app.get("/api/workspaces/:wid/invites", requireUser, t.requireWsRole("admin"), (req, res) => {
    res.json(db.prepare(`SELECT substr(token_hash, 1, 12) AS id, role, uses, max_uses, expires_at, created_at FROM invites
      WHERE workspace_id = ? AND revoked = 0 AND expires_at > datetime('now') ORDER BY created_at DESC`).all(req.params.wid));
  });

  app.post("/api/workspaces/:wid/invites", requireUser, t.requireWsRole("admin"), (req, res) => {
    const role: Role = req.body?.role === "admin" ? "admin" : "gm";
    const days = Math.min(30, Math.max(1, Number(req.body?.days) || 7));
    const maxUses = Math.min(100, Math.max(1, Number(req.body?.maxUses) || 10));
    const token = randomToken(24);
    db.prepare("INSERT INTO invites (token_hash, workspace_id, role, created_by, expires_at, max_uses) VALUES (?,?,?,?, datetime('now', ?), ?)")
      .run(sha256(token), req.params.wid, role, req.auth.user!.id, `+${days} days`, maxUses);
    res.status(201).json({ token, role, days, maxUses });
  });

  app.delete("/api/workspaces/:wid/invites/:iid", requireUser, t.requireWsRole("admin"), (req, res) => {
    db.prepare("UPDATE invites SET revoked = 1 WHERE workspace_id = ? AND substr(token_hash, 1, 12) = ?").run(req.params.wid, req.params.iid);
    res.json({ ok: true });
  });

  app.get("/api/invites/:token", (req, res) => {
    const inv = t.inviteByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: "bad_invite", message: "Приглашение недействительно или истекло" });
    res.json({ workspace: inv.workspace_name, role: inv.role });
  });

  app.post("/api/invites/:token/accept", requireUser, (req, res) => {
    const inv = t.inviteByToken(req.params.token);
    if (!inv) return res.status(404).json({ error: "bad_invite", message: "Приглашение недействительно или истекло" });
    t.acceptInvite(inv, req.auth.user!.id);
    res.json({ workspaceId: inv.workspace_id });
  });

  // ------------------------------- журнал ИИ пространства -------------------------------
  app.get("/api/workspaces/:wid/logs", requireUser, t.requireWsRole("admin"), (req, res) => {
    res.json(db.prepare("SELECT * FROM logs WHERE workspace_id = ? ORDER BY id DESC LIMIT 100").all(req.params.wid));
  });
}

export { PROVIDERS };
