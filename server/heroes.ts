// Зал героев (ветераны переходят из игры в игру) и достижения игрока.
import crypto from "crypto";
import type { Express } from "express";
import type { DB } from "./db";
import { levelFromXp } from "../shared/rules";
import { ACHIEVEMENTS } from "../shared/achievements";

export interface HeroSheet {
  name: string; gender: string; concept: string; archetype?: string;
  xp: number; hpMax: number; gold: number;
  abilities: any[]; equipment: any[]; inventory: any[];
  adventures: number; level: number;
}

/** Ветеран приходит со своим опытом, способностями и вещами (здоровье — полное, стресс снят). */
export function applyVeteran(c: any, v: HeroSheet) {
  return {
    ...c,
    hp: `${v.hpMax}/${v.hpMax}`,
    xp: v.xp,
    gold: v.gold,
    stress: 0,
    archetype: v.archetype || c.archetype,
    abilities: v.abilities?.length ? v.abilities : c.abilities,
    equipment: v.equipment?.length ? v.equipment : c.equipment,
    inventory: (v.inventory || []).slice(0, 6),
  };
}

export const veteranLine = (v: HeroSheet) =>
  `уровень ${v.level}, приключений за плечами: ${v.adventures}; способности: ${(v.abilities || []).map(a => a.name).join(", ") || "нет"}`;

const num = (v: unknown) => parseInt(String(v ?? "").split("/")[0], 10) || 0;

