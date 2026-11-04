# Research methodology

The research contribution is a working escrow protocol and a controlled comparison of two evidence representations. It is not a new hash function, a new tree, or an Evidence Epoch Forest.

## Variants

| | IndividualHashEscrow | MerkleRootEscrow |
| --- | --- | --- |
| Delivery storage | Ordered list of standard leaf hashes | One standard Merkle root, plus a declared count |
| Verification | Compare the recomputed leaf with the stored slot | `MerkleProof` against the stored root |
| Shared | Roles, states, deadlines, token, approval, settlement, events, compiler, optimizer, EVM | Same |

Only evidence storage and the verification inputs should differ. Settlement tests run the same workflow on both and compare withdrawn amounts.

## Metrics

Gas is the primary cost metric. A currency figure, if one is ever computed, must state the assumed gas price in the same table. This repository does not contain gas results yet. Do not invent percentages.

For each measured transaction, record:

- Experiment id, git commit, variant
- Compiler, optimizer runs, `via_ir`, EVM version
- Chain configuration
- Scenario, artifact count, delivery count
- Function name
- Gas used
- Calldata bytes
- Proof bytes, when a proof exists
- Off-chain timings, when the step is off-chain
- Expected result, actual result, pass or fail

`eth_call` may estimate verification gas. Label it as a call. Do not add it to mined-transaction gas.

Repeated identical gas measurements are the same measurement. Do not report them as a statistical sample. Latency measurements, once they exist, should be repeated and reported as median and p95.

## Planned comparisons

These run in Phase 4, after the evidence library exists.

**Submission.** Artifact counts 1, 2, 5, 10, 20, 50, and 100, which is the contract cap. Record submission gas, calldata, stored words, manifest size, proof size, and tree-build time.

**Verification.** Baseline slot read versus Merkle proof verification, plus off-chain prove and verify time. Include valid and invalid artifacts.

**Lifecycle.** Acceptance, one revision then acceptance, arbitrator refund, arbitrator payment, partial split, missed delivery, and review timeout. Include withdrawals.

**Adversarial.** Unauthorized caller, illegal transition, second settlement, second withdrawal, modified artifact, wrong proof, wrong escrow or version, missing off-chain evidence.

The Foundry tests already cover the correctness cases. Phase 4 turns the gas and size numbers into exported CSV or JSON. It does not replace the tests with mocks.

## Fairness constraints

Both variants compile in one Foundry profile:

```text
solc 0.8.38
optimizer true
optimizer_runs 200
via_ir false
evm_version cancun
```

OpenZeppelin Contracts is pinned to v5.7.0. The JavaScript tree library is pinned to 1.0.8. Foundry used for the Phase 1 run is 1.9.0. The local chain is Anvil, chain id 31337.

Do not compare a via-IR build with a legacy build. Do not compare different optimizer settings. Do not attribute a gas change to the Merkle root if the settlement code also changed.

## Non-claims

The study does not claim a novel cryptographic algorithm. It uses OpenZeppelin's standard tree. It does not claim that lower gas makes the Merkle variant more correct, or that the individual-hash variant is more trustworthy because it stores more bytes. Those are the trade-offs to measure: cost, proof size, and what a third party can check from the chain plus an export.
