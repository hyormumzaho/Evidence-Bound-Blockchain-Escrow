import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDatabasePath } from "@/lib/paths";
import * as schema from "./schema";
import { runMigrations } from "./migrate";

export type AppDb = ReturnType<typeof createDb>;

let cached: AppDb | null = null;

function createDb(dbPath = getDatabasePath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  runMigrations(sqlite);
  return db;
}

/** Singleton for Next.js server runtime. Tests may call `createTestDb`. */
export function getDb(): AppDb {
  if (!cached) cached = createDb();
  return cached;
}

export function createTestDb(dbPath: string): AppDb {
  return createDb(dbPath);
}

export function resetDbCache(): void {
  cached = null;
}
