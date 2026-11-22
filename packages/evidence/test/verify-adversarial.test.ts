import { describe, expect, it } from "vitest";
import { EvidenceStatus, OffchainStatus } from "@evidencebound/shared";
import { buildLeafFields, hashEvidenceLeaf } from "../src/leaf.js";
import { verifyExportLeaf, verifyLeafMembership, verifyManifestCommitment } from "../src/verify-offchain.js";
import { makeFileDelivery } from "./helpers.js";
import { EVIDENCE_TYPE_LABELS } from "@evidencebound/shared";
import { hashFileBytes } from "../src/content.js";

describe("adversarial off-chain verification", () => {
  const binding = {
    chainId: 31337,
    escrowContract: "0x1111111111111111111111111111111111111111",
    escrowId: 7,
    deliveryVersion: 1,
  };

  it("accepts an unmodified file delivery", () => {
    const file = new TextEncoder().encode("good-bytes");
    const { evidenceExport } = makeFileDelivery({ files: [file] });
    const result = verifyExportLeaf({
      evidenceExport,
      index: 0,
      artifact: { bytes: file },
      binding,
    });
    expect(result).toEqual({ ok: true, status: EvidenceStatus.Valid });
  });

  it("rejects a modified file", () => {
    const file = new TextEncoder().encode("good-bytes");
    const { evidenceExport } = makeFileDelivery({ files: [file] });
    const result = verifyExportLeaf({
      evidenceExport,
      index: 0,
      artifact: { bytes: new TextEncoder().encode("tampered") },
      binding,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(OffchainStatus.ContentHashMismatch);
    }
  });

  it("rejects a wrong salt via membership check", () => {
    const file = new Uint8Array([1, 2, 3]);
    const { evidenceExport } = makeFileDelivery({ files: [file] });
    const fields = {
      ...evidenceExport.leaves[0]!.fields,
      salt: ("0x" + "ab".repeat(32)) as `0x${string}`,
    };
    const result = verifyLeafMembership({
      fields,
      binding,
      storedCommitments: [evidenceExport.leaves[0]!.leafHash],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(EvidenceStatus.NotMember);
    }
  });

  it("rejects wrong escrowId, chainId, deliveryVersion, and contract", () => {
    const file = new Uint8Array([4, 5, 6]);
    const { evidenceExport } = makeFileDelivery({ files: [file] });
    const leaf = evidenceExport.leaves[0]!;

    expect(
      verifyExportLeaf({
        evidenceExport,
        index: 0,
        artifact: { bytes: file },
        binding: { ...binding, escrowId: 99 },
      }).ok,
    ).toBe(false);

    expect(
      verifyExportLeaf({
        evidenceExport,
        index: 0,
        artifact: { bytes: file },
        binding: { ...binding, chainId: 1 },
      }).ok,
    ).toBe(false);

    expect(
      verifyExportLeaf({
        evidenceExport,
        index: 0,
        artifact: { bytes: file },
        binding: { ...binding, deliveryVersion: 2 },
      }).ok,
    ).toBe(false);

    expect(
      verifyExportLeaf({
        evidenceExport,
        index: 0,
        artifact: { bytes: file },
        binding: {
          ...binding,
          escrowContract: "0x2222222222222222222222222222222222222222",
        },
      }).ok,
    ).toBe(false);

    // Status codes mirror on-chain binding checks.
    const wrongEscrow = verifyExportLeaf({
      evidenceExport,
      index: 0,
      binding: { ...binding, escrowId: 8 },
    });
    expect(wrongEscrow.ok).toBe(false);
    if (!wrongEscrow.ok) expect(wrongEscrow.status).toBe(EvidenceStatus.WrongEscrow);

    const wrongChain = verifyLeafMembership({
      fields: leaf.fields,
      binding: { ...binding, chainId: 999 },
      root: evidenceExport.root,
      proof: leaf.proof,
    });
    expect(wrongChain.ok).toBe(false);
    if (!wrongChain.ok) expect(wrongChain.status).toBe(EvidenceStatus.WrongChain);
  });

  it("supports odd counts and duplicate content with distinct salts", () => {
    const same = new TextEncoder().encode("same-bytes");
    const { evidenceExport } = makeFileDelivery({
      files: [same, same, new Uint8Array([9])],
    });
    expect(evidenceExport.leaves[0]!.fields.contentHash).toBe(
      evidenceExport.leaves[1]!.fields.contentHash,
    );
    expect(evidenceExport.leaves[0]!.leafHash).not.toBe(evidenceExport.leaves[1]!.leafHash);

    for (let i = 0; i < 3; i++) {
      const result = verifyExportLeaf({
        evidenceExport,
        index: i,
        artifact: { bytes: i < 2 ? same : new Uint8Array([9]) },
        binding,
      });
      expect(result.ok).toBe(true);
    }
  });

  it("builds leaf fields from string labels", () => {
    const contentHash = hashFileBytes(new Uint8Array([1]));
    const fields = buildLeafFields({
      chainId: 31337,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 7,
      deliveryVersion: 1,
      itemIndex: 0,
      evidenceTypeLabel: EVIDENCE_TYPE_LABELS.file,
      contentHash,
      salt: ("0x" + "33".repeat(32)) as `0x${string}`,
    });
    expect(fields.evidenceType).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashEvidenceLeaf(fields)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("accepts a manifest that matches the stored hash and rejects a different one", () => {
    const { manifest, evidenceExport } = makeFileDelivery({ files: [new Uint8Array([4, 5])] });
    expect(verifyManifestCommitment({ manifest, storedManifestHash: evidenceExport.manifestHash })).toEqual({
      ok: true,
      status: EvidenceStatus.Valid,
    });
    const wrong = verifyManifestCommitment({
      manifest,
      storedManifestHash: evidenceExport.root,
    });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.status).toBe(OffchainStatus.ManifestIntegrityFailed);
  });

  it("reports missing manifest and missing chain hash as unverified", () => {
    const { manifest, evidenceExport } = makeFileDelivery({ files: [new Uint8Array([6])] });
    const missingManifest = verifyManifestCommitment({ storedManifestHash: evidenceExport.manifestHash });
    const missingChain = verifyManifestCommitment({ manifest });
    expect(missingManifest.ok).toBe(false);
    expect(missingChain.ok).toBe(false);
    if (!missingManifest.ok) expect(missingManifest.status).toBe(OffchainStatus.ManifestMissing);
    if (!missingChain.ok) expect(missingChain.status).toBe(OffchainStatus.ChainCommitmentUnavailable);
  });
});
