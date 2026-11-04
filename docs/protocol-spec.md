# Protocol specification

Status: Phase 1 prototype. This is the rule set implemented in `EscrowBase`, `IndividualHashEscrow`, and `MerkleRootEscrow`.

The contract holds funds, checks who may act, changes state, and records commitments. It does not decide whether delivered work is acceptable. A successful evidence check does not prove quality, authorship, ownership, repository access, file availability, or the original creation time of a file. An on-chain commitment establishes when the commitment was mined.

## Participants and token

Every escrow has three distinct, nonzero addresses: payer, provider, and arbitrator.

The payer creates the escrow. That transaction is the payer's approval of the stored agreement hash. The provider must later submit the same hash. The arbitrator is chosen before funding and is the only address that can resolve a dispute.

Each deployment uses one token, stored immutably in the escrow constructor. Phase 1 deploys `MockUSDC`: 6 decimals, symbol `mUSDC`, mintable by its owner. Amounts are integer base units. There are no floating-point amounts.

The token must transfer the exact amount. Fee-on-transfer and rebasing tokens are rejected or unsupported. The funding function measures the escrow's balance before and after `safeTransferFrom` and reverts unless the increase equals the agreed amount.

The largest accepted amount is `type(uint256).max / 10_000`, so settlement multiplication cannot overflow.

## Terms

Terms are fixed at creation. Changing them means creating another escrow.

| Field | Meaning |
| --- | --- |
| `provider`, `arbitrator` | The other two participants |
| `amount` | Token base units locked after funding |
| `deliveryDeadline` | Absolute timestamp for the first delivery. Also the last time funding is allowed |
| `reviewPeriod` | Seconds after a delivery during which the payer may accept or request revision |
| `revisionDeliveryWindow` | Seconds the provider has to deliver after the single revision request |
| `agreementHash` | keccak256 of the off-chain canonical agreement. Nonzero |
| `templateHash` | Nonzero template identifier or template-content hash |

`MAX_REVISIONS` is the constant `1`. It is not a creation argument. The off-chain agreement must repeat `maxRevisions: 1`. The contract rule is authoritative.

`MAX_EVIDENCE_ITEMS` is the constant `100`. Empty bundles are rejected.

## Agreement hash

The contract stores the hash the payer supplies. It does not recompute the document. Phase 3 must show the document and check that its hash equals the stored hash before asking the provider to approve.

The preimage does **not** include the escrow id. The id is assigned in the creation transaction, so putting it inside the hash races with other creations. Binding is the storage slot: escrow `n` stores hash `h`. The document includes a client nonce so two identical term sets need not share a hash.

Canonical agreement bytes, Phase 2, will be RFC 8785 JSON Canonicalization Scheme over UTF-8. The hash is keccak256 of those bytes. Integer amounts, timestamps, durations, and chain id are decimal strings. Addresses are lowercase `0x` hex. Required keys:

```text
agreementNonce, amount, arbitrator, chainId, deliveryDeadline,
escrowContract, maxRevisions, payer, provider, reviewPeriod,
revisionDeliveryWindow, schema, templateHash, token
```

`schema` is `evidencebound.agreement.v1`. `escrowContract` is the deployed escrow address, so the same document is not silently valid for the other variant or another chain.

The Phase 1 demo uses `cast keccak` of a short label as a stand-in hash. That is not the canonical document.

## States

```text
None = 0
Created = 1
Funded = 2
Delivered = 3
RevisionRequested = 4
Disputed = 5
Settled = 6
Cancelled = 7
```

`providerApproved` is separate. `Created` without approval cannot be funded. The payer may cancel in `Created` whether or not the provider has approved. Cancellation does not delete the recorded terms.

Escrow ids start at 1.

## Deadlines

Comparisons use the block timestamp.

| Action | Allowed when |
| --- | --- |
| Create with a delivery deadline | `deadline >= block.timestamp` |
| Fund | state `Created`, provider approved, `block.timestamp <= deliveryDeadline` |
| Deliver | state `Funded` or `RevisionRequested`, sender is provider, `block.timestamp <= currentDeliveryDeadline` |
| Accept or request revision | state `Delivered`, sender is payer, `block.timestamp <= reviewDeadline` |
| Missed-delivery refund | state `Funded` or `RevisionRequested`, sender is payer, `block.timestamp > currentDeliveryDeadline` |
| Review-timeout claim | state `Delivered`, sender is provider, `block.timestamp > reviewDeadline` |

`currentDeliveryDeadline` starts equal to `deliveryDeadline`. A revision request sets it to `block.timestamp + revisionDeliveryWindow` and clears `reviewDeadline` until the next delivery. The next delivery sets `reviewDeadline` to `block.timestamp + reviewPeriod`.

The original delivery deadline is not reused after a revision. A revision can therefore be due after the original deadline, and a missed revision can be refunded before the original deadline would have expired.

