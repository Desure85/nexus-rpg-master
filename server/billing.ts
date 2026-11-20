import type { Express, Request, Response } from "express";
import crypto from "crypto";
import type { DB } from "./db";
import { requireUser, requireSuperadmin, rateLimit } from "./security";
import type { LlmUsage, LlmSettings } from "./llm";

// ------------------------------- тарифы и продукты -------------------------------

export type PlanId = "free" | "pro";
export interface PlanLimits { title: string; maxSessions: number; maxHeroes: number; maxPlayers: number }

export const PLANS: Record<PlanId, PlanLimits> = {
  free: { title: "Бесплатный", maxSessions: Number(process.env.FREE_MAX_SESSIONS || 10), maxHeroes: 4, maxPlayers: 4 },
  pro: { title: "Мастер", maxSessions: 500, maxHeroes: 8, maxPlayers: 8 },
};

export interface Product {
  id: string;
  kind: "pack" | "subscription";
  title: string;
  description: string;
  credits: number;
  price: number;
  currency: string;
  /** для подписки: сколько дней действует тариф «Мастер» */
  days?: number;
}

const DEFAULT_PRODUCTS: Product[] = [
  { id: "pack_s", kind: "pack", title: "1 000 кредитов", description: "≈100 ходов мастера", credits: 1000, price: 149, currency: "RUB" },
  { id: "pack_m", kind: "pack", title: "5 000 кредитов", description: "≈500 ходов, выгоднее на 20%", credits: 5000, price: 590, currency: "RUB" },
  { id: "sub_master", kind: "subscription", title: "Подписка «Мастер» на 30 дней", description: "4 000 кредитов + до 8 героев и игроков, 500 сессий", credits: 4000, price: 390, currency: "RUB", days: 30 },
];

export const getProducts = (): Product[] => {
  const raw = process.env.BILLING_PRODUCTS;
  if (!raw) return DEFAULT_PRODUCTS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PRODUCTS;
  } catch {
    console.error("[billing] BILLING_PRODUCTS — невалидный JSON, используются продукты по умолчанию");
    return DEFAULT_PRODUCTS;
  }
};

export const paymentsProvider = (): "none" | "yookassa" | "mock" => {
  const p = (process.env.PAYMENTS_PROVIDER || "").toLowerCase();
  if (p === "yookassa") return p;
  // тестовая «оплата одним кликом» в продакшене — бесплатные кредиты любому; только с явным разрешением
  if (p === "mock") return process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_PAYMENTS === "true" ? "mock" : "none";
  return "none";
};

// ------------------------------- кредиты -------------------------------

const CREDIT_TOKENS = () => Number(process.env.CREDIT_TOKENS || 1000);
const OUTPUT_WEIGHT = () => Number(process.env.OUTPUT_WEIGHT || 4);

/** 1 кредит = CREDIT_TOKENS «взвешенных» токенов; вывод дороже ввода в OUTPUT_WEIGHT раз. */
export const creditsFor = (u: LlmUsage) => Math.max(1, Math.ceil((u.inputTokens + OUTPUT_WEIGHT() * u.outputTokens) / CREDIT_TOKENS()));

export const effectivePlan = (ws: any): PlanId =>
  ws?.plan === "pro" && ws.plan_expires_at && new Date(String(ws.plan_expires_at).replace(" ", "T") + "Z").getTime() > Date.now() ? "pro" : "free";

export class BillingError extends Error {
  constructor(message: string, public status = 402, public code = "insufficient_credits") { super(message); }
}

