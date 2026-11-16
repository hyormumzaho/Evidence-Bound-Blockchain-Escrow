import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { createStagingEscrow } from "@/lib/uploads/service";
import { stagingBodySchema } from "@/lib/validation/uploads";
import { assertSameOrigin, jsonError, requireSession, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/escrows/staging
 * Minimal pre-createEscrow row so uploads can bind to participants.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    const { address } = requireSession(request, db);
    const body = stagingBodySchema.parse(await request.json());
    const row = createStagingEscrow(db, {
      ...body,
      creator: address,
    });
    return NextResponse.json({
      escrowRowId: row.id,
      isStaging: true,
      note: "SQLite staging only — not on-chain truth.",
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Staging failed", statusFromError(err));
  }
}
