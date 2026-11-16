# Phase 3 — Stage 3.8 Report

**Stage:** 3.8 — Review, Revision, Disputes, Timeouts & Withdraw  
**Date:** 2026-11-13  
**Status:** COMPLETE — stop here; Stage 3.9 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.8

---

## 1. Implemented actions

On-chain actions in Escrow Room (`EscrowActions`), gated by wallet role + `getEscrow` + chain block timestamp:

| Action | Role | States / conditions |
| --- | --- | --- |
| `acceptDelivery` | payer | Delivered, `now ≤ reviewDeadline` |
| `requestRevision` | payer | Delivered, review open, `revisionsUsed < 1`, reason → `keccak256(utf8)` |
| `openDispute` | payer / provider | Funded / Delivered / RevisionRequested (not limited to review window) |
| `resolveDispute` | arbitrator | Disputed, `providerBps` 0..10000 |
| `claimMissedDeliveryRefund` | payer | Funded / RevisionRequested, `now > currentDeliveryDeadline` |
| `claimReviewTimeout` | provider | Delivered, `now > reviewDeadline` |
| `withdraw` | claim holder | `claimable(escrowId, account) > 0` (manual only) |

Also retained Stage 3.6 approve/fund/cancel. Evidence resubmit after revision uses Stage 3.7 UI (`currentDeliveryDeadline`).

UI shows claimable, deadlines, deliveryVersion/revisionsUsed, TxStatus (pending/success/error + hash). Deadlines use `useBlock` timestamp, not browser clock alone.

---

## 2. Files added / changed

### Added

- `apps/web/src/lib/escrow/reason.ts`
- `apps/web/test/lifecycle-actions.ts`
- `apps/web/test/lifecycle-escrow.test.ts`
- `docs/phase3-stage-3.8-report.md`

### Changed

- `apps/web/src/lib/escrow/states.ts` — full lifecycle gating
- `apps/web/src/components/escrow/EscrowActions.tsx` — lifecycle controls
- `apps/web/src/components/escrow/EvidenceSubmission.tsx` — `currentDeliveryDeadline`
- `apps/web/vitest.config.ts` — `fileParallelism: false` (Anvil nonce safety)
- `apps/web/test/fund-escrow.test.ts` / `evidence-submission.test.ts` — updated action inputs
- `apps/web/src/app/page.tsx` — Stage 3.8 copy
- `docs/phase3-implementation-plan.md` — status → 3.8 complete

### Not changed

- Solidity business logic
- Stage 3.9 verifier / polish

---

## 3. Test / build results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK |
| `pnpm test:evidence` | **28/28** |
| `pnpm test:web` | **27/27** |
| `forge test --root packages/contracts` | **66/66** |

### Unit / gating coverage

| Case | Result |
| --- | --- |
| reasonHash = keccak256(utf8); empty rejected | PASS |
| Accept / revision role + review window | PASS |
| Revision limit (max 1) | PASS |
| Dispute opener roles; resolve arbitrator-only | PASS |
| Missed delivery / review timeout timing | PASS |
| Withdraw only when claimable > 0 | PASS |
| providerBps / MAX_REVISIONS constants | PASS |

---

## 4. Anvil E2E (both variants)

Run with Anvil + `pnpm deploy:local`; Vitest files sequential.

For **individual** and **merkle**:

| Path | Result |
| --- | --- |
| Delivery → Accept → Withdraw; double withdraw fails | PASS |
| Delivery → Revision → Resubmit → Accept; 2nd revision fails | PASS |
| Delivery → Dispute → Resolve (2500 bps) → Withdraw both; wrong roles / bps>10000 fail; timeouts frozen while disputed | PASS |
| Missed delivery → Refund → Withdraw; early claim fails | PASS |
| Review timeout → Settlement → Withdraw; early claim fails | PASS |

### MetaMask

Not automated. Manual: connect correct role → perform gated action → confirm tx → refresh claimable/state.

---

## 5. Remaining important issues

1. **Arbitrator liveness** — dispute freezes timeouts until resolve (protocol / D1).
2. **declaredItemCount** still not authenticated by Merkle root (unchanged).
3. **Independent verifier page** — Stage 3.9+ if planned.
4. Anvil e2e still optional when RPC/deploy missing (unit gates always run).

---

## 6. Verdict

**Stage 3.8 COMPLETE.** Full escrow lifecycle works for both variants via existing contracts; UI follows on-chain rules only.

Await confirmation before Stage 3.9.
