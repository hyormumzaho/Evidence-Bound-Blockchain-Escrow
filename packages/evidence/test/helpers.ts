import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE_TYPE_LABELS,
  type EvidenceLeafFields,
  type Hex,
} from "@evidencebound/shared";
import { buildExport } from "../src/export.js";
import { hashFileBytes } from "../src/content.js";
import { buildManifest } from "../src/manifest.js";
import { randomSalt } from "../src/salt.js";

const here = dirname(fileURLToPath(import.meta.url));

export function loadMerkleVectors() {
  const path = join(here, "../../contracts/test/fixtures/merkle-vectors.json");
  return JSON.parse(readFileSync(path, "utf8")) as {
    cases: Array<{
      name: string;
      root: string;
      leaves: Array<{
        schemaVersion: number;
        chainId: number;
        escrowContract: string;
        escrowId: number;
        deliveryVersion: number;
        itemIndex: number;
        evidenceType: string;
        contentHash: string;
        salt: string;
        leafHash: string;
        proof: string[];
      }>;
    }>;
  };
}

export function vectorToFields(leaf: {
  schemaVersion: number;
  chainId: number;
  escrowContract: string;
  escrowId: number;
  deliveryVersion: number;
  itemIndex: number;
  evidenceType: string;
  contentHash: string;
  salt: string;
}): EvidenceLeafFields {
  return {
    schemaVersion: leaf.schemaVersion,
    chainId: BigInt(leaf.chainId),
    escrowContract: leaf.escrowContract.toLowerCase(),
    escrowId: BigInt(leaf.escrowId),
    deliveryVersion: leaf.deliveryVersion,
    itemIndex: leaf.itemIndex,
    evidenceType: leaf.evidenceType as Hex,
    contentHash: leaf.contentHash as Hex,
    salt: leaf.salt as Hex,
  };
}

export function makeFileDelivery(params: {
  chainId?: number;
  escrowContract?: string;
  escrowId?: number;
  deliveryVersion?: number;
  files: Uint8Array[];
  salts?: Hex[];
}) {
  const chainId = params.chainId ?? 31337;
  const escrowContract = params.escrowContract ?? "0x1111111111111111111111111111111111111111";
  const escrowId = params.escrowId ?? 7;
  const deliveryVersion = params.deliveryVersion ?? 1;
  const salts = params.salts ?? params.files.map(() => randomSalt());

  const items = params.files.map((bytes, index) => ({
    index,
    evidenceType: EVIDENCE_TYPE_LABELS.file,
    contentHash: hashFileBytes(bytes),
    salt: salts[index]!,
    byteLength: bytes.length,
    storageKey: `obj-${index}`,
  }));

  const manifest = buildManifest({
    chainId,
    escrowContract,
    escrowId,
    deliveryVersion,
    items,
  });
  const evidenceExport = buildExport(manifest);
  return { manifest, evidenceExport, salts, files: params.files };
}
