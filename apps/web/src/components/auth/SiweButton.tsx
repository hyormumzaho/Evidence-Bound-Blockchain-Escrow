"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { formatWalletError } from "@/lib/wagmi/errors";

/**
 * Minimal SIWE for file/metadata ACL (not payment auth).
 */
export function SiweButton() {
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshMe() {
    try {
      const res = await fetch("/api/auth/me");
      if (!res.ok) {
        setSessionAddress(null);
        return;
      }
      const body = (await res.json()) as { address: string };
      setSessionAddress(body.address);
    } catch {
      setSessionAddress(null);
    }
  }

  useEffect(() => {
    void refreshMe();
  }, [address]);

  async function onSignIn() {
    setError(null);
    if (!address) {
      setError("Connect a wallet first.");
      return;
    }
    if (chainId !== ANVIL_CHAIN_ID) {
      setError(`Switch wallet to Anvil ${ANVIL_CHAIN_ID} before SIWE.`);
      return;
    }
    setBusy(true);
    try {
      const nonceRes = await fetch(`/api/auth/nonce?address=${address}`);
      const nonceBody = (await nonceRes.json()) as { message?: string; error?: string };
      if (!nonceRes.ok || !nonceBody.message) {
        throw new Error(nonceBody.error ?? "Failed to get SIWE nonce");
      }
      const signature = await signMessageAsync({ message: nonceBody.message });
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: nonceBody.message, signature }),
      });
      const verifyBody = (await verifyRes.json()) as { error?: string; address?: string };
      if (!verifyRes.ok) {
        throw new Error(verifyBody.error ?? "SIWE verify failed");
      }
      setSessionAddress(verifyBody.address ?? address);
    } catch (err) {
      setError(formatWalletError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    setError(null);
    await fetch("/api/auth/logout", { method: "POST" });
    setSessionAddress(null);
  }

  if (!isConnected) {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
        Connect a role, then sign in with SIWE to save escrow metadata and files.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">SIWE session</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">File / SQLite ACL only — not used for fund/withdraw.</p>
        </div>
        <span className="font-mono text-xs uppercase">
          {sessionAddress ? "signed in" : "not signed in"}
        </span>
      </div>
      {sessionAddress ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs">
            {sessionAddress}
          </code>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs"
          >
            Logout
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy || chainId !== ANVIL_CHAIN_ID}
          className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Signing…" : "Sign in with Ethereum"}
        </button>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </section>
  );
}
