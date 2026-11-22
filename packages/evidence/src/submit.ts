import type { EvidenceExport, Hex } from "@evidencebound/shared";
import { parseExport } from "./export.js";

export interface IndividualSubmitPayload {
  commitments: Hex[];
}

export interface MerkleSubmitPayload {
  root: Hex;
  declaredCount: number;
}

export interface ManifestSubmitPayload {
  manifestHash: Hex;
  /** Timeline count. The contract does not authenticate this against the hash. */
  itemCount: number;
}

function asExport(input: EvidenceExport | unknown): EvidenceExport {
  return parseExport(input);
}

export function toIndividualSubmit(input: EvidenceExport | unknown): IndividualSubmitPayload {
  const evidenceExport = asExport(input);
  return {
    commitments: evidenceExport.leaves.map((leaf) => leaf.leafHash),
  };
}

export function toMerkleSubmit(input: EvidenceExport | unknown): MerkleSubmitPayload {
  const evidenceExport = asExport(input);
  return {
    root: evidenceExport.root,
    declaredCount: evidenceExport.declaredItemCount,
  };
}

/** Canonical manifest hash. This is not a Merkle root and not a list of leaf hashes. */
export function toManifestSubmit(input: EvidenceExport | unknown): ManifestSubmitPayload {
  const evidenceExport = asExport(input);
  return {
    manifestHash: evidenceExport.manifestHash,
    itemCount: evidenceExport.manifest.items.length,
  };
}
