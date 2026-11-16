import Link from "next/link";

export function Nav() {
  return (
    <nav className="flex flex-wrap gap-4 text-sm">
      <Link className="text-[var(--accent)] underline-offset-4 hover:underline" href="/">
        Dashboard
      </Link>
      <Link className="text-[var(--accent)] underline-offset-4 hover:underline" href="/create">
        Create escrow
      </Link>
    </nav>
  );
}
