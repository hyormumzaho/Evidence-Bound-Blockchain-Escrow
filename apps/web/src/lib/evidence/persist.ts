import { and, eq } from "drizzle-orm";
import {
  getAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { EVIDENCE_TYPE_LABELS } from "@evidencebound/shared";
import { hashFileBytes, hashUrlReference, serializeExport } from "@evidencebound/evidence";
import type { AppDb } from "@/lib/db/client";
import { evidenceDeliveries, evidenceItems, escrows, files } from "@/lib/db/schema";
import { getDeploymentAddresses } from "@/lib/chain/addresses";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";
import { createAnvilPublicClient } from "@/lib/chain/client";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { readUploadBytes } from "@/lib/storage/files";
import { isParticipant } from "@/lib/auth/access";
import {
  buildDeliveryExport,
  individualBundleCommitment,
  submitPayloadForVariant,
  type DraftEvidenceItem,
} from "./build";
import { parseDeliverySubmittedFromReceipt } from "./events";

export type ConfirmEvidenceItemInput =
  | {
      kind: "file";
      storageKey: string;
      salt: Hex;
      originalFilename?: string;
    }
  | {
      kind: "url";
      storageKey: string;
      salt: Hex;
      url: string;
    };

export type ConfirmDeliveryResult = {
  deliveryId: number;
  escrowRowId: number;
  deliveryVersion: number;
  manifestHash: Hex;
  bundleCommitment: Hex;
  submitTx: Hex;
  itemCount: number;
  duplicated: boolean;
};

function contractForVariant(variant: EscrowVariant): Address {
  const addresses = getDeploymentAddresses();
  const addr = variant === "individual" ? addresses.individualHashEscrow : addresses.merkleRootEscrow;
  if (!addr) {
    throw Object.assign(new Error("Escrow contract address not configured"), { status: 503 });
  }
  return getAddress(addr);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withSqliteRetry<T>(fn: () => T, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      last = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/SQLITE_BUSY|database is locked/i.test(msg) || i === attempts - 1) throw err;
      await sleep(50 * (i + 1));
    }
  }
  throw last;
}

function rebuildDraftItems(
  db: AppDb,
  escrowRowId: number,
  items: ConfirmEvidenceItemInput[],
  uploadDir?: string,
): DraftEvidenceItem[] {
  return items.map((item) => {
    if (item.kind === "file") {
      const file = db.select().from(files).where(eq(files.storageKey, item.storageKey)).get();
      if (!file) {
        throw Object.assign(new Error(`File not found: ${item.storageKey}`), { status: 400 });
      }
      if (file.escrowRowId !== escrowRowId) {
        throw Object.assign(new Error("Forbidden: file belongs to another escrow"), { status: 403 });
      }
      const bytes = readUploadBytes(item.storageKey, uploadDir);
      const contentHash = hashFileBytes(bytes) as Hex;
      if (contentHash.toLowerCase() !== file.contentHash.toLowerCase()) {
        throw Object.assign(new Error("Stored file content hash mismatch"), { status: 400 });
      }
      if (bytes.byteLength !== file.byteLength) {
        throw Object.assign(new Error("Stored file byte length mismatch"), { status: 400 });
      }
      return {
        kind: "file" as const,
        storageKey: item.storageKey,
        contentHash,
        byteLength: file.byteLength,
        originalFilename: item.originalFilename ?? file.originalFilename ?? undefined,
        salt: item.salt,
      };
    }

    const trimmed = item.url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw Object.assign(new Error("URL must start with http:// or https://"), { status: 400 });
    }
    const contentHash = hashUrlReference(trimmed) as Hex;
    return {
      kind: "url" as const,
      storageKey: item.storageKey,
      url: trimmed,
      contentHash,
      byteLength: new TextEncoder().encode(trimmed).byteLength,
      salt: item.salt,
    };
  });
}

/**
 * Confirm submitDelivery from chain receipt + server-rebuilt evidence (files rehashed from disk).
 * Idempotent for the same tx + manifest; refuses conflicting evidence for the same deliveryVersion.
 */
