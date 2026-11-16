/** Mirrors IEscrow.State — UI labels only; chain enum is authoritative. */
export const ESCROW_STATE = {
  None: 0,
  Created: 1,
  Funded: 2,
  Delivered: 3,
  RevisionRequested: 4,
  Disputed: 5,
  Settled: 6,
  Cancelled: 7,
} as const;

export const ESCROW_STATE_NAMES = [
  "None",
  "Created",
  "Funded",
  "Delivered",
  "RevisionRequested",
  "Disputed",
  "Settled",
  "Cancelled",
] as const;

export function escrowStateName(state: number | null | undefined): string {
  if (state === null || state === undefined) return "unknown";
  return ESCROW_STATE_NAMES[state] ?? String(state);
}

export type EscrowActionAvailability = {
  canApproveAgreement: boolean;
  canCancelUnfunded: boolean;
  canApproveToken: boolean;
  canFund: boolean;
  canSubmitEvidence: boolean;
  canAcceptDelivery: boolean;
  canRequestRevision: boolean;
  canOpenDispute: boolean;
  canResolveDispute: boolean;
  canClaimMissedDelivery: boolean;
  canClaimReviewTimeout: boolean;
  canWithdraw: boolean;
  reasons: string[];
};

/**
 * Derive available room actions from on-chain view + connected wallet.
 * Does not consult SQLite. Time checks must use blockchain timestamp (`nowSec`).
 */
export function availableEscrowActions(input: {
  connected: `0x${string}` | undefined;
  chainOk: boolean;
  payer: `0x${string}`;
  provider: `0x${string}`;
  arbitrator: `0x${string}`;
  state: number;
  providerApproved: boolean;
  amount: bigint;
  balance: bigint;
  allowance: bigint;
  /** Original create deadline — used by fund(). */
  deliveryDeadline: bigint;
  /** Active delivery window — submitDelivery / claimMissedDeliveryRefund. */
  currentDeliveryDeadline: bigint;
  reviewDeadline: bigint;
  revisionsUsed: number;
  maxRevisions?: number;
  claimable: bigint;
  /** Prefer chain block.timestamp (seconds). */
  nowSec?: number;
}): EscrowActionAvailability {
  const reasons: string[] = [];
  const now = BigInt(input.nowSec ?? Math.floor(Date.now() / 1000));
  const maxRevisions = input.maxRevisions ?? 1;
  const addr = input.connected?.toLowerCase();
  const isPayer = Boolean(addr && addr === input.payer.toLowerCase());
  const isProvider = Boolean(addr && addr === input.provider.toLowerCase());
  const isArbitrator = Boolean(addr && addr === input.arbitrator.toLowerCase());

  if (!input.connected) reasons.push("Connect MetaMask");
  if (!input.chainOk) reasons.push("Switch to Anvil 31337");

  const created = input.state === ESCROW_STATE.Created;
  const funded = input.state === ESCROW_STATE.Funded;
  const delivered = input.state === ESCROW_STATE.Delivered;
  const revisionRequested = input.state === ESCROW_STATE.RevisionRequested;
  const disputed = input.state === ESCROW_STATE.Disputed;

  const canApproveAgreement =
    Boolean(input.connected) && input.chainOk && isProvider && created && !input.providerApproved;

  const canCancelUnfunded = Boolean(input.connected) && input.chainOk && isPayer && created;

  const fundDeadlineOk = now <= input.deliveryDeadline;
  const canApproveToken =
    Boolean(input.connected) &&
    input.chainOk &&
    isPayer &&
    created &&
    input.providerApproved &&
    input.allowance < input.amount;

  const canFund =
    Boolean(input.connected) &&
    input.chainOk &&
    isPayer &&
    created &&
    input.providerApproved &&
    input.allowance >= input.amount &&
    input.balance >= input.amount &&
    fundDeadlineOk;

  if (isPayer && created && input.providerApproved && input.balance < input.amount) {
    reasons.push("Insufficient MockUSDC balance");
  }
  if (isPayer && created && input.providerApproved && input.allowance < input.amount) {
    reasons.push("MockUSDC allowance below escrow amount — approve tokens first");
  }
  if (isPayer && created && input.providerApproved && !fundDeadlineOk) {
    reasons.push("Delivery deadline passed — cannot fund");
  }
  if (isProvider && created && input.providerApproved) {
    reasons.push("Agreement already approved");
  }
  if (funded) {
    reasons.push("Already funded");
  }

  const deliveryWindowOpen = now <= input.currentDeliveryDeadline;
  const submitStateOk = funded || revisionRequested;
  const canSubmitEvidence =
    Boolean(input.connected) && input.chainOk && isProvider && submitStateOk && deliveryWindowOpen;

  if (isProvider && delivered) {
    reasons.push("Delivery already submitted — wait for review / revision");
  }
  if (isProvider && !submitStateOk && !delivered) {
    reasons.push("Evidence submission requires Funded or RevisionRequested");
  }
  if (isProvider && submitStateOk && !deliveryWindowOpen) {
    reasons.push("Current delivery deadline passed — cannot submit evidence");
  }

  const reviewOpen = delivered && now <= input.reviewDeadline;
  const canAcceptDelivery = Boolean(input.connected) && input.chainOk && isPayer && reviewOpen;
  const canRequestRevision =
    Boolean(input.connected) &&
    input.chainOk &&
    isPayer &&
    reviewOpen &&
    input.revisionsUsed < maxRevisions;

  if (isPayer && delivered && now > input.reviewDeadline) {
    reasons.push("Review window closed — accept/revision unavailable");
  }
  if (isPayer && delivered && input.revisionsUsed >= maxRevisions) {
    reasons.push("Revision limit reached (max 1)");
  }

  const disputeStateOk = funded || delivered || revisionRequested;
  const canOpenDispute =
    Boolean(input.connected) && input.chainOk && (isPayer || isProvider) && disputeStateOk;

  if (disputeStateOk) {
    reasons.push("Dispute freezes timeouts until arbitrator resolves (not limited to review window)");
  }

  const canResolveDispute = Boolean(input.connected) && input.chainOk && isArbitrator && disputed;

  const canClaimMissedDelivery =
    Boolean(input.connected) &&
    input.chainOk &&
    isPayer &&
    (funded || revisionRequested) &&
    now > input.currentDeliveryDeadline;

  const canClaimReviewTimeout =
    Boolean(input.connected) &&
    input.chainOk &&
    isProvider &&
    delivered &&
    now > input.reviewDeadline;

  if (isPayer && (funded || revisionRequested) && now <= input.currentDeliveryDeadline) {
    reasons.push("Missed-delivery refund available only after currentDeliveryDeadline");
  }
  if (isProvider && delivered && now <= input.reviewDeadline) {
    reasons.push("Review-timeout claim available only after reviewDeadline");
  }

  const canWithdraw =
    Boolean(input.connected) && input.chainOk && input.claimable > 0n;

  if (input.connected && input.chainOk && input.claimable === 0n && input.state === ESCROW_STATE.Settled) {
    reasons.push("No claimable balance for this account on this escrow");
  }

  return {
    canApproveAgreement,
    canCancelUnfunded,
    canApproveToken,
    canFund,
    canSubmitEvidence,
    canAcceptDelivery,
    canRequestRevision,
    canOpenDispute,
    canResolveDispute,
    canClaimMissedDelivery,
    canClaimReviewTimeout,
    canWithdraw,
    reasons,
  };
}