export function createHeroes(db: DB, broadcast: (room: string, data: any) => void) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS heroes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sheet TEXT NOT NULL,
      last_session TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    );
    CREATE TABLE IF NOT EXISTS achievements (
      user_id TEXT NOT NULL,
      code TEXT NOT NULL,
      session_id TEXT,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, code)
    );
  `);

  const getHero = (userId: string, id: string): HeroSheet & { id: string } | null => {
    const r = db.prepare("SELECT * FROM heroes WHERE id = ? AND user_id = ?").get(id, userId) as any;
    return r ? { id: r.id, ...JSON.parse(r.sheet) } : null;
  };

  const unlock = (userId: string, codes: string[], sessionId: string | null) => {
    const fresh: string[] = [];
    for (const code of codes) {
      const r = db.prepare("INSERT OR IGNORE INTO achievements (user_id, code, session_id) VALUES (?,?,?)").run(userId, code, sessionId);
      if (r.changes) fresh.push(code);
    }
    if (fresh.length && sessionId) broadcast(sessionId, { type: "achievement", sessionId, codes: fresh });
    return fresh;
  };

  /** После хода: проверяем достижения по состоянию сессии (идемпотентно). */
  const checkSession = (sessionId: string) => {
    const row = db.prepare("SELECT history, created_by, mode, config FROM sessions WHERE id = ?").get(sessionId) as any;
    if (!row?.created_by) return;
    const history: any[] = JSON.parse(row.history || "[]");
    const config = JSON.parse(row.config || "{}");
    const text = history.filter(m => m.role === "user").map(m => m.content).join("\n");
    const dashes = history.filter(m => m.dashboard).map(m => m.dashboard);
    const last = dashes[dashes.length - 1] || {};
    const codes: string[] = [];
    if (/→ КРИТ\. УСПЕХ/.test(text)) codes.push("crit");
    if (/Спасбросок: стабилизирован/.test(text)) codes.push("survivor");
    const chars: any[] = last.characters || [];
    const maxLevel = Math.max(0, ...chars.map(c => levelFromXp(Number(c.xp) || 0)));
    if (maxLevel >= 3) codes.push("level3");
    if (maxLevel >= 5) codes.push("level5");
    if (chars.some(c => (Number(c.gold) || 0) >= 100)) codes.push("rich");
    if ((last.locations || []).filter((l: any) => l.status === "visited").length >= 5) codes.push("explorer");
    if ((last.quests || []).some((q: any) => q.status === "done")) codes.push("quester");
    // победа: угроза была на сцене и ушла с 0 HP (или исчезла после удара)
    for (let i = 1; i < dashes.length; i++) {
      const before = dashes[i - 1].threats || [];
      const after = dashes[i].threats || [];
      if (before.some((t: any) => num(t.hp) > 0 && (after.find((x: any) => x.name === t.name) ? num(after.find((x: any) => x.name === t.name).hp) <= 0 : true))) { codes.push("first_blood"); break; }
    }
    if (row.mode === "tale" && config.tale?.finished) codes.push("storyteller");
    if (config.daily && /\[(SESSION SUMMARY|FINALE)\]/.test(text) && history[history.length - 1]?.role === "assistant") codes.push("daily");
    if (history.filter(m => m.role === "assistant").length >= 30) codes.push("saga");
    if (history.some(m => m.role === "user" && (m.content.match(/\[PLAYER ACTION:/g) || []).length >= 2)) codes.push("fellowship");
    unlock(row.created_by, codes.filter(c => ACHIEVEMENTS.some(a => a.code === c)), sessionId);
  };

  const register = (app: Express, requireUser: any) => {
    app.get("/api/heroes", requireUser, (req: any, res) => {
      const rows = db.prepare("SELECT id, sheet, updated_at FROM heroes WHERE user_id = ? ORDER BY updated_at DESC").all(req.auth.user.id) as any[];
      res.json(rows.map(r => ({ id: r.id, updated_at: r.updated_at, ...JSON.parse(r.sheet) })));
    });

    app.delete("/api/heroes/:hid", requireUser, (req: any, res) => {
      db.prepare("DELETE FROM heroes WHERE id = ? AND user_id = ?").run(req.params.hid, req.auth.user.id);
      res.json({ status: "ok" });
    });

    app.get("/api/achievements", requireUser, (req: any, res) => {
      const got = db.prepare("SELECT code, unlocked_at FROM achievements WHERE user_id = ?").all(req.auth.user.id) as any[];
      res.json(ACHIEVEMENTS.map(a => ({ ...a, unlocked_at: got.find(g => g.code === a.code)?.unlocked_at || null })));
    });

    // Сохранить героя сессии в зал: снимок листа + число пройденных приключений
    app.post("/api/sessions/:id/heroes/save", requireUser, (req: any, res) => {
      if (!req.isOwner) return res.status(403).json({ error: "owner_required" });
      const charName = String(req.body?.charName || "").slice(0, 60);
      const row = db.prepare("SELECT history, config FROM sessions WHERE id = ?").get(req.params.id) as any;
      const history: any[] = JSON.parse(row?.history || "[]");
      const dash = history.slice().reverse().find(m => m.dashboard)?.dashboard;
      const c = dash?.characters?.find((x: any) => x.name === charName);
      if (!c) return res.status(404).json({ error: "character_not_found" });
      const startHero = (JSON.parse(row.config || "{}").heroes || []).find((h: any) => h.name === charName);
      const existing = db.prepare("SELECT id, sheet, last_session FROM heroes WHERE user_id = ? AND name = ?").get(req.auth.user.id, charName) as any;
      const prev: HeroSheet | null = existing ? JSON.parse(existing.sheet) : null;
      const xp = Number(c.xp) || 0;
      const sheet: HeroSheet = {
        name: charName,
        gender: startHero?.gender || prev?.gender || "М",
        concept: String(c.goal || prev?.concept || "").replace(/\s*\[[^\]]*\]/g, "").trim(),
        archetype: c.archetype || startHero?.archetype || prev?.archetype,
        xp,
        hpMax: parseInt(String(c.hp).split("/")[1], 10) || prev?.hpMax || 10,
        gold: Number(c.gold) || 0,
        abilities: c.abilities || [],
        equipment: c.equipment || [],
        inventory: (c.inventory || []).slice(0, 6),
        adventures: (prev?.adventures || 0) + (existing?.last_session === req.params.id ? 0 : 1),
        level: levelFromXp(xp),
      };
      const id = existing?.id || crypto.randomUUID();
      db.prepare(`INSERT INTO heroes (id, user_id, name, sheet, last_session) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id, name) DO UPDATE SET sheet = excluded.sheet, last_session = excluded.last_session, updated_at = CURRENT_TIMESTAMP`)
        .run(id, req.auth.user.id, charName, JSON.stringify(sheet), req.params.id);
      const fresh = sheet.adventures >= 3 ? unlock(req.auth.user.id, ["veteran"], req.params.id) : [];
      res.json({ status: "ok", hero: { id, ...sheet }, achievements: fresh });
    });
  };

  return { register, checkSession, getHero, unlock };
}
