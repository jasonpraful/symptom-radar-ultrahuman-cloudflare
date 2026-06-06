/**
 * Minimal D1Database adapter backed by Node's built-in `node:sqlite`, used as a
 * test double so the *real* Worker code (db.ts, report.ts, backfill.ts,
 * pipeline.ts) can run under vitest against genuine SQLite semantics — identical
 * to Cloudflare D1 (also SQLite).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Loaded via createRequire (not a static `import`) so bundlers/Vite don't try to
// resolve the experimental `node:sqlite` builtin at transform time.
const require = createRequire(import.meta.url);
type DatabaseSync = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
    get(...p: unknown[]): unknown;
  };
};
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

class NodeD1PreparedStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): NodeD1PreparedStatement {
    return new NodeD1PreparedStatement(this.db, this.sql, params);
  }

  private norm(p: unknown[]): (string | number | bigint | null | Uint8Array)[] {
    return p.map((v) =>
      v === null || v === undefined ? null : (v as string | number),
    );
  }

  async run(): Promise<{ success: boolean }> {
    this.db.prepare(this.sql).run(...this.norm(this.params));
    return { success: true };
  }

  async all<T = unknown>(): Promise<{ results: T[]; success: boolean }> {
    const rows = this.db.prepare(this.sql).all(...this.norm(this.params)) as T[];
    return { results: rows, success: true };
  }

  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.norm(this.params));
    return (row as T) ?? null;
  }
}

export class NodeD1Database {
  private db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
  }
  applyMigration(file: string): void {
    this.db.exec(readFileSync(file, "utf8"));
  }
  exec(sql: string): void {
    this.db.exec(sql);
  }
  prepare(sql: string): NodeD1PreparedStatement {
    return new NodeD1PreparedStatement(this.db, sql);
  }
}

/** Construct a D1-typed database backed by node:sqlite, with the schema applied. */
export function makeD1(migrationFile: string, path = ":memory:"): D1Database {
  const d1 = new NodeD1Database(path);
  d1.applyMigration(migrationFile);
  return d1 as unknown as D1Database;
}
