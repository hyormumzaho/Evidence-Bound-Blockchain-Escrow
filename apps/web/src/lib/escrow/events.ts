import { parseEventLogs, type Address, type Hex, type Log, type TransactionReceipt } from "viem";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";

export type EscrowCreatedArgs = {
  escrowId: bigint;
  payer: Address;
  provider: Address;
  arbitrator: Address;
  amount: bigint;
  deliveryDeadline: bigint;
  reviewPeriod: bigint;
  revisionDeliveryWindow: bigint;
  agreementHash: Hex;
  templateHash: Hex;
};

/** Extract EscrowCreated from a receipt. Does not use nextEscrowId heuristics. */
export function parseEscrowCreatedFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  variant: EscrowVariant,
): EscrowCreatedArgs {
  const logs = parseEventLogs({
    abi: escrowAbi(variant),
    eventName: "EscrowCreated",
    logs: receipt.logs as Log[],
  });
  if (logs.length === 0) {
    throw new Error("EscrowCreated event not found in receipt");
  }
  if (logs.length > 1) {
    throw new Error("Multiple EscrowCreated events in receipt");
  }
  const args = logs[0].args as EscrowCreatedArgs;
  if (args.escrowId === undefined || args.payer === undefined) {
    throw new Error("Malformed EscrowCreated event");
  }
  return {
    escrowId: BigInt(args.escrowId),
    payer: args.payer,
    provider: args.provider,
    arbitrator: args.arbitrator,
    amount: BigInt(args.amount),
    deliveryDeadline: BigInt(args.deliveryDeadline),
    reviewPeriod: BigInt(args.reviewPeriod),
    revisionDeliveryWindow: BigInt(args.revisionDeliveryWindow),
    agreementHash: args.agreementHash,
    templateHash: args.templateHash,
  };
}
