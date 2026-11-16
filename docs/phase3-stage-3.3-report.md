# Phase 3 — Stage 3.3 Report

**Stage:** 3.3 — Wallet Integration (wagmi)  
**Date:** 2026-11-09  
**Status:** COMPLETE — stop here; Stage 3.4 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.3

---

## 1. Goal

Connect MetaMask to the Next.js app via **wagmi 2** + TanStack Query, target Anvil **31337**, surface connect/disconnect/wrong-network UX, prepare `TxStatus`, and prove contract view reads through wagmi after connect. No business transactions, SQLite, SIWE, or Solidity changes.

---

## 2. Implemented features

1. **Dependencies:** `wagmi@2.14.16`, `@tanstack/react-query@5.107.1` (keeps existing `viem@2.37.9`).
2. **`Web3Providers`** — `WagmiProvider` + `QueryClientProvider` in root layout.
3. **`wagmiConfig`** — Anvil-only chain, MetaMask `injected({ target: "metaMask" })`, HTTP transport to local RPC, SSR + cookie storage. `injected` imported from `wagmi` (not `wagmi/connectors`) to avoid WalletConnect/Coinbase barrel pulls.
4. **`ConnectButton`** — connect, show truncated address + chainId, disconnect, Switch to Anvil.
5. **Anvil switch / add** — `switchToAnvil`: `wallet_switchEthereumChain`, on 4902 → `wallet_addEthereumChain`, then switch again.
6. **`NetworkGuard`** — existing public RPC/bytecode panel + wallet network subsection (connected / wrong network / switch).
7. **`WalletContractReads`** — after connect on 31337, `useReadContract` for `nextEscrowId` / `evidenceMode` / `token` on both escrows.
8. **`TxStatus`** — reusable `idle | pending | success | error` chip (preview on home; no writes).
9. **Error copy** — MetaMask missing, user reject, disconnect, wrong network, RPC down, switch rejected (`formatWalletError`).

---

## 3. Files added / changed

### Added

- `apps/web/src/lib/wagmi/config.ts`
- `apps/web/src/lib/wagmi/errors.ts`
- `apps/web/src/lib/wagmi/switch-anvil.ts`
- `apps/web/src/components/providers/Web3Providers.tsx`
- `apps/web/src/components/wallet/ConnectButton.tsx`
- `apps/web/src/components/wallet/WalletContractReads.tsx`
- `apps/web/src/components/tx/TxStatus.tsx`
- `docs/phase3-stage-3.3-report.md`

### Changed

- `apps/web/package.json` / `pnpm-lock.yaml` — wagmi + react-query
- `apps/web/src/app/layout.tsx` — providers
- `apps/web/src/app/page.tsx` — ConnectButton, WalletContractReads, TxStatus preview
- `apps/web/src/components/NetworkGuard.tsx` — wallet network integration
- `apps/web/src/lib/chain/status.ts` — expose `addresses` for client wagmi reads
- `apps/web/README.md` — manual MetaMask checklist
- `docs/phase3-implementation-plan.md` — status → Stage 3.3 complete

### Not changed

- Solidity sources / protocol
- Escrow create/fund/dispute txs
- SQLite / uploads / SIWE

---

## 4. Build and test results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK (clean compile; First Load ~174 kB on `/`) |
| `pnpm test:evidence` | **28/28** |
| `forge test --root packages/contracts` | **66/66** |

---

## 5. MetaMask verification

**Automated browser MetaMask flow:** not available in this environment (no interactive extension / headed wallet).

**Manual checklist** (local):

```bash
anvil --chain-id 31337
export PRIVATE_KEY=<anvil#0> PAYER_PRIVATE_KEY=<anvil#1>
pnpm deploy:local && pnpm check:chain
pnpm dev:web
```

Then in Chrome/Brave with MetaMask:

1. Import an Anvil account private key from the Anvil banner.
2. Open the app → **Connect MetaMask** (reject once to confirm error copy; connect again).
3. If not on 31337 → **Switch to Anvil** (accept add-network if first time).
4. Confirm NetworkGuard shows wallet **anvil ok**.
5. Confirm **Wallet contract reads** shows `mode=individual-hash` / `merkle-root` and `nextId`.
6. **Disconnect** → UI returns to disconnected; reconnect works.
7. Switch MetaMask to another chain → wrong-network banner + switch button.

---

## 6. Remaining issues

1. **wagmi pin:** `2.14.16` instead of latest `2.19.x` — `2.19` + `wagmi/connectors` barrel failed Next build on optional `@x402/*` / Base Account deps. Core `injected` from `wagmi@2.14.16` builds cleanly and is enough for MetaMask + Anvil.
2. **Interactive MetaMask** not executed in CI/agent — manual steps above.
3. No other blockers for Stage 3.4.

---

## 7. Verdict

# STAGE 3.3 COMPLETE

Ready for **Stage 3.4 — SQLite + secure uploads** after explicit confirmation.
