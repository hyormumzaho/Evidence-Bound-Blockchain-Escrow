/**
 * Phase 2 end-to-end demo against the real Evidence Library API.
 * Run: pnpm --filter @evidencebound/evidence demo:e2e
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE_TYPE_LABELS,
  EvidenceStatus,
  OffchainStatus,
  buildDeliveryTree,
  buildExport,
  buildManifest,
  hashEvidenceLeaf,
  hashFileBytes,
  hashManifest,
  parseExportJson,
  randomSalt,
  serializeExport,
  toIndividualSubmit,
  toMerkleSubmit,
  verifyExportLeaf,
  verifyLeafProof,
  type Hex,
} from "../src/index.js";

const ESCROW = "0x1111111111111111111111111111111111111111";
const CHAIN_ID = 31337;
const ESCROW_ID = 42;
const DELIVERY_VERSION = 1;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function runSingleFile(): void {
  console.log("\n=== Single-file path ===");
  const bytes = new TextEncoder().encode("Hello EvidenceBound Escrow");
  const contentHash = hashFileBytes(bytes);
  const salt = randomSalt();
  console.log("contentHash:", contentHash);
  console.log("salt:", salt);

  const manifest = buildManifest({
    chainId: CHAIN_ID,
    escrowContract: ESCROW,
    escrowId: ESCROW_ID,
    deliveryVersion: DELIVERY_VERSION,
    items: [
      {
        index: 0,
        evidenceType: EVIDENCE_TYPE_LABELS.file,
        contentHash,
        salt,
        byteLength: bytes.length,
        storageKey: "single-hello",
      },
    ],
  });
  const evidenceExport = buildExport(manifest);
  assert(evidenceExport.root === evidenceExport.leaves[0]!.leafHash, "single-leaf root must equal leaf");
  assert(evidenceExport.leaves[0]!.proof.length === 0, "single-leaf proof must be empty");

  const ok = verifyExportLeaf({
    evidenceExport,
    index: 0,
    artifact: { bytes },
    binding: {
      chainId: CHAIN_ID,
      escrowContract: ESCROW,
      escrowId: ESCROW_ID,
      deliveryVersion: DELIVERY_VERSION,
    },
  });
  assert(ok.ok, `single-file verify failed: ${JSON.stringify(ok)}`);
  console.log("single-file verify: Valid");
  console.log("leafHash:", evidenceExport.leaves[0]!.leafHash);
  console.log("root:", evidenceExport.root);
}

function runThreeItemScenario(): {
  contentHashes: Hex[];
  leafHashes: Hex[];
  root: Hex;
  proofs: Hex[][];
  individual: { commitments: Hex[] };
  merkle: { root: Hex; declaredCount: number };
  fixture: Record<string, unknown>;
} {
  console.log("\n=== Three-item path (non-empty proofs) ===");

  // Fixed salts so the fixture is reproducible for Foundry parity.
  const salts: Hex[] = [
    ("0x" + "11".repeat(32)) as Hex,
    ("0x" + "22".repeat(32)) as Hex,
    ("0x" + "33".repeat(32)) as Hex,
  ];

  const files = [
    new TextEncoder().encode("Hello EvidenceBound Escrow"),
    new TextEncoder().encode("second-artifact"),
    new TextEncoder().encode("third-artifact"),
  ];

  const contentHashes = files.map((bytes) => hashFileBytes(bytes));
  console.log("contentHashes:", contentHashes);

  const manifest = buildManifest({
    chainId: CHAIN_ID,
    escrowContract: ESCROW,
    escrowId: ESCROW_ID,
    deliveryVersion: DELIVERY_VERSION,
    items: files.map((bytes, index) => ({
      index,
      evidenceType: EVIDENCE_TYPE_LABELS.file,
      contentHash: contentHashes[index]!,
      salt: salts[index]!,
      byteLength: bytes.length,
      storageKey: `obj-${index}`,
    })),
  });

  const manifestHash = hashManifest(manifest);
  console.log("manifestHash:", manifestHash);

  const evidenceExport = buildExport(manifest);
  const tree = buildDeliveryTree(evidenceExport.leaves.map((leaf) => leaf.fields));
  assert(evidenceExport.root === tree.root, "export root must match rebuild");

  const leafHashes = evidenceExport.leaves.map((leaf) => leaf.leafHash);
  const proofs = evidenceExport.leaves.map((leaf) => leaf.proof);
  for (let i = 0; i < leafHashes.length; i++) {
    const recomputed = hashEvidenceLeaf(evidenceExport.leaves[i]!.fields);
    assert(recomputed === leafHashes[i], `leaf hash mismatch at ${i}`);
    assert(
      verifyLeafProof(evidenceExport.root, evidenceExport.leaves[i]!.fields, proofs[i]!),
      `proof failed at ${i}`,
    );
    assert(proofs[i]!.length > 0, `expected non-empty proof at index ${i} for 3-leaf tree`);
  }

  console.log("leafHashes:", leafHashes);
  console.log("merkleRoot:", evidenceExport.root);
  console.log("proof[0]:", proofs[0]);
  console.log("proof[1]:", proofs[1]);
  console.log("proof[2]:", proofs[2]);

  const json = serializeExport(evidenceExport);
  const parsed = parseExportJson(json);
  assert(parsed.root === evidenceExport.root, "round-trip root mismatch");
  assert(parsed.manifestHash === manifestHash, "round-trip manifestHash mismatch");

  for (let i = 0; i < files.length; i++) {
    const result = verifyExportLeaf({
      evidenceExport: parsed,
      index: i,
      artifact: { bytes: files[i]! },
      binding: {
        chainId: CHAIN_ID,
        escrowContract: ESCROW,
        escrowId: ESCROW_ID,
        deliveryVersion: DELIVERY_VERSION,
      },
    });
    assert(result.ok && result.status === EvidenceStatus.Valid, `verify failed for item ${i}: ${JSON.stringify(result)}`);
  }
  console.log("off-chain verification: all 3 items Valid");

  const individual = toIndividualSubmit(parsed);
  const merkle = toMerkleSubmit(parsed);
  assert(individual.commitments.length === 3, "individual commitments length");
  assert(
    individual.commitments.every((c, i) => c === leafHashes[i]),
    "individual commitments must be index-ordered leaf hashes",
  );
  assert(merkle.root === evidenceExport.root, "merkle payload root");
  assert(merkle.declaredCount === 3, "declaredCount must be 3");
  console.log("toIndividualSubmit:", individual);
  console.log("toMerkleSubmit:", merkle);

  // Tamper one byte of the first file.
  const tampered = new Uint8Array(files[0]!);
  tampered[0] = (tampered[0]! ^ 0xff) & 0xff;
  const tamperResult = verifyExportLeaf({
    evidenceExport: parsed,
    index: 0,
    artifact: { bytes: tampered },
    binding: {
      chainId: CHAIN_ID,
      escrowContract: ESCROW,
      escrowId: ESCROW_ID,
      deliveryVersion: DELIVERY_VERSION,
    },
  });
  assert(!tamperResult.ok, "tampered file must fail verification");
  assert(
    !tamperResult.ok && tamperResult.status === OffchainStatus.ContentHashMismatch,
    `expected ContentHashMismatch, got ${JSON.stringify(tamperResult)}`,
  );
  console.log("tampered file detection: ContentHashMismatch ✓");

  // Wrong binding checks.
  const wrongChain = verifyExportLeaf({
    evidenceExport: parsed,
    index: 0,
    artifact: { bytes: files[0]! },
    binding: {
      chainId: 1,
      escrowContract: ESCROW,
      escrowId: ESCROW_ID,
      deliveryVersion: DELIVERY_VERSION,
    },
  });
  assert(!wrongChain.ok && wrongChain.status === EvidenceStatus.WrongChain, "wrong chain must fail");

  const fixture = {
    schema: "evidencebound.phase2-e2e-vectors.v1",
    chainId: CHAIN_ID,
    escrowContract: ESCROW,
    escrowId: ESCROW_ID,
    deliveryVersion: DELIVERY_VERSION,
    manifestHash,
    root: evidenceExport.root,
    declaredItemCount: 3,
    individualCommitments: individual.commitments,
    leaves: evidenceExport.leaves.map((leaf) => ({
      index: leaf.index,
      leafHash: leaf.leafHash,
      proof: leaf.proof,
      fields: {
        schemaVersion: leaf.fields.schemaVersion,
        chainId: leaf.fields.chainId.toString(10),
        escrowContract: leaf.fields.escrowContract,
        escrowId: leaf.fields.escrowId.toString(10),
        deliveryVersion: leaf.fields.deliveryVersion,
        itemIndex: leaf.fields.itemIndex,
        evidenceType: leaf.fields.evidenceType,
        contentHash: leaf.fields.contentHash,
        salt: leaf.fields.salt,
      },
    })),
  };

  return {
    contentHashes,
    leafHashes,
    root: evidenceExport.root,
    proofs,
    individual,
    merkle,
    fixture,
  };
}

function main(): void {
  console.log("Phase 2 Evidence Library E2E demo");
  runSingleFile();
  const three = runThreeItemScenario();

  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "../../contracts/test/fixtures");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "phase2-e2e-vectors.json");
  writeFileSync(outPath, `${JSON.stringify(three.fixture, null, 2)}\n`);
  console.log("\nWrote Foundry fixture:", outPath);
  console.log("\nE2E demo completed successfully.");
}

main();
