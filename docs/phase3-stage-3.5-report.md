# Phase 3 — Stage 3.5 Report

**Stage:** 3.5 — Create Escrow + Agreement  
**Date:** 2026-11-13  
**Status:** COMPLETE — stop here; Stage 3.6 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.5

---

## 1. Goal

Create real on-chain escrows via MetaMask using existing Solidity contracts and `@evidencebound/evidence` agreement hashing, persist metadata from the `EscrowCreated` event into SQLite, and expose a minimal dashboard + escrow room. No approve/fund/delivery yet.

---

## 2. Implemented features

1. **`/create`** — variant, provider, arbitrator, MockUSDC amount (6 decimals), delivery/review/revision windows, payer from connected wallet, agreement preview.
2. **Agreement** — `buildAgreement` / `canonicalizeAgreement` / `hashAgreement` only; `templateHash = keccak256("website-milestone-v1")`.
3. **Tx** — wagmi `writeContract(createEscrow…)` → wait receipt → parse **`EscrowCreated`** (no `nextEscrowId - 1`).
4. **Persist** — `POST /api/escrows/confirm` re-reads receipt + `getEscrow`, checks session=payer, agreementHash/parties/amount/contract/chainId, upserts SQLite + agreement JSON; idempotent retry; optional staging link with participant match.
5. **Dashboard** — SIWE-gated list with room links.
6. **`/escrow/[variant]/[id]`** — participants, amount, status, agreementHash, tx hash, canonical agreement (+ live `getEscrow` when RPC up).
7. **SIWE button** on dashboard/create/room for metadata ACL.

---

## 3. Files added / changed

### Added

- `apps/web/src/lib/escrow/{amount,agreement,events,persist,template}.ts`
- `apps/web/src/lib/validation/escrow.ts`
- `apps/web/src/app/api/escrows/confirm/route.ts`
- `apps/web/src/app/api/escrows/route.ts`
- `apps/web/src/app/api/escrows/[variant]/[id]/route.ts`
- `apps/web/src/app/create/page.tsx`
- `apps/web/src/app/escrow/[variant]/[id]/page.tsx`
- `apps/web/src/components/escrow/{CreateEscrowForm,EscrowList,EscrowRoom,StatusBadge}.tsx`
- `apps/web/src/components/auth/SiweButton.tsx`
- `apps/web/src/components/Nav.tsx`
- `apps/web/test/create-escrow.test.ts`
- `docs/phase3-stage-3.5-report.md`

### Changed

- `apps/web/src/app/page.tsx` — dashboard list + SIWE
- `docs/phase3-implementation-plan.md` — status → Stage 3.5 complete

### Not changed

- Solidity business logic
- Approve / fund / delivery / dispute UI (Stage 3.6+)

---

## 4. Test / build results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK (`/create`, `/escrow/[variant]/[id]`, confirm APIs) |
| `pnpm test:evidence` | **28/28** |
| `pnpm test:web` | **14/14** |
| `forge test --root packages/contracts` | **66/66** |

### Web coverage (Stage 3.5)

| Case | Result |
| --- | --- |
| Agreement hash via Evidence Library | PASS |
| MockUSDC 6-decimal parse / reject | PASS |
| Non-distinct participants | PASS |
| Missing EscrowCreated (no nextId heuristic) | PASS |
| Anvil createEscrow + event parse + persist | PASS (live Anvil) |
| Idempotent SQLite re-confirm | PASS |
| Foreign staging bind rejected | PASS |

### MetaMask

**Not automated** (no interactive extension). Programmatic path used Anvil account #0 via viem `writeContract`.

**Manual checklist:**

1. `anvil --chain-id 31337` → `pnpm deploy:local` → `pnpm dev:web`
2. Import Anvil keys into MetaMask; connect; Switch to Anvil; SIWE sign-in
3. `/create` → preview agreement → confirm `createEscrow`
4. Reject once in MetaMask → error shown; approve → redirect to room
5. Wrong network → form blocks create; Switch to Anvil works
6. Dashboard lists escrow; room shows canonical JSON + tx hash
7. Retry SQLite save if persist fails after successful tx

---

## 5. Remaining issues

1. Cancel-unfunded UI deferred (plan DoD mentioned it; user asked not to start funding/approve flows — cancel can land with 3.6 if desired).
2. MetaMask UX verified programmatically + documented for manual check.
3. No critical blockers for Stage 3.6.

---

## 6. Verdict

# STAGE 3.5 COMPLETE

Ready for **Stage 3.6 — Approve + fund + ERC-20** after explicit confirmation.
