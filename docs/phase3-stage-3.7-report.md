# Phase 3 — Stage 3.7 Report

**Stage:** 3.7 — Evidence Submission  
**Date:** 2026-11-13  
**Status:** COMPLETE — stop here; Stage 3.8 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.7

---

## 1. Goal

Provider uploads / URL evidence → Evidence Library commitments → MetaMask `submitDelivery` for both escrow variants → SQLite persist + participant-only export, with immutable binding to on-chain escrow + deliveryVersion.

---

## 2. Implemented features

1. **Evidence Submission UI** on escrow room (`EvidenceSubmission`):
   - Add file items via existing SIWE-protected `/api/uploads`
   - Add URL references (`hashUrlReference`)
   - Preview contentHash + leaf commitment before submit
   - MetaMask `submitDelivery` (individual commitments[] / merkle root + declaredCount)
   - Tx pending / success / error + hash; wait for receipt; confirm to SQLite
   - Idempotent “Retry save (no re-submit)” after successful tx
2. **Evidence Library only** (`buildManifest` / `buildExport` / `toIndividualSubmit` / `toMerkleSubmit` / hashing helpers) — no custom Merkle/hash stack.
3. **Server confirm** rebuilds commitments from disk (rehash files) + URL strings; matches `DeliverySubmitted` event `bundleCommitment` / itemCount; refuses non-provider and conflicting evidence for the same deliveryVersion.
4. **Export** `GET .../evidence/:version/export` — full `buildExport` JSON (manifest, leaves, proofs) for escrow participants only.
5. **Gating** — `canSubmitEvidence` only for provider in Funded / RevisionRequested before delivery deadline.
6. Explicit UI note: **declaredItemCount is not cryptographically proven by the Merkle root.**

---

## 3. Files added / changed

### Added

- `apps/web/src/lib/evidence/build.ts`
- `apps/web/src/lib/evidence/events.ts`
- `apps/web/src/lib/evidence/persist.ts`
- `apps/web/src/lib/validation/evidence.ts`
- `apps/web/src/components/escrow/EvidenceSubmission.tsx`
- `apps/web/src/app/api/escrows/[variant]/[id]/evidence/route.ts`
- `apps/web/src/app/api/escrows/[variant]/[id]/evidence/confirm/route.ts`
- `apps/web/src/app/api/escrows/[variant]/[id]/evidence/[version]/export/route.ts`
- `apps/web/test/evidence-submission.test.ts`
- `docs/phase3-stage-3.7-report.md`

### Changed

- `apps/web/src/components/escrow/EscrowRoom.tsx` — wire Evidence Submission
- `apps/web/src/lib/escrow/states.ts` — `canSubmitEvidence`
- `apps/web/src/lib/http.ts` — 409 for immutable / already-bound
- `apps/web/src/app/page.tsx` — Stage 3.7 copy
- `docs/phase3-implementation-plan.md` — status → Stage 3.7 complete

### Not changed

- Solidity business logic
- Dispute / revision / settlement / withdraw UI (Stage 3.8+)
- Evidence Library algorithms (consumed only)

---

## 4. Test / build results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK |
| `pnpm test:evidence` | **28/28** |
| `pnpm test:web` | **23/23** (Anvil e2e skipped when RPC down; unit/gating always run) |
| `forge test --root packages/contracts` | **66/66** |

### Coverage (unit / service)

| Case | Result |
| --- | --- |
| File hash + URL hash via Evidence Library | PASS |
| Individual commitments + Merkle root/proofs from library | PASS |
| Wrong escrowId / deliveryVersion / salt change commitments | PASS |
| Only provider can submit in Funded / RevisionRequested | PASS |
| Created / Delivered / non-provider cannot submit | PASS |

### Anvil e2e (run with Anvil + `pnpm deploy:local`, evidence file alone)

Command: `pnpm exec vitest run test/evidence-submission.test.ts` (from `apps/web`)

| Case | Result |
| --- | --- |
| Individual: Create → Approve → Fund → Submit → VerifyEvidence Valid | PASS |
| Merkle: Create → Approve → Fund → Submit → VerifyEvidence Valid | PASS |
| Non-provider submitDelivery rejected | PASS |
| Non-provider confirm rejected | PASS |
| Idempotent confirm (same tx + evidence) | PASS |
| Conflicting salt / evidence after persist rejected | PASS |
| Repeat submitDelivery while Delivered rejected | PASS |
| Wrong escrowId leaf → WrongEscrow | PASS |
| Participant export; stranger Forbidden | PASS |

**Note:** Running multiple Anvil e2e files in parallel can race the same deployer/payer nonce (`nonce too low`). Prefer running evidence e2e alone or with file parallelism disabled when Anvil is shared.

### MetaMask

Not automated. Manual path: SIWE as provider → Funded escrow → add file/URL → Submit delivery → confirm MetaMask → wait receipt → export bundle.

---

## 5. Remaining critical issues / known limits

1. **`declaredItemCount` not authenticated by Merkle root** — protocol design; UI labels it as metadata only.
2. **Acceptance / dispute / revision / withdraw UI** — Stage 3.8+.
3. **Independent verifier page** — later stage; export bundle is available for offline/library verify.
4. **URL references commit to the URL string**, not fetched content (Evidence Library semantics).
5. Parallel Vitest Anvil suites can contend on account nonces.

---

## 6. Verdict

**Stage 3.7 COMPLETE.** Cryptographic binding of evidence to chainId / escrow contract / escrowId / deliveryVersion uses `@evidencebound/evidence` only; both variants submit and verify on Anvil; SQLite persistence is idempotent and immutable after confirmation.

Await confirmation before Stage 3.8.
