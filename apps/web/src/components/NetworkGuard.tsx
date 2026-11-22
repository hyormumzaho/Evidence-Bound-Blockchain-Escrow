"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { ChainStatus } from "@/lib/chain/status";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { formatWalletError } from "@/lib/wagmi/errors";
import { switchToAnvil } from "@/lib/wagmi/switch-anvil";
import { wagmiConfig } from "@/lib/wagmi/config";

/**
 * Combines public RPC/contract health (Stage 3.2) with wallet network status (Stage 3.3).
 */
export function NetworkGuard() {
  const { isConnected, chainId, address, status: walletStatus } = useAccount();
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chain/status");
        const body = (await res.json()) as ChainStatus;
        if (!cancelled) setStatus(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load chain status");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const walletOnAnvil = isConnected && chainId === ANVIL_CHAIN_ID;
  const walletWrongNetwork = isConnected && chainId !== undefined && chainId !== ANVIL_CHAIN_ID;

  async function onSwitch() {
    setSwitchError(null);
    setSwitching(true);
    try {
      await switchToAnvil(wagmiConfig);
    } catch (err) {
      setSwitchError(formatWalletError(err));
    } finally {
      setSwitching(false);
    }
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-950">
        <h2 className="font-medium">Network status</h2>
        <p className="mt-2">{error}</p>
      </section>
    );
  }

  if (!status) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted)]">
        Checking Anvil RPC…
      </section>
    );
  }

  const rpcTone = status.ok
    ? "border-emerald-300 bg-emerald-50 text-emerald-950"
    : "border-amber-300 bg-amber-50 text-amber-950";

  return (
    <section className={`rounded-2xl border p-5 text-sm ${rpcTone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Network / contract status</h2>
        <span className="font-mono text-xs uppercase tracking-wide">{status.ok ? "rpc ready" : "rpc not ready"}</span>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-xs opacity-70">RPC</dt>
          <dd className="font-mono break-all">{status.rpcUrl}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-70">Chain ID</dt>
          <dd className="font-mono">
            expected {status.expectedChainId}
            {status.actualChainId !== null ? ` / actual ${status.actualChainId}` : " / unreachable"}
          </dd>
        </div>
        <div>
          <dt className="text-xs opacity-70">Addresses configured</dt>
          <dd>{status.addressesConfigured ? "yes" : "no — run pnpm deploy:local"}</dd>
        </div>
        <div>
          <dt className="text-xs opacity-70">Bytecode</dt>
          <dd className="font-mono text-xs">
            mUSDC={String(status.bytecode.mockUSDC)} individual={String(status.bytecode.individualHashEscrow)}{" "}
            manifest={String(status.bytecode.manifestHashEscrow)} merkle={String(status.bytecode.merkleRootEscrow)}
          </dd>
        </div>
      </dl>

      {(status.reads.individualEvidenceMode || status.reads.merkleEvidenceMode) && (
        <dl className="mt-4 grid gap-2 border-t border-black/10 pt-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs opacity-70">IndividualHashEscrow (public RPC)</dt>
            <dd className="font-mono text-xs">
              mode={status.reads.individualEvidenceMode ?? "—"} nextId=
              {status.reads.individualNextEscrowId ?? "—"}
              <br />
              token={status.reads.individualToken ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-70">ManifestHashEscrow (public RPC)</dt>
            <dd className="font-mono text-xs">
              mode={status.reads.manifestEvidenceMode ?? "—"} nextId=
              {status.reads.manifestNextEscrowId ?? "—"}
              <br />
              token={status.reads.manifestToken ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs opacity-70">MerkleRootEscrow (public RPC)</dt>
            <dd className="font-mono text-xs">
              mode={status.reads.merkleEvidenceMode ?? "—"} nextId=
              {status.reads.merkleNextEscrowId ?? "—"}
              <br />
              token={status.reads.merkleToken ?? "—"}
            </dd>
          </div>
        </dl>
      )}

      {status.errors.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs">
          {status.errors.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      <div className="mt-4 rounded-xl border border-black/10 bg-white/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide opacity-80">Wallet network</h3>
          <span className="font-mono text-xs uppercase">
            {!isConnected
              ? walletStatus === "connecting" || walletStatus === "reconnecting"
                ? walletStatus
                : "disconnected"
              : walletOnAnvil
                ? "anvil ok"
                : "wrong network"}
          </span>
        </div>
        <p className="mt-2 font-mono text-xs break-all">
          {isConnected
            ? `${address} · wallet chain ${chainId ?? "—"} · expected ${ANVIL_CHAIN_ID}`
            : "Connect a local role or MetaMask. Expected chain 31337."}
        </p>
        {walletWrongNetwork && (
          <button
            type="button"
            onClick={onSwitch}
            disabled={switching}
            className="mt-3 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {switching ? "Switching…" : "Switch wallet to Anvil"}
          </button>
        )}
        {switchError && <p className="mt-2 text-xs text-red-700">{switchError}</p>}
      </div>

      <p className="mt-4 text-xs opacity-80">
        Public RPC checks stay on the Next.js API. Local role buttons use Anvil's unlocked accounts. MetaMask can
        still sign if you import those accounts yourself.
      </p>
    </section>
  );
}
