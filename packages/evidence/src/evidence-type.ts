import type { Hex } from "@evidencebound/shared";
import { keccak256Utf8 } from "./hash.js";

/** Hash an evidence type label to the bytes32 used in the Solidity leaf. */
export function hashEvidenceType(label: string): Hex {
  if (typeof label !== "string" || label.length === 0) {
    throw new Error("evidenceType label must be a non-empty string");
  }
  return keccak256Utf8(label);
}
