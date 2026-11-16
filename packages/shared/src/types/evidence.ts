import type { Hex } from "./hex.js";
import type { LEAF_ENCODING } from "../constants.js";

/** Manifest item. evidenceType is the string label, not the bytes32 hash. */
export interface ManifestItem {
  index: string;
  evidenceType: string;
  contentHash: Hex;
  salt: Hex;
  byteLength: string;
  storageKey: string;
}

/**
 * Canonical delivery manifest. Must not embed Merkle root or proofs.
 * Integer fields are decimal strings for RFC 8785 stability.
 */
export interface Manifest {
  schema: "evidencebound.manifest.v1";
  chainId: string;
  escrowContract: string;
  escrowId: string;
  deliveryVersion: string;
  items: ManifestItem[];
}

/** Nine leaf fields matching IEscrow.EvidenceLeaf / Solidity ABI order. */
export interface EvidenceLeafFields {
  schemaVersion: number;
  chainId: bigint;
  escrowContract: string;
  escrowId: bigint;
  deliveryVersion: number;
  itemIndex: number;
  evidenceType: Hex;
  contentHash: Hex;
  salt: Hex;
}

export interface EvidenceExportLeaf {
  index: number;
  leafHash: Hex;
  fields: EvidenceLeafFields;
  proof: Hex[];
}

/** Fixed export envelope for offline verification. */
export interface EvidenceExport {
  schema: "evidencebound.evidence-export.v1";
  manifest: Manifest;
  manifestHash: Hex;
  leafEncoding: typeof LEAF_ENCODING | readonly string[];
  leaves: EvidenceExportLeaf[];
  root: Hex;
  declaredItemCount: number;
}
