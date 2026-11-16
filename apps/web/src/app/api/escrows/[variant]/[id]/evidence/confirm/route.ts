import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { getDb } from "@/lib/db/client";
import { confirmDeliverySubmission } from "@/lib/evidence/persist";
import { confirmEvidenceBodySchema } from "@/lib/validation/evidence";
import { assertSameOrigin, jsonError, requireSession, statusFromError } from "@/lib/http";
import type { EscrowVariant } from "@/lib/chain/abis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ variant: string; id: string }> };

/** POST — persist evidence after submitDelivery receipt (idempotent). */
export async function POST(request: Request, ctx: Ctx) {
  try {
    assertSameOrigin(request);
    const { variant: variantRaw, id: idRaw } = await ctx.params;
    if (variantRaw !== "individual" && variantRaw !== "merkle") {
      return jsonError("Invalid variant", 400);
    }
    const variant = variantRaw as EscrowVariant;
    const escrowId = Number(idRaw);
    if (!Number.isInteger(escrowId) || escrowId <= 0) {
      return jsonError("Invalid escrow id", 400);
    }

    const db = getDb();
    const { address } = requireSession(request, db);
    const body = confirmEvidenceBodySchema.parse(await request.json());

    const result = await confirmDeliverySubmission(db, {
      variant,
      escrowId,
      txHash: body.txHash as Hex,
      items: body.items as Parameters<typeof confirmDeliverySubmission>[1]["items"],
      sessionAddress: address,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      exportPath: `/api/escrows/${variant}/${escrowId}/evidence/${result.deliveryVersion}/export`,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Confirm failed", statusFromError(err));
  }
}
