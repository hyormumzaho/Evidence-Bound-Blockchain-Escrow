import { SCHEMAS, type Hex } from "@evidencebound/shared";
import { canonicalizeJson } from "./canonicalize.js";
import { keccak256Bytes, keccak256Utf8 } from "./hash.js";

/** keccak256 of raw file bytes with no prefix. */
export function hashFileBytes(bytes: Uint8Array): Hex {
  return keccak256Bytes(bytes);
}

/** Snapshot bytes use the same raw-byte hash as files. */
export function hashSnapshotBytes(bytes: Uint8Array): Hex {
  return hashFileBytes(bytes);
}

/**
 * keccak256 of the RFC 8785 canonical URL-reference JSON object.
 * Commits to the URL string, not to whatever that URL returns.
 */
export function hashUrlReference(url: string): Hex {
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("url must be a non-empty string");
  }
  const canonical = canonicalizeJson({
    schema: SCHEMAS.urlReference,
    url,
  });
  return keccak256Utf8(canonical);
}
