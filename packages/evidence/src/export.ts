import {
  LEAF_ENCODING,
  SCHEMAS,
  type EvidenceExport,
  type EvidenceExportLeaf,
  type Hex,
  type Manifest,
} from "@evidencebound/shared";
import { hashManifest, manifestToLeafFields } from "./manifest.js";
import { buildDeliveryTree, type DeliveryTree } from "./merkle.js";
import { assertBytes32, normalizeHex } from "./hex.js";
import { hashEvidenceLeaf } from "./leaf.js";
import { verifyLeafProof } from "./merkle.js";

export function buildExport(manifest: Manifest, tree?: DeliveryTree): EvidenceExport {
  const fields = manifestToLeafFields(manifest);
  const deliveryTree = tree ?? buildDeliveryTree(fields);
  const manifestHash = hashManifest(manifest);

  if (deliveryTree.fieldsInIndexOrder.length !== fields.length) {
    throw new Error("Tree leaf count does not match manifest");
  }

  const leaves: EvidenceExportLeaf[] = fields.map((leafFields, index) => {
    const leafHash = hashEvidenceLeaf(leafFields);
    if (leafHash !== deliveryTree.leafHashesInIndexOrder[index]) {
      throw new Error(`Leaf hash mismatch at index ${index}`);
    }
    return {
      index,
      leafHash,
      fields: leafFields,
      proof: deliveryTree.getProof(index),
    };
  });

  // Integrity: every proof verifies against the export root.
  for (const leaf of leaves) {
    if (!verifyLeafProof(deliveryTree.root, leaf.fields, leaf.proof)) {
      throw new Error(`Invalid Merkle proof generated for index ${leaf.index}`);
    }
  }

  return {
    schema: SCHEMAS.export,
    manifest,
    manifestHash,
    leafEncoding: [...LEAF_ENCODING],
    leaves,
    root: deliveryTree.root,
    declaredItemCount: leaves.length,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string") {
    throw new Error(`Export field ${key} must be a string`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Export field ${key} must be an integer`);
  }
  return value;
}

function parseLeafFields(raw: unknown): EvidenceExport["leaves"][number]["fields"] {
  if (!isObject(raw)) {
    throw new Error("leaf.fields must be an object");
  }
  const schemaVersion = requireNumber(raw, "schemaVersion");
  const deliveryVersion = requireNumber(raw, "deliveryVersion");
  const itemIndex = requireNumber(raw, "itemIndex");
  const chainIdRaw = raw.chainId;
  const escrowIdRaw = raw.escrowId;
  const chainId =
    typeof chainIdRaw === "bigint"
      ? chainIdRaw
      : typeof chainIdRaw === "number" || typeof chainIdRaw === "string"
        ? BigInt(chainIdRaw)
        : (() => {
            throw new Error("fields.chainId must be bigint-compatible");
          })();
  const escrowId =
    typeof escrowIdRaw === "bigint"
      ? escrowIdRaw
      : typeof escrowIdRaw === "number" || typeof escrowIdRaw === "string"
        ? BigInt(escrowIdRaw)
        : (() => {
            throw new Error("fields.escrowId must be bigint-compatible");
          })();

  return {
    schemaVersion,
    chainId,
    escrowContract: requireString(raw, "escrowContract").toLowerCase(),
    escrowId,
    deliveryVersion,
    itemIndex,
    evidenceType: assertBytes32(requireString(raw, "evidenceType"), "evidenceType"),
    contentHash: assertBytes32(requireString(raw, "contentHash"), "contentHash"),
    salt: assertBytes32(requireString(raw, "salt"), "salt"),
  };
}

/**
 * Parse and strictly validate an export envelope.
 * Recomputes manifestHash, leaf hashes, and verifies proofs against root.
 */
export function parseExport(input: unknown): EvidenceExport {
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!isObject(raw)) {
    throw new Error("Export must be an object");
  }
  if (raw.schema !== SCHEMAS.export) {
    throw new Error(`Unexpected export schema: ${String(raw.schema)}`);
  }
  if (!isObject(raw.manifest)) {
    throw new Error("Export.manifest must be an object");
  }
  if (raw.manifest.schema !== SCHEMAS.manifest) {
    throw new Error(`Unexpected manifest schema in export: ${String(raw.manifest.schema)}`);
  }

  const manifest = raw.manifest as unknown as Manifest;
  const expectedManifestHash = hashManifest(manifest);
  const manifestHash = normalizeHex(requireString(raw, "manifestHash"));
  if (manifestHash !== expectedManifestHash) {
    throw new Error("manifestHash does not match canonical manifest");
  }

  if (!Array.isArray(raw.leafEncoding)) {
    throw new Error("leafEncoding must be an array");
  }
  if (raw.leafEncoding.length !== LEAF_ENCODING.length) {
    throw new Error("leafEncoding length mismatch");
  }
  for (let i = 0; i < LEAF_ENCODING.length; i++) {
    if (raw.leafEncoding[i] !== LEAF_ENCODING[i]) {
      throw new Error(`leafEncoding[${i}] mismatch`);
    }
  }

  if (!Array.isArray(raw.leaves)) {
    throw new Error("leaves must be an array");
  }
  const declaredItemCount = requireNumber(raw, "declaredItemCount");
  if (declaredItemCount !== raw.leaves.length) {
    throw new Error("declaredItemCount must equal leaves.length");
  }
  if (declaredItemCount !== manifest.items.length) {
    throw new Error("declaredItemCount must equal manifest.items.length");
  }

  const root = normalizeHex(requireString(raw, "root")) as Hex;
  const leaves: EvidenceExportLeaf[] = raw.leaves.map((leafRaw, i) => {
    if (!isObject(leafRaw)) {
      throw new Error(`leaves[${i}] must be an object`);
    }
    const index = requireNumber(leafRaw, "index");
    if (index !== i) {
      throw new Error(`leaves[${i}].index must equal ${i}`);
    }
    const fields = parseLeafFields(leafRaw.fields);
    if (fields.itemIndex !== i) {
      throw new Error(`leaves[${i}].fields.itemIndex must equal ${i}`);
    }
    const leafHash = normalizeHex(requireString(leafRaw, "leafHash")) as Hex;
    const expectedHash = hashEvidenceLeaf(fields);
    if (leafHash !== expectedHash) {
      throw new Error(`leaves[${i}].leafHash does not match fields`);
    }
    if (!Array.isArray(leafRaw.proof)) {
      throw new Error(`leaves[${i}].proof must be an array`);
    }
    const proof = leafRaw.proof.map((p, j) => {
      if (typeof p !== "string") {
        throw new Error(`leaves[${i}].proof[${j}] must be hex string`);
      }
      return normalizeHex(p);
    });
    if (!verifyLeafProof(root, fields, proof)) {
      throw new Error(`leaves[${i}] proof does not verify against root`);
    }
    return { index, leafHash, fields, proof };
  });

  // Cross-check leaves against manifest-derived fields.
  const fromManifest = manifestToLeafFields(manifest);
  for (let i = 0; i < fromManifest.length; i++) {
    const a = fromManifest[i]!;
    const b = leaves[i]!.fields;
    if (
      a.schemaVersion !== b.schemaVersion ||
      a.chainId !== b.chainId ||
      a.escrowContract !== b.escrowContract ||
      a.escrowId !== b.escrowId ||
      a.deliveryVersion !== b.deliveryVersion ||
      a.itemIndex !== b.itemIndex ||
      a.evidenceType !== b.evidenceType ||
      a.contentHash !== b.contentHash ||
      a.salt !== b.salt
    ) {
      throw new Error(`Export leaf ${i} does not match manifest`);
    }
  }

  return {
    schema: SCHEMAS.export,
    manifest,
    manifestHash,
    leafEncoding: [...LEAF_ENCODING],
    leaves,
    root,
    declaredItemCount,
  };
}

export function serializeExport(evidenceExport: EvidenceExport): string {
  // BigInt fields must be encoded as strings for JSON.
  return JSON.stringify(evidenceExport, (_key, value) =>
    typeof value === "bigint" ? value.toString(10) : value,
  );
}

export function parseExportJson(json: string): EvidenceExport {
  return parseExport(JSON.parse(json));
}