export async function confirmDeliverySubmission(
  db: AppDb,
  input: {
    variant: EscrowVariant;
    escrowId: number;
    txHash: Hex;
    items: ConfirmEvidenceItemInput[];
    sessionAddress: Address;
    uploadDir?: string;
  },
): Promise<ConfirmDeliveryResult> {
  const session = getAddress(input.sessionAddress);
  const contractAddress = contractForVariant(input.variant);
  const client = createAnvilPublicClient();

  const chainId = await client.getChainId();
  if (chainId !== ANVIL_CHAIN_ID) {
    throw Object.assign(new Error(`Wrong RPC chainId ${chainId}`), { status: 400 });
  }

  const receipt = (await client.getTransactionReceipt({
    hash: input.txHash,
  })) as TransactionReceipt;
  if (receipt.status !== "success") {
    throw Object.assign(new Error("Transaction failed on-chain"), { status: 400 });
  }
  if (getAddress(receipt.to ?? "0x0000000000000000000000000000000000000000") !== contractAddress) {
    throw Object.assign(new Error("Transaction was not sent to the expected escrow contract"), {
      status: 400,
    });
  }

  const submitted = parseDeliverySubmittedFromReceipt(receipt, input.variant);
  if (Number(submitted.escrowId) !== input.escrowId) {
    throw Object.assign(new Error("DeliverySubmitted escrowId does not match route"), { status: 400 });
  }
  if (getAddress(submitted.provider) !== session) {
    throw Object.assign(new Error("Forbidden: session is not the on-chain delivery provider"), {
      status: 403,
    });
  }

  const row = db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.chainId, ANVIL_CHAIN_ID),
        eq(escrows.variant, input.variant),
        eq(escrows.contractAddress, contractAddress.toLowerCase()),
        eq(escrows.escrowId, input.escrowId),
        eq(escrows.isStaging, false),
      ),
    )
    .get();
  if (!row) {
    throw Object.assign(new Error("Escrow not found in SQLite"), { status: 404 });
  }
  if (!isParticipant(row, session)) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  if (getAddress(row.provider) !== session) {
    throw Object.assign(new Error("Forbidden: only the provider may confirm delivery evidence"), {
      status: 403,
    });
  }

  const view = (await client.readContract({
    address: contractAddress,
    abi: escrowAbi(input.variant),
    functionName: "getEscrow",
    args: [BigInt(input.escrowId)],
  })) as {
    provider: Address;
    deliveryVersion: number;
    state: number;
  };

  if (getAddress(view.provider) !== session) {
    throw Object.assign(new Error("Forbidden: on-chain provider mismatch"), { status: 403 });
  }
  if (Number(view.deliveryVersion) !== submitted.deliveryVersion) {
    throw Object.assign(
      new Error("On-chain deliveryVersion does not match DeliverySubmitted event"),
      { status: 400 },
    );
  }

  const drafts = rebuildDraftItems(db, row.id, input.items, input.uploadDir);
  if (drafts.length !== submitted.itemCount) {
    throw Object.assign(
      new Error(`Item count ${drafts.length} does not match on-chain itemCount ${submitted.itemCount}`),
      { status: 400 },
    );
  }

  const evidenceExport = buildDeliveryExport({
    chainId: ANVIL_CHAIN_ID,
    escrowContract: contractAddress,
    escrowId: input.escrowId,
    deliveryVersion: submitted.deliveryVersion,
    items: drafts,
  });

  const payload = submitPayloadForVariant(evidenceExport, input.variant);
  const expectedBundle: Hex =
    payload.kind === "individual"
      ? individualBundleCommitment(payload.commitments)
      : payload.root;

  if (expectedBundle.toLowerCase() !== submitted.bundleCommitment.toLowerCase()) {
    throw Object.assign(
      new Error("Rebuilt evidence bundleCommitment does not match DeliverySubmitted event"),
      { status: 400 },
    );
  }

  if (input.variant === "merkle" && payload.kind === "merkle") {
    if (payload.declaredCount !== submitted.itemCount) {
      throw Object.assign(new Error("declaredItemCount mismatch"), { status: 400 });
    }
  }

  const exportJson = serializeExport(evidenceExport);
  const manifestHash = evidenceExport.manifestHash as Hex;

  return withSqliteRetry(() =>
    db.transaction((tx) => {
      const existing = tx
        .select()
        .from(evidenceDeliveries)
        .where(
          and(
            eq(evidenceDeliveries.escrowRowId, row.id),
            eq(evidenceDeliveries.deliveryVersion, submitted.deliveryVersion),
          ),
        )
        .get();

      if (existing) {
        if (
          existing.manifestHash.toLowerCase() === manifestHash.toLowerCase() &&
          existing.submitTx &&
          existing.submitTx.toLowerCase() === input.txHash.toLowerCase()
        ) {
          return {
            deliveryId: existing.id,
            escrowRowId: row.id,
            deliveryVersion: submitted.deliveryVersion,
            manifestHash,
            bundleCommitment: submitted.bundleCommitment,
            submitTx: input.txHash,
            itemCount: submitted.itemCount,
            duplicated: true,
          } satisfies ConfirmDeliveryResult;
        }
        throw Object.assign(
          new Error(
            "Delivery version already persisted with different evidence or tx — immutable after confirmation",
          ),
          { status: 409 },
        );
      }

      for (const draft of drafts) {
        const bound = tx
          .select()
          .from(evidenceItems)
          .where(eq(evidenceItems.storageKey, draft.storageKey))
          .get();
        if (bound) {
          throw Object.assign(
            new Error(`storageKey already bound to a delivery item: ${draft.storageKey}`),
            { status: 409 },
          );
        }
      }

      const inserted = tx
        .insert(evidenceDeliveries)
        .values({
          escrowRowId: row.id,
          deliveryVersion: submitted.deliveryVersion,
          manifestHash,
          exportJson,
          submitTx: input.txHash,
        })
        .returning({ id: evidenceDeliveries.id })
        .get();

      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i];
        tx.insert(evidenceItems)
          .values({
            deliveryId: inserted.id,
            itemIndex: i,
            evidenceType:
              draft.kind === "file"
                ? EVIDENCE_TYPE_LABELS.file
                : EVIDENCE_TYPE_LABELS.urlReference,
            contentHash: draft.contentHash,
            salt: draft.salt,
            byteLength: draft.byteLength,
            storageKey: draft.storageKey,
            originalFilename:
              draft.kind === "file" ? (draft.originalFilename ?? null) : draft.url,
          })
          .run();
      }

      tx.update(escrows)
        .set({ stateCache: "Delivered" })
        .where(eq(escrows.id, row.id))
        .run();

      return {
        deliveryId: inserted.id,
        escrowRowId: row.id,
        deliveryVersion: submitted.deliveryVersion,
        manifestHash,
        bundleCommitment: submitted.bundleCommitment,
        submitTx: input.txHash,
        itemCount: submitted.itemCount,
        duplicated: false,
      } satisfies ConfirmDeliveryResult;
    }),
  );
}

