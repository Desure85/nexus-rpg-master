import express from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import fs from "fs";
import { openDatabase, type DB } from "./db";
import { initSecret } from "./crypto";
import { buildApi, apiErrorHandler } from "./api";

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

  const { engine, billing, tenancy } = buildApi(app, { db, broadcast });

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
    app.get("*", (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  } else if (opts.vite) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use(apiErrorHandler);

  const close = async () => {
    clearInterval(heartbeat);
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>(r => wss.close(() => r()));
    await new Promise<void>(r => (server.listening ? server.close(() => r()) : r()));
    await Promise.race([engine.whenIdle(), new Promise(r => setTimeout(r, 10_000))]).catch(() => undefined);
    db.close();
  };

  return { app, server, wss, db, engine, billing, tenancy, close };
}
