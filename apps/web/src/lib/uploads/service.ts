import { hashFileBytes } from "@evidencebound/evidence";
import { eq, sum } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { AppDb } from "@/lib/db/client";
import { escrows, files } from "@/lib/db/schema";
import { requireEscrowAccess } from "@/lib/auth/access";
import { MAX_DELIVERY_BYTES, MAX_FILE_BYTES } from "@/lib/storage/limits";
import {
  deleteUploadBytes,
  newStorageKey,
  relativeUploadPath,
  writeUploadBytes,
  readUploadBytes,
  assertSafeStorageKey,
} from "@/lib/storage/files";

export function createStagingEscrow(
  db: AppDb,
  input: {
    chainId: number;
    variant: "individual" | "manifest" | "merkle";
    contractAddress: string;
    payer: string;
    provider: string;
    arbitrator: string;
    creator: Address;
  },
) {
  const creator = input.creator.toLowerCase();
  const roles = [input.payer, input.provider, input.arbitrator].map((a) => a.toLowerCase());
  if (!roles.includes(creator)) {
    throw new Error("Creator must be payer, provider, or arbitrator");
  }

  const result = db
    .insert(escrows)
    .values({
      chainId: input.chainId,
      variant: input.variant,
      contractAddress: input.contractAddress.toLowerCase(),
      escrowId: null,
      payer: input.payer.toLowerCase(),
      provider: input.provider.toLowerCase(),
      arbitrator: input.arbitrator.toLowerCase(),
      agreementHash: "",
      templateHash: "",
      isStaging: true,
      createdAt: Date.now(),
    })
    .returning({ id: escrows.id })
    .get();

  return result;
}

export function totalBytesForEscrow(db: AppDb, escrowRowId: number): number {
  const row = db
    .select({ total: sum(files.byteLength) })
    .from(files)
    .where(eq(files.escrowRowId, escrowRowId))
    .get();
  return Number(row?.total ?? 0);
}

export function storeUpload(
  db: AppDb,
  input: {
    escrowRowId: number;
    uploader: Address;
    bytes: Uint8Array;
    expectedContentHash?: Hex;
    originalFilename?: string;
    uploadDir?: string;
  },
) {
  requireEscrowAccess(db, input.escrowRowId, input.uploader);

  if (input.bytes.byteLength === 0) {
    throw new Error("Empty file rejected");
  }
  if (input.bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error(`File exceeds ${MAX_FILE_BYTES} bytes`);
  }

  const used = totalBytesForEscrow(db, input.escrowRowId);
  if (used + input.bytes.byteLength > MAX_DELIVERY_BYTES) {
    throw new Error(`Delivery would exceed ${MAX_DELIVERY_BYTES} bytes`);
  }

  const contentHash = hashFileBytes(input.bytes);
  if (input.expectedContentHash && input.expectedContentHash.toLowerCase() !== contentHash.toLowerCase()) {
    throw new Error("Content hash mismatch");
  }

  const storageKey = newStorageKey();
  writeUploadBytes(storageKey, input.bytes, input.uploadDir);

  try {
    db.insert(files)
      .values({
        storageKey,
        escrowRowId: input.escrowRowId,
        absoluteRelpath: relativeUploadPath(storageKey),
        byteLength: input.bytes.byteLength,
        contentHash,
        originalFilename: input.originalFilename ?? null,
        createdAt: Date.now(),
        ownerAddress: input.uploader.toLowerCase(),
      })
      .run();
  } catch (err) {
    deleteUploadBytes(storageKey, input.uploadDir);
    throw err;
  }

  return { storageKey, contentHash, byteLength: input.bytes.byteLength };
}

export function loadUploadForDownload(
  db: AppDb,
  storageKeyRaw: string,
  requester: Address,
  uploadDir?: string,
) {
  const storageKey = assertSafeStorageKey(storageKeyRaw);
  const file = db.select().from(files).where(eq(files.storageKey, storageKey)).get();
  if (!file) {
    throw new Error("File not found");
  }
  requireEscrowAccess(db, file.escrowRowId, requester);

  const bytes = readUploadBytes(storageKey, uploadDir);
  const contentHash = hashFileBytes(bytes);
  if (contentHash.toLowerCase() !== file.contentHash.toLowerCase()) {
    throw new Error("Stored file content hash mismatch");
  }

  return {
    bytes,
    contentHash,
    byteLength: bytes.byteLength,
    originalFilename: file.originalFilename,
    storageKey,
  };
}