export function getDeliveryForExport(
  db: AppDb,
  input: {
    variant: EscrowVariant;
    escrowId: number;
    deliveryVersion: number;
    sessionAddress: Address;
  },
) {
  const session = getAddress(input.sessionAddress);
  const contractAddress = contractForVariant(input.variant).toLowerCase();
  const row = db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.chainId, ANVIL_CHAIN_ID),
        eq(escrows.variant, input.variant),
        eq(escrows.contractAddress, contractAddress),
        eq(escrows.escrowId, input.escrowId),
        eq(escrows.isStaging, false),
      ),
    )
    .get();
  if (!row) return null;
  if (!isParticipant(row, session)) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  const delivery = db
    .select()
    .from(evidenceDeliveries)
    .where(
      and(
        eq(evidenceDeliveries.escrowRowId, row.id),
        eq(evidenceDeliveries.deliveryVersion, input.deliveryVersion),
      ),
    )
    .get();
  if (!delivery) return null;

  const items = db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.deliveryId, delivery.id))
    .all()
    .sort((a, b) => a.itemIndex - b.itemIndex);

  return { row, delivery, items };
}

export function listDeliveriesForEscrow(db: AppDb, escrowRowId: number) {
  return db
    .select({
      id: evidenceDeliveries.id,
      deliveryVersion: evidenceDeliveries.deliveryVersion,
      manifestHash: evidenceDeliveries.manifestHash,
      submitTx: evidenceDeliveries.submitTx,
    })
    .from(evidenceDeliveries)
    .where(eq(evidenceDeliveries.escrowRowId, escrowRowId))
    .all()
    .sort((a, b) => a.deliveryVersion - b.deliveryVersion);
}
