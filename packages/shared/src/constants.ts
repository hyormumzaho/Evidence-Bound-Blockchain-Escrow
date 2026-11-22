/** OpenZeppelin StandardMerkleTree leaf ABI encoding. Do not reorder without a schema bump. */
export const LEAF_ENCODING = [
  "uint16",
  "uint256",
  "address",
  "uint256",
  "uint32",
  "uint32",
  "bytes32",
  "bytes32",
  "bytes32",
] as const;

export const EVIDENCE_SCHEMA_VERSION = 1;
export const MAX_EVIDENCE_ITEMS = 100;
export const MAX_REVISIONS = 1;
export const BPS_DENOMINATOR = 10_000;

export const EVIDENCE_TYPE_LABELS = {
  file: "evidencebound.file.v1",
  urlReference: "evidencebound.url-reference.v1",
  snapshot: "evidencebound.snapshot.v1",
} as const;

export const SCHEMAS = {
  agreement: "evidencebound.agreement.v1",
  manifest: "evidencebound.manifest.v1",
  export: "evidencebound.evidence-export.v1",
  urlReference: "evidencebound.url-reference.v1",
} as const;

/** Mirrors IEscrow.EvidenceStatus. */
export const EvidenceStatus = {
  Valid: 0,
  UnknownEscrow: 1,
  WrongSchema: 2,
  WrongChain: 3,
  WrongContract: 4,
  WrongEscrow: 5,
  UnknownDelivery: 6,
  NotMember: 7,
} as const;

export type EvidenceStatusCode = (typeof EvidenceStatus)[keyof typeof EvidenceStatus];

/** Off-chain-only results. The chain cannot see missing files or manifests. */
export const OffchainStatus = {
  MissingArtifact: "MissingArtifact",
  ManifestMissing: "ManifestMissing",
  ContentHashMismatch: "ContentHashMismatch",
  InvalidExport: "InvalidExport",
  ManifestIntegrityFailed: "ManifestIntegrityFailed",
  /** The authoritative chain commitment was not supplied. This is unknown, not invalid. */
  ChainCommitmentUnavailable: "ChainCommitmentUnavailable",
} as const;

export type OffchainStatusCode = (typeof OffchainStatus)[keyof typeof OffchainStatus];
