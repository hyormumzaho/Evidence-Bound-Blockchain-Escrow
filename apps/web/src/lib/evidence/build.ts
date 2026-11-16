import {
  buildExport,
  buildManifest,
  hashFileBytes,
  hashUrlReference,
  randomSalt,
  toIndividualSubmit,
  toMerkleSubmit,
  type EvidenceExport,
} from "@evidencebound/evidence";
import { EVIDENCE_TYPE_LABELS, MAX_EVIDENCE_ITEMS } from "@evidencebound/shared";
import type { Address, Hex } from "viem";
import { encodeAbiParameters, keccak256 } from "viem";

export type DraftFileItem = {
  kind: "file";
  storageKey: string;
  contentHash: Hex;
  byteLength: number;
  originalFilename?: string;
  salt: Hex;
};

export type DraftUrlItem = {
  kind: "url";
  storageKey: string;
  url: string;
  contentHash: Hex;
  byteLength: number;
  salt: Hex;
};

export type DraftEvidenceItem = DraftFileItem | DraftUrlItem;

export function newUrlDraft(url: string): DraftUrlItem {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("URL must start with http:// or https://");
  }
  return {
    kind: "url",
    storageKey: crypto.randomUUID().replace(/-/g, ""),
    url: trimmed,
    contentHash: hashUrlReference(trimmed),
    byteLength: new TextEncoder().encode(trimmed).byteLength,
    salt: randomSalt(),
  };
}

export function draftFromUploadedFile(input: {
  storageKey: string;
  contentHash: Hex;
  byteLength: number;
  originalFilename?: string;
}): DraftFileItem {
  return {
    kind: "file",
    storageKey: input.storageKey,
    contentHash: input.contentHash,
    byteLength: input.byteLength,
    originalFilename: input.originalFilename,
    salt: randomSalt(),
  };
}

export function buildDeliveryExport(input: {
  chainId: number;
  escrowContract: Address;
  escrowId: number;
  deliveryVersion: number;
  items: DraftEvidenceItem[];
}): EvidenceExport {
  if (input.items.length === 0 || input.items.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`Need 1..${MAX_EVIDENCE_ITEMS} evidence items`);
  }
  if (!Number.isInteger(input.deliveryVersion) || input.deliveryVersion < 1) {
    throw new Error("deliveryVersion must be >= 1 (use on-chain deliveryVersion + 1)");
  }

  const manifest = buildManifest({
    chainId: input.chainId,
    escrowContract: input.escrowContract,
    escrowId: input.escrowId,
    deliveryVersion: input.deliveryVersion,
    items: input.items.map((item, index) => ({
      index,
      evidenceType:
        item.kind === "file" ? EVIDENCE_TYPE_LABELS.file : EVIDENCE_TYPE_LABELS.urlReference,
      contentHash: item.contentHash,
      salt: item.salt,
      byteLength: item.byteLength,
      storageKey: item.storageKey,
    })),
  });

  return buildExport(manifest);
}

export function submitPayloadForVariant(evidenceExport: EvidenceExport, variant: "individual" | "merkle") {
  if (variant === "individual") {
    return { kind: "individual" as const, ...toIndividualSubmit(evidenceExport) };
  }
  return { kind: "merkle" as const, ...toMerkleSubmit(evidenceExport) };
}

/** Matches IndividualHashEscrow event bundleCommitment = keccak256(abi.encode(commitments)). */
export function individualBundleCommitment(commitments: Hex[]): Hex {
  return keccak256(encodeAbiParameters([{ type: "bytes32[]" }], [commitments]));
}

export { hashFileBytes, hashUrlReference, randomSalt };
