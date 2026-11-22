import { Disclaimer } from "@/components/Disclaimer";
import { Nav } from "@/components/Nav";
import { VerifierForm } from "@/components/evidence/VerifierForm";

export default function VerifierPage() {
  return (
    <main className="space-y-6">
      <Nav />
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Independent verifier</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          Import an evidence export and an artifact. The verdict reads the commitment from the configured
          contract. The database is not consulted.
        </p>
      </header>
      <Disclaimer />
      <VerifierForm />
    </main>
  );
}
