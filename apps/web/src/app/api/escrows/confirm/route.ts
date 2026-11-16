import { NextResponse } from "next/server";
import type { Hex } from "viem";
import type { AgreementDocument } from "@evidencebound/shared";
import { getDb } from "@/lib/db/client";
import { confirmCreateEscrow } from "@/lib/escrow/persist";
import { confirmEscrowBodySchema } from "@/lib/validation/escrow";
import { assertSameOrigin, jsonError, requireSession, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/escrows/confirm — persist after createEscrow using receipt event (not browser escrowId). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const db = getDb();
    const { address } = requireSession(request, db);
    const body = confirmEscrowBodySchema.parse(await request.json());
    const result = await confirmCreateEscrow(db, {
      variant: body.variant,
      txHash: body.txHash as Hex,
      agreement: body.agreement as AgreementDocument,
      sessionAddress: address,
      stagingRowId: body.stagingRowId,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      roomPath: `/escrow/${result.variant}/${result.escrowId}`,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Confirm failed", statusFromError(err));
  }
}
