# Evidence format

Phase 1 freezes the leaf hash and implements it in Solidity. Phase 2 implements manifests, file hashing, salts, and the export package in TypeScript. The leaf encoding does not change without a schema version bump.

## What a commitment means

A valid check means three things:

- The artifact bytes hash to the content hash in the leaf.
- The leaf is in the committed delivery for this escrow and version.
- The leaf names this chain, this contract, this escrow, and this delivery version.

It does not mean the work is good, true, owned by the provider, or still available at a URL. Hashing a URL commits to the URL string, not to the page that URL returned.

## Content hashes

| Item | Preimage |
| --- | --- |
| File or snapshot bytes | keccak256 of the raw bytes, with no added prefix |
| URL reference | keccak256 of the canonical JSON object below |

URL reference JSON, RFC 8785, UTF-8:

```json
{"schema":"evidencebound.url-reference.v1","url":"https://example.test/page"}
```

A snapshot export is a file item or a snapshot item. It is not a substitute claim about the live URL.

## Leaf

OpenZeppelin standard leaf, field order fixed:

```text
uint16 schemaVersion
uint256 chainId
address escrowContract
uint256 escrowId
uint32 deliveryVersion
uint32 itemIndex
bytes32 evidenceType
bytes32 contentHash
bytes32 salt
```

```text
leaf = keccak256(bytes.concat(keccak256(abi.encode(...fields))))
```

`@openzeppelin/merkle-tree` 1.0.8 with encoding

```text
["uint16","uint256","address","uint256","uint32","uint32","bytes32","bytes32","bytes32"]
```

produces the same leaf. `MerkleVectorsTest` checks that, including a one-leaf tree, a pair, a triple, five leaves, and two leaves that share content bytes but use different salts and indexes.

Schema version is `1`.

Evidence type is keccak256 of one of these UTF-8 strings:

```text
evidencebound.file.v1
evidencebound.url-reference.v1
evidencebound.snapshot.v1
```

Other types still hash. The contract does not whitelist them. Unknown types are an interoperability problem, not a rejected transaction.

## Salt

Each item gets a fresh 32-byte salt from a cryptographic random generator. The salt is stored off-chain with the export. It is there so a guessable file does not have a guessable leaf.

Fixture salts in `test/fixtures/merkle-vectors.json` are deterministic labels. They are test vectors, not an example of how to mint production salts.

## Manifest and export

The manifest is canonical JSON. It must not contain the Merkle root. The root is computed from the leaves, and the leaves are computed from the manifest fields. Putting the root inside that preimage would be circular.

Phase 2 manifest, schema `evidencebound.manifest.v1`:

```text
chainId, escrowContract, escrowId, deliveryVersion,
items[]: index, evidenceType, contentHash, salt, byteLength, storageKey
```

Original filenames stay in private local metadata. They are not leaf fields and they are not event fields. `storageKey` is a generated id, never a user-supplied path.

Export envelope, schema `evidencebound.evidence-export.v1`, is a separate object. It may contain the manifest, the manifest hash, the leaf encoding, the leaf hashes, the root, and the proofs. Verification can use the export plus the artifact bytes plus the root read from the chain. It should not need the application database.

The individual-hash variant does not need proofs, but the export still carries the leaf hashes so a checker can compare them to `commitmentAt`.

## Merkle tree

Use `StandardMerkleTree.of` with the default `sortLeaves: true`. Do not implement a second hashing scheme. Internal nodes are sorted-pair Keccak, matching `MerkleProof` in OpenZeppelin Contracts 5.7.

A one-leaf tree has an empty proof and a root equal to the leaf hash.

The contract never accepts a proof against a root that the caller supplies at verification time. `MerkleRootEscrow.verifyEvidence` loads the root stored for that escrow and version.

## On-chain status codes

```text
0 Valid
1 UnknownEscrow
2 WrongSchema
3 WrongChain
4 WrongContract
5 WrongEscrow
6 UnknownDelivery
7 NotMember
```

Missing files and missing manifests are off-chain results. The chain cannot see them. The future verifier page maps those separately from `NotMember`.
