import { Nav } from "@/components/Nav";
import { SiweButton } from "@/components/auth/SiweButton";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { EscrowRoom } from "@/components/escrow/EscrowRoom";

type Props = { params: Promise<{ variant: string; id: string }> };

export default async function EscrowRoomPage({ params }: Props) {
  const { variant, id } = await params;
  return (
    <main className="space-y-8">
      <header className="space-y-3 border-b border-[var(--border)] pb-6">
        <Nav />
        <h1 className="text-3xl font-semibold tracking-tight">Escrow room</h1>
      </header>
      <ConnectButton />
      <SiweButton />
      <EscrowRoom variant={variant} id={id} />
    </main>
  );
}
