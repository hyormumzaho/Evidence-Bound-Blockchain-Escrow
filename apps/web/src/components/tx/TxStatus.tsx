"use client";

export type TxPhase = "idle" | "pending" | "success" | "error";

export type TxStatusProps = {
  status: TxPhase;
  /** Optional human label, e.g. "Approve mUSDC". */
  label?: string;
  hash?: `0x${string}` | null;
  error?: string | null;
  className?: string;
};

const tone: Record<TxPhase, string> = {
  idle: "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]",
  pending: "border-sky-300 bg-sky-50 text-sky-950",
  success: "border-emerald-300 bg-emerald-50 text-emerald-950",
  error: "border-red-300 bg-red-50 text-red-950",
};

/**
 * Reusable transaction status chip for later write flows (Stage 3.5+).
 * Stage 3.3 ships the component only — no business txs yet.
 */
export function TxStatus({ status, label, hash, error, className = "" }: TxStatusProps) {
  if (status === "idle" && !label) return null;

  return (
    <div className={`rounded-xl border px-3 py-2 text-xs ${tone[status]} ${className}`.trim()}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono uppercase tracking-wide">{status}</span>
        {label ? <span>{label}</span> : null}
      </div>
      {hash ? <p className="mt-1 break-all font-mono opacity-80">{hash}</p> : null}
      {status === "error" && error ? <p className="mt-1">{error}</p> : null}
    </div>
  );
}
