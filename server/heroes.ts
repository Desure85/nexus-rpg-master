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
  /** прошлые приключения героя (одна запись на партию) */
  story?: { session: string; title: string; world?: string; note?: string; at: string }[];
  /** пал в приключении — в новые партии не берётся */
  fallen?: boolean;
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
  `уровень ${v.level}, приключений за плечами: ${v.adventures}; способности: ${(v.abilities || []).map(a => a.name).join(", ") || "нет"}`
  + ((v.story || []).length ? `; прошлое: ${(v.story || []).slice(-3).map(e => `«${e.title}»${e.world ? ` (${e.world})` : ""}${e.note ? ` — ${e.note.slice(0, 120)}` : ""}`).join("; ")}` : "");

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


  /** Сколько денег герой уносит в следующее приключение: больше — оседает в «сундуке», чтобы ветеран не ломал экономику новой партии. */
  const HERO_GOLD_CARRY = 300;
  const STORY_MAX = 12;

  /**
   * Снимок героя в зал. Числа (опыт, деньги, max HP) — из состояния движка, а не из дашборда: правка дашборда не прокачает героя.
   * Способности, снаряжение и вещи — из дашборда; запись истории — одна на партию (обновляется, а не дублируется).
   */
  const syncHero = (userId: string, sessionId: string, charName: string, opts: { finished?: boolean } = {}) => {
    const row = db.prepare("SELECT name, history, config, archive FROM sessions WHERE id = ?").get(sessionId) as any;
    if (!row || !charName) return null;
    const history: any[] = JSON.parse(row.history || "[]");
    const dash = history.slice().reverse().find(m => m.dashboard)?.dashboard;
    const c = dash?.characters?.find((x: any) => x.name === charName);
    if (!c) return null;
    const config = JSON.parse(row.config || "{}");
    const startHero = (config.heroes || []).find((h: any) => h.name === charName);
    const eng = (() => { const e = db.prepare("SELECT characters FROM engine_state WHERE session_id = ?").get(sessionId) as any; return e ? JSON.parse(e.characters)[charName] : null; })();
    const existing = (startHero?.veteranId
      ? db.prepare("SELECT id, sheet, last_session FROM heroes WHERE id = ? AND user_id = ?").get(startHero.veteranId, userId)
      : db.prepare("SELECT id, sheet, last_session FROM heroes WHERE user_id = ? AND name = ?").get(userId, charName)) as any;
    const prev: HeroSheet | null = existing ? JSON.parse(existing.sheet) : null;
    const xp = Math.max(Number(eng?.xp ?? c.xp) || 0, prev?.xp || 0);
    const inMemorial = (() => { try { return !!db.prepare("SELECT 1 FROM memorial WHERE session_id = ? AND name = ?").get(sessionId, charName); } catch { return false; } })();
    const fallen = /погиб|мертв|мёртв|умер|пал в бою/i.test(String(c.condition || "")) || inMemorial;
    const summary = String((row.archive || "").split("# Итоги партии")[1] || "").replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim();
    const entry = { session: sessionId, title: String(row.name || "Приключение").slice(0, 80), ...(config.world?.title ? { world: String(config.world.title).slice(0, 80) } : {}), ...(summary ? { note: summary.slice(0, 200) } : {}), at: new Date().toISOString().slice(0, 10) };
    const story = [...(prev?.story || []).filter(e => e.session !== sessionId), entry].slice(-STORY_MAX);
    const sheet: HeroSheet = {
      name: charName,
      gender: startHero?.gender || prev?.gender || "М",
      concept: String(startHero?.concept || prev?.concept || c.goal || "").replace(/\s*\[[^\]]*\]/g, "").trim().slice(0, 300),
      archetype: c.archetype || startHero?.archetype || prev?.archetype,
      xp,
      hpMax: Math.max(Number(eng?.hp_max) || parseInt(String(c.hp).split("/")[1], 10) || 10, prev?.hpMax || 0),
      gold: Math.min(HERO_GOLD_CARRY, Math.max(0, Number(eng?.gold ?? c.gold) || 0)),
      abilities: (c.abilities || []).slice(0, 12),
      equipment: (c.equipment || []).slice(0, 8),
      inventory: (c.inventory || []).slice(0, 6),
      adventures: story.length,
      level: levelFromXp(xp),
      story,
      ...(fallen ? { fallen: true } : {}),
    };
    const id = existing?.id || crypto.randomUUID();
    db.prepare(`INSERT INTO heroes (id, user_id, name, sheet, last_session) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id, name) DO UPDATE SET sheet = excluded.sheet, last_session = excluded.last_session, updated_at = CURRENT_TIMESTAMP`)
      .run(id, userId, charName, JSON.stringify(sheet), sessionId);
    const achievements = sheet.adventures >= 3 ? unlock(userId, ["veteran"], sessionId) : [];
    void opts;
    return { hero: { id, ...sheet }, achievements };
  };

  /**
   * После хода: ветераны из зала обновляются сами (прогресс не теряется, даже если забыть нажать «в зал»);
   * в финале соло-партии (есть «Итоги партии») в зал уходят все герои мастера. Герои, которых взяли другие игроки, — их, не трогаем.
   */
  const autoSync = (sessionId: string) => {
    const row = db.prepare("SELECT created_by, config, archive, mode FROM sessions WHERE id = ?").get(sessionId) as any;
    if (!row?.created_by || row.mode === "tale") return [];
    const config = JSON.parse(row.config || "{}");
    if (config.tutorial) return [];
    const taken = new Set((db.prepare("SELECT char_name FROM claims WHERE session_id = ? AND status = 'approved'").all(sessionId) as any[]).map(r => r.char_name));
    const finished = /# Итоги партии/.test(row.archive || "");
    const names = (config.heroes || []).filter((h: any) => !taken.has(h.name) && (h.veteranId || finished)).map((h: any) => h.name);
    const saved = names.map((n: string) => syncHero(row.created_by, sessionId, n, { finished })).filter(Boolean);
    return saved.length ? [{ finished, count: saved.length }] : [];
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

    // Сохранить героя сессии в зал вручную (мастер)
    app.post("/api/sessions/:id/heroes/save", requireUser, (req: any, res) => {
      if (!req.isOwner) return res.status(403).json({ error: "owner_required" });
      const r = syncHero(req.auth.user.id, req.params.id, String(req.body?.charName || "").slice(0, 60));
      if (!r) return res.status(404).json({ error: "character_not_found" });
      res.json({ status: "ok", hero: r.hero, achievements: r.achievements });
    });
  };

  return { register, checkSession, getHero, unlock, syncHero, autoSync };
}
