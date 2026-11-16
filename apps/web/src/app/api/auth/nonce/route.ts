import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { issueNonce } from "@/lib/auth/siwe";
import { nonceQuerySchema } from "@/lib/validation/auth";
import { jsonError, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/auth/nonce?address=0x... */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = nonceQuerySchema.safeParse({ address: url.searchParams.get("address") });
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid address", 400);
    }
    const issued = await issueNonce(getDb(), parsed.data.address);
    return NextResponse.json({
      address: issued.address,
      nonce: issued.nonce,
      expiresAt: issued.expiresAt,
      message: issued.message,
      chainId: 31337,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Nonce failed", statusFromError(err));
  }
}
