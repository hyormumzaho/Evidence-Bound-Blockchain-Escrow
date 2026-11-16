import { parseEventLogs, type Log, type TransactionReceipt } from "viem";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";

export type DeliverySubmittedArgs = {
  escrowId: bigint;
  provider: `0x${string}`;
  deliveryVersion: number;
  bundleCommitment: `0x${string}`;
  itemCount: number;
};

export function parseDeliverySubmittedFromReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  variant: EscrowVariant,
): DeliverySubmittedArgs {
  const logs = parseEventLogs({
    abi: escrowAbi(variant),
    eventName: "DeliverySubmitted",
    logs: receipt.logs as Log[],
  });
  if (logs.length === 0) {
    throw new Error("DeliverySubmitted event not found in receipt");
  }
  if (logs.length > 1) {
    throw new Error("Multiple DeliverySubmitted events in receipt");
  }
  const args = logs[0].args as {
    escrowId: bigint;
    provider: `0x${string}`;
    deliveryVersion: number | bigint;
    bundleCommitment: `0x${string}`;
    itemCount: number | bigint;
  };
  return {
    escrowId: BigInt(args.escrowId),
    provider: args.provider,
    deliveryVersion: Number(args.deliveryVersion),
    bundleCommitment: args.bundleCommitment,
    itemCount: Number(args.itemCount),
  };
}
