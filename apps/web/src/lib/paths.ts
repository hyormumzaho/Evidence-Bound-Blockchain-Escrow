import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

function resolveFromCwd(raw: string, fallback: string): string {
  const value = raw.trim() || fallback;
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/** SQLite file path. DATABASE_URL may be `file:./data/web.sqlite` or a plain path. */
export function getDatabasePath(): string {
  const raw = process.env.DATABASE_URL ?? "file:./data/web.sqlite";
  const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  return resolveFromCwd(withoutScheme, "./data/web.sqlite");
}

export function getUploadDir(): string {
  const dir = resolveFromCwd(process.env.UPLOAD_DIR ?? "./data/uploads", "./data/uploads");
  mkdirSync(dir, { recursive: true });
  return dir;
}
