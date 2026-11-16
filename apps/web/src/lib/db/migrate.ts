import type Database from "better-sqlite3";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Apply committed SQL migrations in order (idempotent via drizzle-style journal table). */
export function runMigrations(sqlite: Database.Database, migrationsDir?: string): void {
  const besideModule = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const dir =
    migrationsDir ??
    (existsSync(besideModule) ? besideModule : join(process.cwd(), "src/lib/db/migrations"));

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  if (!existsSync(dir)) return;

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = file;
    const already = sqlite.prepare("SELECT 1 FROM __migrations WHERE id = ?").get(id);
    if (already) continue;
    const sql = readFileSync(join(dir, file), "utf8");
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare("INSERT INTO __migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
    });
    tx();
  }
}
