# `@evidencebound/evidence`

Phase 2 TypeScript evidence library: RFC 8785 canonicalization, content/leaf hashing, OpenZeppelin standard Merkle trees, manifests, export envelopes, and agreement hashing.

Compatible with `IndividualHashEscrow` and `MerkleRootEscrow` leaf encoding (`EvidenceCommitment.sol`). Does not send transactions.

## Scripts

```bash
pnpm --filter @evidencebound/evidence test
pnpm test:evidence
```

## Pinning

- `@openzeppelin/merkle-tree@1.0.8`
- `canonicalize@2.1.0` (RFC 8785; verified against library vectors in tests)
