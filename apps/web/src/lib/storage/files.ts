import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { getUploadDir } from "@/lib/paths";

const STORAGE_KEY_RE = /^[a-f0-9]{32}$/;

export function newStorageKey(): string {
  return randomBytes(16).toString("hex");
}

export function assertSafeStorageKey(storageKey: string): string {
  if (!STORAGE_KEY_RE.test(storageKey)) {
    throw new Error("Invalid storage key");
  }
  if (storageKey.includes("..") || storageKey.includes("/") || storageKey.includes("\\") || storageKey.includes("\0")) {
    throw new Error("Invalid storage key");
  }
  return storageKey;
}

/** Resolve path under upload dir; reject traversal. */
export function resolveUploadPath(storageKey: string, uploadDir = getUploadDir()): string {
  const key = assertSafeStorageKey(storageKey);
  const root = resolve(uploadDir);
  const full = resolve(root, key);
  if (full !== join(root, key) && !full.startsWith(root + sep) && full !== root) {
    throw new Error("Path traversal rejected");
  }
  if (!full.startsWith(root + sep) && full !== root) {
    throw new Error("Path traversal rejected");
  }
  return full;
}

export function writeUploadBytes(storageKey: string, bytes: Uint8Array, uploadDir = getUploadDir()): string {
  mkdirSync(uploadDir, { recursive: true });
  const path = resolveUploadPath(storageKey, uploadDir);
  writeFileSync(path, bytes);
  return path;
}

export function readUploadBytes(storageKey: string, uploadDir = getUploadDir()): Buffer {
  const path = resolveUploadPath(storageKey, uploadDir);
  if (!existsSync(path)) {
    throw new Error("File not found");
  }
  return readFileSync(path);
}

export function deleteUploadBytes(storageKey: string, uploadDir = getUploadDir()): void {
  try {
    const path = resolveUploadPath(storageKey, uploadDir);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
}

/** Relative path stored in DB (never absolute host paths). */
export function relativeUploadPath(storageKey: string): string {
  return assertSafeStorageKey(storageKey);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
