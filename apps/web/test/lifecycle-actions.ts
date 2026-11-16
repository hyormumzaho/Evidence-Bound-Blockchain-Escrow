import type { Address } from "viem";

/** Shared defaults for availableEscrowActions unit tests. */
export function actionBase(input: {
  payer: Address;
  provider: Address;
  arbitrator: Address;
  state: number;
  nowSec?: number;
  deliveryDeadline?: bigint;
  currentDeliveryDeadline?: bigint;
  reviewDeadline?: bigint;
  revisionsUsed?: number;
  claimable?: bigint;
  providerApproved?: boolean;
  amount?: bigint;
  balance?: bigint;
  allowance?: bigint;
}) {
  const deadline =
    input.deliveryDeadline ?? BigInt((input.nowSec ?? Math.floor(Date.now() / 1000)) + 3600);
  return {
    chainOk: true as const,
    payer: input.payer,
    provider: input.provider,
    arbitrator: input.arbitrator,
    state: input.state,
    providerApproved: input.providerApproved ?? true,
    amount: input.amount ?? 1_000_000n,
    balance: input.balance ?? 1_000_000n,
    allowance: input.allowance ?? 1_000_000n,
    deliveryDeadline: deadline,
    currentDeliveryDeadline: input.currentDeliveryDeadline ?? deadline,
    reviewDeadline: input.reviewDeadline ?? deadline,
    revisionsUsed: input.revisionsUsed ?? 0,
    claimable: input.claimable ?? 0n,
    nowSec: input.nowSec,
  };
}
