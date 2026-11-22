import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getEscrowRoom } from "@/lib/escrow/persist";
import { createAnvilPublicClient } from "@/lib/chain/client";
import { escrowAbi, isEscrowVariant } from "@/lib/chain/abis";
import { addressForVariant } from "@/lib/chain/addresses";
import { jsonError, requireSession, statusFromError } from "@/lib/http";
import { jsonSafe } from "@/lib/json/safe";
import type { Address } from "viem";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ variant: string; id: string }> };

export async function GET(request: Request, ctx: Ctx) {
  try {
    const { variant: variantRaw, id: idRaw } = await ctx.params;
    if (!isEscrowVariant(variantRaw)) {
      return jsonError("Invalid variant", 400);
    }
    const variant = variantRaw;
    const escrowId = Number(idRaw);
    if (!Number.isInteger(escrowId) || escrowId <= 0) {
      return jsonError("Invalid escrow id", 400);
    }

    const db = getDb();
    const { address } = requireSession(request, db);
    const room = getEscrowRoom(db, variant, escrowId, address);
    if (!room) return jsonError("Escrow not found in SQLite", 404);

    const contract = addressForVariant(variant);

    let onChain: unknown = null;
    if (contract) {
      try {
        const client = createAnvilPublicClient();
        // getEscrow returns uint256/uint64 as bigint — must convert before NextResponse.json.
        onChain = jsonSafe(
          await client.readContract({
            address: contract,
            abi: escrowAbi(variant),
            functionName: "getEscrow",
            args: [BigInt(escrowId)],
          }),
        );
      } catch {
        onChain = { error: "Failed to read getEscrow (redeploy / orphan possible)" };
      }
    }

    return NextResponse.json({
      metadata: room.row,
      agreement: room.agreement
        ? {
            agreementHash: room.agreement.agreementHash,
            canonicalJson: room.agreement.canonicalJson,
          }
        : null,
      onChain,
      note: "Chain getEscrow is authoritative for state and money.",
      viewer: address as Address,
    });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Load failed", statusFromError(err));
  }
}
