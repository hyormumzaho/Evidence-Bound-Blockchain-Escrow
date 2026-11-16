"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { formatWalletError, isMetaMaskInstalled } from "@/lib/wagmi/errors";
import { switchToAnvil } from "@/lib/wagmi/switch-anvil";
import { wagmiConfig } from "@/lib/wagmi/config";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectButton() {
  const { address, isConnected, isConnecting, chainId, status } = useAccount();
  const { connect, connectors, isPending, error: connectError, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const [actionError, setActionError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (connectError) setActionError(formatWalletError(connectError));
  }, [connectError]);

  const metaMaskConnector = connectors.find((c) => c.id === "metaMask" || c.name.toLowerCase().includes("metamask")) ?? connectors[0];
  const wrongNetwork = isConnected && chainId !== undefined && chainId !== ANVIL_CHAIN_ID;
  const installed = mounted ? isMetaMaskInstalled() : true;

  async function onConnect() {
    setActionError(null);
    reset();
    if (!installed) {
      setActionError("MetaMask is not installed.");
      return;
    }
    if (!metaMaskConnector) {
      setActionError("No injected wallet connector available.");
      return;
    }
    connect({ connector: metaMaskConnector });
  }

  async function onSwitch() {
    setActionError(null);
    setSwitching(true);
    try {
      await switchToAnvil(wagmiConfig);
    } catch (err) {
      setActionError(formatWalletError(err));
    } finally {
      setSwitching(false);
    }
  }

  function onDisconnect() {
    setActionError(null);
    reset();
    disconnect();
  }

  if (!mounted) {
    return (
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted)]">
        Loading wallet…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-[var(--fg)]">Wallet</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            MetaMask → Anvil <span className="font-mono">{ANVIL_CHAIN_ID}</span>. No keys on the server.
          </p>
        </div>
        <span className="font-mono text-xs uppercase tracking-wide text-[var(--muted)]">
          {status === "reconnecting" ? "reconnecting" : isConnected ? "connected" : "disconnected"}
        </span>
      </div>

      {!installed && (
        <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          MetaMask extension not detected. Install it, then reload this page.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!isConnected ? (
          <button
            type="button"
            onClick={onConnect}
            disabled={isPending || isConnecting || !installed}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isPending || isConnecting ? "Connecting…" : "Connect MetaMask"}
          </button>
        ) : (
          <>
            <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs">
              {address ? shortAddress(address) : "—"}
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs">
              chain {chainId ?? "—"}
              {wrongNetwork ? " (wrong)" : ""}
            </div>
            {wrongNetwork && (
              <button
                type="button"
                onClick={onSwitch}
                disabled={switching}
                className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {switching ? "Switching…" : "Switch to Anvil"}
              </button>
            )}
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm"
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {wrongNetwork && (
        <p className="mt-3 text-xs text-amber-800">
          Wallet is on chain {chainId}. This app expects Anvil {ANVIL_CHAIN_ID}.
        </p>
      )}

      {actionError && <p className="mt-3 text-xs text-red-700">{actionError}</p>}
    </section>
  );
}
