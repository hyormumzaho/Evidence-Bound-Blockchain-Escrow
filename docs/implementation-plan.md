# Implementation plan

Work in vertical slices. Do not start the web UI or an LLM feature before the contract workflow is tested.

## Phase 1 — contracts and local workflow

1. Repository scaffold, pinned Foundry profile, and these documents.
2. `MockUSDC` with 6 decimals and owner-only mint.
3. `EscrowBase`: approval, funding, one revision, dispute, timeouts, split settlement, pull withdrawal.
4. `IndividualHashEscrow` and `MerkleRootEscrow` with the same rules and different evidence storage.
5. Foundry unit tests, a shared scenario suite, a parity split, Merkle vectors from OpenZeppelin's JavaScript library, fee-on-transfer and reentrancy checks.
6. `script/Deploy.s.sol` and `script/local-demo.sh` for Anvil chain id 31337.

Phase 1 does not include the web app, SQLite, uploads, experiment CSV, or charts.

## Phase 2 — evidence library

1. `packages/evidence` with RFC 8785 canonical JSON. Pin a library only after its API is checked against vectors.
2. keccak256 of raw file bytes and of URL-reference records.
3. Manifest builder that does not embed the Merkle root.
4. Standard Merkle tree, proofs, and the export envelope.
5. Vitest cases: deterministic canonicalization, modified file, wrong salt, wrong escrow, wrong version, wrong chain or contract, one item, odd counts, duplicate content with distinct salts.

## Phase 3 — local application

1. SQLite metadata and generated storage keys for uploads.
2. Size limits, basic file checks, path traversal checks, no execution of uploads, no server-side fetch of user URLs.
3. Wallet UI: dashboard, agreement, escrow room, submission, review, arbitrator settlement, independent verifier.
4. Read state and balances from the chain.
5. Show the mock-funds disclaimer and the separate verification messages from the evidence format.

## Phase 4 — measurements

1. Experiment runner that does not need the web UI.
2. CSV or JSON records described in the methodology.
3. Lifecycle and adversarial scenarios.
4. Stronger invariant tests around conservation, single settlement, and withdrawal limits.
5. Analysis scripts that read real records. No placeholder charts.

## Phase 5 — only if the measured prototype is done

LLM-assisted drafting, more templates, devcontainer polish, or a public testnet demo that still uses mock tokens.

## Decisions already made

See `docs/protocol-spec.md`. The ones most likely to be questioned:

- Disputes are not confined to the review window. Decision D1.
- No arbitrator timeout.
- One revision and 100 items are constants.
- Merkle `declaredItemCount` is stored and is not authenticated.
- Acceptance does not require an on-chain proof.
- Rounding remainder goes to the payer.
- Agreement hash omits the escrow id and includes a nonce and the contract address.

## Research extension after the teammate baseline

The baseline at `99534ea` has two on-chain strategies and an off-chain manifest hash. The comparison question needs the manifest hash as its own contract. `ManifestHashEscrow` stores that hash and shares `EscrowBase`. The web UI, experiment runner, and independent verifier still follow this plan. Historical phase reports describe the two-variant UI and are left as records of that work.

## Open items

- Which RFC 8785 package to pin in Phase 2. The algorithm is decided. The dependency is not, until its tests pass.
- Whether timeout claims should later become permissionless. They are beneficiary-only now.
- Whether to drop `declaredItemCount` before the measured experiments so a reader cannot mistake it for an authenticated count.
- EIP-712 presentation of the agreement in the wallet. Approval is already an on-chain transaction that includes the hash.
- An arbitrator fee. The current fee is zero.
- Devcontainer and Docker, deferred until the contract and app paths work without them.
