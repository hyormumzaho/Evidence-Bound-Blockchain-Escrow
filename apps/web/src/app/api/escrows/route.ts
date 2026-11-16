import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { listEscrowsForAddress } from "@/lib/escrow/persist";
import { jsonError, requireSession, statusFromError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/escrows — SQLite metadata for session participant (not chain authority). */
export async function GET(request: Request) {
  try {
    const db = getDb();
    const { address } = requireSession(request, db);
    const rows = listEscrowsForAddress(db, address);
    return NextResponse.json({
      address,
      escrows: rows.map((r) => ({
        escrowRowId: r.id,
        chainId: r.chainId,
        variant: r.variant,
        contractAddress: r.contractAddress,
        escrowId: r.escrowId,
        payer: r.payer,
        provider: r.provider,
        arbitrator: r.arbitrator,
        agreementHash: r.agreementHash,
        createdTx: r.createdTx,
        stateCache: r.stateCache,
        createdAt: r.createdAt,
        roomPath: r.escrowId !== null ? `/escrow/${r.variant}/${r.escrowId}` : null,
      })),
      note: "SQLite is metadata only. Refresh on-chain state before money actions.",
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "List failed", statusFromError(err));
  }
}