export function createBilling(db: DB) {
  const getWs = (id: string) => db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id) as any;

  const adjustCredits = (workspaceId: string, delta: number, reason: string, ref?: string) =>
    db.transaction(() => {
      db.prepare("UPDATE workspaces SET credits = credits + ? WHERE id = ?").run(delta, workspaceId);
      const bal = (db.prepare("SELECT credits FROM workspaces WHERE id = ?").get(workspaceId) as any)?.credits ?? 0;
      db.prepare("INSERT INTO credit_ledger (workspace_id, delta, balance_after, reason, ref) VALUES (?,?,?,?,?)").run(workspaceId, delta, bal, reason, ref ?? null);
      return bal as number;
    })();

  /** Проверка перед вызовом ИИ: пространство активно, а на ключе платформы есть кредиты. */
  const assertCanSpend = (workspaceId: string, mode: "byok" | "platform") => {
    const ws = getWs(workspaceId);
    if (!ws) throw new BillingError("Пространство не найдено", 404, "workspace_not_found");
    if (ws.status !== "active") throw new BillingError("Пространство заблокировано администратором платформы", 403, "workspace_suspended");
    if (mode === "platform" && ws.credits <= 0) {
      throw new BillingError("Кредиты пространства закончились. Пополните баланс или подключите свой ключ ИИ.", 402, "insufficient_credits");
    }
  };

  /** Учёт расхода: на ключе платформы списываем кредиты, на своём ключе — только статистика. */
  const recordUsage = (p: { workspaceId: string; sessionId?: string | null; userId?: string | null; kind: string; mode: "byok" | "platform"; llm: LlmSettings; usage: LlmUsage }) => {
    const credits = p.mode === "platform" ? creditsFor(p.usage) : 0;
    db.prepare(`INSERT INTO usage (workspace_id, session_id, user_id, kind, mode, provider, model, input_tokens, output_tokens, estimated, credits)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(p.workspaceId, p.sessionId ?? null, p.userId ?? null, p.kind, p.mode, p.llm.provider, p.llm.modelName || p.llm.openRouterModel || null,
      p.usage.inputTokens, p.usage.outputTokens, p.usage.estimated ? 1 : 0, credits);
    if (credits > 0) adjustCredits(p.workspaceId, -credits, `usage:${p.kind}`, p.sessionId ?? undefined);
    return credits;
  };

  /** Зачисление оплаты. Идемпотентно: повторный вебхук ничего не начислит. */
  const fulfillPayment = (paymentId: string) =>
    db.transaction(() => {
      const pay = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as any;
      if (!pay || pay.status === "succeeded") return false;
      db.prepare("UPDATE payments SET status = 'succeeded', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(paymentId);
      if (pay.credits > 0) adjustCredits(pay.workspace_id, pay.credits, `payment:${pay.product_id}`, pay.id);
      const product = getProducts().find(p => p.id === pay.product_id);
      if (product?.kind === "subscription") {
        const ws = getWs(pay.workspace_id);
        const base = effectivePlan(ws) === "pro" ? new Date(String(ws.plan_expires_at).replace(" ", "T") + "Z") : new Date();
        const until = new Date(base.getTime() + (product.days || 30) * 86400_000);
        db.prepare("UPDATE workspaces SET plan = 'pro', plan_expires_at = ? WHERE id = ?").run(until.toISOString().replace("T", " ").slice(0, 19), pay.workspace_id);
      }
      return true;
    })();

  return { getWs, adjustCredits, assertCanSpend, recordUsage, fulfillPayment };
}

export type Billing = ReturnType<typeof createBilling>;

// ------------------------------- ЮKassa -------------------------------

const YK_API = "https://api.yookassa.ru/v3";
const ykAuth = () => "Basic " + Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString("base64");

async function ykCreatePayment(p: { id: string; amount: string; description: string; returnUrl: string; email?: string; workspaceId: string }) {
  const body: any = {
    amount: { value: p.amount, currency: "RUB" },
    capture: true,
    confirmation: { type: "redirect", return_url: p.returnUrl },
    description: p.description.slice(0, 128),
    metadata: { payment_id: p.id, workspace_id: p.workspaceId },
  };
  if (process.env.YOOKASSA_RECEIPT === "true" && p.email) {
    // Чек по 54-ФЗ (если магазин работает с онлайн-кассой ЮKassa)
    body.receipt = {
      customer: { email: p.email },
      items: [{
        description: p.description.slice(0, 128), quantity: "1.00", amount: { value: p.amount, currency: "RUB" },
        vat_code: Number(process.env.YOOKASSA_VAT_CODE || 1), payment_mode: "full_payment", payment_subject: "service",
      }],
    };
  }
  const res = await fetch(`${YK_API}/payments`, {
    method: "POST",
    headers: { Authorization: ykAuth(), "Idempotence-Key": p.id, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ЮKassa: ${data.description || res.status}`);
  return { externalId: data.id as string, confirmationUrl: data.confirmation?.confirmation_url as string, status: data.status as string };
}

