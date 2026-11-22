import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceStatus,
  OffchainStatus,
  type EvidenceExport,
  type EvidenceLeafFields,
  type Hex,
  type Manifest,
  type VerifyResult,
} from "@evidencebound/shared";
import { hashFileBytes, hashSnapshotBytes, hashUrlReference } from "./content.js";
import { EVIDENCE_TYPE_LABELS } from "@evidencebound/shared";
import { hashManifest } from "./manifest.js";
import { hashEvidenceLeaf } from "./leaf.js";
import { verifyLeafProof } from "./merkle.js";
import { parseExport } from "./export.js";
import { assertAddress, normalizeHex } from "./hex.js";

export interface BindingContext {
  chainId: bigint | number | string;
  escrowContract: string;
  escrowId: bigint | number | string;
  /** Optional: if provided, leaf.deliveryVersion must equal this. */
  deliveryVersion?: number;
  /**
   * Optional on-chain deliveryVersion ceiling (mirrors UnknownDelivery).
   * When set, leaf.deliveryVersion must be in 1..currentDeliveryVersion.
   */
  currentDeliveryVersion?: number;
}

export interface ArtifactInput {
  /** Raw bytes for file/snapshot items. */
  bytes?: Uint8Array;
  /** URL string for url-reference items. */
  url?: string;
}

function bindingStatus(fields: EvidenceLeafFields, ctx: BindingContext): VerifyResult {
  if (fields.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    return { ok: false, status: EvidenceStatus.WrongSchema, message: "Wrong schema version" };
  }
  const expectedChain = BigInt(ctx.chainId);
  if (fields.chainId !== expectedChain) {
    return { ok: false, status: EvidenceStatus.WrongChain, message: "Wrong chain id" };
  }
  if (fields.escrowContract !== assertAddress(ctx.escrowContract)) {
    return { ok: false, status: EvidenceStatus.WrongContract, message: "Wrong escrow contract" };
  }
  if (fields.escrowId !== BigInt(ctx.escrowId)) {
    return { ok: false, status: EvidenceStatus.WrongEscrow, message: "Wrong escrow id" };
  }
  if (ctx.deliveryVersion !== undefined && fields.deliveryVersion !== ctx.deliveryVersion) {
    return { ok: false, status: EvidenceStatus.UnknownDelivery, message: "Wrong delivery version" };
  }
  if (ctx.currentDeliveryVersion !== undefined) {
    if (fields.deliveryVersion === 0 || fields.deliveryVersion > ctx.currentDeliveryVersion) {
      return { ok: false, status: EvidenceStatus.UnknownDelivery, message: "Unknown delivery version" };
    }
  }
  return { ok: true, status: EvidenceStatus.Valid };
}

function expectedContentHash(evidenceTypeLabel: string, artifact: ArtifactInput): Hex {
  if (evidenceTypeLabel === EVIDENCE_TYPE_LABELS.urlReference) {
    if (!artifact.url) {
      throw new Error("URL artifact required");
    }
    return hashUrlReference(artifact.url);
  }
  if (!artifact.bytes) {
    throw new Error("Byte artifact required");
  }
  if (evidenceTypeLabel === EVIDENCE_TYPE_LABELS.snapshot) {
    return hashSnapshotBytes(artifact.bytes);
  }
  return hashFileBytes(artifact.bytes);
}

/**
 * Verify one export leaf against optional artifact bytes and binding context.
 * Does not call the chain; pair with on-chain verifyEvidence for membership against storage.
 */
