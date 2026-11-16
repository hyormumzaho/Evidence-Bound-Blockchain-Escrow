# Phase 3 Implementation Plan — Local Web Application

**Status:** Stage **3.8 complete** (review, revision, disputes, timeouts, withdraw). Stage 3.9+ not started.  
**Date:** 2026-11-09  
**Depends on:** Phase 1 contracts + Phase 2 Evidence Library (`READY FOR PHASE 3` per `docs/phase2-final-validation.md`)

Verified when the plan was written:

- `apps/` was missing (created in Stage 3.1 as `apps/web`)
- `packages/contracts/src/{IEscrow,EscrowBase,IndividualHashEscrow,MerkleRootEscrow,MockUSDC,EvidenceCommitment}.sol` exist
- `packages/evidence` + `packages/shared` exist; `packages/evidence/dist` present
- Docs listed in §2 are present under `docs/`

---

## 1. Executive Summary

Phase 3 builds a **local-only** Next.js research UI that lets payer / provider / arbitrator run the full escrow lifecycle against Anvil (chainId **31337**), using:

- existing Foundry contracts (`Deploy.s.sol`, `local-demo.sh`);
- existing `@evidencebound/evidence` / `@evidencebound/shared` (no second Merkle/hash stack);
- SQLite + local disk for **metadata and uploads only** — never as payment authority.

The app must support **both** evidence variants with identical business UI, so Phase 4 gas/size comparisons stay fair.

**Out of this phase:** Phase 4 experiment runner, public testnet, LLM features, protocol changes to Solidity.

---

## 2. Current Repository Assessment

### 2.1 Present

| Area | Path / fact |
| --- | --- |
| Contracts | `packages/contracts/src/*` |
| Deploy | `packages/contracts/script/Deploy.s.sol` → MockUSDC + both escrows + mint to payer |
| Local demo | `packages/contracts/script/local-demo.sh` (refuses non-31337) |
| Evidence lib | `packages/evidence` public API in `src/index.ts` |
| Shared types | `packages/shared` |
| Workspace | `pnpm-workspace.yaml` → `packages/*` only |
| Env template | `.env.example` (Anvil keys; no web vars yet) |
| Validation | `docs/phase2-final-validation.md` — 28 Vitest + 66 Foundry |

### 2.2 Missing (Phase 3)

- `apps/web`
- ABIs / addresses package for the app
- SQLite schema / migrations
- Upload storage
- Wallet UI
- Root scripts for “anvil + deploy + web”

### 2.3 Contract surface (verified)

Shared interface: `packages/contracts/src/IEscrow.sol`.

**States:** `None, Created, Funded, Delivered, RevisionRequested, Disputed, Settled, Cancelled`

**Shared functions (EscrowBase / IEscrow):**

| Function | Notes |
| --- | --- |
| `createEscrow(provider, arbitrator, amount, deliveryDeadline, reviewPeriod, revisionDeliveryWindow, agreementHash, templateHash) → escrowId` | caller = payer |
| `approveAgreement(escrowId, agreementHash)` | provider; hash must match |
| `cancelUnfunded(escrowId)` | payer; Created only |
| `fund(escrowId)` | payer; needs approval + allowance; exact amount |
| `requestRevision(escrowId, reasonHash)` | payer; Delivered; review window; max 1 |
| `acceptDelivery(escrowId)` | payer; Delivered; review window |
| `openDispute(escrowId, reasonHash)` | payer or provider; Funded/Delivered/RevisionRequested; **not** limited to review window (D1) |
| `claimMissedDeliveryRefund(escrowId)` | payer; Funded or RevisionRequested; after delivery deadline |
| `claimReviewTimeout(escrowId)` | provider; Delivered; after reviewDeadline |
| `resolveDispute(escrowId, providerBps)` | arbitrator; 0..10000 |
| `withdraw(escrowId)` | claimable[msg.sender] pull |
| Views | `token`, `nextEscrowId`, `claimable`, `stateOf`, `lockedAmount`, `getEscrow`, `evidenceMode`, `hashEvidenceLeaf` |

**IndividualHashEscrow only** (`IndividualHashEscrow.sol`):

- `submitDelivery(uint256 escrowId, bytes32[] commitments)`
- `verifyEvidence(uint256 escrowId, EvidenceLeaf leaf) → EvidenceStatus`
- `commitmentCount`, `commitmentAt`

**MerkleRootEscrow only** (`MerkleRootEscrow.sol`):

- `submitDelivery(uint256 escrowId, bytes32 root, uint32 declaredCount)`
- `verifyEvidence(uint256 escrowId, EvidenceLeaf leaf, bytes32[] proof) → EvidenceStatus`
- `deliveryRoot`, `declaredItemCount` (**declared count is not authenticated by root**)

