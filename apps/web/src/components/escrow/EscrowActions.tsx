"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBlock,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { Address, Hex } from "viem";
import { escrowAbi, mockUsdcAbi, type EscrowVariant } from "@/lib/chain/abis";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { formatMockUsdc } from "@/lib/escrow/amount";
import { BPS_DENOMINATOR, hashReasonText, MAX_REVISIONS } from "@/lib/escrow/reason";
import { availableEscrowActions, escrowStateName, ESCROW_STATE } from "@/lib/escrow/states";
import { TxStatus, type TxPhase } from "@/components/tx/TxStatus";
import { formatWalletError } from "@/lib/wagmi/errors";
import { StatusBadge } from "./StatusBadge";

type Props = {
  variant: EscrowVariant;
  escrowId: bigint;
  escrowAddress: Address;
  tokenAddress: Address;
  /** Stored agreement hash from Stage 3.5 — must match on-chain before approveAgreement. */
  expectedAgreementHash: Hex;
};

type PendingKind =
  | "approveAgreement"
  | "approveToken"
  | "fund"
  | "cancel"
  | "acceptDelivery"
  | "requestRevision"
  | "openDispute"
  | "resolveDispute"
  | "claimMissed"
  | "claimReview"
  | "withdraw"
  | null;

type EscrowView = {
  payer: Address;
  provider: Address;
  arbitrator: Address;
  amount: bigint;
  agreementHash: Hex;
  deliveryDeadline: bigint;
  currentDeliveryDeadline: bigint;
  reviewDeadline: bigint;
  revisionsUsed: number;
  deliveryVersion: number;
  state: number;
  providerApproved: boolean;
};

