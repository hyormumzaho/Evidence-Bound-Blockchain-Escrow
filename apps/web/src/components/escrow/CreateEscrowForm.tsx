"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { Address, Hex } from "viem";
import type { AgreementDocument } from "@evidencebound/shared";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { buildCreateAgreement } from "@/lib/escrow/agreement";
import { parseMockUsdcToBaseUnits } from "@/lib/escrow/amount";
import { parseEscrowCreatedFromReceipt } from "@/lib/escrow/events";
import { TxStatus, type TxPhase } from "@/components/tx/TxStatus";
import { formatWalletError } from "@/lib/wagmi/errors";

type ChainAddrs = {
  mockUSDC: Address | null;
  individualHashEscrow: Address | null;
  merkleRootEscrow: Address | null;
};

function hoursFromNow(hours: number): number {
  return Math.floor(Date.now() / 1000) + Math.floor(hours * 3600);
}

export function CreateEscrowForm() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const { writeContractAsync, data: txHash, reset: resetWrite, error: writeError, isPending } =
    useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const [variant, setVariant] = useState<EscrowVariant>("individual");
  const [provider, setProvider] = useState("");
  const [arbitrator, setArbitrator] = useState("");
  const [amountHuman, setAmountHuman] = useState("100");
  const [deliveryHours, setDeliveryHours] = useState("72");
  const [reviewHours, setReviewHours] = useState("24");
  const [revisionHours, setRevisionHours] = useState("48");
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const [addresses, setAddresses] = useState<ChainAddrs | null>(null);
  const [preview, setPreview] = useState<{
    document: AgreementDocument;
    agreementHash: Hex;
    templateHash: Hex;
    amountBase: bigint;
    deliveryDeadline: number;
    reviewPeriod: number;
    revisionDeliveryWindow: number;
    escrowContract: Address;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);
  const [donePath, setDonePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/chain/status");
      const body = (await res.json()) as { addresses: ChainAddrs };
      if (!cancelled) setAddresses(body.addresses);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!txHash || !receipt.isSuccess || !receipt.data || !preview || !address) return;
    let cancelled = false;
    (async () => {
      setPersisting(true);
      setPersistError(null);
      try {
        // Client-side sanity: event present (server re-parses independently).
        parseEscrowCreatedFromReceipt(receipt.data, variant);
        const res = await fetch("/api/escrows/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variant,
            txHash,
            agreement: preview.document,
          }),
        });
        const body = (await res.json()) as { error?: string; roomPath?: string };
        if (!res.ok) {
          throw new Error(body.error ?? "Failed to persist escrow metadata");
        }
        if (!cancelled) {
          setDonePath(body.roomPath ?? null);
          if (body.roomPath) router.push(body.roomPath);
        }
      } catch (err) {
        if (!cancelled) setPersistError(err instanceof Error ? err.message : "Persist failed");
      } finally {
        if (!cancelled) setPersisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [txHash, receipt.isSuccess, receipt.data, preview, address, variant, router]);

  const escrowContract = useMemo(() => {
    if (!addresses) return null;
    return variant === "individual" ? addresses.individualHashEscrow : addresses.merkleRootEscrow;
  }, [addresses, variant]);

  function onPreview(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPreview(null);
    setDonePath(null);
    resetWrite();
    try {
      if (!isConnected || !address) throw new Error("Connect MetaMask as payer");
      if (chainId !== ANVIL_CHAIN_ID) throw new Error(`Wrong network: need Anvil ${ANVIL_CHAIN_ID}`);
      if (!escrowContract || !addresses?.mockUSDC) throw new Error("Contracts not deployed / configured");
      const amountBase = parseMockUsdcToBaseUnits(amountHuman);
      const deliveryDeadline = hoursFromNow(Number(deliveryHours));
      const reviewPeriod = Math.floor(Number(reviewHours) * 3600);
      const revisionDeliveryWindow = Math.floor(Number(revisionHours) * 3600);
      if (!Number.isFinite(reviewPeriod) || reviewPeriod <= 0) throw new Error("Invalid review period");
      if (!Number.isFinite(revisionDeliveryWindow) || revisionDeliveryWindow <= 0) {
        throw new Error("Invalid revision window");
      }
      if (deliveryDeadline <= Math.floor(Date.now() / 1000)) throw new Error("Delivery deadline in the past");

      const built = buildCreateAgreement({
        agreementNonce: nonce,
        amountBaseUnits: amountBase,
        arbitrator: arbitrator as Address,
        chainId: ANVIL_CHAIN_ID,
        deliveryDeadline,
        escrowContract,
        payer: address,
        provider: provider as Address,
        reviewPeriod,
        revisionDeliveryWindow,
        token: addresses.mockUSDC,
      });
      setPreview({
        document: built.document,
        agreementHash: built.agreementHash,
        templateHash: built.templateHash,
        amountBase,
        deliveryDeadline,
        reviewPeriod,
        revisionDeliveryWindow,
        escrowContract,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Invalid form");
    }
  }

  async function onCreate() {
    setFormError(null);
    if (!preview || !address) return;
    if (chainId !== ANVIL_CHAIN_ID) {
      setFormError(`Wrong network: need Anvil ${ANVIL_CHAIN_ID}`);
      return;
    }
    try {
      await writeContractAsync({
        address: preview.escrowContract,
        abi: escrowAbi(variant),
        functionName: "createEscrow",
        args: [
          preview.document.provider as Address,
          preview.document.arbitrator as Address,
          preview.amountBase,
          BigInt(preview.deliveryDeadline),
          BigInt(preview.reviewPeriod),
          BigInt(preview.revisionDeliveryWindow),
          preview.agreementHash,
          preview.templateHash,
        ],
      });
    } catch (err) {
      setFormError(formatWalletError(err));
    }
  }

  const txPhase: TxPhase = writeError || receipt.isError || persistError
    ? "error"
    : isPending || (txHash && receipt.isLoading) || persisting
      ? "pending"
      : receipt.isSuccess && donePath
        ? "success"
        : "idle";

  return (
    <div className="space-y-6">
      <form onSubmit={onPreview} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
        <h2 className="text-lg font-medium">Create escrow</h2>
        <p className="text-sm text-[var(--muted)]">
          Payer is the connected wallet. Agreement is hashed with{" "}
          <code>@evidencebound/evidence</code> before the MetaMask transaction.
        </p>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Variant</span>
          <select
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2"
            value={variant}
            onChange={(e) => setVariant(e.target.value as EscrowVariant)}
          >
            <option value="individual">IndividualHashEscrow</option>
            <option value="merkle">MerkleRootEscrow</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Payer (connected)</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[#f7fafb] px-3 py-2 font-mono text-xs"
            value={address ?? ""}
            readOnly
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Provider</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
            value={provider}
            onChange={(e) => setProvider(e.target.value.trim())}
            placeholder="0x…"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Arbitrator</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
            value={arbitrator}
            onChange={(e) => setArbitrator(e.target.value.trim())}
            placeholder="0x…"
            required
          />
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Amount (MockUSDC, 6 decimals)</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2"
            value={amountHuman}
            onChange={(e) => setAmountHuman(e.target.value)}
            required
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Delivery deadline (hours from now)</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2"
              value={deliveryHours}
              onChange={(e) => setDeliveryHours(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Review period (hours)</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2"
              value={reviewHours}
              onChange={(e) => setReviewHours(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Revision window (hours)</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2"
              value={revisionHours}
              onChange={(e) => setRevisionHours(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Agreement nonce</span>
          <div className="mt-1 flex gap-2">
            <input
              className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 font-mono text-xs"
              value={nonce}
              onChange={(e) => setNonce(e.target.value)}
              required
            />
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-white px-3 text-xs"
              onClick={() => setNonce(crypto.randomUUID())}
            >
              New
            </button>
          </div>
        </label>

        <button
          type="submit"
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Preview agreement
        </button>
        {formError && <p className="text-sm text-red-700">{formError}</p>}
      </form>

      {preview && (
        <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
          <h3 className="font-medium">Agreement preview</h3>
          <p className="font-mono text-xs break-all">
            agreementHash {preview.agreementHash}
            <br />
            templateHash {preview.templateHash}
            <br />
            contract {preview.escrowContract}
          </p>
          <pre className="max-h-80 overflow-auto rounded-xl border border-[var(--border)] bg-[#f7fafb] p-3 text-xs">
            {JSON.stringify(preview.document, null, 2)}
          </pre>
          <button
            type="button"
            onClick={onCreate}
            disabled={isPending || receipt.isLoading || persisting || !!donePath}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Confirm createEscrow in MetaMask
          </button>
          <TxStatus
            status={txPhase}
            label={
              persistError
                ? "tx ok, SQLite persist failed — retry save"
                : persisting
                  ? "saving metadata…"
                  : receipt.isLoading
                    ? "waiting for receipt…"
                    : isPending
                      ? "confirm in wallet…"
                      : donePath
                        ? "created"
                        : writeError
                          ? "rejected / failed"
                          : "ready"
            }
            hash={txHash}
            error={persistError ?? (writeError ? formatWalletError(writeError) : null)}
          />
          {persistError && txHash && preview && (
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs"
              onClick={async () => {
                setPersisting(true);
                setPersistError(null);
                try {
                  const res = await fetch("/api/escrows/confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ variant, txHash, agreement: preview.document }),
                  });
                  const body = (await res.json()) as { error?: string; roomPath?: string };
                  if (!res.ok) throw new Error(body.error ?? "Persist failed");
                  setDonePath(body.roomPath ?? null);
                  if (body.roomPath) router.push(body.roomPath);
                } catch (err) {
                  setPersistError(err instanceof Error ? err.message : "Persist failed");
                } finally {
                  setPersisting(false);
                }
              }}
            >
              Retry SQLite save
            </button>
          )}
        </section>
      )}
    </div>
  );
}
