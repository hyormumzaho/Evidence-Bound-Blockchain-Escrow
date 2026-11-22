"use client";

import { useEffect, useState } from "react";

type RecordRow = {
  scenario: string;
  variant: string;
  artifactCount: number;
  functionName: string;
  executionKind: string;
  gasUsed: number | null;
  calldataBytes: number | null;
  manifestBytes: number | null;
  proofBytes: number | null;
  pass: boolean;
};

type Timing = {
  operation: string;
  variant: string;
  artifactCount: number;
  trials: number;
  medianMs: number;
  p95Ms: number;
};

type Document = {
  runId: string;
  gitCommit: string;
  dirty: boolean;
  createdAt: string;
  suite: string;
  datasetSeed: string;
  synthetic: boolean;
  records: RecordRow[];
  timings: Timing[];
};

export function MeasurementTable() {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "empty"; message: string; command: string }
    | { kind: "ready"; document: Document }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/experiments/latest");
        const body = await res.json();
        if (cancelled) return;
        if (!body.available) {
          setState({ kind: "empty", message: body.message, command: body.command });
          return;
        }
        setState({ kind: "ready", document: body.document as Document });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Load failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p className="text-sm text-[var(--muted)]">Loading measurements…</p>;
  if (state.kind === "error") return <p className="text-sm text-red-800">{state.message}</p>;
  if (state.kind === "empty") {
    return (
      <section className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm">
        <p>{state.message}</p>
        <pre className="mt-3 rounded-lg bg-[#f7fafb] p-3 text-xs">{state.command}</pre>
      </section>
    );
  }

  const doc = state.document;
  const mined = doc.records.filter((row) => row.executionKind === "mined");
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Run {doc.runId} · commit {doc.gitCommit.slice(0, 8)}
        {doc.dirty ? " (dirty tree)" : ""} · {doc.suite} · seed {doc.datasetSeed}
        {doc.synthetic ? " · synthetic artifacts" : ""} · {doc.createdAt}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--card)]">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[var(--border)] text-[var(--muted)]">
            <tr>
              <th className="px-3 py-2">Scenario</th>
              <th className="px-3 py-2">Variant</th>
              <th className="px-3 py-2">Items</th>
              <th className="px-3 py-2">Function</th>
              <th className="px-3 py-2">Gas</th>
              <th className="px-3 py-2">Calldata</th>
              <th className="px-3 py-2">Manifest</th>
              <th className="px-3 py-2">Proof</th>
              <th className="px-3 py-2">Pass</th>
            </tr>
          </thead>
          <tbody>
            {mined.map((row, index) => (
              <tr key={`${row.functionName}-${row.variant}-${row.artifactCount}-${index}`} className="border-b border-[var(--border)]">
                <td className="px-3 py-2">{row.scenario}</td>
                <td className="px-3 py-2">{row.variant}</td>
                <td className="px-3 py-2">{row.artifactCount}</td>
                <td className="px-3 py-2">{row.functionName}</td>
                <td className="px-3 py-2 font-mono">{row.gasUsed ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{row.calldataBytes ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{row.manifestBytes ?? "—"}</td>
                <td className="px-3 py-2 font-mono">{row.proofBytes ?? "—"}</td>
                <td className="px-3 py-2">{row.pass ? "pass" : "fail"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {doc.timings.length > 0 && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 text-xs">
          <h2 className="font-medium">Off-chain preparation</h2>
          <ul className="mt-2 space-y-1">
            {doc.timings.map((timing) => (
              <li key={`${timing.operation}-${timing.variant}-${timing.artifactCount}`}>
                {timing.variant} · {timing.artifactCount} items · {timing.operation}: median {timing.medianMs} ms, p95{" "}
                {timing.p95Ms} ms, n={timing.trials}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
