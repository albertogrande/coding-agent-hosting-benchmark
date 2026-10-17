/**
 * The only place a database driver is named.
 *
 * Everything above this file talks to Drizzle, so moving from a local SQLite file to a
 * hosted Postgres or libSQL is a dialect swap here plus a schema regeneration — not a
 * rewrite of the app. That boundary is why the hosting decision can stay open.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import * as schema from "./schema";

export type Db = ReturnType<typeof create>;

function create(file: string) {
  const sqlite = new Database(file);
  // WAL keeps the UI readable while a wave writes; foreign keys are off by default in
  // SQLite, and every cascade in the schema depends on them being on.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

let cached: Db | undefined;

/** The app's database. `AEO_DB` overrides the path; tests pass ":memory:". */
export function db(): Db {
  if (!cached) {
    const file = process.env.AEO_DB ?? path.join(process.cwd(), "data", "aeo.db");
    cached = create(file);
    migrateTo(cached);
  }
  return cached;
}

/** A throwaway database, migrated and empty. Used by every test that touches storage. */
export function testDb(): Db {
  const d = create(":memory:");
  migrateTo(d);
  return d;
}

function migrateTo(d: Db) {
  migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") });
}

export { schema };
