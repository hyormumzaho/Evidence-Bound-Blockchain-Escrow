"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "./StatusBadge";

type EscrowRow = {
  escrowRowId: number;
  variant: string;
  escrowId: number | null;
  payer: string;
  provider: string;
  arbitrator: string;
  agreementHash: string;
  createdTx: string | null;
  stateCache: string | null;
  roomPath: string | null;
};

export function EscrowList() {
  const [rows, setRows] = useState<EscrowRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/escrows");
        const body = (await res.json()) as { escrows?: EscrowRow[]; error?: string };
        if (!res.ok) {
          if (!cancelled) {
            setRows([]);
            setError(body.error ?? "Failed to load escrows (SIWE required)");
          }
          return;
        }
        if (!cancelled) {
          setRows(body.escrows ?? []);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error && (!rows || rows.length === 0)) {
    return (
      <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
        <h2 className="font-medium">Your escrows</h2>
        <p className="mt-2">{error}</p>
      </section>
    );
  }

  if (!rows) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm text-[var(--muted)]">
        Loading escrows…
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 text-sm shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Your escrows</h2>
        <Link href="/create" className="text-[var(--accent)] underline-offset-4 hover:underline">
          Create new
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[var(--muted)]">No saved escrows yet. Create one after SIWE sign-in.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)]">
          {rows.map((row) => (
            <li key={row.escrowRowId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs uppercase">{row.variant}</span>
                  <span className="font-mono text-xs">#{row.escrowId}</span>
                  <StatusBadge state={row.stateCache} />
                </div>
                <p className="mt-1 font-mono text-xs break-all text-[var(--muted)]">
                  hash {row.agreementHash}
                </p>
              </div>
              {row.roomPath ? (
                <Link
                  href={row.roomPath}
                  className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-xs"
                >
                  Open room
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
