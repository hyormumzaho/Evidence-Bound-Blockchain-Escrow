import { eq } from "drizzle-orm";
import { getAddress, type Address } from "viem";
import type { AppDb } from "@/lib/db/client";
import { escrows, files } from "@/lib/db/schema";

export function isParticipant(
  row: { payer: string; provider: string; arbitrator: string },
  address: Address,
): boolean {
  const a = address.toLowerCase();
  return (
    row.payer.toLowerCase() === a ||
    row.provider.toLowerCase() === a ||
    row.arbitrator.toLowerCase() === a
  );
}

export function requireEscrowAccess(db: AppDb, escrowRowId: number, address: Address) {
  const row = db.select().from(escrows).where(eq(escrows.id, escrowRowId)).get();
  if (!row) {
    throw new Error("Escrow row not found");
  }
  if (!isParticipant(row, address)) {
    throw new Error("Forbidden: not an escrow participant");
  }
  return row;
}

export function requireFileAccess(db: AppDb, storageKey: string, address: Address) {
  const file = db.select().from(files).where(eq(files.storageKey, storageKey)).get();
  if (!file) {
    throw new Error("File not found");
  }
  const row = requireEscrowAccess(db, file.escrowRowId, address);
  return { file, escrow: row };
}

export function normalizeAddress(address: string): Address {
  return getAddress(address);
}
