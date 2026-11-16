# Phase 3 — Stage 3.6 Report

**Stage:** 3.6 — Approve Agreement + Funding + ERC-20  
**Date:** 2026-11-13  
**Status:** COMPLETE — stop here; Stage 3.7 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.6

---

## 1. Goal

Provider `approveAgreement`, payer MockUSDC ERC-20 `approve` + `fund`, and payer `cancelUnfunded` on the existing escrow room — driven by on-chain state for both variants.

---

## 2. Implemented features

1. **`EscrowActions`** on `/escrow/[variant]/[id]`:
   - Live `getEscrow` / `balanceOf` / `allowance` via wagmi
   - **Approve agreement** (provider only, Created, hash match)
   - **Approve MockUSDC** (payer, when allowance &lt; amount)
   - **Fund escrow** (payer, after provider + allowance + balance)
   - **Cancel unfunded** (payer, Created)
2. **Action gating** from on-chain view only (`availableEscrowActions`) — not SQLite.
3. **TxStatus** + disable while pending; wrong network / reject handled.
4. Clear separation of ERC-20 `approve` vs escrow `approveAgreement`.

---

## 3. Files added / changed

### Added

- `apps/web/src/lib/escrow/states.ts`
- `apps/web/src/components/escrow/EscrowActions.tsx`
- `apps/web/test/fund-escrow.test.ts`
- `docs/phase3-stage-3.6-report.md`

### Changed

- `apps/web/src/components/escrow/EscrowRoom.tsx` — wire actions + live amounts
- `apps/web/src/app/page.tsx` — Stage 3.6 copy
- `docs/phase3-implementation-plan.md` — status → Stage 3.6 complete

### Not changed

- Solidity business logic
- Delivery / dispute / withdraw UI (Stage 3.7+)

---

## 4. Test / build results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK |
| `pnpm test:evidence` | **28/28** |
| `pnpm test:web` | **19/19** |
| `forge test --root packages/contracts` | **66/66** |

### Coverage

| Case | Result |
| --- | --- |
| Only provider can approveAgreement (helper) | PASS |
| Insufficient allowance / balance gating | PASS |
| Cancel only in Created; no fund when Funded | PASS |
| Wrong network disables actions; reject mapping | PASS |
| Anvil: wrong hash / non-provider approve rejected | PASS |
| Anvil: fund without allowance fails | PASS |
| Anvil: ERC-20 approve → fund → Funded | PASS |
| Anvil: double fund fails | PASS |
| Anvil: cancelUnfunded → Cancelled | PASS |

MockUSDC for payer in e2e: owner `mint` (Anvil account #0) — same as Foundry deploy ownership; no backend mint API.

### MetaMask

Not automated. Manual: connect as provider → Approve agreement → switch to payer → Approve MockUSDC → Fund (or Cancel while Created).

---

## 5. Remaining issues

1. Room still loads SQLite metadata for agreement JSON; **actions use chain only**.
2. MetaMask UX requires manual check.
3. No critical blockers for Stage 3.7.

---

## 6. Verdict

# STAGE 3.6 COMPLETE

Ready for **Stage 3.7 — Evidence Submission** after explicit confirmation.
