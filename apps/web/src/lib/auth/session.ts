import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { AppDb } from "@/lib/db/client";
import { sessions } from "@/lib/db/schema";

export const SESSION_COOKIE = "eb_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function createSession(db: AppDb, addressRaw: string): { id: string; address: Address; expiresAt: number } {
  const address = getAddress(addressRaw);
  const id = randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  db.delete(sessions).where(lt(sessions.expiresAt, now)).run();

  db.insert(sessions)
    .values({
      id,
      address: address.toLowerCase(),
      expiresAt,
      createdAt: now,
    })
    .run();

  return { id, address, expiresAt };
}

export function getSession(db: AppDb, sessionId: string | undefined | null): { id: string; address: Address } | null {
  if (!sessionId || !/^[a-f0-9]{48}$/.test(sessionId)) return null;
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) return null;
  if (row.expiresAt < Date.now()) {
    db.delete(sessions).where(eq(sessions.id, sessionId)).run();
    return null;
  }
  return { id: row.id, address: getAddress(row.address) };
}

export function destroySession(db: AppDb, sessionId: string | undefined | null): void {
  if (!sessionId) return;
  db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

export function sessionCookieHeader(sessionId: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx);
    if (name === SESSION_COOKIE) return part.slice(eqIdx + 1);
  }
  return null;
}
