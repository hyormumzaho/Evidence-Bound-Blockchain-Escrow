import { Disclaimer } from "@/components/Disclaimer";
import { Nav } from "@/components/Nav";
import { NetworkGuard } from "@/components/NetworkGuard";
import { SiweButton } from "@/components/auth/SiweButton";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { EscrowList } from "@/components/escrow/EscrowList";

export default function HomePage() {
  return (
    <main className="space-y-8">
      <header className="space-y-3 border-b border-[var(--border)] pb-6">
        <Nav />
        <p className="text-sm tracking-[0.2em] text-[var(--muted)] uppercase">Research prototype</p>
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--fg)]">EvidenceBound Escrow</h1>
        <p className="max-w-2xl text-base leading-relaxed text-[var(--muted)]">
          One escrow room for individual hashes, a canonical manifest hash, or a Merkle root. Mock tokens only.
        </p>
      </header>

      <Disclaimer />
      <ConnectButton />
      <SiweButton />
      <NetworkGuard />
      <EscrowList />

      <section className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
        Create an agreement, approve it, fund it, submit evidence, then accept or dispute. Measured costs are on
        the Measurements page after <code>pnpm experiment:small</code>.
      </section>
    </main>
  );
}
