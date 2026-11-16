import { keccak256Utf8 } from "@evidencebound/evidence";
import type { Hex } from "viem";

/** reasonHash = keccak256(utf8 reason). Empty / whitespace rejected (maps to ZeroCommitment risk if abused). */
export function hashReasonText(reason: string): Hex {
  const trimmed = reason.trim();
  if (!trimmed) {
    throw new Error("Reason text is required");
  }
  return keccak256Utf8(trimmed);
}

export const BPS_DENOMINATOR = 10_000;
export const MAX_REVISIONS = 1;
