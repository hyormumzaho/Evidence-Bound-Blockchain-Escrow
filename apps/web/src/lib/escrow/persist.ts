import { canonicalizeAgreement, hashAgreement } from "@evidencebound/evidence";
import type { AgreementDocument } from "@evidencebound/shared";
import { and, desc, eq, or } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import type { AppDb } from "@/lib/db/client";
import { agreements, escrows } from "@/lib/db/schema";
import { getDeploymentAddresses } from "@/lib/chain/addresses";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";
import { createAnvilPublicClient } from "@/lib/chain/client";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { parseEscrowCreatedFromReceipt } from "./events";

export type PersistEscrowResult = {
  escrowRowId: number;
  escrowId: number;
  variant: EscrowVariant;
  contractAddress: Address;
  createdTx: Hex;
  agreementHash: Hex;
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

/**
 * Confirm createEscrow from chain receipt + agreement, then upsert SQLite.
 * Browser-supplied escrowId is ignored — only EscrowCreated event + on-chain view are trusted.
 */
export async function confirmCreateEscrow(
  db: AppDb,
  input: {
    variant: EscrowVariant;
    txHash: Hex;
    agreement: AgreementDocument;
    sessionAddress: Address;
    stagingRowId?: number;
  },
): Promise<PersistEscrowResult> {
  const session = getAddress(input.sessionAddress);
  const contractAddress = contractForVariant(input.variant);
  const client = createAnvilPublicClient();

  const chainId = await client.getChainId();
  if (chainId !== ANVIL_CHAIN_ID) {
    throw Object.assign(new Error(`Wrong RPC chainId ${chainId}`), { status: 400 });
  }

  const receipt = await client.getTransactionReceipt({ hash: input.txHash });
  if (receipt.status !== "success") {
    throw Object.assign(new Error("Transaction failed on-chain"), { status: 400 });
  }
  if (getAddress(receipt.to ?? "0x0000000000000000000000000000000000000000") !== contractAddress) {
    throw Object.assign(new Error("Transaction was not sent to the expected escrow contract"), { status: 400 });
  }

  const created = parseEscrowCreatedFromReceipt(receipt, input.variant);
  if (getAddress(created.payer) !== session) {
    throw Object.assign(new Error("Forbidden: session is not the on-chain payer"), { status: 403 });
  }

  const agreementHash = hashAgreement(input.agreement);
  const canonicalJson = canonicalizeAgreement(input.agreement);
  if (agreementHash.toLowerCase() !== created.agreementHash.toLowerCase()) {
    throw Object.assign(new Error("Agreement hash does not match EscrowCreated event"), { status: 400 });
  }
  if (getAddress(input.agreement.escrowContract) !== contractAddress) {
    throw Object.assign(new Error("Agreement escrowContract mismatch"), { status: 400 });
  }
  if (input.agreement.chainId !== String(ANVIL_CHAIN_ID)) {
    throw Object.assign(new Error("Agreement chainId mismatch"), { status: 400 });
  }
  if (getAddress(input.agreement.payer) !== session) {
    throw Object.assign(new Error("Agreement payer must match session"), { status: 403 });
  }

  const view = (await client.readContract({
    address: contractAddress,
    abi: escrowAbi(input.variant),
    functionName: "getEscrow",
    args: [created.escrowId],
  })) as {
    payer: Address;
    provider: Address;
    arbitrator: Address;
    amount: bigint;
    agreementHash: Hex;
    templateHash: Hex;
    state: number;
  };

  if (getAddress(view.payer) !== getAddress(created.payer)) {
    throw Object.assign(new Error("On-chain payer mismatch"), { status: 400 });
  }
  if (getAddress(view.provider) !== getAddress(created.provider)) {
    throw Object.assign(new Error("On-chain provider mismatch"), { status: 400 });
  }
  if (getAddress(view.arbitrator) !== getAddress(created.arbitrator)) {
    throw Object.assign(new Error("On-chain arbitrator mismatch"), { status: 400 });
  }
  if (view.amount !== created.amount) {
    throw Object.assign(new Error("On-chain amount mismatch"), { status: 400 });
  }
  if (view.agreementHash.toLowerCase() !== agreementHash.toLowerCase()) {
    throw Object.assign(new Error("On-chain agreementHash mismatch"), { status: 400 });
  }
  if (
    getAddress(input.agreement.provider) !== getAddress(created.provider) ||
    getAddress(input.agreement.arbitrator) !== getAddress(created.arbitrator)
  ) {
    throw Object.assign(new Error("Agreement parties do not match EscrowCreated"), { status: 400 });
  }
  if (input.agreement.amount !== created.amount.toString(10)) {
    throw Object.assign(new Error("Agreement amount does not match EscrowCreated"), { status: 400 });
  }

  const escrowIdNum = Number(created.escrowId);
  if (!Number.isSafeInteger(escrowIdNum)) {
    throw Object.assign(new Error("escrowId out of range"), { status: 400 });
  }

  return withSqliteRetry(() =>
    db.transaction((tx) => {
      if (input.stagingRowId) {
        const staging = tx.select().from(escrows).where(eq(escrows.id, input.stagingRowId)).get();
        if (!staging || !staging.isStaging) {
          throw Object.assign(new Error("Staging row not found"), { status: 400 });
        }
        if (staging.escrowId !== null) {
          throw Object.assign(new Error("Staging row already linked"), { status: 400 });
        }
        if (staging.variant !== input.variant) {
          throw Object.assign(new Error("Staging variant mismatch"), { status: 400 });
        }
        if (getAddress(staging.contractAddress) !== contractAddress) {
          throw Object.assign(new Error("Staging contract mismatch"), { status: 400 });
        }
        const rolesOk =
          getAddress(staging.payer) === getAddress(created.payer) &&
          getAddress(staging.provider) === getAddress(created.provider) &&
          getAddress(staging.arbitrator) === getAddress(created.arbitrator);
        if (!rolesOk) {
          throw Object.assign(new Error("Forbidden: staging participants do not match created escrow"), {
            status: 403,
          });
        }
        const sessionIsParticipant =
          session === getAddress(staging.payer) ||
          session === getAddress(staging.provider) ||
          session === getAddress(staging.arbitrator);
        if (!sessionIsParticipant) {
          throw Object.assign(new Error("Forbidden: cannot link foreign staging row"), { status: 403 });
        }
      }

      const existing = tx
        .select()
        .from(escrows)
        .where(
          and(
            eq(escrows.chainId, ANVIL_CHAIN_ID),
            eq(escrows.contractAddress, contractAddress.toLowerCase()),
            eq(escrows.escrowId, escrowIdNum),
          ),
        )
        .get();

      if (existing) {
        if (input.stagingRowId && existing.id !== input.stagingRowId) {
          throw Object.assign(
            new Error("Forbidden: cannot bind staging to an escrow already persisted under another row"),
            { status: 403 },
          );
        }
        if (existing.agreementHash.toLowerCase() !== agreementHash.toLowerCase()) {
          throw Object.assign(new Error("Existing SQLite row has conflicting agreementHash"), { status: 409 });
        }
        const ag = tx.select().from(agreements).where(eq(agreements.escrowRowId, existing.id)).get();
        if (!ag) {
          tx.insert(agreements)
            .values({
              escrowRowId: existing.id,
              canonicalJson,
              agreementHash,
            })
            .run();
        }
        return {
          escrowRowId: existing.id,
          escrowId: escrowIdNum,
          variant: input.variant,
          contractAddress,
          createdTx: input.txHash,
          agreementHash,
          duplicated: true,
        } satisfies PersistEscrowResult;
      }

      let rowId: number | undefined;

      if (input.stagingRowId) {
        const staging = tx.select().from(escrows).where(eq(escrows.id, input.stagingRowId)).get();
        if (!staging) {
          throw Object.assign(new Error("Staging row not found"), { status: 400 });
        }

        tx.update(escrows)
          .set({
            escrowId: escrowIdNum,
            agreementHash,
            templateHash: created.templateHash,
            createdTx: input.txHash,
            createdBlock: Number(receipt.blockNumber),
            stateCache: "Created",
            isStaging: false,
            payer: getAddress(created.payer).toLowerCase(),
            provider: getAddress(created.provider).toLowerCase(),
            arbitrator: getAddress(created.arbitrator).toLowerCase(),
          })
          .where(eq(escrows.id, staging.id))
          .run();
        rowId = staging.id;
      } else {
        const inserted = tx
          .insert(escrows)
          .values({
            chainId: ANVIL_CHAIN_ID,
            variant: input.variant,
            contractAddress: contractAddress.toLowerCase(),
            escrowId: escrowIdNum,
            payer: getAddress(created.payer).toLowerCase(),
            provider: getAddress(created.provider).toLowerCase(),
            arbitrator: getAddress(created.arbitrator).toLowerCase(),
            agreementHash,
            templateHash: created.templateHash,
            createdTx: input.txHash,
            createdBlock: Number(receipt.blockNumber),
            stateCache: "Created",
            isStaging: false,
            createdAt: Date.now(),
          })
          .returning({ id: escrows.id })
          .get();
        rowId = inserted.id;
      }

      if (rowId === undefined) {
        throw new Error("Failed to persist escrow row");
      }

      const existingAgreement = tx.select().from(agreements).where(eq(agreements.escrowRowId, rowId)).get();
      if (existingAgreement) {
        tx.update(agreements)
          .set({ canonicalJson, agreementHash })
          .where(eq(agreements.escrowRowId, rowId))
          .run();
      } else {
        tx.insert(agreements)
          .values({
            escrowRowId: rowId,
            canonicalJson,
            agreementHash,
          })
          .run();
      }

      return {
        escrowRowId: rowId,
        escrowId: escrowIdNum,
        variant: input.variant,
        contractAddress,
        createdTx: input.txHash,
        agreementHash,
        duplicated: false,
      } satisfies PersistEscrowResult;
    }),
  );
}

export function listEscrowsForAddress(db: AppDb, address: Address) {
  const a = getAddress(address).toLowerCase();
  return db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.isStaging, false),
        or(eq(escrows.payer, a), eq(escrows.provider, a), eq(escrows.arbitrator, a)),
      ),
    )
    .orderBy(desc(escrows.createdAt))
    .all();
}

export function getEscrowRoom(db: AppDb, variant: EscrowVariant, escrowId: number, address: Address) {
  const a = getAddress(address).toLowerCase();
  const contractAddress = contractForVariant(variant).toLowerCase();
  const row = db
    .select()
    .from(escrows)
    .where(
      and(
        eq(escrows.variant, variant),
        eq(escrows.contractAddress, contractAddress),
        eq(escrows.escrowId, escrowId),
        eq(escrows.isStaging, false),
      ),
    )
    .get();
  if (!row) return null;
  if (row.payer !== a && row.provider !== a && row.arbitrator !== a) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  const agreement = db.select().from(agreements).where(eq(agreements.escrowRowId, row.id)).get();
  return { row, agreement };
}