export function verifyExportLeaf(params: {
  evidenceExport: EvidenceExport | unknown;
  index: number;
  artifact?: ArtifactInput;
  binding: BindingContext;
  /** When true, also check Merkle proof against export.root. */
  checkProof?: boolean;
}): VerifyResult {
  let evidenceExport: EvidenceExport;
  try {
    evidenceExport = parseExport(params.evidenceExport);
  } catch (err) {
    return {
      ok: false,
      status: OffchainStatus.InvalidExport,
      message: err instanceof Error ? err.message : "Invalid export",
    };
  }

  const leaf = evidenceExport.leaves[params.index];
  const manifestItem = evidenceExport.manifest.items[params.index];
  if (!leaf || !manifestItem) {
    return { ok: false, status: EvidenceStatus.NotMember, message: "Index out of range" };
  }

  const bound = bindingStatus(leaf.fields, params.binding);
  if (!bound.ok) {
    return bound;
  }

  if (params.artifact !== undefined) {
    try {
      const contentHash = expectedContentHash(manifestItem.evidenceType, params.artifact);
      if (contentHash !== normalizeHex(leaf.fields.contentHash)) {
        return {
          ok: false,
          status: OffchainStatus.ContentHashMismatch,
          message: "Artifact content hash mismatch",
        };
      }
    } catch (err) {
      return {
        ok: false,
        status: OffchainStatus.MissingArtifact,
        message: err instanceof Error ? err.message : "Missing artifact",
      };
    }
  }

  const recomputed = hashEvidenceLeaf(leaf.fields);
  if (recomputed !== leaf.leafHash) {
    return { ok: false, status: EvidenceStatus.NotMember, message: "Leaf hash mismatch" };
  }

  if (params.checkProof !== false) {
    if (!verifyLeafProof(evidenceExport.root, leaf.fields, leaf.proof)) {
      return { ok: false, status: EvidenceStatus.NotMember, message: "Merkle proof failed" };
    }
  }

  // Salt / type consistency with manifest
  if (normalizeHex(manifestItem.salt) !== leaf.fields.salt) {
    return { ok: false, status: EvidenceStatus.NotMember, message: "Salt mismatch vs manifest" };
  }
  if (normalizeHex(manifestItem.contentHash) !== leaf.fields.contentHash) {
    return { ok: false, status: EvidenceStatus.NotMember, message: "Content hash mismatch vs manifest" };
  }

  return { ok: true, status: EvidenceStatus.Valid };
}

/**
 * Compare a manifest with the hash stored by ManifestHashEscrow.
 * A missing manifest or a missing chain hash is not an integrity failure.
 */
export function verifyManifestCommitment(params: {
  manifest?: Manifest;
  storedManifestHash?: Hex;
}): VerifyResult {
  if (!params.manifest) {
    return { ok: false, status: OffchainStatus.ManifestMissing, message: "Manifest missing; not verified" };
  }
  if (!params.storedManifestHash) {
    return {
      ok: false,
      status: OffchainStatus.ChainCommitmentUnavailable,
      message: "Chain manifest hash missing; not verified",
    };
  }

  const actual = hashManifest(params.manifest);
  if (actual !== normalizeHex(params.storedManifestHash)) {
    return {
      ok: false,
      status: OffchainStatus.ManifestIntegrityFailed,
      message: "Manifest hash does not match the stored commitment",
    };
  }
  return { ok: true, status: EvidenceStatus.Valid };
}

/** Convenience: verify leaf fields alone against binding + optional membership list/root. */
export function verifyLeafMembership(params: {
  fields: EvidenceLeafFields;
  binding: BindingContext;
  /** Individual-hash path: stored commitments in index order. */
  storedCommitments?: Hex[];
  /** Merkle path. */
  root?: Hex;
  proof?: Hex[];
}): VerifyResult {
  const bound = bindingStatus(params.fields, params.binding);
  if (!bound.ok) {
    return bound;
  }

  const leafHash = hashEvidenceLeaf(params.fields);

  if (params.storedCommitments) {
    const stored = params.storedCommitments[params.fields.itemIndex];
    if (!stored || normalizeHex(stored) !== leafHash) {
      return { ok: false, status: EvidenceStatus.NotMember, message: "Not in stored commitments" };
    }
    return { ok: true, status: EvidenceStatus.Valid };
  }

  if (params.root && params.proof) {
    if (!verifyLeafProof(normalizeHex(params.root) as Hex, params.fields, params.proof)) {
      return { ok: false, status: EvidenceStatus.NotMember, message: "Merkle proof failed" };
    }
    return { ok: true, status: EvidenceStatus.Valid };
  }

  return { ok: false, status: OffchainStatus.InvalidExport, message: "No membership target provided" };
}
