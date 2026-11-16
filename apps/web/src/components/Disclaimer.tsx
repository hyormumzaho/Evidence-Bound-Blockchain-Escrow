export function Disclaimer() {
  return (
    <aside className="rounded-2xl border border-amber-700/20 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-950">
      <strong className="font-semibold">Mock funds only.</strong> This application is a research
      prototype. It uses local Anvil and non-redeemable Mock USDC. It does not move real money, and
      a successful evidence hash check does not prove work quality.
    </aside>
  );
}
