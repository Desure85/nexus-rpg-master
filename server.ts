import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("game.db");

// ... (database initialization code remains same)
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT,
    genre TEXT,
    setting TEXT,
    style TEXT,
    snapshot TEXT,
    history TEXT,
    lore TEXT,
    codex TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    request TEXT,
    response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Ensure codex column exists
try {
  db.prepare("SELECT codex FROM sessions LIMIT 1").get();
} catch (e) {
  console.log("Adding codex column to sessions table...");
  db.exec("ALTER TABLE sessions ADD COLUMN codex TEXT");
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // WebSocket Room Management
  const rooms = new Map<string, Set<WebSocket>>();

  wss.on("connection", (ws) => {
    let currentRoom: string | null = null;

    ws.on("message", (message) => {
      const data = JSON.parse(message.toString());
      
      if (data.type === "join") {
        const roomId = data.sessionId;
        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Set());
        }
        rooms.get(roomId)!.add(ws);
        currentRoom = roomId;
        console.log(`Client joined room: ${roomId}`);
      }
    });

    ws.on("close", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom)!.delete(ws);
        if (rooms.get(currentRoom)!.size === 0) {
          rooms.delete(currentRoom);
        }
      }
    });
  });

  const broadcastToRoom = (roomId: string, data: any) => {
    const clients = rooms.get(roomId);
    if (clients) {
      const message = JSON.stringify(data);
      clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  };

  // API Routes
  app.get("/api/sessions", (req, res) => {
    const sessions = db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all();
    res.json(sessions);
  });

  app.get("/api/sessions/:id", (req, res) => {
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    res.json(session);
  });

  app.post("/api/sessions", (req, res) => {
    const { id, name, genre, setting, style, snapshot, history, lore, codex } = req.body;
    const stmt = db.prepare(`
      INSERT INTO sessions (id, name, genre, setting, style, snapshot, history, lore, codex)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        snapshot=excluded.snapshot,
        history=excluded.history,
        lore=excluded.lore,
        codex=excluded.codex,
        updated_at=CURRENT_TIMESTAMP
    `);
    stmt.run(id, name, genre, setting, style, snapshot, history, lore, codex);
    
    // Broadcast update to all clients in the session room
    broadcastToRoom(id, { type: "update", sessionId: id });
    
    res.json({ status: "ok" });
  });

  app.delete("/api/sessions/:id", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.id);
    res.json({ status: "ok" });
  });

  app.get("/api/settings", (req, res) => {
    const settings = db.prepare("SELECT * FROM settings").all();
    const config = settings.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json(config);
  });

  app.post("/api/settings", (req, res) => {
    const { provider, modelUrl, apiKey, modelName, systemPrompt, fontSize, fontFamily, loggingEnabled, mechanics } = req.body;
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
    upsert.run("provider", provider);
    upsert.run("modelUrl", modelUrl);
    upsert.run("apiKey", apiKey);
    upsert.run("modelName", modelName);
    upsert.run("systemPrompt", systemPrompt);
    upsert.run("fontSize", fontSize?.toString());
    upsert.run("fontFamily", fontFamily);
    upsert.run("loggingEnabled", loggingEnabled ? "true" : "false");
    if (mechanics) {
      upsert.run("mechanics", JSON.stringify(mechanics));
    }
    res.json({ status: "ok" });
  });

  app.post("/api/logs", (req, res) => {
    const { sessionId, request, response } = req.body;
    const stmt = db.prepare("INSERT INTO logs (session_id, request, response) VALUES (?, ?, ?)");
    stmt.run(sessionId, JSON.stringify(request), response);
    res.json({ status: "ok" });
  });

  app.get("/api/logs", (req, res) => {
    const logs = db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT 100").all();
    res.json(logs);
  });

  app.get("/api/download/dockerfile", (req, res) => {
    const filePath = path.join(__dirname, "Dockerfile");
    res.download(filePath, "Dockerfile", (err) => {
      if (err) {
        console.error("Error downloading Dockerfile:", err);
        res.status(500).send("Error downloading file");
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
