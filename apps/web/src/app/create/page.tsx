import { Disclaimer } from "@/components/Disclaimer";
import { Nav } from "@/components/Nav";
import { SiweButton } from "@/components/auth/SiweButton";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { CreateEscrowForm } from "@/components/escrow/CreateEscrowForm";

export default function CreatePage() {
  return (
    <main className="space-y-8">
      <header className="space-y-3 border-b border-[var(--border)] pb-6">
        <Nav />
        <h1 className="text-3xl font-semibold tracking-tight">Create escrow</h1>
        <p className="max-w-2xl text-sm text-[var(--muted)]">
          Build a canonical agreement, submit <code>createEscrow</code> via MetaMask, then persist
          metadata from the on-chain <code>EscrowCreated</code> event.
        </p>
      </header>
      <Disclaimer />
      <ConnectButton />
      <SiweButton />
      <CreateEscrowForm />
    </main>
  );
}