**MockUSDC** (`MockUSDC.sol`): ERC-20, 6 decimals, `mint(to, amount)` owner-only; standard `approve` / `transferFrom`.

**Constants (EscrowBase):** `MAX_REVISIONS = 1`, `MAX_EVIDENCE_ITEMS = 100`, `BPS_DENOMINATOR = 10000`, `EVIDENCE_SCHEMA_VERSION = 1`.

**Agreement hash chicken/egg (protocol):** agreement **omits escrowId**, includes `escrowContract` + nonce (`docs/protocol-spec.md`). UI can hash agreement **before** `createEscrow` once the deployed escrow address is known.

### 2.4 Evidence Library API (verified `packages/evidence/src/index.ts`)

Use these — do **not** reimplement:

- `buildAgreement` / `canonicalizeAgreement` / `hashAgreement`
- `buildManifest` / `hashManifest` / `canonicalizeManifest`
- `hashFileBytes` / `hashSnapshotBytes` / `hashUrlReference` / `randomSalt`
- `buildExport` / `serializeExport` / `parseExport` / `parseExportJson`
- `toIndividualSubmit` → `{ commitments: Hex[] }`
- `toMerkleSubmit` → `{ root: Hex, declaredCount: number }`
- `verifyExportLeaf` / `verifyLeafMembership`
- Shared: `MAX_EVIDENCE_ITEMS`, `EvidenceStatus`, `OffchainStatus`, schemas

---

## 3. Phase 3 Scope / Out of Scope

### In scope

1. `apps/web` Next.js App Router app in the pnpm workspace.
2. Wallet connect (MetaMask / injected) via wagmi + viem to Anvil 31337.
3. Full lifecycle UI for both escrow variants.
4. SQLite metadata + secure local file storage.
5. Independent evidence verifier page.
6. Mock-funds disclaimer; separate off-chain vs on-chain verify messages.
7. Local DX: scripts to run Anvil, deploy, configure addresses, start web.
8. Tests for web/API/storage + keep existing 28 + 66 green.

### Out of scope

- Solidity / protocol changes
- Phase 4 measurement runner / CSV charts
- Phase 5 LLM / public testnet / Docker-first polish
- Production hosting, real USDC, multisig, indexer network
- Server custody of user private keys
- Claiming evidence proves work quality

---

## 4. Proposed Technology Stack

| Layer | Choice | Rationale / pin criteria |
| --- | --- | --- |
| App | **Next.js 15** (App Router) + React 19 + TypeScript | Matches `docs/implementation-plan.md` Phase 3; App Router for API routes |
| CSS | **Tailwind CSS 4** | Fast research UI; no design-system tax |
| Chain | **wagmi 2** + **viem 2** + **@tanstack/react-query** | Standard wallet UX; typed contracts |
| Wallet | Injected connector (MetaMask) | Local Anvil accounts |
| DB | **SQLite** via **Drizzle ORM** (recommended; needs confirm) | Lightweight, SQL-clear, good for local file DB; Prisma also viable |
| Validation | **Zod** | Shared client/server schemas |
| Evidence | Existing `@evidencebound/evidence` + `@evidencebound/shared` | Already validated |
| Contracts | Foundry artifacts / ABI export from `packages/contracts` | No Hardhat |
| Package mgr | **pnpm@12.16.1** (already pinned) | Extend workspace to `apps/*` |
| Tests | Vitest (unit/API) + Playwright (E2E optional subset) | Align with Phase 2 Vitest |

**Version selection rule:** pin exact versions at scaffold time; prefer wagmi/viem pairs from their peerDependency matrix; Next version must support `transpilePackages: ['@evidencebound/evidence','@evidencebound/shared']` or consume built `dist/`.

**Workspace change required:** `pnpm-workspace.yaml` currently only `packages/*` — add `apps/*`.

---

## 5. Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (MetaMask)                        │
│  UI pages → wagmi/viem → Anvil RPC (31337)                       │
│  Evidence hashing may run client-side (salts stay local) OR      │
│  after SIWE session on server (decision Q-AUTH / Q-HASH)         │
└───────────────┬───────────────────────────┬─────────────────────┘
                │ txs / eth_call            │ HTTPS to Next API
                ▼                           ▼
┌───────────────────────────┐   ┌─────────────────────────────────┐
│ Anvil + Contracts         │   │ Next.js server                   │
│ MockUSDC                  │   │ API routes: uploads, metadata,   │
│ IndividualHashEscrow      │   │ SIWE session, file download      │
│ MerkleRootEscrow          │   │ SQLite (better-sqlite3/libsql)   │
│ AUTHORITY: state, money,  │   │ Disk: data/uploads/<storageKey>  │
│ commitments               │   │ NOT authority for payment        │
└───────────────────────────┘   └─────────────────────────────────┘
                ▲
                │ uses
        @evidencebound/evidence
        (canonical agreement/manifest/export)
