// Синхронная обёртка над sql.js с API better-sqlite3 (в объёме, который использует сервер).
import type { SqlJsStatic, Database as SqlDb } from 'sql.js';

let SQL: SqlJsStatic | null = null;
let initialData: Uint8Array | null = null;
export function setSqlJs(mod: SqlJsStatic, data?: Uint8Array | null) { SQL = mod; initialData = data ?? null; }

let dirty = false;
export const takeDirty = () => { const d = dirty; dirty = false; return d; };

const norm = (args: any[]) => (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map(v =>
  v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

class Statement {
  constructor(private db: SqlDb, private sql: string) {}
  private exec(args: any[], one: boolean) {
    const st = this.db.prepare(this.sql);
    try {
      st.bind(norm(args));
      const rows: any[] = [];
      while (st.step()) { rows.push(st.getAsObject()); if (one) break; }
      return rows;
    } finally { st.free(); }
  }
  run(...args: any[]) {
    const st = this.db.prepare(this.sql);
    try { st.bind(norm(args)); st.step(); } finally { st.free(); }
    dirty = true;
    return { changes: this.db.getRowsModified(), lastInsertRowid: 0 };
  }
  get(...args: any[]) { return this.exec(args, true)[0]; }
  all(...args: any[]) { return this.exec(args, false); }
}

class Database {
  private db: SqlDb;
  private depth = 0;
  constructor(_path?: string) {
    if (!SQL) throw new Error('sql.js не инициализирован');
    this.db = initialData ? new SQL.Database(initialData) : new SQL.Database();
    initialData = null;
  }
  prepare(sql: string) { return new Statement(this.db, sql); }
  exec(sql: string) { this.db.exec(sql); dirty = true; return this; }
  pragma(s: string) { if (!/journal_mode|busy_timeout|synchronous/i.test(s)) this.db.exec(`PRAGMA ${s}`); return []; }
  transaction<T extends (...a: any[]) => any>(fn: T): T {
    return ((...a: any[]) => {
      const sp = `sp${this.depth++}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      try { const r = fn(...a); this.db.exec(`RELEASE ${sp}`); return r; }
      catch (e) { this.db.exec(`ROLLBACK TO ${sp}`); this.db.exec(`RELEASE ${sp}`); throw e; }
      finally { this.depth--; dirty = true; }
    }) as T;
  }
  export() { return this.db.export(); }
  close() { /* в демо БД живёт всё время вкладки */ }
}

namespace Database { export type Database = InstanceType<typeof Database>; }
export default Database;
