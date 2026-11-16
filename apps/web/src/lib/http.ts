import { NextResponse } from "next/server";
import type { AppDb } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { getSession, readSessionIdFromCookie } from "@/lib/auth/session";
import type { Address } from "viem";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function requireSession(
  request: Request,
  db: AppDb = getDb(),
): { address: Address; sessionId: string } {
  const sessionId = readSessionIdFromCookie(request.headers.get("cookie"));
  const session = getSession(db, sessionId);
  if (!session) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return { address: session.address, sessionId: session.id };
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin navigations / curl without Origin
  const host = request.headers.get("host");
  if (!host) return;
  try {
    const o = new URL(origin);
    if (o.host !== host) {
      throw Object.assign(new Error("CSRF: origin mismatch"), { status: 403 });
    }
  } catch (err) {
    if ((err as { status?: number }).status) throw err;
    throw Object.assign(new Error("CSRF: invalid origin"), { status: 403 });
  }
}

export function statusFromError(err: unknown): number {
  if (err && typeof err === "object" && "status" in err && typeof (err as { status: unknown }).status === "number") {
    return (err as { status: number }).status;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("Unauthorized") || msg.includes("session")) return 401;
  if (msg.includes("Forbidden")) return 403;
  if (msg.includes("not found") || msg.includes("File not found")) return 404;
  if (msg.includes("immutable") || msg.includes("already persisted") || msg.includes("already bound")) {
    return 409;
  }
  if (msg.includes("mismatch") || msg.includes("exceed") || msg.includes("Invalid") || msg.includes("rejected") || msg.includes("Empty")) {
    return 400;
  }
  if (msg.includes("traversal")) return 400;
  return 500;
}
