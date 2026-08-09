import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || "game.db";
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

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

// Migration: Ensure archive column exists (NEXUS SAVE: Final Drafts / Story Archive crystallizations)
try {
  db.prepare("SELECT archive FROM sessions LIMIT 1").get();
} catch (e) {
  console.log("Adding archive column to sessions table...");
  db.exec("ALTER TABLE sessions ADD COLUMN archive TEXT");
}

// Migration: Ensure decision_tree column exists (Древо Решений)
try {
  db.prepare("SELECT decision_tree FROM sessions LIMIT 1").get();
} catch (e) {
  console.log("Adding decision_tree column to sessions table...");
  db.exec("ALTER TABLE sessions ADD COLUMN decision_tree TEXT");
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
    const { id, name, genre, setting, style, snapshot, history, lore, codex, archive, decision_tree } = req.body;
    const stmt = db.prepare(`
      INSERT INTO sessions (id, name, genre, setting, style, snapshot, history, lore, codex, archive, decision_tree)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        snapshot=excluded.snapshot,
        history=excluded.history,
        lore=excluded.lore,
        codex=excluded.codex,
        archive=excluded.archive,
        decision_tree=excluded.decision_tree,
        updated_at=CURRENT_TIMESTAMP
    `);
    stmt.run(id, name, genre, setting, style, snapshot, history, lore, codex, archive ?? null, decision_tree ?? null);
    
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

  // OpenCode Go subscription proxy: forwards LLM calls to https://opencode.ai/zen/go/v1
  const OPENCODE_API_URL = process.env.OPENCODE_API_URL || "https://opencode.ai/zen/go/v1";
  const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || "";
  const OPENCODE_MODEL = process.env.OPENCODE_MODEL || "deepseek-v4-flash";

  // Модели (glm/deepseek/minimax) иногда сливают мета-абзацы перед ответом
  // (рассуждения о скиллах, «I'll answer as...», служебные заметки). Срезаем
  // все ведущие абзацы, похожие на мета, до первого «чистого» нарратива.
  const stripMetaPrefix = (text: string): string => {
    const meta = /skill|brainstorm|AGENTS|creative writing|let me (check|think|just)|user (is asking|asks|wants|keeps)|according to|I.?ll answer|I will answer|this is (a|just|the)|Пользователь|навык|скилл|провер|рассужд|отвечу как|я отвечу|просит|задач/i;
    const out: string[] = [];
    let metaMode = true;
    for (const p of text.split(/\n\s*\n/)) {
      if (metaMode && p.length < 600 && meta.test(p)) continue;
      metaMode = false;
      out.push(p);
    }
    return out.join("\n\n").trim();
  };

  app.post("/api/chat", async (req, res) => {
    const { system, prompt, model, stream } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    if (!OPENCODE_API_KEY) return res.status(500).json({ error: "OPENCODE_API_KEY not configured on the server" });
    try {
      const messages: { role: string; content: string }[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });
      const upstream = await fetch(`${OPENCODE_API_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENCODE_API_KEY}` },
        body: JSON.stringify({ model: model || OPENCODE_MODEL, messages, temperature: 0.7, stream: !!stream })
      });
      if (!upstream.ok) {
        const err = await upstream.text().catch(() => "");
        throw new Error(`OpenCode Go: HTTP ${upstream.status} ${err.slice(0, 200)}`);
      }

      if (!stream) {
        const data = await upstream.json();
        res.json({ text: stripMetaPrefix(data.choices?.[0]?.message?.content || "") });
        return;
      }

      // Streaming: буферизуем первый абзац (чтобы срезать мету), дальше льём SSE.
      const META_RE = /skill|brainstorm|AGENTS|creative writing|let me (check|think|just)|user (is asking|asks|wants|keeps)|according to|I.?ll answer|I will answer|this is (a|just|the)|Пользователь|навык|скилл|провер|рассужд|отвечу как|я отвечу|просит|задач/i;
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      let pending = "";
      let firstPara = true;
      let upstreamDone = false;
      while (!upstreamDone) {
        const { value, done } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = raw.indexOf("\n")) >= 0) {
          const line = raw.slice(0, nl).trim();
          raw = raw.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") { upstreamDone = true; break; }
          let delta = "";
          try {
            const ev = JSON.parse(payload);
            delta = ev.choices?.[0]?.delta?.content || "";
          } catch { continue; }
          if (!delta) continue;
          if (firstPara) {
            pending += delta;
            const boundary = pending.indexOf("\n\n");
            if (boundary >= 0 || pending.length > 800) {
              const head = boundary >= 0 ? pending.slice(0, boundary) : pending;
              const rest = boundary >= 0 ? pending.slice(boundary + 2) : "";
              let out = "";
              if (!(head.length < 600 && META_RE.test(head))) out = head;
              if (rest) out += (out ? "\n\n" : "") + rest;
              if (out) res.write(`data: ${JSON.stringify({ delta: out })}\n\n`);
              firstPara = false;
              pending = "";
            }
          } else {
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }
        }
      }
      if (firstPara && pending && !(pending.length < 600 && META_RE.test(pending))) {
        res.write(`data: ${JSON.stringify({ delta: pending })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : "opencode proxy error" });
    }
  });

  // NEXUS EXPORT: writes session to skill-compatible files (session.json + archive.md + timeline.md)
  app.get("/api/sessions/:id/export", (req, res) => {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "Session not found" });

    const history = JSON.parse(row.history || "[]");
    const codex = JSON.parse(row.codex || "[]");
    let decisionTree = [];
    try { decisionTree = JSON.parse(row.decision_tree || "[]"); } catch (e) { decisionTree = []; }
    if (!decisionTree.length) {
      const lastDashMsg = history.slice().reverse().find((m: any) => m.dashboard);
      decisionTree = lastDashMsg?.dashboard?.decisionTree || [];
    }
    const dashboard = history.slice().reverse().find((m: any) => m.dashboard)?.dashboard || {};

    const parseHp = (hp: string) => {
      const m = String(hp || "").match(/(\d+)\s*\/\s*(\d+)/);
      return m ? { current: parseInt(m[1]), max: parseInt(m[2]) } : { current: 0, max: 0 };
    };
    const parseStress = (s: string | number) => {
      if (typeof s === "number") return s;
      const m = String(s || "").match(/(\d+)/);
      return m ? parseInt(m[1]) : 0;
    };

    const characters = (dashboard.characters || []).map((c: any) => ({
      name: c.name,
      hp: parseHp(c.hp),
      stress: parseStress(c.stress),
      tokens: c.tokens || 0,
      state: c.condition || "—",
      scars: [],
      personal_goal: c.goal || "—",
      inventory: c.inventory || [],
      notes: "",
    }));
    const threats = (dashboard.threats || []).map((t: any) => ({
      name: t.name,
      hp: parseHp(t.hp),
      stress: 0,
      aspects: Array.isArray(t.features) ? t.features.join("; ") : (t.features || ""),
      legendary_resistance: 0,
    }));
    const clocks = (dashboard.clocks || []);
    const clocksObj = {
      chapter: clocks[0]?.progress || 0,
      chapter_max: clocks[0]?.total || 6,
      threat: clocks[1]?.progress || 0,
      threat_max: clocks[1]?.total || 6,
    };

    const sessionJson = {
      session_id: row.id,
      status: "active",
      story: {
        genre: row.genre || "Custom",
        setting: row.setting || "",
        style: row.style || "",
        synopsis: row.name || "",
        chapter: 1,
        round: history.length,
      },
      options: { karma: false },
      characters,
      npcs: codex.filter((e: any) => e.type === "npc").map((e: any) => ({
        name: e.name, hp: { current: 10, max: 10 }, stress: 0,
        aspects: e.description || "", known_by: [], memory: [],
      })),
      threats,
      scene: {
        location: dashboard.currentLocationId || "",
        time: "",
        aspects: dashboard.sceneAspects || [],
      },
      clocks: clocksObj,
      doom_pool: dashboard.doomPool || 0,
      doom_pool_max: 20,
      echo_of_past: dashboard.echoes || [],
      atmosphere: dashboard.atmosphere || "",
      decision_tree: decisionTree,
      npc_memory: [],
      history: history.slice(-20).map((m: any, i: number) => ({
        round: i + 1,
        action: m.role === "user" ? m.content : "",
        result: m.role === "assistant" ? m.content : "",
        roll_tag: "",
      })),
      counters: { turns_total: history.length, rounds_since_narrative_right: 0, fail_streak: 0 },
    };

    const archiveMd = [
      row.lore ? `# Story Archive\n\n${row.lore}` : "",
      row.archive ? `\n\n# Final Drafts (NEXUS SAVE)\n\n${row.archive}` : "",
    ].filter(Boolean).join("\n") || "# Story Archive\n\n(пока пусто)";

    const timelineMd = history
      .filter((m: any) => m.role === "user")
      .map((m: any, i: number) => `- [Ход ${i + 1}] ${String(m.content).replace(/\n/g, " ").slice(0, 200)}`)
      .join("\n") || "(пока пусто)";

    const exportDir = path.join(process.env.EXPORT_DIR || path.join(__dirname, "exports"), row.id);
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(path.join(exportDir, "session.json"), JSON.stringify(sessionJson, null, 2), "utf-8");
    fs.writeFileSync(path.join(exportDir, "archive.md"), archiveMd, "utf-8");
    fs.writeFileSync(path.join(exportDir, "timeline.md"), timelineMd, "utf-8");

    res.json({ status: "ok", files: ["session.json", "archive.md", "timeline.md"], dir: exportDir, session_json: sessionJson, archive_md: archiveMd, timeline_md: timelineMd });
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
