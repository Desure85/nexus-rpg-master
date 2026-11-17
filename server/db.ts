import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

const addColumn = (db: DB, table: string, column: string, ddl: string) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
};

export function openDatabase(dbPath: string): DB {
  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
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
    CREATE TABLE IF NOT EXISTS bases (
      session_id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      bedroom INTEGER DEFAULT 0,
      treasury INTEGER DEFAULT 0,
      barracks INTEGER DEFAULT 0,
      trophy_hall INTEGER DEFAULT 0,
      armory INTEGER DEFAULT 0,
      garden INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS collection (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      desc TEXT DEFAULT '',
      type TEXT DEFAULT 'trophy',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fronts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      impulse TEXT DEFAULT '',
      portents TEXT NOT NULL,
      portent_index INTEGER DEFAULT 0,
      doom TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS memorial (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      desc TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumn(db, "sessions", "codex", "codex TEXT");
  addColumn(db, "sessions", "archive", "archive TEXT");
  addColumn(db, "sessions", "decision_tree", "decision_tree TEXT");
  addColumn(db, "sessions", "mode", "mode TEXT DEFAULT 'short'");
  addColumn(db, "sessions", "owner_hash", "owner_hash TEXT");
  addColumn(db, "sessions", "config", "config TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_hash);
    CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
    CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_actions(session_id);
    CREATE INDEX IF NOT EXISTS idx_expeditions_session ON expeditions(session_id);
    CREATE INDEX IF NOT EXISTS idx_collection_session ON collection(session_id);
    CREATE INDEX IF NOT EXISTS idx_fronts_session ON fronts(session_id);
    CREATE INDEX IF NOT EXISTS idx_memorial_session ON memorial(session_id);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
  `);
}

const SESSION_TABLES = ["claims", "pending_actions", "pacing", "searches", "idle", "expeditions", "engine_state", "bases", "collection", "fronts", "memorial", "logs"];

export function deleteSessionCascade(db: DB, sessionId: string) {
  db.transaction(() => {
    for (const t of SESSION_TABLES) db.prepare(`DELETE FROM ${t} WHERE session_id = ?`).run(sessionId);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  })();
}
