# Baseline audit

Reviewed commit: `99534ea` (`origin/main` at the time of the fetch). Local `main` fast-forwarded from `a683ee9`. Working branch: `research/evidencebound-comparison`. The root `README.md` was untracked and was not part of the remote tree.

This file records that baseline. It is not a measurement report.

## Stack

pnpm workspace. Foundry contracts on solc 0.8.38, optimizer 200 runs, `via_ir` off, Cancun. OpenZeppelin Contracts v5.7.0 and `@openzeppelin/merkle-tree` 1.0.8. Evidence canonicalization uses `canonicalize` 2.1.0. The web app is Next.js 15 with wagmi, viem, SIWE, Drizzle, and SQLite. Mock USDC has 6 decimals. The local chain is Anvil chain id 31337.

## What was implemented

`EscrowBase` implements one milestone, three distinct participants, provider approval before funding, one revision, Decision D1 disputes, split settlement, and pull withdrawals. `IndividualHashEscrow` stores each leaf hash. `MerkleRootEscrow` stores one root and an unauthenticated `declaredItemCount`. The evidence library builds the shared leaf, the canonical manifest, and the export envelope. The web UI, through Stage 3.8, can create, fund, submit evidence for those two variants, review, dispute, time out, and withdraw. Chain state is read for actions. SQLite is metadata.

## What was not implemented

No third on-chain commitment. The manifest hash existed only in the export and the database. No independent verifier page. No event timeline. No headless experiment runner and no result files. One template id, `website-milestone-v1`. The UI did not call `verifyEvidence`, so an internally consistent export could look valid without matching the chain.

## Protocol choices kept

Disputes are not limited to the review window. There is no arbitrator timeout. The leaf schema stays version 1 and does not add a submitter field, because only the provider can submit and the transaction sender is public. The agreement binds the escrow contract address instead of a separate strategy name. Acceptance does not require an on-chain proof. Timeout claims are beneficiary-only. The rounding remainder goes to the payer.

## Checks run on the baseline

`forge test --root packages/contracts` with Foundry 1.9.0: 66 passed, 0 failed. One existing warning: `Phase2EvidenceIntegrationTest._readLeaf` can be `pure`.

`pnpm --filter @evidencebound/evidence test`: 28 passed, 0 failed.

`pnpm install --frozen-lockfile` for the whole workspace failed on this machine. Node is v26.9.0, and `better-sqlite3@11.10.0` has no prebuild for it. The source build fails on `info.This()`. Web tests were not run. The Stage 3.8 report says 27 web tests passed in the teammate's environment. That number was not reproduced here.

## Limits that affect later measurements

`declaredItemCount` is not authenticated by the Merkle root. Direct token donations are not tracked. Cookie requests without an `Origin` header skip the same-origin check. Test files contain the published Anvil default keys. `apps/web/src/lib/chain/deployments/31337.json` is a past local deployment and will not match a new Anvil until `pnpm deploy:local` rewrites it. `apps/web/tsconfig.tsbuildinfo` is a committed build artifact.
