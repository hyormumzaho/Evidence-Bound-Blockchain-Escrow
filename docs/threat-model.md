# Threat model

This is a design record for a local mock-token prototype. Passing the Foundry tests is not a security audit.

## Assets

- Mock tokens locked in an escrow before settlement.
- Claimable balances after settlement.
- Agreement hashes and delivery commitments.
- Off-chain files, salts, and proofs once those exist in later phases.

The mock token has no redemption value. The interesting property is still that the contract cannot create, lose, or reroute entitlement relative to its own rules.

## Actors

| Actor | Can | Cannot |
| --- | --- | --- |
| Payer | Create, cancel while unfunded, fund, accept, request one revision, dispute, withdraw their claim | Change terms, deliver, resolve a dispute, withdraw the provider's claim |
| Provider | Approve the stored hash, deliver, dispute, claim a review timeout, withdraw their claim | Fund, accept, resolve, cancel the payer's escrow |
| Arbitrator | Resolve one open dispute with basis points from 0 to 10_000 | Open a dispute, seize funds, change the split after settlement |
| Stranger | Read public state | Call any privileged transition |
| Mock-token owner | Mint more test tokens | Pull deposits out of the escrow |
| Future web server | Store files and display hashes | Sign for a user or authorize a transfer |

No backend key can move escrow funds. Users sign with their own wallets.

## In-scope protections

- Distinct nonzero participants and nonzero economic inputs.
- Exact token amount on funding, using SafeERC20 and a balance delta.
- State checks on every transition.
- One revision, stored previous deliveries, and a 100-item cap so the baseline cannot loop without bound inside one transaction.
- Settlement math that pays the provider `floor(amount * bps / 10_000)` and the payer the remainder, with the sum equal to the escrow amount.
- Pull withdrawal, claim cleared before the token call, and a reentrancy guard on fund and withdraw.
- No second settlement. `Settled` is terminal for the workflow functions.
- Evidence views that bind chain, contract, escrow, schema, and delivery version, and that use the stored commitment rather than a caller-supplied root.
- Rejection of direct ether.

The reentrancy test funds two escrows and withdraws one through a token that calls back into withdraw. The second escrow's tokens stay locked. The fee-on-transfer test cannot fund either variant.

## Assumptions

- The configured token is standard ERC-20 without transfer fees, rebasing, or a hook that lies about balances. `MockUSDC` is that token. A token that reports a false balance can still fool a balance-delta check. The prototype does not try to support arbitrary tokens.
- Deadlines are long enough that small timestamp drift does not decide the study.
- Off-chain storage in later phases is local and demo-private. It is not a production confidentiality boundary.
- Participants can read the chain. The UI is not required for correctness of a contract call.
- The arbitrator is willing and able to send one transaction. This is an assumption, not a mechanism.

## Known limitations

**Arbitrator liveness.** After a dispute, nobody else can settle. There is no timeout that pays or refunds around a silent arbitrator. Adding one would let a party bypass the dispute they agreed to.

**Dispute can freeze a timeout.** A provider can dispute a funded escrow and block the missed-delivery refund. A payer can dispute after the review deadline and block the provider's timeout claim if that dispute is mined first. Both follow Decision D1 in the protocol spec.

**Declared Merkle item count.** The root does not prove the count. A client that displays the count as fact is wrong.

**Commitment time is not creation time.** The block timestamp is when the hash was submitted.

**Evidence availability.** The contract cannot make an off-chain file remain online. Missing files are a failed verification, not a payment rule.

**Mock minting.** The token owner can mint unlimited `mUSDC`. That matters only because the token is a test instrument. Do not point this escrow at a token whose admin can freeze or confiscate balances.

**Rounding.** The payer receives the leftover base unit. An arbitrator who wants a specific split has to account for flooring.

**No legal layer.** A hash is not a court judgment, a signature on a deed, or proof of identity.

## Out of scope

Real funds, fiat, wallet software, phishing beyond showing the agreement hash, compromised keys, chain reorg policy, upgrade bugs, MEV as an economic attack, and formal verification. Later phases add file-server checks for path traversal, upload size, and not executing uploaded bytes. Those checks are not in Phase 1 because Phase 1 does not store uploads.
