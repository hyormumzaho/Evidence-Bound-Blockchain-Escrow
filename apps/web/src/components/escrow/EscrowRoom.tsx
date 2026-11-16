"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Address, Hex } from "viem";
import { StatusBadge } from "./StatusBadge";
import { EscrowActions } from "./EscrowActions";
import { EvidenceSubmission } from "./EvidenceSubmission";
import { escrowStateName } from "@/lib/escrow/states";
import type { EscrowVariant } from "@/lib/chain/abis";
import { formatMockUsdc } from "@/lib/escrow/amount";

type RoomPayload = {
  metadata: {
    id: number;
    variant: string;
    escrowId: number | null;
    payer: string;
    provider: string;
    arbitrator: string;
    agreementHash: string;
    createdTx: string | null;
    stateCache: string | null;
    contractAddress: string;
  };
  agreement: { agreementHash: string; canonicalJson: string } | null;
  onChain: {
    payer?: string;
    provider?: string;
    arbitrator?: string;
    amount?: string | number | bigint;
    agreementHash?: string;
    state?: number;
    providerApproved?: boolean;
    error?: string;
  } | null;
  note: string;
};

export function EscrowRoom({ variant, id }: { variant: string; id: string }) {
  const [data, setData] = useState<RoomPayload | null>(null);
  const [token, setToken] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [roomRes, statusRes] = await Promise.all([
          fetch(`/api/escrows/${variant}/${id}`),
          fetch("/api/chain/status"),
        ]);
        const body = await roomRes.json();
        const status = await statusRes.json();
        if (!roomRes.ok) {
          if (!cancelled) setError(body.error ?? "Failed to load");
          return;
        }
        if (!cancelled) {
          setData(body as RoomPayload);
          setToken((status.addresses?.mockUSDC as Address | null) ?? null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [variant, id]);

  if (error) {
    return (
      <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-950">
        <p>{error}</p>
        <Link href="/" className="mt-3 inline-block text-[var(--accent)] underline">
          Back to dashboard
        </Link>
      </section>
    );
  }

  if (!data) {
    return <p className="text-sm text-[var(--muted)]">Loading escrow room…</p>;
  }

  const onChainState =
    data.onChain && typeof data.onChain.state === "number"
      ? escrowStateName(data.onChain.state)
      : data.metadata.stateCache;

  const amountBase =
    data.onChain && data.onChain.amount !== undefined ? BigInt(data.onChain.amount as string | number | bigint) : null;

  const canShowActions =
    (variant === "individual" || variant === "merkle") &&
    data.metadata.escrowId !== null &&
    Boolean(data.metadata.contractAddress) &&
    Boolean(token) &&
    Boolean(data.metadata.agreementHash);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">
            {data.metadata.variant} #{data.metadata.escrowId}
          </h1>
          <StatusBadge state={onChainState} />
        </div>
        <p className="mt-2 text-sm text-[var(--muted)]">{data.note}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Contract</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.contractAddress}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Create tx</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.createdTx ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Payer</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.payer}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Provider</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.provider}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Arbitrator</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.arbitrator}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Amount</dt>
            <dd className="font-mono text-xs">
              {amountBase !== null ? `${formatMockUsdc(amountBase)} mUSDC` : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">agreementHash</dt>
            <dd className="font-mono text-xs break-all">{data.metadata.agreementHash}</dd>
          </div>
        </dl>
      </section>

      {canShowActions && (
        <EscrowActions
          variant={variant as EscrowVariant}
          escrowId={BigInt(data.metadata.escrowId as number)}
          escrowAddress={data.metadata.contractAddress as Address}
          tokenAddress={token as Address}
          expectedAgreementHash={data.metadata.agreementHash as Hex}
        />
      )}

      {canShowActions && (
        <EvidenceSubmission
          variant={variant as EscrowVariant}
          escrowId={BigInt(data.metadata.escrowId as number)}
          escrowAddress={data.metadata.contractAddress as Address}
          escrowRowId={data.metadata.id}
          provider={data.metadata.provider as Address}
        />
      )}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <h2 className="font-medium">Canonical agreement</h2>
        {data.agreement ? (
          <pre className="mt-3 max-h-96 overflow-auto rounded-xl border border-[var(--border)] bg-[#f7fafb] p-3 text-xs">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(data.agreement.canonicalJson), null, 2);
              } catch {
                return data.agreement.canonicalJson;
              }
            })()}
          </pre>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">No agreement JSON stored.</p>
        )}
      </section>

      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="text-[var(--accent)] underline">
          Dashboard
        </Link>
      </p>
    </div>
  );
}
