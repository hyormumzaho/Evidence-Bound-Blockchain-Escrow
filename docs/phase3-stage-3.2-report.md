# Phase 3 — Stage 3.2 Report

**Stage:** 3.2 — Chain Configuration, ABIs & Deployment Address Export  
**Date:** 2026-11-09  
**Status:** COMPLETE — stop here; Stage 3.3 not started  
**Plan:** `docs/phase3-implementation-plan.md` § Stage 3.2

---

## 1. Goal

Connect existing Foundry Solidity contracts to the Next.js app via **viem** for local Anvil (`chainId` **31337**): ABI export, deployment address JSON, public client reads, RPC/bytecode checks, and a read-only NetworkGuard. No wallet integration, SQLite, uploads, or escrow UI.

---

## 2. Commands and results

All commands run from the repo root in this session.

### 2.1. `pnpm install`

```text
Scope: all 5 workspace projects
Packages: +9 (includes viem@2.37.9 for apps/web)
Done
```

**Result:** OK

### 2.2. `pnpm contracts:abis`

```text
Exported MockUSDC (25 ABI entries)
Exported IndividualHashEscrow (71 ABI entries)
Exported MerkleRootEscrow (71 ABI entries)
ABI export complete.
```

Writes to:

- `packages/contracts/abis/*.json`
- `apps/web/src/lib/chain/abis/*.json`

**Result:** OK — ABIs taken from Foundry `out/` (no hand-maintained duplicates).

### 2.3. `pnpm build:evidence`

```text
shared tsc OK
evidence tsc OK
```

**Result:** OK

### 2.4. `pnpm build:web`

```text
build:evidence → contracts:abis → next build
Compiled successfully
Route /api/chain/status  (Dynamic)
```

**Result:** OK

### 2.5. `pnpm test:evidence`

```text
Test Files  6 passed (6)
Tests       28 passed (28)
```

**Result:** OK

### 2.6. `forge test --root packages/contracts`

```text
66 tests passed, 0 failed, 0 skipped
```

**Result:** OK — Solidity business logic unchanged.

### 2.7. Local Anvil deploy + viem reads

```bash
anvil --chain-id 31337
PRIVATE_KEY=<anvil#0> PAYER_PRIVATE_KEY=<anvil#1> pnpm deploy:local
pnpm check:chain
```

`pnpm deploy:local` output (addresses from this run):

| Contract | Address |
| --- | --- |
| MockUSDC | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| IndividualHashEscrow | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| MerkleRootEscrow | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |

`pnpm check:chain`:

```text
chainId 31337
MockUSDC / IndividualHashEscrow / MerkleRootEscrow — has bytecode
Individual token 0x5FbD… nextEscrowId 1 mode individual-hash
Merkle token 0x5FbD… nextEscrowId 1 mode merkle-root
check-chain OK
```

`GET /api/chain/status` (Next on `:3010` against live Anvil):

```json
{
  "ok": true,
  "actualChainId": 31337,
  "rpcReachable": true,
  "chainIdMatch": true,
  "addressesConfigured": true,
  "bytecode": { "mockUSDC": true, "individualHashEscrow": true, "merkleRootEscrow": true },
  "reads": {
    "individualToken": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "individualNextEscrowId": "1",
    "individualEvidenceMode": "individual-hash",
    "merkleToken": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "merkleNextEscrowId": "1",
    "merkleEvidenceMode": "merkle-root"
  },
  "errors": []
}
```

**Result:** OK — acceptance criteria (`token()` / `nextEscrowId` via UI/API against Anvil) met.

---

## 3. What was implemented

### 3.1. ABI export

- `packages/contracts/script/export-abis.mjs` — `forge build` then copy ABI arrays from artifacts.
- Root script: `pnpm contracts:abis` (also chained into `pnpm build:web`).

### 3.2. Local deployment address export

- `packages/contracts/script/deploy-local.sh` — wraps `Deploy.s.sol`, refuses non-31337, writes:
  - `packages/contracts/deployments/31337.json` (**gitignored** live file)
  - `apps/web/src/lib/chain/deployments/31337.json` (local overwrite; tracked placeholder remains the git baseline)
- Example: `packages/contracts/deployments/31337.example.json`
- Root script: `pnpm deploy:local`
- Deploy keys stay in Foundry/shell env only — **not** in Next.js backend.

### 3.3. viem public client + reads

Under `apps/web/src/lib/chain/`:

