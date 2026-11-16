import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getEscrowRoom } from "@/lib/escrow/persist";
import { listDeliveriesForEscrow } from "@/lib/evidence/persist";
import { jsonError, requireSession, statusFromError } from "@/lib/http";
import type { EscrowVariant } from "@/lib/chain/abis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ variant: string; id: string }> };

/** GET — list persisted deliveries for this escrow (participants only). */
export async function GET(request: Request, ctx: Ctx) {
  try {
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
    const room = getEscrowRoom(db, variant, escrowId, address);
    if (!room) return jsonError("Escrow not found in SQLite", 404);

    const deliveries = listDeliveriesForEscrow(db, room.row.id);
    return NextResponse.json({
      escrowRowId: room.row.id,
      deliveries: deliveries.map((d) => ({
        ...d,
        exportPath: `/api/escrows/${variant}/${escrowId}/evidence/${d.deliveryVersion}/export`,
      })),
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "List failed", statusFromError(err));
  }
}
