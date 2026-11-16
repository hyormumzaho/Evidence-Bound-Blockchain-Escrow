export function StatusBadge({ state }: { state: string | number | null | undefined }) {
  const label = state === null || state === undefined || state === "" ? "unknown" : String(state);
  return (
    <span className="inline-flex rounded-full border border-[var(--border)] bg-white px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[var(--fg)]">
      {label}
    </span>
  );
}
