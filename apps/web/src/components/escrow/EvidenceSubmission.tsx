"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { Address, Hex } from "viem";
import { escrowAbi, type EscrowVariant } from "@/lib/chain/abis";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";
import { ESCROW_STATE, escrowStateName } from "@/lib/escrow/states";
import { TxStatus, type TxPhase } from "@/components/tx/TxStatus";
import { formatWalletError } from "@/lib/wagmi/errors";
import {
  buildDeliveryExport,
  draftFromUploadedFile,
  newUrlDraft,
  submitPayloadForVariant,
  type DraftEvidenceItem,
} from "@/lib/evidence/build";
import { MAX_EVIDENCE_ITEMS } from "@evidencebound/shared";

type Props = {
  variant: EscrowVariant;
  escrowId: bigint;
  escrowAddress: Address;
  escrowRowId: number;
  provider: Address;
};

type PersistedDelivery = {
  deliveryVersion: number;
  manifestHash: string;
  submitTx: string | null;
  exportPath: string;
};

export function EvidenceSubmission({
  variant,
  escrowId,
  escrowAddress,
  escrowRowId,
  provider,
}: Props) {
  const { address, chainId, isConnected } = useAccount();
  const chainOk = chainId === ANVIL_CHAIN_ID;
  const isProvider = Boolean(address && address.toLowerCase() === provider.toLowerCase());

  const { writeContractAsync, data: txHash, error: writeError, isPending, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const [items, setItems] = useState<DraftEvidenceItem[]>([]);
  const [urlInput, setUrlInput] = useState("https://");
  const [localError, setLocalError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmOk, setConfirmOk] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<PersistedDelivery[]>([]);
  const [pendingExport, setPendingExport] = useState<ReturnType<typeof buildDeliveryExport> | null>(
    null,
  );
  const [pendingConfirmItems, setPendingConfirmItems] = useState<
    Array<
      | { kind: "file"; storageKey: string; salt: Hex; originalFilename?: string }
      | { kind: "url"; storageKey: string; salt: Hex; url: string }
    >
  >([]);

  function itemsToConfirmPayload(list: DraftEvidenceItem[]) {
    return list.map((draft) =>
      draft.kind === "url"
        ? {
            kind: "url" as const,
            storageKey: draft.storageKey,
            salt: draft.salt,
            url: draft.url,
          }
        : {
            kind: "file" as const,
            storageKey: draft.storageKey,
            salt: draft.salt,
            originalFilename: draft.originalFilename,
          },
    );
  }

  const escrowQuery = useReadContract({
    address: escrowAddress,
    abi: escrowAbi(variant),
    functionName: "getEscrow",
    args: [escrowId],
    query: { refetchInterval: 4_000, enabled: Boolean(escrowAddress) },
  });

  const view = escrowQuery.data as
    | {
        provider: Address;
        deliveryVersion: number;
        currentDeliveryDeadline: bigint;
        state: number;
      }
    | undefined;

  const refreshDeliveries = useCallback(async () => {
    try {
      const res = await fetch(`/api/escrows/${variant}/${escrowId.toString()}/evidence`);
      const body = await res.json();
      if (res.ok) setDeliveries(body.deliveries ?? []);
    } catch {
      // ignore list errors in UI
    }
  }, [variant, escrowId]);

  useEffect(() => {
    void refreshDeliveries();
  }, [refreshDeliveries]);

  useEffect(() => {
    if (!receipt.isSuccess || !txHash || pendingConfirmItems.length === 0) return;
    let cancelled = false;
    (async () => {
      setConfirming(true);
      setLocalError(null);
      try {
        const res = await fetch(`/api/escrows/${variant}/${escrowId.toString()}/evidence/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ txHash, items: pendingConfirmItems }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Confirm failed");
        if (!cancelled) {
          setConfirmOk(
            body.duplicated
              ? `Already saved delivery v${body.deliveryVersion} (idempotent).`
              : `Saved delivery v${body.deliveryVersion}.`,
          );
          setItems([]);
          setPendingExport(null);
          setPendingConfirmItems([]);
          void refreshDeliveries();
          void escrowQuery.refetch();
        }
      } catch (err) {
        if (!cancelled) setLocalError(err instanceof Error ? err.message : "Confirm failed");
      } finally {
        if (!cancelled) setConfirming(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess, txHash]);

  const nextDeliveryVersion = view ? Number(view.deliveryVersion) + 1 : 1;
  const nowSec = Math.floor(Date.now() / 1000);
  const deadlineOk = view ? BigInt(nowSec) <= view.currentDeliveryDeadline : false;
  const stateOk =
    view &&
    (view.state === ESCROW_STATE.Funded || view.state === ESCROW_STATE.RevisionRequested);
  const canSubmit =
    isConnected && chainOk && isProvider && stateOk && deadlineOk && items.length > 0 && !isPending && !confirming;

  const preview = useMemo(() => {
    if (!view || items.length === 0) return null;
    try {
      const evidenceExport = buildDeliveryExport({
        chainId: ANVIL_CHAIN_ID,
        escrowContract: escrowAddress,
        escrowId: Number(escrowId),
        deliveryVersion: nextDeliveryVersion,
        items,
      });
      const payload = submitPayloadForVariant(evidenceExport, variant);
      return { evidenceExport, payload };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Build failed" };
    }
  }, [view, items, escrowAddress, escrowId, nextDeliveryVersion, variant]);

  async function onUploadFile(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    if (items.length + fileList.length > MAX_EVIDENCE_ITEMS) {
      setLocalError(`Max ${MAX_EVIDENCE_ITEMS} evidence items`);
      return;
    }
    setUploading(true);
    setLocalError(null);
    try {
      for (const file of Array.from(fileList)) {
        const form = new FormData();
        form.set("file", file);
        form.set("escrowRowId", String(escrowRowId));
        form.set("originalFilename", file.name);
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Upload failed");
        setItems((prev) => [
          ...prev,
          draftFromUploadedFile({
            storageKey: body.storageKey,
            contentHash: body.contentHash as Hex,
            byteLength: body.byteLength,
            originalFilename: file.name,
          }),
        ]);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onAddUrl() {
    setLocalError(null);
    try {
      if (items.length >= MAX_EVIDENCE_ITEMS) {
        throw new Error(`Max ${MAX_EVIDENCE_ITEMS} evidence items`);
      }
      setItems((prev) => [...prev, newUrlDraft(urlInput)]);
      setUrlInput("https://");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Invalid URL");
    }
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function onSubmitDelivery() {
    if (!preview || !("payload" in preview) || !preview.payload || !preview.evidenceExport) return;
    setLocalError(null);
    setConfirmOk(null);
    reset();
    setPendingExport(preview.evidenceExport);
    setPendingConfirmItems(itemsToConfirmPayload(items));
    try {
      if (preview.payload.kind === "individual") {
        await writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi(variant),
          functionName: "submitDelivery",
          args: [escrowId, preview.payload.commitments],
        });
      } else {
        await writeContractAsync({
          address: escrowAddress,
          abi: escrowAbi(variant),
          functionName: "submitDelivery",
          args: [escrowId, preview.payload.root, preview.payload.declaredCount],
        });
      }
    } catch (err) {
      setPendingExport(null);
      setPendingConfirmItems([]);
      setLocalError(formatWalletError(err));
    }
  }

  async function retryConfirm() {
    if (!txHash || pendingConfirmItems.length === 0) return;
    setConfirming(true);
    setLocalError(null);
    try {
      const res = await fetch(`/api/escrows/${variant}/${escrowId.toString()}/evidence/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, items: pendingConfirmItems }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Confirm failed");
      setConfirmOk(
        body.duplicated
          ? `Already saved delivery v${body.deliveryVersion} (idempotent).`
          : `Saved delivery v${body.deliveryVersion}.`,
      );
      setPendingExport(null);
      setPendingConfirmItems([]);
      setItems([]);
      void refreshDeliveries();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setConfirming(false);
    }
  }

  const busy = isPending || receipt.isLoading || confirming;
  const txPhase: TxPhase =
    writeError || receipt.isError || localError
      ? "error"
      : busy
        ? "pending"
        : receipt.isSuccess && confirmOk
          ? "success"
          : "idle";

  if (escrowQuery.isError) {
    return (
      <section className="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-950">
        Failed to read on-chain escrow for evidence submission.
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Evidence Submission</h2>
        {view && <span className="text-xs text-[var(--muted)]">{escrowStateName(view.state)}</span>}
      </div>
      <p className="text-xs text-[var(--muted)]">
        Provider only. Commitments bind to chainId, escrow contract, escrowId, and next deliveryVersion (
        {nextDeliveryVersion}). declaredItemCount is not cryptographically proven by the Merkle root.
      </p>

      {deliveries.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[#f7fafb] p-3 text-sm">
          <p className="font-medium">Persisted deliveries</p>
          <ul className="mt-2 space-y-1 text-xs">
            {deliveries.map((d) => (
              <li key={d.deliveryVersion} className="flex flex-wrap items-center gap-2">
                <span>
                  v{d.deliveryVersion} · {d.manifestHash.slice(0, 14)}…
                </span>
                <a className="text-[var(--accent)] underline" href={d.exportPath}>
                  Export bundle
                </a>
                {d.submitTx && (
                  <span className="font-mono text-[10px] text-[var(--muted)]">{d.submitTx}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isProvider && stateOk ? (
        <>
          <div className="flex flex-wrap gap-2">
            <label className="cursor-pointer rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
              {uploading ? "Uploading…" : "Add file"}
              <input
                type="file"
                className="hidden"
                multiple
                disabled={uploading || busy}
                onChange={(e) => {
                  void onUploadFile(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            <div className="flex flex-1 flex-wrap gap-2">
              <input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="min-w-[12rem] flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                placeholder="https://…"
                disabled={busy}
              />
              <button
                type="button"
                onClick={onAddUrl}
                disabled={busy}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              >
                Add URL ref
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No evidence items yet.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {items.map((item, index) => (
                <li
                  key={`${item.storageKey}-${index}`}
                  className="rounded-lg border border-[var(--border)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        #{index} {item.kind === "file" ? "file" : "urlReference"}
                      </p>
                      <p className="mt-1 break-all text-[var(--muted)]">
                        {item.kind === "file"
                          ? item.originalFilename ?? item.storageKey
                          : item.url}
                      </p>
                      <p className="mt-1 font-mono break-all">contentHash {item.contentHash}</p>
                      {preview && "evidenceExport" in preview && preview.evidenceExport && (
                        <p className="mt-1 font-mono break-all">
                          commitment {preview.evidenceExport.leaves[index]?.leafHash}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-red-700 underline"
                      disabled={busy}
                      onClick={() => removeItem(index)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {preview && "error" in preview && preview.error && (
            <p className="text-sm text-red-700">{preview.error}</p>
          )}

          {preview && "payload" in preview && preview.payload && (
            <div className="rounded-xl border border-[var(--border)] bg-[#f7fafb] p-3 text-xs font-mono break-all">
              {preview.payload.kind === "individual" ? (
                <p>commitments[{preview.payload.commitments.length}] ready for submitDelivery</p>
              ) : (
                <>
                  <p>merkleRoot {preview.payload.root}</p>
                  <p className="mt-1 text-[var(--muted)]">
                    declaredItemCount {preview.payload.declaredCount} (metadata only — not proven by
                    root)
                  </p>
                </>
              )}
              {"evidenceExport" in preview && preview.evidenceExport && (
                <p className="mt-1">manifestHash {preview.evidenceExport.manifestHash}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canSubmit || busy || Boolean(preview && "error" in preview)}
              onClick={() => void onSubmitDelivery()}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Submit delivery (MetaMask)
            </button>
            {receipt.isSuccess && pendingConfirmItems.length > 0 && localError && (
              <button
                type="button"
                disabled={confirming}
                onClick={() => void retryConfirm()}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
              >
                Retry save (no re-submit)
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {!isConnected
            ? "Connect wallet as provider."
            : !isProvider
              ? "Only the escrow provider can submit evidence."
              : !stateOk
                ? `Submission locked in state ${view ? escrowStateName(view.state) : "…"}.`
                : "Waiting for on-chain view…"}
        </p>
      )}

      <TxStatus
        status={txPhase}
        label={
          confirming
            ? "saving evidence metadata…"
            : isPending || receipt.isLoading
              ? "submitDelivery…"
              : confirmOk
                ? confirmOk
                : "idle"
        }
        hash={txHash}
        error={localError ?? (writeError ? formatWalletError(writeError) : null)}
      />
    </section>
  );
}
