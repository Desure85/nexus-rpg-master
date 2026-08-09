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

// Migration: Ensure mode column exists (short | campaign)
try {
  db.prepare("SELECT mode FROM sessions LIMIT 1").get();
} catch (e) {
  console.log("Adding mode column to sessions table...");
  db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'short'");
}

// Multiplayer: claims (закрепление персонажа за игроком) + pending_actions (очередь ходов)
db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    char_name TEXT NOT NULL,
    player_name TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pending_actions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    char_name TEXT NOT NULL,
    player_name TEXT,
    action_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pacing (
    session_id TEXT PRIMARY KEY,
    round INTEGER DEFAULT 0,
    last_threat_round INTEGER DEFAULT -99,
    safe_until INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS searches (
    session_id TEXT NOT NULL,
    target TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, target)
  );
  CREATE TABLE IF NOT EXISTS idle (
    session_id TEXT PRIMARY KEY,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expeditions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    char_name TEXT NOT NULL,
    hireling TEXT NOT NULL,
    tier TEXT NOT NULL,
    cost INTEGER NOT NULL,
    reward_gold INTEGER NOT NULL,
    reward_item TEXT,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    returns_at DATETIME NOT NULL,
    claimed INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS engine_state (
    session_id TEXT PRIMARY KEY,
    characters TEXT NOT NULL
  );
`);

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
    const { id, name, genre, setting, style, snapshot, history, lore, codex, archive, decision_tree, mode } = req.body;
    const stmt = db.prepare(`
      INSERT INTO sessions (id, name, genre, setting, style, snapshot, history, lore, codex, archive, decision_tree, mode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name,
        snapshot=excluded.snapshot,
        history=excluded.history,
        lore=excluded.lore,
        codex=excluded.codex,
        archive=excluded.archive,
        decision_tree=excluded.decision_tree,
        mode=excluded.mode,
        updated_at=CURRENT_TIMESTAMP
    `);
    stmt.run(id, name, genre, setting, style, snapshot, history, lore, codex, archive ?? null, decision_tree ?? null, mode || 'short');
    
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
    const { provider, modelUrl, apiKey, modelName, systemPrompt, fontSize, fontFamily, loggingEnabled, mechanics, idlePlayerAction } = req.body;
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
    if (idlePlayerAction) {
      upsert.run("idlePlayerAction", idlePlayerAction);
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

  // --- Multiplayer: claims + pending actions ---
  app.post("/api/sessions/:id/claim", (req, res) => {
    const { charName, playerName, deviceId } = req.body || {};
    if (!charName || !playerName || !deviceId) return res.status(400).json({ error: "charName/playerName/deviceId required" });
    const existing = db.prepare("SELECT * FROM claims WHERE session_id = ? AND char_name = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id, charName);
    if (existing && existing.status === "approved" && existing.device_id !== deviceId) {
      return res.status(409).json({ error: "claimed_by_other", claim: existing });
    }
    if (existing && (existing.status === "approved" || existing.status === "pending") && existing.device_id === deviceId) {
      return res.json({ status: existing.status, claim: existing });
    }
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO claims (id, session_id, char_name, player_name, device_id, status) VALUES (?,?,?,?,?, 'pending')")
      .run(id, req.params.id, charName, playerName, deviceId);
    broadcastToRoom(req.params.id, { type: "claims_changed", sessionId: req.params.id });
    res.json({ status: "pending", claim: { id, charName, playerName, status: "pending" } });
  });

  app.get("/api/sessions/:id/claims", (req, res) => {
    res.json(db.prepare("SELECT * FROM claims WHERE session_id = ? ORDER BY created_at ASC").all(req.params.id));
  });

  app.post("/api/claims/:id/approve", (req, res) => {
    const c = db.prepare("SELECT * FROM claims WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ error: "claim not found" });
    db.prepare("UPDATE claims SET status = 'approved' WHERE id = ?").run(req.params.id);
    broadcastToRoom(c.session_id, { type: "claims_changed", sessionId: c.session_id });
    res.json({ status: "ok" });
  });

  app.post("/api/claims/:id/reject", (req, res) => {
    const c = db.prepare("SELECT * FROM claims WHERE id = ?").get(req.params.id);
    if (!c) return res.status(404).json({ error: "claim not found" });
    db.prepare("UPDATE claims SET status = 'rejected' WHERE id = ?").run(req.params.id);
    broadcastToRoom(c.session_id, { type: "claims_changed", sessionId: c.session_id });
    res.json({ status: "ok" });
  });

  app.get("/api/sessions/:id/pending", (req, res) => {
    res.json(db.prepare("SELECT * FROM pending_actions WHERE session_id = ? ORDER BY created_at ASC").all(req.params.id));
  });

  app.post("/api/sessions/:id/actions", (req, res) => {
    const { charName, deviceId, action } = req.body || {};
    if (!charName || !deviceId || !action) return res.status(400).json({ error: "charName/deviceId/action required" });
    const claim = db.prepare("SELECT * FROM claims WHERE session_id = ? AND char_name = ? AND status = 'approved'").get(req.params.id, charName);
    if (!claim || claim.device_id !== deviceId) return res.status(403).json({ error: "character not claimed by this device" });
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pending_actions (id, session_id, char_name, player_name, action_text) VALUES (?,?,?,?,?)")
      .run(id, req.params.id, charName, claim.player_name, action);
    broadcastToRoom(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", id });
  });

  app.delete("/api/actions/:id", (req, res) => {
    db.prepare("DELETE FROM pending_actions WHERE id = ?").run(req.params.id);
    res.json({ status: "ok" });
  });

  // GM-action: ГМ играет за персонажа (соло-режим, обходит claim по устройству)
  app.post("/api/sessions/:id/gm-action", (req, res) => {
    const { charName, action } = req.body || {};
    if (!charName || !action) return res.status(400).json({ error: "charName/action required" });
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO pending_actions (id, session_id, char_name, player_name, action_text) VALUES (?,?,?,?,?)")
      .run(id, req.params.id, charName, "ГМ", action);
    broadcastToRoom(req.params.id, { type: "actions_changed", sessionId: req.params.id });
    res.json({ status: "ok", id });
  });

  app.post("/api/sessions/:id/commit", (req, res) => {
    const sessionId = req.params.id;
    const pending = db.prepare("SELECT * FROM pending_actions WHERE session_id = ? ORDER BY created_at ASC").all(sessionId);
    if (pending.length === 0) return res.json({ status: "ok", committed: 0 });
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    const history = JSON.parse(row.history || "[]");
    const newMsgs = pending.map(p => ({
      role: "user",
      content: `[PLAYER ACTION: ${p.char_name}${p.player_name ? ` (${p.player_name})` : ""}] ${p.action_text}`
    }));
    db.prepare("UPDATE sessions SET history = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify([...history, ...newMsgs]), sessionId);
    db.prepare("DELETE FROM pending_actions WHERE session_id = ?").run(sessionId);
    broadcastToRoom(sessionId, { type: "update", sessionId });
    broadcastToRoom(sessionId, { type: "actions_changed", sessionId });
    res.json({ status: "ok", committed: newMsgs.length });
  });

  // --- Pacing: реальная проверка эскалации (заменяет «мысленный d6») ---
  // Прогрессия: XP → уровень (level = floor(sqrt(xp/50))+1; золото = XP)
  const levelFromXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
  const partyLevel = (dash: any) => {
    const chars = dash?.characters || [];
    if (chars.length === 0) return 1;
    const total = chars.reduce((s: number, c: any) => s + levelFromXp(Number(c.xp || 0)), 0);
    return Math.max(1, Math.round(total / chars.length));
  };
  const threatBudget = (level: number, danger: number) => ({
    hp: 8 + level * 3 + danger * 2,
    features: 1 + Math.floor(level / 2),
  });

  const PACING_STYLES: Record<string, { limit: number; safeDelay: number; threshold: number; failedBonus: number }> = {
    narrative: { limit: 1, safeDelay: 3, threshold: 6, failedBonus: 1 },
    fairytale: { limit: 1, safeDelay: 3, threshold: 6, failedBonus: 1 },
    balanced: { limit: 2, safeDelay: 2, threshold: 5, failedBonus: 1 },
    combat: { limit: 3, safeDelay: 0, threshold: 3, failedBonus: 1 },
  };

  app.post("/api/sessions/:id/encounter-check", (req, res) => {
    const { style = "balanced", playerFailed = false } = req.body || {};
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    if (!row) return res.json({ roll: 0, result: "none", reason: "session not found", tag: "" });
    const history = JSON.parse(row.history || "[]");
    const round = history.filter((m: any) => m.role === "assistant").length;
    const lastDash = history.slice().reverse().find((m: any) => m.dashboard)?.dashboard;
    const threatsActive = Array.isArray(lastDash?.threats) ? lastDash.threats.length : 0;
    const cfg = PACING_STYLES[style] || PACING_STYLES.balanced;

    let p = db.prepare("SELECT * FROM pacing WHERE session_id = ?").get(req.params.id);
    if (!p) { db.prepare("INSERT INTO pacing (session_id) VALUES (?)").run(req.params.id); p = { round: 0, last_threat_round: -99, safe_until: 0 }; }

    const roll = Math.floor(Math.random() * 6) + 1;
    const effectiveRoll = roll + (playerFailed ? cfg.failedBonus : 0);
    let result: "encounter" | "none" | "silence" | "world" = "none";
    let reason = "";
    let worldType: "positive" | "neutral" | "negative" = "neutral";

    const doomPool = Number(lastDash?.doomPool || 0);
    if (doomPool >= 5) {
      // Пул Рока сработал: непредсказуемое мировое событие (полярность случайна)
      result = "world";
      const typeRoll = Math.floor(Math.random() * 6) + 1;
      worldType = typeRoll <= 2 ? "positive" : typeRoll <= 4 ? "neutral" : "negative";
      reason = `doom=${doomPool} ≥ 5, полярность d6=${typeRoll} → ${worldType}`;
      db.prepare("UPDATE pacing SET round = ?, last_threat_round = ?, safe_until = ? WHERE session_id = ?")
        .run(round, worldType === "negative" ? round : (p.last_threat_round ?? -99), round + (worldType === "negative" ? cfg.safeDelay : 0), req.params.id);
    } else if (round < p.safe_until && style !== "combat") {
      reason = `safe_haven (до хода ${p.safe_until})`;
    } else if (threatsActive >= cfg.limit) {
      reason = `лимит угроз (${threatsActive}/${cfg.limit})`;
    } else if (round - (p.last_threat_round ?? -99) >= 5) {
      result = "silence";
      reason = "тишина 5+ ходов — авто-событие";
    } else if (effectiveRoll >= cfg.threshold) {
      result = "encounter";
      reason = `d6=${roll} (порог ${cfg.threshold})`;
    } else {
      reason = `d6=${roll} < ${cfg.threshold}`;
    }

    if (result === "encounter" || result === "silence") {
      db.prepare("UPDATE pacing SET round = ?, last_threat_round = ?, safe_until = ? WHERE session_id = ?")
        .run(round, round, round + cfg.safeDelay, req.params.id);
    }
    const typeLabel = worldType === "positive" ? "благосклонность судьбы" : worldType === "neutral" ? "нейтральное знамение" : "опасность";
    const pl = partyLevel(lastDash);
    const budget = threatBudget(pl, Number(lastDash?.locations?.find((l: any) => l.id === lastDash?.currentLocationId)?.dangerLevel || 1));
    const tag = result === "world"
      ? `[WORLD EVENT: ${worldType} (${typeLabel})] Пул Рока разрядился — произойдёт НЕОЖИДАННОЕ событие ${worldType === "positive" ? "в пользу героев (союзник, находка, удача)" : worldType === "neutral" ? "— знамение, встреча, деталь мира" : "— угроза, засада, ухудшение"}. Опиши его живо и ОБНУЛИ doomPool до 0 в следующем dashboard_json.`
      : result === "encounter"
        ? `[ENCOUNTER: ${reason} — введи новую угрозу или опасное событие. Партия уровня ${pl}: враг должен иметь HP ~${budget.hp}, особенностей ${budget.features} (автоскейл)]`
        : result === "silence"
          ? `[ENCOUNTER: тишина затянулась — введи событие (опасность, интригу или открытие)]`
          : "";
    res.json({ roll, result, reason, worldType: result === "world" ? worldType : undefined, partyLevel: pl, threatBudget: result === "encounter" ? budget : undefined, tag });
  });

  // --- Loot: детерминированный поиск (локация / тело) ---
  const LOOT_POOLS: Record<string, string[]> = {
    common: ["12 золотых монет", "Зелье лечения (восстанавливает 5 HP)", "Старый железный кинжал", "Связка верёвки (10 м)", "Потертая карта окрестностей", "Пустая склянка"],
    uncommon: ["30 золотых монет", "Зелье стабильности (снимает 2 Стресса)", "Кинжал гнева (+1 урон)", "Малый ключ", "Письмо с чужой печатью", "Фляга крепкого вина"],
    rare: ["75 золотых монет", "Зелье великого лечения (восстанавливает 10 HP)", "Меч из лунного серебра (+2 урон, светится в темноте)", "Свиток с шифром", "Амулет старой гильдии", "Линза истины (видит невидимое)"],
    epic: ["150 золотых монет", "Сердце Вельдегара (расходник: 20 HP или сброс 5 Стресса, 1 раз)", "Ключ от башни Инквизитора", "Дневник Варго (знание слабости врага)", "Печать Нексуса"],
  };

  const pickLoot = (pool: keyof typeof LOOT_POOLS, count: number, used: string[] = []) => {
    const available = LOOT_POOLS[pool].filter(i => !used.includes(i));
    const picked: string[] = [];
    for (let i = 0; i < count && available.length > 0; i++) {
      const idx = Math.floor(Math.random() * available.length);
      picked.push(available.splice(idx, 1)[0]);
    }
    return picked;
  };

  const tierFor = (roll: number, danger: number): keyof typeof LOOT_POOLS | null => {
    if (roll < 5) return null;
    if (roll <= 14) return "common";
    if (roll <= 19) return danger <= 2 ? "common" : "uncommon";
    return danger <= 2 ? "uncommon" : danger <= 4 ? "rare" : "epic";
  };

  app.post("/api/sessions/:id/search", (req, res) => {
    const { target = "location", targetName = "", dangerLevel = 1 } = req.body || {};
    const key = target === "body" ? `body:${targetName}` : "location";
    let s = db.prepare("SELECT * FROM searches WHERE session_id = ? AND target = ?").get(req.params.id, key);
    if (s && s.count >= 1) {
      return res.json({ roll: 0, found: false, loot: [], tag: `[LOOT: уже обыскано]`, repeat: true });
    }
    const roll = Math.floor(Math.random() * 20) + 1;
    const tier = tierFor(roll, dangerLevel);
    const items = tier ? pickLoot(tier, target === "body" ? 2 : 2) : [];
    db.prepare("INSERT INTO searches (session_id, target, count) VALUES (?,?,1) ON CONFLICT(session_id, target) DO UPDATE SET count = count + 1")
      .run(req.params.id, key);
    const found = items.length > 0;
    const tag = found ? `[LOOT FOUND: ${items.join("; ")}]` : `[LOOT: ничего ценного (d20=${roll})]`;
    res.json({ roll, found, tier, loot: items, tag });
  });

  // --- Economy: таверна + магазин (сервер владеет золотом) ---
  const SHOP: { name: string; cost: number; desc: string }[] = [
    { name: "Зелье лечения (восстанавливает 5 HP)", cost: 15, desc: "Расходник" },
    { name: "Зелье стабильности (снимает 2 Стресса)", cost: 12, desc: "Расходник" },
    { name: "Кинжал гнева (+1 урон)", cost: 25, desc: "Оружие" },
    { name: "Связка верёвки (10 м)", cost: 8, desc: "Инструмент" },
    { name: "Потертая карта окрестностей", cost: 10, desc: "Открывает маршрут" },
    { name: "Фляга крепкого вина", cost: 5, desc: "Торговый предмет" },
  ];
  const REST_COST = 10;

  const parseHpNum = (hp: string) => {
    const m = String(hp || "").match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { cur: parseInt(m[1]), max: parseInt(m[2]) } : { cur: 0, max: 0 };
  };

  app.get("/api/shop", (req, res) => {
    res.json(SHOP);
  });

  app.post("/api/sessions/:id/economy", (req, res) => {
    const { action, charName, item } = req.body || {};
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "session not found" });
    const history = JSON.parse(row.history || "[]");
    const dashIdx = history.map((m: any) => m.dashboard ? 1 : 0).lastIndexOf(1);
    if (dashIdx < 0) return res.status(400).json({ error: "dashboard not found" });
    const dash = history[dashIdx].dashboard;

    // Сервисы текущей локации — сервер проверяет сам, аутентичность месту
    const curLoc = (dash.locations || []).find((l: any) => l.id === dash.currentLocationId);
    const services: string[] = curLoc?.services || [];
    const need = action === "buy" ? "market" : action === "inn" ? "inn" : action === "heal" ? "healer" : "tavern";
    if (!services.includes(need)) {
      return res.status(400).json({ error: "no service", tag: `[ECONOMY: здесь нет нужной услуги (${need}) — это ${curLoc?.name || "место"} без сервиса]` });
    }

    // Числа — из движкового состояния (State Authority)
    const chars = ensureEngineState(req.params.id);
    const st = chars[charName];
    if (!st) return res.status(404).json({ error: `character ${charName} not found` });
    const dashChar = (dash.characters || []).find((c: any) => c.name === charName);

    const finalize = () => {
      saveEngineState(req.params.id, chars);
      const merged = mergeStateIntoDashboard(dash, chars);
      history[dashIdx].dashboard = merged;
      db.prepare("UPDATE sessions SET history = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(history), req.params.id);
      broadcastToRoom(req.params.id, { type: "update", sessionId: req.params.id });
    };

    if (action === "rest") {
      if (st.gold < REST_COST) return res.status(400).json({ error: "not enough gold", tag: `[ECONOMY: у ${charName} не хватает золота (${st.gold}/${REST_COST})]` });
      st.gold -= REST_COST;
      st.hp_cur = st.hp_max;
      st.stress = Math.max(0, st.stress - 2);
      finalize();
      return res.json({ status: "ok", tag: `[ECONOMY: ${charName} отдохнул(а) в таверне — HP до ${st.hp_max}, стресс -2, списано ${REST_COST} золота]`, gold: st.gold });
    }
    if (action === "inn") {
      const INN_COST = 20;
      if (st.gold < INN_COST) return res.status(400).json({ error: "not enough gold", tag: `[ECONOMY: у ${charName} не хватает золота (${st.gold}/${INN_COST})]` });
      st.gold -= INN_COST;
      st.hp_cur = st.hp_max;
      st.stress = 0;
      finalize();
      return res.json({ status: "ok", tag: `[ECONOMY: ${charName} переночевал(а) на постоялом дворе — HP до ${st.hp_max}, стресс до 0, списано ${INN_COST} золота]`, gold: st.gold });
    }
    if (action === "heal") {
      const HEAL_COST = 12;
      const HEAL_AMOUNT = 5;
      if (st.gold < HEAL_COST) return res.status(400).json({ error: "not enough gold", tag: `[ECONOMY: у ${charName} не хватает золота (${st.gold}/${HEAL_COST})]` });
      if (st.hp_cur >= st.hp_max) return res.status(400).json({ error: "already full", tag: `[ECONOMY: ${charName} и так здоров(а)]` });
      st.gold -= HEAL_COST;
      st.hp_cur = Math.min(st.hp_max, st.hp_cur + HEAL_AMOUNT);
      finalize();
      return res.json({ status: "ok", tag: `[ECONOMY: ${charName} подлечился(лась) у лекаря — +${HEAL_AMOUNT} HP, списано ${HEAL_COST} золота]`, gold: st.gold });
    }
    if (action === "buy") {
      const good = SHOP.find(s => s.name === item);
      if (!good) return res.status(400).json({ error: "unknown item" });
      if (st.gold < good.cost) return res.status(400).json({ error: "not enough gold", tag: `[ECONOMY: у ${charName} не хватает золота (${st.gold}/${good.cost})]` });
      st.gold -= good.cost;
      if (dashChar) dashChar.inventory = [...(dashChar.inventory || []), good.name];
      finalize();
      return res.json({ status: "ok", tag: `[ECONOMY: ${charName} купил(а) «${good.name}» за ${good.cost} золота]`, gold: st.gold });
    }
    res.status(400).json({ error: "unknown action" });
  });

  // --- Engine State (State Authority: движок владеет числами) ---
  const ensureEngineState = (sessionId: string): any => {
    const row = db.prepare("SELECT * FROM engine_state WHERE session_id = ?").get(sessionId);
    if (row) return JSON.parse(row.characters);
    const sess = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId);
    if (sess) {
      const history = JSON.parse(sess.history || "[]");
      const dash = history.slice().reverse().find((m: any) => m.dashboard)?.dashboard;
      const chars: any = {};
      for (const c of (dash?.characters || [])) {
        const { cur, max } = parseHpNum(c.hp);
        chars[c.name] = { hp_cur: cur, hp_max: max, stress: Number(c.stress) || 0, gold: Number(c.gold) || 0, xp: Number(c.xp) || 0, tokens: Number(c.tokens) || 0 };
      }
      if (Object.keys(chars).length) {
        db.prepare("INSERT INTO engine_state (session_id, characters) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET characters=excluded.characters").run(sessionId, JSON.stringify(chars));
        return chars;
      }
    }
    return {};
  };
  const saveEngineState = (sessionId: string, chars: any) => {
    db.prepare("INSERT INTO engine_state (session_id, characters) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET characters=excluded.characters").run(sessionId, JSON.stringify(chars));
  };
  const stateToTag = (chars: any) =>
    Object.entries(chars).map(([name, c]: any) => `${name} HP ${c.hp_cur}/${c.hp_max}, Стресс ${c.stress}, Жетоны ${c.tokens}, Золото ${c.gold}, XP ${c.xp}`).join(" | ");
  const mergeStateIntoDashboard = (dash: any, chars: any) => {
    if (!dash || !Array.isArray(dash.characters)) return dash;
    dash.characters = dash.characters.map((c: any) => {
      const s = chars[c.name];
      if (!s) return c;
      return { ...c, hp: `${s.hp_cur}/${s.hp_max}`, stress: s.stress, gold: s.gold, xp: s.xp, tokens: s.tokens };
    });
    return dash;
  };
  const applyStateChanges = (chars: any, changes: any[]) => {
    const applied: any[] = [];
    for (const ch of changes || []) {
      const { field, name, delta } = ch;
      const c = chars[name];
      if (!c || typeof delta !== "number" || isNaN(delta)) continue;
      if (field === "hp") {
        const before = c.hp_cur;
        c.hp_cur = Math.max(0, Math.min(c.hp_max, c.hp_cur + delta));
        applied.push({ field, name, delta, from: before, to: c.hp_cur });
      } else if (["stress", "gold", "xp", "tokens"].includes(field)) {
        const before = c[field];
        c[field] = Math.max(0, c[field] + delta);
        applied.push({ field, name, delta, from: before, to: c[field] });
      }
    }
    return applied;
  };

  app.get("/api/sessions/:id/state", (req, res) => {
    const chars = ensureEngineState(req.params.id);
    res.json({ characters: chars, tag: `[STATE: ${stateToTag(chars)}]` });
  });

  app.post("/api/sessions/:id/state/apply", (req, res) => {
    const { changes = [], dashboard } = req.body || {};
    const chars = ensureEngineState(req.params.id);
    const applied = applyStateChanges(chars, changes);
    saveEngineState(req.params.id, chars);
    const merged = dashboard ? mergeStateIntoDashboard(dashboard, chars) : null;
    res.json({ characters: chars, applied, dashboard: merged, tag: `[STATE: ${stateToTag(chars)}]` });
  });

  // --- Idle: пассивный доход, пока игрока нет ---
  app.post("/api/sessions/:id/idle", (req, res) => {
    const row = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "session not found" });
    const history = JSON.parse(row.history || "[]");
    const dashIdx = history.map((m: any) => m.dashboard ? 1 : 0).lastIndexOf(1);
    const dash = dashIdx >= 0 ? history[dashIdx].dashboard : null;
    const pl = partyLevel(dash);

    const now = Date.now();
    const rec = db.prepare("SELECT * FROM idle WHERE session_id = ?").get(req.params.id);
    const last = rec ? new Date(rec.last_seen).getTime() : now;
    const hours = Math.min(12, Math.max(0, (now - last) / 3600000));
    db.prepare("INSERT INTO idle (session_id, last_seen) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(session_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP").run(req.params.id);

    const idleGold = Math.floor((2 + pl * 2) * hours);
    const doomUp = hours >= 6 ? 1 : 0;
    let changed = false;

    const chars = ensureEngineState(req.params.id);
    if (Object.keys(chars).length > 0 && idleGold > 0) {
      const per = Math.floor(idleGold / Object.keys(chars).length);
      for (const name of Object.keys(chars)) {
        chars[name].gold += per;
        chars[name].xp += per;
      }
      saveEngineState(req.params.id, chars);
      if (dash) {
        const merged = mergeStateIntoDashboard(dash, chars);
        history[dashIdx].dashboard = merged;
      }
      changed = true;
    }
    if (dash && doomUp) {
      dash.doomPool = Math.min(20, (Number(dash.doomPool) || 0) + doomUp);
      if (dashIdx >= 0) { history[dashIdx].dashboard = dash; }
      changed = true;
    }
    if (changed) {
      db.prepare("UPDATE sessions SET history = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(history), req.params.id);
      broadcastToRoom(req.params.id, { type: "update", sessionId: req.params.id });
    }
    const tag = idleGold > 0
      ? `[IDLE: пока тебя не было (${hours.toFixed(1)} ч), город принёс +${idleGold} золота и XP${doomUp ? ", Пул Рока +1" : ""}]`
      : doomUp ? `[IDLE: пока тебя не было, Пул Рока +1 — мир не ждал]` : "";
    res.json({ status: "ok", idleGold, doomUp, partyLevel: pl, hours: Number(hours.toFixed(1)), tag });
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
