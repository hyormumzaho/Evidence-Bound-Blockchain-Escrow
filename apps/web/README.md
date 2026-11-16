# `@evidencebound/web`

Phase 3 local research UI for EvidenceBound Escrow.

## Stage 3.6 status

- Stages 3.2–3.5: ABIs, wagmi, SQLite, SIWE, create escrow
- Escrow room: `approveAgreement`, MockUSDC ERC-20 `approve`, `fund`, `cancelUnfunded`
- Actions gated by on-chain state + role (not SQLite)

SQLite is **not** payment authority.

## Local Anvil setup

```bash
# terminal 1
anvil --chain-id 31337

# terminal 2 — use keys printed by Anvil
export RPC_URL=http://127.0.0.1:8545
export PRIVATE_KEY=0x...          # deployer
export PAYER_PRIVATE_KEY=0x...    # receives mint
pnpm deploy:local
pnpm check:chain
pnpm build:evidence
pnpm dev:web
```

Copy `apps/web/.env.example` → `apps/web/.env.local` if needed.

### File ACL (SIWE)

1. `GET /api/auth/nonce?address=0x...` → SIWE message  
2. Sign with MetaMask / viem  
3. `POST /api/auth/verify` `{ message, signature }` → httpOnly `eb_session` cookie  
4. `POST /api/escrows/staging` → `escrowRowId`  
5. `POST /api/uploads` multipart (`file`, `escrowRowId`, optional `expectedContentHash`)  
6. `GET /api/uploads/:storageKey` download (participant only)

```bash
pnpm --filter @evidencebound/web test   # upload/authz/hash/traversal tests
pnpm --filter @evidencebound/web data:reset
```

## Commands

```bash
pnpm contracts:abis
pnpm check:chain
pnpm build:web
pnpm test:web
pnpm --filter @evidencebound/web dev
```

Target chain: Anvil `31337`.
