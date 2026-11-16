# Phase 3 — Stage 3.4 Report

**Stage:** 3.4 — SQLite + Secure File Storage (+ minimal SIWE / 3.4b)  
**Date:** 2026-11-13  
**Status:** COMPLETE — stop here; Stage 3.5 not started  
**Plan:** `docs/phase3-implementation-plan.md` §§ 3.4 / 3.4b

---

## 1. Goal

Provide local SQLite metadata, path-safe private uploads, and SIWE session ACL so evidence bytes can be stored and downloaded only by escrow participants. SQLite is never payment authority. No escrow create/fund/dispute UI.

---

## 2. Implemented features

1. **Drizzle + better-sqlite3** with `DATABASE_URL` / `UPLOAD_DIR` env.
2. **Schema:** `escrows` (incl. staging), `agreements`, `evidence_deliveries`, `evidence_items`, `files`, `auth_nonces`, `sessions`.
3. **Migrations:** `apps/web/src/lib/db/migrations/0001_init.sql` applied on DB open.
4. **Storage:** random 32-hex `storageKey` under `UPLOAD_DIR` (outside `public/`); traversal rejected.
5. **Limits:** 10 MiB / file, 50 MiB / escrow staging total.
6. **Hashing:** `@evidencebound/evidence` `hashFileBytes` on upload + re-check on download.
7. **APIs:**
   - `GET /api/auth/nonce`, `POST /api/auth/verify`, `POST /api/auth/logout`, `GET /api/auth/me`
   - `POST /api/escrows/staging` — minimal pre-chain row bound to payer/provider/arbitrator
   - `POST /api/uploads`, `GET /api/uploads/[storageKey]`
8. **SIWE:** EIP-4361 via `siwe` message + **viem** `verifyMessage` (no server private keys); httpOnly `eb_session` cookie; nonce expiry; SameSite=Lax + origin check on mutating routes.
9. **Authz:** session required; address must be participant on the escrow/staging row.
10. **Zod** validation for auth + staging + upload meta.
11. **Vitest** integration tests for the required failure modes.

---

## 3. Files added / changed

### Added (high level)

- `apps/web/src/lib/db/{schema,client,migrate}.ts` + `migrations/0001_init.sql`
- `apps/web/src/lib/paths.ts`
- `apps/web/src/lib/storage/{files,limits}.ts`
- `apps/web/src/lib/auth/{siwe,session,access}.ts`
- `apps/web/src/lib/uploads/service.ts`
- `apps/web/src/lib/validation/{auth,uploads}.ts`
- `apps/web/src/lib/http.ts`
- `apps/web/src/app/api/auth/{nonce,verify,logout,me}/route.ts`
- `apps/web/src/app/api/escrows/staging/route.ts`
- `apps/web/src/app/api/uploads/route.ts`
- `apps/web/src/app/api/uploads/[storageKey]/route.ts`
- `apps/web/test/{helpers,uploads-auth.test}.ts`
- `apps/web/vitest.config.ts`, `drizzle.config.ts`
- `docs/phase3-stage-3.4-report.md`

### Changed

- `apps/web/package.json` — drizzle, better-sqlite3, zod, siwe, vitest; `test` / `data:reset`
- Root `package.json` — `test:web`; `test` includes web
- `apps/web/next.config.ts` — `serverExternalPackages: ['better-sqlite3']`
- `apps/web/.env.example`, `README.md`, home page copy
- `docs/phase3-implementation-plan.md` status → Stage 3.4 complete
- `pnpm-lock.yaml`

### Not changed

- Solidity business logic
- Escrow create / fund / delivery submit UI (Stage 3.5+)

---

## 4. Build and test results

| Command | Result |
| --- | --- |
| `pnpm build:evidence` | OK |
| `pnpm build:web` | OK (auth + upload API routes present) |
| `pnpm test:evidence` | **28/28** |
| `forge test --root packages/contracts` | **66/66** |
| `pnpm test:web` | **9/9** |

### Web integration coverage

| Case | Result |
| --- | --- |
| Successful upload + download | PASS |
| Invalid SIWE signature | PASS |
| Expired session | PASS |
| Expired SIWE nonce | PASS |
| Stranger / non-participant access | PASS |
| Path traversal storage keys | PASS |
| File size > 10 MiB | PASS |
| Content hash mismatch | PASS |

---

## 5. Staging flow (minimal)

Because on-chain escrow may not exist yet:

1. Authenticated user `POST /api/escrows/staging` with roles + variant + contract address.
2. Creator must be one of payer/provider/arbitrator.
3. Uploads attach to `escrowRowId` (`is_staging=true`, `escrow_id` null).
4. Stage 3.5 can later link the row to a real on-chain `escrowId`.

---

## 6. Remaining issues

1. **`better-sqlite3` native build** must be approved (`pnpm approve-builds better-sqlite3`) on fresh machines / Node upgrades.
2. **No upload UI yet** — API + tests only; Stage 3.5/3.7 will consume them.
3. **SIWE peer `ethers`** is unused (verify via viem); optional install if tooling warns.

No other blockers for Stage 3.5.

---

## 7. Verdict

# STAGE 3.4 COMPLETE

Ready for **Stage 3.5 — Create escrow + agreement** after explicit confirmation.
