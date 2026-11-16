import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getDeliveryForExport } from "@/lib/evidence/persist";
import { jsonError, requireSession, statusFromError } from "@/lib/http";
import type { EscrowVariant } from "@/lib/chain/abis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ variant: string; id: string; version: string }> };

/**
 * GET — evidence export JSON for escrow participants only (no public file access).
 * Bundle includes manifest, commitments/leaves, and Merkle proofs where applicable.
 */
export async function GET(request: Request, ctx: Ctx) {
  try {
    const { variant: variantRaw, id: idRaw, version: versionRaw } = await ctx.params;
    if (variantRaw !== "individual" && variantRaw !== "merkle") {
      return jsonError("Invalid variant", 400);
    }
    const variant = variantRaw as EscrowVariant;
    const escrowId = Number(idRaw);
    const deliveryVersion = Number(versionRaw);
    if (!Number.isInteger(escrowId) || escrowId <= 0) {
      return jsonError("Invalid escrow id", 400);
    }
    if (!Number.isInteger(deliveryVersion) || deliveryVersion < 1) {
      return jsonError("Invalid delivery version", 400);
    }

    const db = getDb();
    const { address } = requireSession(request, db);
    const packed = getDeliveryForExport(db, {
      variant,
      escrowId,
      deliveryVersion,
      sessionAddress: address,
    });
    if (!packed) {
      return jsonError("Delivery not found", 404);
    }

    return new NextResponse(packed.delivery.exportJson, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="evidence-${variant}-${escrowId}-v${deliveryVersion}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Export failed", statusFromError(err));
  }
}