| File | Role |
| --- | --- |
| `config.ts` | Anvil chainId 31337, RPC URL helpers |
| `client.ts` | read-only `createPublicClient` |
| `abis.ts` | typed ABI imports from exported JSON |
| `addresses.ts` | env overrides → live disk JSON → placeholder |
| `read.ts` | `token()`, `nextEscrowId()`, `evidenceMode()`, `getEscrow`, MockUSDC meta |
| `status.ts` | RPC reachability, chainId match, bytecode, view reads |

### 3.4. NetworkGuard + API

- `GET /api/chain/status` — public health JSON (200 if ready, 503 otherwise).
- `NetworkGuard` — client panel that fetches the API; wrong-chain / missing deploy messaging; **no wallet**.
- Home page embeds NetworkGuard.

### 3.5. Smoke script

- `apps/web/scripts/check-chain.mjs` + root `pnpm check:chain`
- Lives under `apps/web` so Node resolves `viem` from the web package.

### 3.6. Docs / ignore rules

- `apps/web/README.md` — Anvil → deploy → check → dev flow.
- `.gitignore` — live `packages/contracts/deployments/31337.json`.

---

## 4. Files added / changed (Stage 3.2)

### Added

- `packages/contracts/script/export-abis.mjs`
- `packages/contracts/script/deploy-local.sh`
- `packages/contracts/deployments/31337.example.json`
- `packages/contracts/abis/{MockUSDC,IndividualHashEscrow,MerkleRootEscrow}.json`
- `apps/web/src/lib/chain/{config,client,abis,addresses,read,status}.ts`
- `apps/web/src/lib/chain/abis/*.json`
- `apps/web/src/lib/chain/deployments/31337.json` (placeholder)
- `apps/web/src/components/NetworkGuard.tsx`
- `apps/web/src/app/api/chain/status/route.ts`
- `apps/web/scripts/check-chain.mjs`
- `docs/phase3-stage-3.2-report.md` (this file)

### Changed

- Root `package.json` — `contracts:abis`, `deploy:local`, `check:chain`; `build:web` runs ABI export
- `apps/web/package.json` — `viem@2.37.9`
- `apps/web/src/app/page.tsx` — NetworkGuard
- `apps/web/README.md`, `apps/web/.env.example`
- `.gitignore`
- `docs/phase3-implementation-plan.md` — status → Stage 3.2 complete
- `pnpm-lock.yaml`

### Not changed

- Solidity sources / business protocol
- Wallet / wagmi (Stage 3.3)
- SQLite, uploads, escrow create UI

---

## 5. Acceptance criteria mapping

| Criterion | Evidence |
| --- | --- |
| Export ABIs from forge artifacts | `export-abis.mjs` + dual write to contracts/abis + web |
| `deployments/31337.json` after Deploy.s.sol | `deploy-local.sh` |
| viem clients | `client.ts` / Anvil 31337 |
| NetworkGuard | component + amber/emerald banner from `/api/chain/status` |
| Read `token()` / `nextEscrowId` against Anvil | `check:chain` + API `ok: true` |
| No private keys in Next backend | only public RPC reads; deploy keys shell-only |
| No Solidity business changes | `forge test` 66/66 unchanged protocol |

---

## 6. Remaining issues / risks

1. **Anvil restart invalidates addresses** — must re-run `pnpm deploy:local` (documented).
2. **Bundled placeholder vs live JSON** — address loader prefers live disk JSON (including gitignored contracts path) so `next start` works after deploy without baking secrets/keys; tracked web JSON stays a null placeholder for git.
3. **Wallet / wrong MetaMask network UX** — NetworkGuard is RPC-based only; full injected-wallet chain switch arrives in Stage 3.3.
4. **`declaredItemCount` not authenticated by Merkle root** — protocol design; unchanged; UI later must not treat count as proof.
5. **No indexer / production monitoring** — intentionally out of scope.

---

## 7. Explicit non-goals (confirmed not started)

- Stage 3.3 wagmi / ConnectButton
- SQLite / Drizzle / uploads
- Create-escrow / fund / dispute UI
- SIWE
- Protocol / Solidity edits

---

## 8. Verdict

# STAGE 3.2 COMPLETE

Ready for **Stage 3.3 — Wallet integration (wagmi)** after explicit confirmation.

Suggested local loop before 3.3:

```bash
anvil --chain-id 31337
export PRIVATE_KEY=... PAYER_PRIVATE_KEY=...
pnpm deploy:local && pnpm check:chain && pnpm dev:web
```
