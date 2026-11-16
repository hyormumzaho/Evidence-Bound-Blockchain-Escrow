"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { individualHashEscrowAbi, merkleRootEscrowAbi } from "@/lib/chain/abis";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import type { ChainStatus } from "@/lib/chain/status";
import { TxStatus } from "@/components/tx/TxStatus";

type Addresses = {
  individualHashEscrow: `0x${string}` | null;
  merkleRootEscrow: `0x${string}` | null;
};

/**
 * After wallet connect on Anvil, read escrow views through wagmi (wallet transport).
 * No write transactions in Stage 3.3.
 */
export function WalletContractReads() {
  const { isConnected, chainId, address } = useAccount();
  const [addresses, setAddresses] = useState<Addresses | null>(null);
  const [rpcOk, setRpcOk] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chain/status");
        const body = (await res.json()) as ChainStatus;
        if (cancelled) return;
        setRpcOk(body.rpcReachable && body.chainIdMatch);
        setAddresses({
          individualHashEscrow: body.addresses.individualHashEscrow,
          merkleRootEscrow: body.addresses.merkleRootEscrow,
        });
        setLoadError(null);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load deployment addresses");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onAnvil = isConnected && chainId === ANVIL_CHAIN_ID;
  const individual = addresses?.individualHashEscrow ?? undefined;
  const merkle = addresses?.merkleRootEscrow ?? undefined;
  const enabled = Boolean(onAnvil && rpcOk && individual && merkle);

  const individualNext = useReadContract({
    address: individual,
    abi: individualHashEscrowAbi,
    functionName: "nextEscrowId",
    query: { enabled },
  });
  const individualMode = useReadContract({
    address: individual,
    abi: individualHashEscrowAbi,
    functionName: "evidenceMode",
    query: { enabled },
  });
  const individualToken = useReadContract({
    address: individual,
    abi: individualHashEscrowAbi,
    functionName: "token",
    query: { enabled },
  });
  const merkleNext = useReadContract({
    address: merkle,
    abi: merkleRootEscrowAbi,
    functionName: "nextEscrowId",
    query: { enabled },
  });
  const merkleMode = useReadContract({
    address: merkle,
    abi: merkleRootEscrowAbi,
    functionName: "evidenceMode",
    query: { enabled },
  });

  const pending =
    individualNext.isFetching ||
    individualMode.isFetching ||
    individualToken.isFetching ||
    merkleNext.isFetching ||
    merkleMode.isFetching;
  const readError =
    individualNext.error ?? individualMode.error ?? individualToken.error ?? merkleNext.error ?? merkleMode.error;

  if (!isConnected) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">
        Connect MetaMask on Anvil to read contracts through wagmi.
      </section>
    );
  }

  if (!onAnvil) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        Switch the wallet to Anvil ({ANVIL_CHAIN_ID}) to enable contract reads.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Wallet contract reads</h2>
        <span className="font-mono text-xs text-[var(--muted)]">{address}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">
        eth_call via wagmi against deployed escrows (no transactions).
      </p>

      {loadError && <p className="mt-3 text-xs text-red-700">{loadError}</p>}
      {!addresses?.individualHashEscrow && !loadError && (
        <p className="mt-3 text-xs text-amber-800">Contract addresses missing. Run `pnpm deploy:local`.</p>
      )}

      <div className="mt-4">
        <TxStatus
          status={readError ? "error" : pending ? "pending" : enabled ? "success" : "idle"}
          label={readError ? "read failed" : pending ? "reading contracts…" : enabled ? "reads ok" : "waiting"}
          error={readError ? String(readError.message ?? readError) : null}
        />
      </div>

      {enabled && (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-white p-3">
            <dt className="text-xs text-[var(--muted)]">IndividualHashEscrow</dt>
            <dd className="mt-1 font-mono text-xs break-all">
              mode={String(individualMode.data ?? "—")}
              <br />
              nextId={individualNext.data !== undefined ? String(individualNext.data) : "—"}
              <br />
              token={String(individualToken.data ?? "—")}
            </dd>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-white p-3">
            <dt className="text-xs text-[var(--muted)]">MerkleRootEscrow</dt>
            <dd className="mt-1 font-mono text-xs break-all">
              mode={String(merkleMode.data ?? "—")}
              <br />
              nextId={merkleNext.data !== undefined ? String(merkleNext.data) : "—"}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