```

**Trust boundary (from `docs/architecture.md`):** chain = escrow truth; wallet = authorization for money; SQLite/files = convenience + evidence bytes; server never signs fund/withdraw.

---

## 6. Directory Structure (proposed)

```text
apps/web/
  package.json
  next.config.ts          # transpilePackages / experimental
  .env.example
  drizzle.config.ts
  src/
    app/
      layout.tsx
      page.tsx                    # dashboard
      create/page.tsx
      escrow/[variant]/[id]/page.tsx
      verifier/page.tsx
      api/
        health/route.ts
        auth/nonce/route.ts
        auth/verify/route.ts
        auth/logout/route.ts
        uploads/route.ts
        uploads/[storageKey]/route.ts
        escrows/route.ts
        escrows/[variant]/[id]/route.ts
        agreements/route.ts
        evidence/route.ts
    components/
      wallet/ConnectButton.tsx
      wallet/NetworkGuard.tsx
      escrow/StatusBadge.tsx
      escrow/Timeline.tsx
      escrow/RoleActions.tsx
      evidence/UploadPanel.tsx
      evidence/VerifyPanel.tsx
      tx/TxStatus.tsx
      common/Disclaimer.tsx
    lib/
      chain/config.ts            # chainId 31337, RPCs
      chain/addresses.ts         # from deployments JSON
      chain/abis.ts              # IEscrow + variants + MockUSDC + errors
      chain/read.ts
      chain/write.ts             # wagmi hooks wrappers
      evidence/client.ts         # thin wrappers around @evidencebound/evidence
      db/client.ts
      db/schema.ts
      db/migrations/
      storage/files.ts           # path-safe storageKey IO
      auth/siwe.ts
      auth/session.ts
      validation/*.ts            # zod
    hooks/
      useEscrow.ts
      useEscrowList.ts
      useTokenAllowance.ts
      useRole.ts
    styles/globals.css
  data/                          # gitignored: sqlite + uploads
packages/contracts/
  deployments/31337.json         # written by deploy script (new helper OK)
  abis/                          # optional exported JSON ABIs
```

**Layer responsibilities**

| Layer | Responsibility |
| --- | --- |
| `app/` pages | Composition, no direct SQL |
| `components/` | Presentational + local UX state |
| `lib/chain` | viem clients, ABI, address resolution, decode errors |
| `lib/evidence` | Call Phase 2 library only |
| `lib/db` | Metadata CRUD |
| `lib/storage` | Bytes on disk keyed by storageKey |
| `lib/auth` | SIWE session for **file** access, not payments |
| API routes | Authz checks, size limits, no private keys |

---

## 7. Smart Contract Integration Matrix

Sources: `IEscrow.sol`, `IndividualHashEscrow.sol`, `MerkleRootEscrow.sol`, `MockUSDC.sol`, `EscrowBase.sol` errors.

| Contract | Function | Caller | Parameters | Preconditions | State transition | Events | UI action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Individual **or** Merkle | `createEscrow` | payer | provider, arbitrator, amount, deliveryDeadline, reviewPeriod, revisionDeliveryWindow, agreementHash, templateHash | distinct nonzero addrs; amount>0; hashes≠0; deadline≥now; durations>0 | → Created | `EscrowCreated` | Create form submit |
| Both | `approveAgreement` | provider | escrowId, agreementHash | Created; not already approved; hash match | providerApproved=true | `ProviderApproved` | Approve agreement |
| Both | `cancelUnfunded` | payer | escrowId | Created | → Cancelled | `EscrowCancelled` | Cancel |
| MockUSDC | `approve` | payer | escrow, amount | balance sufficient preferred | allowance set | `Approval` | Approve tokens |
| Both | `fund` | payer | escrowId | Created; approved; now≤deliveryDeadline; exact transfer | → Funded | `EscrowFunded` | Fund |
| Individual | `submitDelivery` | provider | escrowId, commitments[] | Funded or RevisionRequested; window open; 1..100; nonzero | → Delivered; version++ | `DeliverySubmitted` | Submit evidence |
| Merkle | `submitDelivery` | provider | escrowId, root, declaredCount | same; root≠0; count 1..100 | → Delivered | `DeliverySubmitted` | Submit evidence |
| Both | `acceptDelivery` | payer | escrowId | Delivered; now≤reviewDeadline | → Settled; provider 10000 bps | `EscrowSettled` | Accept |
| Both | `requestRevision` | payer | escrowId, reasonHash | Delivered; review open; revisionsUsed<1; reason≠0 | → RevisionRequested | `RevisionRequested` | Request revision |
| Both | `openDispute` | payer/provider | escrowId, reasonHash | Funded/Delivered/RevisionRequested; reason≠0 | → Disputed | `DisputeOpened` | Open dispute |
| Both | `claimMissedDeliveryRefund` | payer | escrowId | Funded/RevisionRequested; now>currentDeliveryDeadline | → Settled; 0 bps | `EscrowSettled` | Claim refund |
| Both | `claimReviewTimeout` | provider | escrowId | Delivered; now>reviewDeadline | → Settled; 10000 bps | `EscrowSettled` | Claim timeout |
| Both | `resolveDispute` | arbitrator | escrowId, providerBps | Disputed; bps≤10000 | → Settled | `EscrowSettled` | Resolve |
| Both | `withdraw` | claim holder | escrowId | claimable>0 | claimable→0; transfer | `Withdrawal` | Withdraw |
| Individual | `verifyEvidence` | anyone (view) | escrowId, leaf | — | none | — | Verifier / review |
| Merkle | `verifyEvidence` | anyone (view) | escrowId, leaf, proof | — | none | — | Verifier / review |
| MockUSDC | `mint` | token owner | to, amount | onlyOwner | supply++ | `Transfer` | Dev faucet UI (local) |

**UI must decode custom errors** from EscrowBase (`Unauthorized`, `InvalidState`, `ProviderNotApproved`, `IncorrectFundingAmount`, `ReviewWindowClosed`, …).

**Reads for room page:** `getEscrow`, `stateOf`, `lockedAmount`, `claimable(id, account)`, `token`, ERC-20 `balanceOf`/`allowance`, plus variant views (`commitmentAt` / `deliveryRoot`).

**Escrow discovery without indexer (local):**

1. Primary: SQLite rows created when user participates / imports id.
2. Backfill: `eth_getLogs` for `EscrowCreated` from deployment block (Anvil-friendly).
3. Optional: scan `1 .. nextEscrowId-1` for demos with few escrows.

---

## 8. Evidence Library Integration

### 8.1 Create agreement (before createEscrow)

```text
buildAgreement({ ..., escrowContract, token, chainId: 31337, maxRevisions: 1 })
hashAgreement(doc) → agreementHash
```

Store canonical JSON + hash in SQLite; show hash in wallet tx UI.

`templateHash`: keccak of template id/content (UI constant e.g. website-milestone-v1) — already used in Phase 1 demos.

### 8.2 Delivery (provider)

```text
for each file:
  storageKey = random id (server)
  contentHash = hashFileBytes(bytes)   // prefer same environment that holds salt policy
  salt = randomSalt()
buildManifest({ chainId, escrowContract, escrowId, deliveryVersion, items })
buildExport(manifest)
Individual: toIndividualSubmit(export) → submitDelivery(id, commitments)
Merkle:     toMerkleSubmit(export)     → submitDelivery(id, root, declaredCount)
```

`deliveryVersion` for next submit = `getEscrow().deliveryVersion + 1` (first delivery from 0 → 1).

### 8.3 Verification

1. Off-chain: `verifyExportLeaf` (+ artifact) → may yield `ContentHashMismatch` / `MissingArtifact` / `InvalidExport`.
2. On-chain: `verifyEvidence` → `EvidenceStatus` 0..7.
3. UI labels must **not** conflate the two (`docs/evidence-format.md`).

### 8.4 Research fairness

Same upload UI, same caps (≤100), same agreement fields, same deadlines UX for both variants — only commitment encoding differs.

---

## 9. Pages and User Flows

### Navigation

- `/` Dashboard  
- `/create` Create escrow (variant select)  
- `/escrow/individual/[id]` and `/escrow/merkle/[id]` Escrow room  
- `/verifier` Independent verifier  
- Global: Connect wallet, network badge, mock-funds disclaimer  

### A. Dashboard `/`

**Data:** wallet address; SQLite escrows where user is participant **enriched** with live `getEscrow`/`stateOf`; optional log backfill.  
**Actions:** create, open room, filter by state/role/variant.  
**States:** disconnected, wrong network, loading, empty, error.

### B. Create `/create`

**Data:** addresses (provider, arbitrator), amount (UI decimal → 6-dec base units), deadlines (absolute unix / duration helpers), template, variant.  
**Flow:** build+hash agreement → preview → `createEscrow` → persist metadata with returned id → redirect room.  
**Errors:** ParticipantsNotDistinct, DeadlineInPast, user reject, wrong chain.

### C. Agreement approval (room tab)

Provider sees canonical agreement + stored on-chain `agreementHash`; must match `hashAgreement`. Then `approveAgreement`.

### D. Funding

Show balance, allowance, amount. Steps: `approve` (if needed) → `fund`. Handle `ProviderNotApproved`, `IncorrectFundingAmount`, `DeliveryDeadlinePassed`.

### E. Delivery submission

Upload ≤100 files; show progress; build export; submit variant-specific tx; store export JSON + salts metadata in DB (salts sensitivity = decision).

### F. Review

List items; download via authz; run off-chain verify; optional on-chain verify; Accept / Revision / Dispute; show `reviewDeadline`.

### G. Disputes

Open dispute (reason text → `reasonHash = keccak256(utf8)`); arbitrator `resolveDispute` with bps slider 0–10000; explain rounding to payer.

### H. Withdrawals

Show `claimable`; `withdraw`; explorer-less tx hash display.

### I. Verifier `/verifier`

Upload export JSON + artifact; recompute; binding checks; call on-chain verify if addresses configured; explicit disclaimer: integrity ≠ quality.

### Room timeline component

Created → Approved? → Funded → Delivered (vN) → Revision? → Disputed? → Settled → Withdrawals.

Role-gated action panel: only show txs the connected address can send **and** state allows (still re-check on-chain at click time — race with deadlines).

---

## 10. SQLite Schema (proposed)

Authority note: columns like `state_cache` are **hints** only; UI refreshes from chain before money actions.

```sql
-- deployments / app config can live in JSON; optional table:
-- app_meta(key, value)

escrows(
  id INTEGER PRIMARY KEY,              -- app row id
  chain_id INTEGER NOT NULL,
  variant TEXT NOT NULL CHECK(variant IN ('individual','merkle')),
  contract_address TEXT NOT NULL,
  escrow_id INTEGER NOT NULL,         -- on-chain id
  payer TEXT NOT NULL,
  provider TEXT NOT NULL,
  arbitrator TEXT NOT NULL,
  agreement_hash TEXT NOT NULL,
  template_hash TEXT NOT NULL,
  created_tx TEXT,
  created_block INTEGER,
  state_cache TEXT,                    -- denormalized, nullable
  UNIQUE(chain_id, contract_address, escrow_id)
);

agreements(
  id INTEGER PRIMARY KEY,
  escrow_row_id INTEGER NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  canonical_json TEXT NOT NULL,
  agreement_hash TEXT NOT NULL,
  UNIQUE(escrow_row_id)
);

evidence_deliveries(
  id INTEGER PRIMARY KEY,
  escrow_row_id INTEGER NOT NULL REFERENCES escrows(id) ON DELETE CASCADE,
  delivery_version INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  export_json TEXT NOT NULL,          -- full envelope
  submit_tx TEXT,
  UNIQUE(escrow_row_id, delivery_version)
);

evidence_items(
  id INTEGER PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES evidence_deliveries(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL,
  evidence_type TEXT NOT NULL,        -- string label
  content_hash TEXT NOT NULL,
  salt TEXT NOT NULL,                 -- see Q-SALT
  byte_length INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT,             -- private metadata only
  UNIQUE(delivery_id, item_index)
);

files(
  storage_key TEXT PRIMARY KEY,
  absolute_relpath TEXT NOT NULL,     -- relative under data/uploads only
  byte_length INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  owner_address TEXT NOT NULL         -- uploader; authz gate
);

auth_nonces(
  address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(address, nonce)
);

sessions(
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_escrows_participants ON escrows(payer, provider, arbitrator);
CREATE INDEX idx_files_owner ON files(owner_address);
```

**Migrations:** Drizzle Kit SQL migrations committed under `apps/web/src/lib/db/migrations`.  
**Cleanup:** local `pnpm data:reset` deletes `data/` (documented); never auto-delete on Anvil restart without warning.

**Chain vs DB drift:** if `getEscrow` reverts UnknownEscrow or hash mismatch → mark row `orphaned` / show “redeploy detected”.

---

## 11. File Storage Architecture

| Rule | Design |
| --- | --- |
| storageKey | `crypto.randomUUID()` or 32-byte hex; **never** user path |
| Path | `data/uploads/{storageKey}` only; reject `..`, `/`, `\` |
| Size | recommend **10 MiB / file**, **100 files**, **50 MiB / delivery** (confirm) |
| Types | allowlist MIME/extension for demo (pdf,png,jpg,txt,zip,…); still hash raw bytes |
| Execute | store outside web root; serve via API with `Content-Disposition: attachment`; no static public exec |
| URL refs | store URL string only; **no** server-side fetch of user URLs (`docs/implementation-plan.md`) |
| Hash check | on upload, compute `hashFileBytes`; persist; recheck on download/verify |
| Missing file | API 404 → UI `MissingArtifact`; on-chain may still be Valid membership |
| Authz | SIWE session required for upload/download; participant check against escrow row + chain roles |

---

## 12. Authentication and Authorization

### Payments / escrow txs

**Wallet signatures only** (wagmi). Server never holds user keys.

### Off-chain files / exports

Connected address ≠ proof of file ACL by itself if API is open.

**Recommended:** SIWE (EIP-4361) challenge:

1. `GET /api/auth/nonce` → nonce + expiry  
2. User signs message binding address, domain, chainId 31337, nonce, expiry  
3. `POST /api/auth/verify` → httpOnly secure session cookie  
4. API checks session address ∈ {payer, provider, arbitrator} for that escrow **or** explicit share token (out of scope unless requested)

Separate from `approveAgreement` / `fund` txs.

**Public verifier page:** may verify export+bytes without login; **download of stored uploads** still authz-gated.

---

## 13. Security Threat Model (Phase 3)

| ID | Risk | Sev | Mitigation | Test |
| --- | --- | --- | --- | --- |
| S1 | Path traversal upload/download | Critical | storageKey-only paths; normalize+reject | API tests with `../` |
| S2 | Unauthorized file read | Critical | SIWE session + role check | authz integration |
| S3 | Server signs money txs | Critical | Architecture forbid; no key in env for web | review + grep |
| S4 | XSS via filename/agreement | High | React escape; CSP; sanitize names | component tests |
| S5 | CSRF on upload APIs | High | SameSite cookie + origin check | API tests |
| S6 | Oversized upload DoS | High | size/count limits | API tests |
| S7 | Malicious zip/pdf | Medium | attachment only; no preview exec | manual |
| S8 | Wrong network txs | High | NetworkGuard; refuse non-31337 | e2e |
| S9 | Stale UI vs deadline race | High | re-read `getEscrow` immediately before write | unit+e2e |
| S10 | Evidence tampering | High | content hash + on-chain verify | e2e tamper |
| S11 | Salt leakage via logs | Medium | redact salts in logs; Q-SALT policy | review |
| S12 | declaredCount shown as proof | Medium | UI copy: “provider-declared” | UI copy test |
| S13 | Phishing agreement | Medium | show full canonical JSON + hash | UX |
| S14 | SQLite/Anvil desync | Medium | deployment id file; orphan detection | e2e restart |
| S15 | RPC manipulation | Low–Med | local trusted Anvil; show RPC URL | docs |
| S16 | XSS in export JSON render | Medium | don’t `dangerouslySetInnerHTML` | review |

Aligns with `docs/threat-model.md` Phase 1 boundaries + Phase 3 upload requirements from `docs/implementation-plan.md`.

---

## 14. Local Development Setup

### 14.1 Existing pieces to reuse

- `packages/contracts/script/Deploy.s.sol`
- `packages/contracts/script/local-demo.sh` (cast-based; keep for contract smoke)
- `.env.example` Anvil keys

### 14.2 Proposed DX flow

```bash
pnpm install
pnpm build:evidence
# terminal 1
anvil --chain-id 31337
# terminal 2
pnpm deploy:local          # forge script → writes packages/contracts/deployments/31337.json
# optional mint to provider/arbitrator
pnpm --filter @evidencebound/web dev
```

MetaMask: add network `http://127.0.0.1:8545`, chainId `31337`, import Anvil keys.

### 14.3 Env (apps/web `.env.example`)

```text
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_INDIVIDUAL_ESCROW=
NEXT_PUBLIC_MERKLE_ESCROW=
NEXT_PUBLIC_MOCK_USDC=
# or single JSON path:
NEXT_PUBLIC_DEPLOYMENTS_PATH=../../packages/contracts/deployments/31337.json
DATABASE_URL=file:./data/web.sqlite
UPLOAD_DIR=./data/uploads
SIWE_DOMAIN=localhost
SIWE_STATEMENT=EvidenceBound Escrow local file access
```

### 14.4 Anvil restart hazard

On every Anvil reset, addresses change. App must:

1. Compare `deployments/31337.json` `deployedAt` / bytecode hash / anvil genesis.
2. Banner: “Local chain reset — redeploy and re-import accounts”.
3. Mark SQLite escrows orphaned; do not send txs to stale addresses.

Optional: `pnpm dev:local` orchestrates anvil+deploy+next (confirm if desired).

---

## 15. Testing Strategy

### Regression (must stay green)

- `pnpm test:evidence` → 28  
- `forge test --root packages/contracts` → 66  

### Unit (apps/web)

- Amount ↔ 6-decimal base units  
- State/role action matrix  
- Zod schemas  
- Error selector decoding  
- Evidence wrapper calls (mock lib)

### Integration

- Upload → disk → hash → DB row  
- SIWE nonce/verify/session  
- API authz deny stranger  
- Manifest/export via real `@evidencebound/evidence`  
- Read contract views against Anvil (Foundry-deployed)

### E2E (Playwright + Anvil)

Happy path both variants: connect → create → approve → approve ERC20 → fund → submit → verify → accept → withdraw.

Also: revision; dispute+resolve; missed delivery; review timeout; tampered file; wrong network; user reject; missing file; unauthorized download.

**Without node:** pure UI unit tests. **With Anvil:** integration + e2e.

---

## 16. Step-by-Step Implementation Roadmap

### 3.1 — Workspace scaffold & config

**Goal:** empty Next app wired to monorepo.  
**Tasks:** add `apps/web`; extend `pnpm-workspace.yaml`; Tailwind; env example; `transpilePackages`; root scripts stubs.  
**Files:** `apps/web/**`, root `package.json`, `pnpm-workspace.yaml`.  
**Deps:** next, react, typescript, tailwind.  
**AC:** `pnpm --filter @evidencebound/web dev` serves page; `build:evidence` still works.  
**Tests:** smoke build.  
**Risks:** workspace resolution of dist.  
**DoD:** app boots; no Solidity changes.

### 3.2 — Chain config, ABIs, deploy address export

**Goal:** typed contract access.  
**Tasks:** export ABIs from forge artifacts; `deployments/31337.json` writer post-`Deploy.s.sol`; viem clients; NetworkGuard.  
**AC:** read `token()` / `nextEscrowId` from UI against Anvil.  
**Tests:** integration read.  
**DoD:** wrong-chain banner works.

### 3.3 — Wallet integration (wagmi)

**Goal:** connect / account / disconnect.  
**Tasks:** WagmiProvider; ConnectButton; TxStatus component.  
**AC:** show address; send no-op or eth_call.  
**DoD:** rejected connection handled.

### 3.4 — SQLite + secure uploads

**Goal:** metadata + files.  
**Tasks:** Drizzle schema/migrations; upload/download API; limits; path checks.  
**AC:** stranger cannot download; traversal fails; size rejected.  
**Tests:** API integration.  
**DoD:** SIWE optional stub or full (prefer with 3.4b).

### 3.4b — SIWE sessions

**Goal:** file ACL.  
**Tasks:** nonce/verify/logout; session cookie.  
**AC:** expired nonce rejected.  
**DoD:** documented auth flow.

### 3.5 — Create escrow + agreement

**Goal:** canonical agreement → createEscrow → DB row.  
**Tasks:** create page; hashAgreement; both variants.  
**AC:** on-chain Created; agreementHash match; SQLite row.  
**Tests:** e2e create.  
**DoD:** cancel unfunded works.

### 3.6 — Approve + fund + ERC-20

**Goal:** provider approve; payer fund.  
**Tasks:** allowance UX; mint faucet for local.  
**AC:** Funded; lockedAmount==amount.  
**DoD:** errors decoded.

### 3.7 — Evidence submission

**Goal:** upload → export → submitDelivery.  
**Tasks:** UploadPanel; buildManifest/Export; variant payloads.  
**AC:** Delivered; individual commitments / merkle root match export; ≤100 items.  
**Tests:** tamper off-chain fails; on-chain verify Valid.  
**DoD:** revision second delivery version=2.

### 3.8 — Review, disputes, timeouts, withdraw

**Goal:** complete lifecycle UI.  
**Tasks:** accept/revision/dispute/resolve/timeouts/withdraw.  
**AC:** claimable + withdraw; dispute freezes timeouts (D1 messaging).  
**DoD:** role-gated actions only.

### 3.9 — Independent verifier + polish + docs

**Goal:** `/verifier`; disclaimers; README local setup; Anvil reset UX.  
**AC:** MissingArtifact vs NotMember vs ContentHashMismatch distinct.  
**Tests:** full e2e both variants; regression 28+66.  
**DoD:** Phase 3 Definition of Done (§20) met.

---

## 17. Acceptance Criteria (Phase 3 overall)

1. Local app runs against Anvil 31337 with deployed MockUSDC + both escrows.  
2. Complete lifecycle works for **Individual** and **Merkle** with same UX.  
3. All money actions are wallet-signed; server has no user keys.  
4. SQLite/files never authorize payment.  
5. Evidence built only via `@evidencebound/evidence`.  
6. Uploads safe: storageKey, size limits, no path traversal, no URL fetch.  
7. Verifier distinguishes off-chain vs on-chain results; no quality claims.  
8. Mock-funds disclaimer visible.  
9. `declaredItemCount` not presented as cryptographic proof.  
10. Existing **28** Vitest + **66** Foundry tests pass.  
11. Anvil restart is detectable and recoverable via redeploy docs/scripts.  
12. Tx hash + pending/success/revert UX for writes.

---

## 18. Open Questions / Decisions Required

| ID | Question | Options | Recommendation | Consequences |
| --- | --- | --- | --- | --- |
| Q-ORM | SQLite ORM? | Drizzle / Prisma / raw | **Drizzle** | Lighter migrations; confirm before scaffold |
| Q-AUTH | File ACL mechanism? | SIWE session / signed download URLs / open local | **SIWE session** | Extra UX; needed for non-trivial ACL |
| Q-SALT | Where store salts? | DB encrypted / DB plaintext local / client-only export | **DB plaintext local + export** (research) | Leak risk if DB shared; document |
| Q-HASH | Hash files where? | Browser / server / both | **Browser for salt+leaf; server re-hash on upload to confirm** | CPU in browser; consistent verify |
| Q-SIZE | Max upload size? | 5 / 10 / 25 MiB | **10 MiB/file, 50 MiB/delivery** | Affects UX |
| Q-LIST | Escrow list source? | Events / SQLite / nextEscrowId scan | **SQLite + event backfill** | No external indexer |
| Q-ABI | ABI packaging? | forge out copy / wagmi generate / hand maintain | **script sync from forge `out/`** | CI step |
| Q-ADDR | Address config? | env vars / deployments JSON | **deployments/31337.json + env override** | Anvil reset story |
| Q-WS | Next + workspace packages? | transpilePackages src / consume dist | **build:evidence + transpilePackages fallback** | Matches Phase 2 validation |
| Q-E2E | Playwright in Phase 3? | Yes mandatory / subset | **Subset happy-path both variants** | Timebox |
| Q-FAUCET | In-app mint? | Yes owner key on server / cast script only | **dev-only API with Anvil deployer key optional** | Dangerous if misconfigured — gate behind `NODE_ENV=development` |
| Q-PRIV | Private evidence default? | Authz always / public verifier only | **Uploads private; verifier uses user-provided files** | — |
| Q-EIP712 | EIP-712 agreement? | Defer (open item) / implement | **Defer** (protocol open item) | Hash still shown |

**No irreversible choice will be coded until you confirm the table.**

---

## 19. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Accidental Solidity edits | Phase 3 PRs touch `apps/web` + deploy JSON/scripts only |
| Unfair variant UX | Shared components; variant only at submit/verify encoding |
| Anvil address drift | deployments file + UI banner |
| Evidence lib API misuse | Thin wrappers; no duplicate merkle |
| SIWE skipped → open downloads | Block Phase 3 DoD if auth missing |
| Large Merkle calldata UX | Show size warning; still allow ≤100 |
| Deadline race | Re-fetch state in submit handlers |
| Treating SQLite as truth | Code review checklist; integration tests force chain read |

---

## 20. Definition of Done for Phase 3

- [ ] `apps/web` exists and is documented for local run  
- [ ] Both variants: create → approve → fund → deliver → accept → withdraw  
- [ ] Revision + dispute + arbitrator resolve demos work  
- [ ] Timeout paths callable when deadlines pass (Anvil `evm_increaseTime` in tests)  
- [ ] Secure uploads + SIWE (or approved alternative)  
- [ ] Independent verifier page with correct status taxonomy  
- [ ] Deployments/Anvil reset story documented and implemented  
- [ ] Phase 4 not blocked (tx hashes retained; identical scenarios)  
- [ ] `pnpm test:evidence` 28/28 and `forge test` 66/66 green  
- [ ] No protocol/Solidity business logic changes  

---

## Contradictions / Blockers noted

1. **Workspace:** `pnpm-workspace.yaml` lacks `apps/*` — must change at 3.1.  
2. **Agreement vs escrow id:** already resolved in protocol (no id in hash) — UI must follow.  
3. **Acceptance without proof:** UI must allow accept even if verifier fails (protocol); show warning, not hard-block (confirm UX preference).  
4. **Phase 1 open item EIP-712:** still open — Phase 3 can show raw hash without EIP-712.  
5. **Deploy script mints only payer** (`Deploy.s.sol`) — provider/arbitrator need mint/transfer for demos (extend deploy or faucet — confirm).  
6. **`apps/` missing** — expected; not a doc lie.

---

## Confirmation

**Implementation has not started.** No Next.js app, dependencies, migrations, or Solidity changes were made for Phase 3 in this task — only this plan file was added: `docs/phase3-implementation-plan.md`.

Awaiting your decisions on §18 and explicit permission before coding Stage 3.1.