export function EscrowActions({
  variant,
  escrowId,
  escrowAddress,
  tokenAddress,
  expectedAgreementHash,
}: Props) {
  const { address, chainId, isConnected } = useAccount();
  const chainOk = chainId === ANVIL_CHAIN_ID;
  const { writeContractAsync, data: txHash, error: writeError, isPending, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });
  const blockQuery = useBlock({
    chainId: ANVIL_CHAIN_ID,
    query: { refetchInterval: 4_000, enabled: chainOk },
  });

  const [pendingKind, setPendingKind] = useState<PendingKind>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [revisionReason, setRevisionReason] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [providerBps, setProviderBps] = useState("5000");

  const escrowQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi(variant),
    functionName: "getEscrow",
    args: [escrowId],
    query: { refetchInterval: 4_000, enabled: Boolean(escrowAddress) },
  });

  const balanceQuery = useReadContract({
    address: tokenAddress,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && tokenAddress), refetchInterval: 4_000 },
  });

  const allowanceQuery = useReadContract({
    address: tokenAddress,
    abi: mockUsdcAbi,
    functionName: "allowance",
    args: address ? [address, escrowAddress] : undefined,
    query: { enabled: Boolean(address && tokenAddress), refetchInterval: 4_000 },
  });

  const claimableQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi(variant),
    functionName: "claimable",
    args: address ? [escrowId, address] : undefined,
    query: { enabled: Boolean(address && escrowAddress), refetchInterval: 4_000 },
  });

  useEffect(() => {
    if (receipt.isSuccess) {
      void escrowQuery.refetch();
      void balanceQuery.refetch();
      void allowanceQuery.refetch();
      void claimableQuery.refetch();
      setPendingKind(null);
      setRefreshTick((n) => n + 1);
    }
  }, [receipt.isSuccess]); // eslint-disable-line react-hooks/exhaustive-deps

  const view = escrowQuery.data as EscrowView | undefined;
  const balance = (balanceQuery.data as bigint | undefined) ?? 0n;
  const allowance = (allowanceQuery.data as bigint | undefined) ?? 0n;
  const claimable = (claimableQuery.data as bigint | undefined) ?? 0n;
  const nowSec = blockQuery.data?.timestamp !== undefined ? Number(blockQuery.data.timestamp) : undefined;

  const actions = useMemo(() => {
    if (!view) {
      return {
        canApproveAgreement: false,
        canCancelUnfunded: false,
        canApproveToken: false,
        canFund: false,
        canSubmitEvidence: false,
        canAcceptDelivery: false,
        canRequestRevision: false,
        canOpenDispute: false,
        canResolveDispute: false,
        canClaimMissedDelivery: false,
        canClaimReviewTimeout: false,
        canWithdraw: false,
        reasons: ["Loading on-chain escrow…"],
      };
    }
    return availableEscrowActions({
      connected: address,
      chainOk,
      payer: view.payer,
      provider: view.provider,
      arbitrator: view.arbitrator,
      state: view.state,
      providerApproved: view.providerApproved,
      amount: view.amount,
      balance,
      allowance,
      deliveryDeadline: view.deliveryDeadline,
      currentDeliveryDeadline: view.currentDeliveryDeadline,
      reviewDeadline: view.reviewDeadline,
      revisionsUsed: Number(view.revisionsUsed),
      maxRevisions: MAX_REVISIONS,
      claimable,
      nowSec,
    });
  }, [view, address, chainOk, balance, allowance, claimable, nowSec, refreshTick]);

  const busy = isPending || receipt.isLoading || Boolean(pendingKind && !receipt.isSuccess && txHash);
  const txPhase: TxPhase =
    writeError || receipt.isError || localError
      ? "error"
      : busy
        ? "pending"
        : receipt.isSuccess
          ? "success"
          : "idle";

  async function run(kind: PendingKind, fn: () => Promise<Hex>) {
    if (busy) return;
    setLocalError(null);
    reset();
    setPendingKind(kind);
    try {
      await fn();
    } catch (err) {
      setPendingKind(null);
      setLocalError(formatWalletError(err));
    }
  }

  async function onApproveAgreement() {
    if (!view) return;
    if (view.agreementHash.toLowerCase() !== expectedAgreementHash.toLowerCase()) {
      setLocalError("Stored agreementHash does not match on-chain agreementHash");
      return;
    }
    if (view.state !== ESCROW_STATE.Created) {
      setLocalError("Escrow is not in Created state");
      return;
    }
    await run("approveAgreement", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "approveAgreement",
        args: [escrowId, view.agreementHash],
      }),
    );
  }

  async function onApproveToken() {
    if (!view) return;
    await run("approveToken", () =>
      writeContractAsync({
        address: tokenAddress,
        abi: mockUsdcAbi,
        functionName: "approve",
        args: [escrowAddress, view.amount],
      }),
    );
  }

  async function onFund() {
    if (!view) return;
    if (!view.providerApproved) {
      setLocalError("Provider has not approved the agreement");
      return;
    }
    if (allowance < view.amount) {
      setLocalError("Insufficient MockUSDC allowance");
      return;
    }
    if (balance < view.amount) {
      setLocalError("Insufficient MockUSDC balance");
      return;
    }
    await run("fund", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "fund",
        args: [escrowId],
      }),
    );
  }

  async function onCancel() {
    await run("cancel", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "cancelUnfunded",
        args: [escrowId],
      }),
    );
  }

  async function onAccept() {
    await run("acceptDelivery", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "acceptDelivery",
        args: [escrowId],
      }),
    );
  }

  async function onRequestRevision() {
    try {
      const reasonHash = hashReasonText(revisionReason);
      await run("requestRevision", () =>
        writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi(variant),
          functionName: "requestRevision",
          args: [escrowId, reasonHash],
        }),
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid revision reason");
    }
  }

  async function onOpenDispute() {
    try {
      const reasonHash = hashReasonText(disputeReason);
      await run("openDispute", () =>
        writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi(variant),
          functionName: "openDispute",
          args: [escrowId, reasonHash],
        }),
      );
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid dispute reason");
    }
  }

  async function onResolveDispute() {
    const bps = Number(providerBps);
    if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
      setLocalError(`providerBps must be an integer 0..${BPS_DENOMINATOR}`);
      return;
    }
    await run("resolveDispute", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "resolveDispute",
        args: [escrowId, BigInt(bps)],
      }),
    );
  }

  async function onClaimMissed() {
    await run("claimMissed", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "claimMissedDeliveryRefund",
        args: [escrowId],
      }),
    );
  }

  async function onClaimReview() {
    await run("claimReview", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "claimReviewTimeout",
        args: [escrowId],
      }),
    );
  }

  async function onWithdraw() {
    if (claimable === 0n) {
      setLocalError("Nothing to withdraw");
      return;
    }
    await run("withdraw", () =>
      writeContractAsync({
        address: escrowAddress,
        abi: escrowAbi(variant),
        functionName: "withdraw",
        args: [escrowId],
      }),
    );
  }

  if (escrowQuery.isError) {
    return (
      <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-950">
        Failed to read on-chain escrow. Is Anvil running and the contract deployed?
      </section>
    );
  }

  if (!view) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted)]">
        Loading on-chain actions…
      </section>
    );
  }

  const hashMatch = view.agreementHash.toLowerCase() === expectedAgreementHash.toLowerCase();
  const pendingLabel =
    pendingKind === "approveAgreement"
      ? "approveAgreement…"
      : pendingKind === "approveToken"
        ? "ERC-20 approve…"
        : pendingKind === "fund"
          ? "fund…"
          : pendingKind === "cancel"
            ? "cancelUnfunded…"
            : pendingKind === "acceptDelivery"
              ? "acceptDelivery…"
              : pendingKind === "requestRevision"
                ? "requestRevision…"
                : pendingKind === "openDispute"
                  ? "openDispute…"
                  : pendingKind === "resolveDispute"
                    ? "resolveDispute…"
                    : pendingKind === "claimMissed"
                      ? "claimMissedDeliveryRefund…"
                      : pendingKind === "claimReview"
                        ? "claimReviewTimeout…"
                        : pendingKind === "withdraw"
                          ? "withdraw…"
                          : receipt.isSuccess
                            ? "confirmed — state refreshed"
                            : "idle";

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Actions (on-chain)</h2>
        <StatusBadge state={escrowStateName(view.state)} />
      </div>
      <p className="text-xs text-[var(--muted)]">
        Blockchain is authoritative. Deadlines use chain block time
        {nowSec !== undefined ? ` (block ts ${nowSec})` : ""}. Dispute freezes timeout claims until resolve.
      </p>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-[var(--muted)]">Provider approved</dt>
          <dd className="font-mono text-xs">{String(view.providerApproved)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Amount</dt>
          <dd className="font-mono text-xs">
            {formatMockUsdc(view.amount)} mUSDC ({view.amount.toString()} base)
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">deliveryVersion / revisionsUsed</dt>
          <dd className="font-mono text-xs">
            {Number(view.deliveryVersion)} / {Number(view.revisionsUsed)} (max {MAX_REVISIONS})
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Your claimable</dt>
          <dd className="font-mono text-xs">
            {isConnected ? `${formatMockUsdc(claimable)} (${claimable.toString()})` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">currentDeliveryDeadline</dt>
          <dd className="font-mono text-xs">{view.currentDeliveryDeadline.toString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">reviewDeadline</dt>
          <dd className="font-mono text-xs">{view.reviewDeadline.toString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Your MockUSDC balance</dt>
          <dd className="font-mono text-xs">
            {isConnected ? `${formatMockUsdc(balance)} (${balance.toString()})` : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Allowance → escrow</dt>
          <dd className="font-mono text-xs">
            {isConnected ? `${formatMockUsdc(allowance)} (${allowance.toString()})` : "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-[var(--muted)]">On-chain agreementHash</dt>
          <dd className="font-mono text-xs break-all">
            {view.agreementHash}
            {!hashMatch && <span className="ml-2 text-red-700">mismatch with stored hash</span>}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {actions.canApproveAgreement && (
          <button
            type="button"
            disabled={busy || !hashMatch}
            onClick={onApproveAgreement}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Approve agreement (provider)
          </button>
        )}
        {actions.canApproveToken && (
          <button
            type="button"
            disabled={busy}
            onClick={onApproveToken}
            className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Approve MockUSDC (ERC-20)
          </button>
        )}
        {actions.canFund && (
          <button
            type="button"
            disabled={busy}
            onClick={onFund}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Fund escrow
          </button>
        )}
        {actions.canCancelUnfunded && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 disabled:opacity-50"
          >
            Cancel unfunded
          </button>
        )}
        {actions.canAcceptDelivery && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAccept()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Accept delivery (payer)
          </button>
        )}
        {actions.canClaimMissedDelivery && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClaimMissed()}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 disabled:opacity-50"
          >
            Claim missed-delivery refund
          </button>
        )}
        {actions.canClaimReviewTimeout && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onClaimReview()}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 disabled:opacity-50"
          >
            Claim review timeout
          </button>
        )}
        {actions.canWithdraw && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void onWithdraw()}
            className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Withdraw claimable
          </button>
        )}
      </div>

      {actions.canRequestRevision && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Request revision (payer, max 1)</p>
          <textarea
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            placeholder="Revision reason…"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy || !revisionReason.trim()}
            onClick={() => void onRequestRevision()}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50"
          >
            requestRevision
          </button>
        </div>
      )}

      {actions.canOpenDispute && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Open dispute (payer or provider)</p>
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            placeholder="Dispute reason…"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy || !disputeReason.trim()}
            onClick={() => void onOpenDispute()}
            className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 disabled:opacity-50"
          >
            openDispute
          </button>
        </div>
      )}

      {actions.canResolveDispute && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Resolve dispute (arbitrator)</p>
          <p className="text-xs text-[var(--muted)]">
            providerBps 0..{BPS_DENOMINATOR}. Remainder to payer (rounding favors payer per contract).
          </p>
          <input
            type="number"
            min={0}
            max={BPS_DENOMINATOR}
            step={1}
            value={providerBps}
            onChange={(e) => setProviderBps(e.target.value)}
            className="w-40 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            disabled={busy}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onResolveDispute()}
            className="ml-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            resolveDispute
          </button>
        </div>
      )}

      {actions.reasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">
          {actions.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <TxStatus
        status={txPhase}
        label={pendingLabel}
        hash={txHash}
        error={localError ?? (writeError ? formatWalletError(writeError) : null)}
      />
    </section>
  );
}
