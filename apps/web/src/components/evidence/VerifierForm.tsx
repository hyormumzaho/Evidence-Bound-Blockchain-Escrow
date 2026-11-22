"use client";

import { useState } from "react";

type Verdict = {
  integrity: "valid" | "invalid" | "not-verified";
  availability: string;
  strategy: string | null;
  summary: string;
  checks: Array<{ name: string; result: string }>;
};

export function VerifierForm() {
  const [exportText, setExportText] = useState("");
  const [fileBase64, setFileBase64] = useState<string | undefined>();
  const [fileName, setFileName] = useState<string | null>(null);
  const [itemIndex, setItemIndex] = useState(0);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) {
      setFileBase64(undefined);
      setFileName(null);
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    setFileBase64(btoa(binary));
    setFileName(file.name);
  }

  async function onVerify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exportText, fileBase64, itemIndex }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Verification failed");
      setVerdict(body as Verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  const tone =
    verdict?.integrity === "valid"
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : verdict?.integrity === "invalid"
        ? "border-red-300 bg-red-50 text-red-950"
        : "border-amber-300 bg-amber-50 text-amber-950";

  return (
    <form onSubmit={onVerify} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
      <label className="block text-sm">
        <span className="text-[var(--muted)]">Evidence export JSON</span>
        <textarea
          className="mt-1 h-48 w-full rounded-lg border border-[var(--border)] p-3 font-mono text-xs"
          value={exportText}
          onChange={(e) => setExportText(e.target.value)}
          placeholder='{"schema":"evidencebound.evidence-export.v1", ...}'
          required
        />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="text-[var(--muted)]">Artifact file</span>
          <input
            className="mt-1 block text-sm"
            type="file"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          {fileName && <span className="mt-1 block text-xs text-[var(--muted)]">{fileName}</span>}
        </label>
        <label className="text-sm">
          <span className="text-[var(--muted)]">Item index</span>
          <input
            className="mt-1 block w-24 rounded-lg border border-[var(--border)] px-3 py-2"
            type="number"
            min={0}
            value={itemIndex}
            onChange={(e) => setItemIndex(Number(e.target.value))}
          />
        </label>
      </div>
      <button
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-60"
        type="submit"
        disabled={busy}
      >
        {busy ? "Reading the chain…" : "Verify against the chain"}
      </button>
      {error && <p className="text-sm text-red-800">{error}</p>}
      {verdict && (
        <section className={`rounded-xl border p-4 text-sm ${tone}`}>
          <p className="font-medium">{verdict.summary}</p>
          <p className="mt-2 text-xs">
            Integrity: {verdict.integrity}. Availability: {verdict.availability}.
            {verdict.strategy ? ` Strategy: ${verdict.strategy}.` : ""}
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {verdict.checks.map((check) => (
              <li key={check.name}>
                {check.name}: {check.result}
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  );
}
