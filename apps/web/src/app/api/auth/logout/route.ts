import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { clearSessionCookieHeader, destroySession, readSessionIdFromCookie } from "@/lib/auth/session";
import { assertSameOrigin, jsonError, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const sessionId = readSessionIdFromCookie(request.headers.get("cookie"));
    destroySession(getDb(), sessionId);
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", clearSessionCookieHeader());
    return res;
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Logout failed", statusFromError(err));
  }
}