Timestamp granularity is the block time. Miners or sequencers can move it by a small amount. The prototype assumes deadlines measured in hours or days, not seconds that matter at the boundary.

## Delivery

Only the provider submits. Each submission increments `deliveryVersion`, starting at 1. A revision keeps the previous version.

Individual-hash submission stores the calldata hashes in order and rejects `bytes32(0)`. Its event field `bundleCommitment` is `keccak256(abi.encode(commitments))`. That event hash is a timeline identifier. It is not a Merkle root. The stored list is the commitment.

Merkle submission stores the provider's root and a `declaredItemCount`. The root must be nonzero. The count must be from 1 to 100. The count is not authenticated by the root. A single-item standard tree has root equal to the leaf hash, and verification of that leaf succeeds even if the declared count is larger. Clients must not treat the count as proof of how many artifacts exist.

Neither submission function checks file bytes. A provider can commit to hashes that do not match the files later shown to the payer. The payer sees that during review. Verification then returns not-a-member.

## Review, dispute, and the contradictory requirement

The project statement says the payer's accept, revision, and dispute actions happen inside the review window. It also says either participant may open a dispute after funding and before settlement.

Those sentences conflict. This prototype resolves them as follows.

**Decision D1.** Accept and the single revision request are payer-only and only while `Delivered` and `block.timestamp <= reviewDeadline`.

**Decision D1, dispute.** `openDispute` is available to the payer or the provider in `Funded`, `Delivered`, or `RevisionRequested`, with a nonzero reason hash. It is not limited to the review window.

Reason: if dispute ended with the review window, a payer who misses that window would have no path except full payment through the provider's timeout claim. The dispute section is the more specific rule, and it explicitly disables ordinary acceptance and timeout release once a dispute exists.

Consequence: after `block.timestamp > reviewDeadline`, the provider's timeout claim and the payer's dispute are both valid until one is mined. At the exact review deadline, only the payer can still act. The same pattern exists for a missed delivery: the provider can dispute in `Funded` and freeze the refund until the arbitrator acts.

This is a liveness dependency on the arbitrator, not an accidental hole. There is no unilateral timeout that overrides an open dispute. If the arbitrator never sends a transaction, disputed funds stay in the contract. The participants chose that arbitrator before funding.

A dispute requires a reason hash. The reason text stays off-chain.

## Settlement

`providerBps` is an integer from 0 to 10_000.

```text
providerAmount = floor(amount * providerBps / 10_000)
payerAmount = amount - providerAmount
```

The remainder from flooring stays with the payer. It is at most one base unit of the token, which is 0.000001 mock USDC.

| Kind | Who | Basis points |
| --- | --- | --- |
| `Accepted` | Payer | 10_000 |
| `ReviewTimeout` | Provider | 10_000 |
| `MissedDelivery` | Payer | 0 |
| `Arbitration` | Arbitrator | the submitted value |

Settlement writes `Settled` and the claimable balances before any token transfer. Withdrawal is pull-based. The caller receives only their own claimable balance. The balance is set to zero before `safeTransfer`. A second withdrawal returns nothing to withdraw. There is no arbitrator fee in this version.

Direct ether transfers revert.

## Evidence verification

`verifyEvidence` is a view. It does not change state and it is not a paid user transaction. Gas measured with `eth_call` must be labeled as a call, not as a mined transaction.

Binding checks, in order:

1. The escrow id exists, else `UnknownEscrow`.
2. Schema version is `1`, else `WrongSchema`.
3. `chainId` equals `block.chainid`, else `WrongChain`.
4. `escrowContract` equals this contract, else `WrongContract`.
5. The leaf's escrow id equals the function argument, else `WrongEscrow`.
6. The delivery version is between 1 and the current version, else `UnknownDelivery`.
7. The leaf hash is in the stored list at that item index, or the Merkle proof matches the stored root, else `NotMember`.
8. Otherwise `Valid`.

The first failing check wins. Recommended evidence type strings, which are labels rather than an allowlist:

```text
evidencebound.file.v1
evidencebound.url-reference.v1
evidencebound.snapshot.v1
```

The type is hashed with keccak256 of the UTF-8 string and stored in the leaf as `bytes32`.

File content hash is keccak256 of the raw file bytes. Hashing a URL does not prove what that URL displayed. A preserved page is a separate snapshot or file item. Details are in `docs/evidence-format.md`.

## Events

Events carry ids, addresses, amounts, hashes, versions, and basis points. They do not carry agreement text, file bytes, filenames, or private URLs.

`EscrowCreated`, `ProviderApproved`, `EscrowFunded`, `DeliverySubmitted`, `RevisionRequested`, `DisputeOpened`, `EscrowSettled`, `Withdrawal`, `EscrowCancelled`.

## What this version does not do

No upgrade path, no pause, no admin seizure, no marketplace, no jury selection, no cross-chain transfer, no real-money deployment, and no claim that the outcome is legally enforceable or fair in a non-technical sense.
