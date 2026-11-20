import express from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { openDatabase, type DB } from "./db";
import { initSecret } from "./crypto";
import { buildApi, apiErrorHandler } from "./api";
import { setUrlGuard } from "./llm";
import { assertPublicUrl } from "./netguard";

export interface AppOptions {
  dbPath?: string;
  db?: DB;
  /** Каталог собранного фронтенда (prod). Если не задан и NODE_ENV!=production — подключается Vite dev-middleware. */
  staticDir?: string;
  vite?: boolean;
}

export async function createApp(opts: AppOptions = {}) {
  const dbPath = opts.dbPath || process.env.DB_PATH || "game.db";
  const db = opts.db || openDatabase(dbPath);
  initSecret(opts.db ? ":memory:" : dbPath);
  const app = express();
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY);
  const server: Server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  app.use(express.json({ limit: "2mb" }));

  // ------------------------------- WebSocket -------------------------------
  const rooms = new Map<string, Set<WebSocket>>();
  const alive = new WeakMap<WebSocket, boolean>();

  const broadcast = (roomId: string, data: any) => {
    const clients = rooms.get(roomId);
    if (!clients) return;
    const msg = JSON.stringify(data);
    for (const c of clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  };

  setUrlGuard(assertPublicUrl);
  const { engine, billing, tenancy, ops, worlds } = buildApi(app, { db, broadcast, dbPath: opts.db ? undefined : dbPath });
  ops.start();

  wss.on("connection", ws => {
    let room: string | null = null;
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", raw => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }
      if (data?.type === "join" && typeof data.sessionId === "string") {
        const exists = db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(data.sessionId);
        if (!exists) return;
        if (room) rooms.get(room)?.delete(ws);
        room = data.sessionId;
        if (!rooms.has(room!)) rooms.set(room!, new Set());
        rooms.get(room!)!.add(ws);
        ws.send(JSON.stringify({ type: "joined", sessionId: room, busy: engine.isBusy(room!) }));
      }
    });
    ws.on("close", () => {
      if (room && rooms.has(room)) {
        rooms.get(room)!.delete(ws);
        if (rooms.get(room)!.size === 0) rooms.delete(room);
      }
    });
    ws.on("error", () => ws.terminate());
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) { ws.terminate(); continue; }
      alive.set(ws, false);
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();


  // ------------------------------- фронтенд -------------------------------
  const staticDir = opts.staticDir ?? (process.env.NODE_ENV === "production" ? path.resolve(process.env.STATIC_DIR || "dist") : undefined);
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: "1h", setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); } }));
    // CSP для страницы приложения: только свои скрипты, без inline-JS; шрифты Google; список моделей OpenRouter в настройках
    const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob:", "connect-src 'self' ws: wss: https://openrouter.ai", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"].join("; ");
    // Превью ссылок (VK, Telegram, поисковики): для /world/:id — название, описание и обложка мира в og-тегах
    const indexHtml = fs.readFileSync(path.join(staticDir, "index.html"), "utf8");
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const base = () => (process.env.APP_URL || "").replace(/\/$/, "");
    const withMeta = (title: string, desc: string, image?: string, url?: string) => indexHtml
      .replace(/\s*<meta property="og:[^>]*>/g, "")
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}" />`)
      .replace(/<\/head>/, [
        `<meta property="og:type" content="website" />`, `<meta property="og:title" content="${esc(title)}" />`, `<meta property="og:description" content="${esc(desc)}" />`,
        ...(image && base() ? [`<meta property="og:image" content="${esc(base() + image)}" />`, `<meta name="twitter:card" content="summary_large_image" />`] : []),
        ...(url && base() ? [`<meta property="og:url" content="${esc(base() + url)}" />`] : []),
      ].join("\n    ") + "\n  </head>");
    // Поисковикам: публичные миры в sitemap (адреса — от APP_URL)
    app.get("/sitemap.xml", (_req, res) => {
      if (!base()) return res.status(404).end();
      const ids = worlds.publicIds();
      res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${esc(base())}/</loc></url>\n${ids.map(id => `<url><loc>${esc(`${base()}/world/${id}`)}</loc></url>`).join("\n")}\n</urlset>`);
    });
    app.get("/robots.txt", (_req, res) => res.type("text/plain").send(`User-agent: *\nAllow: /\nAllow: /world/\nDisallow: /api/\nDisallow: /invite/\nDisallow: /reset/\nDisallow: /character/\n${base() ? `Sitemap: ${base()}/sitemap.xml\n` : ""}`));
    app.get("*", (req, res) => {
      res.setHeader("Content-Security-Policy", process.env.CSP || CSP);
      const m = req.path.match(/^\/world\/([0-9a-z-]{1,64})\/?$/i);
      const w = m ? worlds.publicPreview(m[1]) : null;
      if (w) return res.type("html").send(withMeta(`${w.title} — мир для игры с ИИ-мастером`, (w.description || w.scenarios[0]?.hook || "").slice(0, 200), w.cover, req.path));
      res.sendFile(path.join(staticDir, "index.html"));
    });
  } else if (opts.vite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use(apiErrorHandler);

  const close = async () => {
    clearInterval(heartbeat);
    ops.stop();
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(r => wss.close(() => r()));
    await new Promise<void>(r => (server.listening ? server.close(() => r()) : r()));
    await Promise.race([engine.whenIdle(), new Promise(r => setTimeout(r, 10_000))]).catch(() => undefined);
    db.close();
  };

  return { app, server, wss, db, engine, billing, tenancy, ops, close };
}
