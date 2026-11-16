import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  EVIDENCE_SCHEMA_VERSION,
  LEAF_ENCODING,
  type EvidenceLeafFields,
  type Hex,
} from "@evidencebound/shared";
import { assertAddress, assertBytes32, normalizeHex } from "./hex.js";
import { hashEvidenceType } from "./evidence-type.js";

export type LeafValueTuple = [
  number,
  bigint | number | string,
  string,
  bigint | number | string,
  number,
  number,
  string,
  string,
  string,
];

export function leafValues(fields: EvidenceLeafFields): LeafValueTuple {
  return [
    fields.schemaVersion,
    fields.chainId,
    assertAddress(fields.escrowContract, "escrowContract"),
    fields.escrowId,
    fields.deliveryVersion,
    fields.itemIndex,
    assertBytes32(fields.evidenceType, "evidenceType"),
    assertBytes32(fields.contentHash, "contentHash"),
    assertBytes32(fields.salt, "salt"),
  ];
}

/**
 * OpenZeppelin standard leaf hash matching EvidenceCommitment.sol.
 * Uses the public StandardMerkleTree API (browser-safe; no node:module).
 */
export function hashEvidenceLeaf(fields: EvidenceLeafFields): Hex {
  const values = leafValues(fields);
  const tree = StandardMerkleTree.of([values], LEAF_ENCODING as unknown as string[]);
  return normalizeHex(tree.leafHash(values));
}

export interface BuildLeafInput {
  schemaVersion?: number;
  chainId: bigint | number | string;
  escrowContract: string;
  escrowId: bigint | number | string;
  deliveryVersion: number;
  itemIndex: number;
  evidenceTypeLabel: string;
  contentHash: Hex;
  salt: Hex;
}

export function buildLeafFields(input: BuildLeafInput): EvidenceLeafFields {
  const schemaVersion = input.schemaVersion ?? EVIDENCE_SCHEMA_VERSION;
  if (schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported evidence schemaVersion: ${schemaVersion}`);
  }
  if (!Number.isInteger(input.deliveryVersion) || input.deliveryVersion < 1) {
    throw new Error("deliveryVersion must be a positive integer");
  }
  if (!Number.isInteger(input.itemIndex) || input.itemIndex < 0) {
    throw new Error("itemIndex must be a non-negative integer");
  }

  const chainId = typeof input.chainId === "bigint" ? input.chainId : BigInt(input.chainId);
  const escrowId = typeof input.escrowId === "bigint" ? input.escrowId : BigInt(input.escrowId);

  return {
    schemaVersion,
    chainId,
    escrowContract: assertAddress(input.escrowContract),
    escrowId,
    deliveryVersion: input.deliveryVersion,
    itemIndex: input.itemIndex,
    evidenceType: hashEvidenceType(input.evidenceTypeLabel),
    contentHash: assertBytes32(input.contentHash, "contentHash"),
    salt: assertBytes32(input.salt, "salt"),
  };
}