async function ykGetPayment(externalId: string) {
  const res = await fetch(`${YK_API}/payments/${encodeURIComponent(externalId)}`, { headers: { Authorization: ykAuth() } });
  if (!res.ok) throw new Error(`ЮKassa: HTTP ${res.status}`);
  return (await res.json()) as any;
}

// ------------------------------- маршруты -------------------------------

export function registerBillingRoutes(app: Express, db: DB, billing: Billing, requireWsRole: (minRole: "gm" | "admin" | "owner") => any) {
  const appUrl = (req: Request) => (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

  app.get("/api/billing/products", (_req, res) => {
    res.json({ provider: paymentsProvider(), products: paymentsProvider() === "none" ? [] : getProducts(), plans: PLANS });
  });

  app.get("/api/workspaces/:wid/billing", requireUser, requireWsRole("gm"), (req, res) => {
    const ws = billing.getWs(req.params.wid);
    const ledger = db.prepare("SELECT delta, balance_after, reason, created_at FROM credit_ledger WHERE workspace_id = ? ORDER BY id DESC LIMIT 50").all(req.params.wid);
    const payments = db.prepare("SELECT id, product_id, amount, currency, credits, status, created_at FROM payments WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20").all(req.params.wid);
    const usage30 = db.prepare(`SELECT date(created_at) AS day, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(credits) AS credits, COUNT(*) AS calls
      FROM usage WHERE workspace_id = ? AND created_at > datetime('now', '-30 days') GROUP BY day ORDER BY day`).all(req.params.wid);
    res.json({ credits: ws.credits, plan: effectivePlan(ws), planExpiresAt: ws.plan_expires_at, limits: PLANS[effectivePlan(ws)], ledger, payments, usage30 });
  });

  app.post("/api/workspaces/:wid/checkout", requireUser, requireWsRole("admin"), rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
    const provider = paymentsProvider();
    if (provider === "none") return res.status(400).json({ error: "payments_disabled", message: "Оплата на этом сервере не подключена" });
    const product = getProducts().find(p => p.id === req.body?.productId);
    if (!product) return res.status(400).json({ error: "unknown_product" });
    const ws = billing.getWs(req.params.wid);
    const id = crypto.randomUUID();
    const amount = product.price.toFixed(2);
    db.prepare("INSERT INTO payments (id, workspace_id, user_id, provider, product_id, amount, currency, credits) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, ws.id, req.auth.user!.id, provider, product.id, amount, product.currency, product.credits);
    try {
      let confirmationUrl: string;
      let externalId: string;
      if (provider === "mock") {
        externalId = `mock-${id}`;
        confirmationUrl = `/api/billing/mock/confirm/${id}`;
      } else {
        const r = await ykCreatePayment({ id, amount, description: `${product.title} — ${ws.name}`, returnUrl: `${appUrl(req)}/?payment=${id}`, email: req.auth.user!.email, workspaceId: ws.id });
        externalId = r.externalId;
        confirmationUrl = r.confirmationUrl;
      }
      db.prepare("UPDATE payments SET external_id = ?, confirmation_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(externalId, confirmationUrl, id);
      res.json({ paymentId: id, confirmationUrl });
    } catch (e: any) {
      db.prepare("UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      res.status(502).json({ error: "payment_create_failed", message: e?.message || "Не удалось создать платёж" });
    }
  });

  /** Возврат с оплаты: перепроверяем статус у провайдера (на случай, если вебхук не настроен). */
  app.post("/api/workspaces/:wid/payments/:pid/refresh", requireUser, requireWsRole("gm"), async (req, res) => {
    const pay = db.prepare("SELECT * FROM payments WHERE id = ? AND workspace_id = ?").get(req.params.pid, req.params.wid) as any;
    if (!pay) return res.status(404).json({ error: "payment_not_found" });
    if (pay.status === "pending" && pay.provider === "yookassa" && pay.external_id) {
      try {
        const remote = await ykGetPayment(pay.external_id);
        if (remote.status === "succeeded") billing.fulfillPayment(pay.id);
        else if (remote.status === "canceled") db.prepare("UPDATE payments SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(pay.id);
      } catch (e) { console.error("[billing] refresh", e); }
    }
    res.json(db.prepare("SELECT id, product_id, amount, credits, status FROM payments WHERE id = ?").get(pay.id));
  });

  /**
   * Вебхук ЮKassa. Тело уведомления не подписано, поэтому ему не доверяем:
   * берём id платежа и перепроверяем статус запросом к API ЮKassa.
   */
  app.post("/api/billing/webhook/yookassa", async (req, res) => {
    const externalId = req.body?.object?.id;
    if (paymentsProvider() !== "yookassa" || typeof externalId !== "string") return res.status(200).json({ ok: true });
    try {
      const pay = db.prepare("SELECT * FROM payments WHERE provider = 'yookassa' AND external_id = ?").get(externalId) as any;
      if (!pay) return res.status(200).json({ ok: true });
      const remote = await ykGetPayment(externalId);
      if (remote.status === "succeeded" && remote.paid && remote.amount?.value === pay.amount && remote.metadata?.payment_id === pay.id) {
        billing.fulfillPayment(pay.id);
      } else if (remote.status === "canceled") {
        db.prepare("UPDATE payments SET status = 'canceled', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(pay.id);
      }
      res.status(200).json({ ok: true });
    } catch (e) {
      console.error("[billing] webhook", e);
      res.status(500).json({ ok: false }); // ЮKassa повторит уведомление
    }
  });

  // Тестовый провайдер: «оплата» одним кликом (только PAYMENTS_PROVIDER=mock)
  app.get("/api/billing/mock/confirm/:pid", (req, res) => {
    if (paymentsProvider() !== "mock") return res.status(404).end();
    billing.fulfillPayment(req.params.pid);
    res.redirect(`/?payment=${encodeURIComponent(req.params.pid)}`);
  });

  // ------------------------------- суперадмин -------------------------------
  app.get("/api/admin/workspaces", requireUser, requireSuperadmin, (_req, res) => {
    const rows = db.prepare(`SELECT w.id, w.name, w.status, w.credits, w.plan, w.plan_expires_at, w.ai_mode, w.created_at,
        (SELECT COUNT(*) FROM memberships m WHERE m.workspace_id = w.id) AS members,
        (SELECT COUNT(*) FROM sessions s WHERE s.workspace_id = w.id) AS sessions,
        (SELECT COALESCE(SUM(credits),0) FROM usage u WHERE u.workspace_id = w.id AND u.created_at > datetime('now','-30 days')) AS credits30,
        (SELECT COALESCE(SUM(input_tokens + output_tokens),0) FROM usage u WHERE u.workspace_id = w.id AND u.created_at > datetime('now','-30 days')) AS tokens30,
        (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1) AS owner_email
      FROM workspaces w ORDER BY w.created_at DESC LIMIT 500`).all();
    const revenue = db.prepare("SELECT currency, SUM(CAST(amount AS REAL)) AS total, COUNT(*) AS n FROM payments WHERE status = 'succeeded' GROUP BY currency").all();
    res.json({ workspaces: rows.map((w: any) => ({ ...w, plan: effectivePlan(w) })), revenue });
  });

  app.post("/api/admin/workspaces/:wid/credits", requireUser, requireSuperadmin, (req: Request, res: Response) => {
    const delta = Math.trunc(Number(req.body?.delta));
    if (!billing.getWs(req.params.wid)) return res.status(404).json({ error: "workspace_not_found" });
    if (!delta) return res.status(400).json({ error: "delta_required" });
    const balance = billing.adjustCredits(req.params.wid, delta, `admin:${String(req.body?.reason || "manual").slice(0, 80)}`, req.auth.user!.id);
    res.json({ credits: balance });
  });

  app.post("/api/admin/workspaces/:wid/status", requireUser, requireSuperadmin, (req, res) => {
    const status = req.body?.status === "suspended" ? "suspended" : "active";
    db.prepare("UPDATE workspaces SET status = ? WHERE id = ?").run(status, req.params.wid);
    res.json({ status });
  });

  app.post("/api/admin/workspaces/:wid/plan", requireUser, requireSuperadmin, (req, res) => {
    const days = Math.max(0, Math.trunc(Number(req.body?.days) || 0));
    if (!days) db.prepare("UPDATE workspaces SET plan = 'free', plan_expires_at = NULL WHERE id = ?").run(req.params.wid);
    else db.prepare("UPDATE workspaces SET plan = 'pro', plan_expires_at = datetime('now', ?) WHERE id = ?").run(`+${days} days`, req.params.wid);
    res.json(billing.getWs(req.params.wid));
  });
}
