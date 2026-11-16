import type { EvidenceExport, Hex } from "@evidencebound/shared";
import { parseExport } from "./export.js";

export interface IndividualSubmitPayload {
  commitments: Hex[];
}

export interface MerkleSubmitPayload {
  root: Hex;
  declaredCount: number;
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
