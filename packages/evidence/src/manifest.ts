import {
  MAX_EVIDENCE_ITEMS,
  SCHEMAS,
  type Hex,
  type Manifest,
  type ManifestItem,
} from "@evidencebound/shared";
import { canonicalizeJson } from "./canonicalize.js";
import { keccak256Utf8 } from "./hash.js";
import {
  assertAddress,
  assertBytes32,
  decimalString,
  normalizeHex,
  parseDecimalToBigInt,
  parseDecimalToNumber,
} from "./hex.js";
import { buildLeafFields, hashEvidenceLeaf } from "./leaf.js";
import type { EvidenceLeafFields } from "@evidencebound/shared";

export interface ManifestItemInput {
  index: number;
  evidenceType: string;
  contentHash: Hex;
  salt: Hex;
  byteLength: number | bigint | string;
  storageKey: string;
}

export interface BuildManifestInput {
  chainId: number | bigint | string;
  escrowContract: string;
  escrowId: number | bigint | string;
  deliveryVersion: number | bigint | string;
  items: ManifestItemInput[];
}

function assertStorageKey(storageKey: string): string {
  if (typeof storageKey !== "string" || storageKey.length === 0) {
    throw new Error("storageKey must be a non-empty generated id");
  }
  if (storageKey.includes("..") || storageKey.includes("/") || storageKey.includes("\\")) {
    throw new Error("storageKey must not look like a filesystem path");
  }
  return storageKey;
}

export function buildManifest(input: BuildManifestInput): Manifest {
  const count = input.items.length;
  if (count === 0 || count > MAX_EVIDENCE_ITEMS) {
    throw new Error(`Manifest item count must be 1..${MAX_EVIDENCE_ITEMS}, got ${count}`);
  }

  const items: ManifestItem[] = input.items.map((item, expectedIndex) => {
    if (item.index !== expectedIndex) {
      throw new Error(`Item index must be contiguous from 0: expected ${expectedIndex}, got ${item.index}`);
    }
    if (typeof item.evidenceType !== "string" || item.evidenceType.length === 0) {
      throw new Error("evidenceType must be a non-empty string label");
    }
    return {
      index: decimalString(item.index, "index"),
      evidenceType: item.evidenceType,
      contentHash: assertBytes32(item.contentHash, "contentHash"),
      salt: assertBytes32(item.salt, "salt"),
      byteLength: decimalString(item.byteLength, "byteLength"),
      storageKey: assertStorageKey(item.storageKey),
    };
  });

  const manifest: Manifest = {
    schema: SCHEMAS.manifest,
    chainId: decimalString(input.chainId, "chainId"),
    escrowContract: assertAddress(input.escrowContract),
    escrowId: decimalString(input.escrowId, "escrowId"),
    deliveryVersion: decimalString(input.deliveryVersion, "deliveryVersion"),
    items,
  };

  assertNoRootInManifest(manifest);
  return manifest;
}

export function assertNoRootInManifest(manifest: Manifest): void {
  const record = manifest as unknown as Record<string, unknown>;
  if ("root" in record || "proofs" in record || "proof" in record) {
    throw new Error("Manifest must not embed Merkle root or proofs");
  }
}

export function canonicalizeManifest(manifest: Manifest): string {
  assertNoRootInManifest(manifest);
  return canonicalizeJson(manifest);
}

export function hashManifest(manifest: Manifest): Hex {
  return keccak256Utf8(canonicalizeManifest(manifest));
}

/** Convert a canonical manifest into Solidity leaf field structs (index order). */
export function manifestToLeafFields(manifest: Manifest): EvidenceLeafFields[] {
  if (manifest.schema !== SCHEMAS.manifest) {
    throw new Error(`Unexpected manifest schema: ${manifest.schema}`);
  }
  const chainId = parseDecimalToBigInt(manifest.chainId, "chainId");
  const escrowId = parseDecimalToBigInt(manifest.escrowId, "escrowId");
  const deliveryVersion = parseDecimalToNumber(manifest.deliveryVersion, "deliveryVersion", 0xffffffff);

  return manifest.items.map((item) =>
    buildLeafFields({
      chainId,
      escrowContract: manifest.escrowContract,
      escrowId,
      deliveryVersion,
      itemIndex: parseDecimalToNumber(item.index, "index", MAX_EVIDENCE_ITEMS - 1),
      evidenceTypeLabel: item.evidenceType,
      contentHash: normalizeHex(item.contentHash) as Hex,
      salt: normalizeHex(item.salt) as Hex,
    }),
  );
}

export function manifestLeafHashes(manifest: Manifest): Hex[] {
  return manifestToLeafFields(manifest).map((fields) => hashEvidenceLeaf(fields));
}
