import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getDb } from "@/lib/db/client";
import { verifySiweSignature } from "@/lib/auth/siwe";
import { createSession, sessionCookieHeader } from "@/lib/auth/session";
import { verifyBodySchema } from "@/lib/validation/auth";
import { assertSameOrigin, jsonError, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/auth/verify { message, signature } → session cookie */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = verifyBodySchema.parse(await request.json());
    const db = getDb();
    const { address } = await verifySiweSignature(db, body.message, body.signature as Hex);
    const session = createSession(db, address);
    const res = NextResponse.json({
      ok: true,
      address: session.address,
      expiresAt: session.expiresAt,
    });
    res.headers.set("Set-Cookie", sessionCookieHeader(session.id, session.expiresAt));
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verify failed";
    const status = msg.includes("signature") || msg.includes("nonce") || msg.includes("SIWE") || msg.includes("expired")
      ? 401
      : statusFromError(err);
    return jsonError(msg, status);
  }
}
