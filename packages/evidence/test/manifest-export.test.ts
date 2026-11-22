import { describe, expect, it } from "vitest";
import { MAX_EVIDENCE_ITEMS } from "@evidencebound/shared";
import { buildExport, parseExport, parseExportJson, serializeExport } from "../src/export.js";
import { buildManifest, hashManifest } from "../src/manifest.js";
import { toIndividualSubmit, toManifestSubmit, toMerkleSubmit } from "../src/submit.js";
import { makeFileDelivery } from "./helpers.js";

describe("manifest", () => {
  it("rejects empty and over-cap bundles", () => {
    expect(() =>
      buildManifest({
        chainId: 1,
        escrowContract: "0x1111111111111111111111111111111111111111",
        escrowId: 1,
        deliveryVersion: 1,
        items: [],
      }),
    ).toThrow(/1\.\.100/);

    const tooMany = Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, (_, index) => ({
      index,
      evidenceType: "evidencebound.file.v1",
      contentHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      salt: ("0x" + "22".repeat(32)) as `0x${string}`,
      byteLength: 1,
      storageKey: `k${index}`,
    }));
    expect(() =>
      buildManifest({
        chainId: 1,
        escrowContract: "0x1111111111111111111111111111111111111111",
        escrowId: 1,
        deliveryVersion: 1,
        items: tooMany,
      }),
    ).toThrow(/1\.\.100/);
  });

  it("stores evidenceType as a string label and integers as decimal strings", () => {
    const { manifest } = makeFileDelivery({ files: [new Uint8Array([1, 2, 3])] });
    expect(manifest.items[0]!.evidenceType).toBe("evidencebound.file.v1");
    expect(manifest.chainId).toBe("31337");
    expect(manifest.items[0]!.index).toBe("0");
    expect(manifest.items[0]!.byteLength).toBe("3");
    expect("root" in manifest).toBe(false);
  });

  it("rejects path-like storage keys and non-contiguous indexes", () => {
    expect(() =>
      buildManifest({
        chainId: 1,
        escrowContract: "0x1111111111111111111111111111111111111111",
        escrowId: 1,
        deliveryVersion: 1,
        items: [
          {
            index: 0,
            evidenceType: "evidencebound.file.v1",
            contentHash: ("0x" + "11".repeat(32)) as `0x${string}`,
            salt: ("0x" + "22".repeat(32)) as `0x${string}`,
            byteLength: 1,
            storageKey: "../secret",
          },
        ],
      }),
    ).toThrow(/storageKey/);
  });
});

describe("export round-trip", () => {
  it("create → serialize → parse → verify integrity", () => {
    const { evidenceExport } = makeFileDelivery({
      files: [new Uint8Array([9, 9, 9]), new Uint8Array([1]), new Uint8Array([2, 3])],
    });

    const json = serializeExport(evidenceExport);
    const parsed = parseExportJson(json);

    expect(parsed.root).toBe(evidenceExport.root);
    expect(parsed.manifestHash).toBe(hashManifest(evidenceExport.manifest));
    expect(parsed.declaredItemCount).toBe(3);
    expect(parsed.leaves).toHaveLength(3);
    expect(toIndividualSubmit(parsed).commitments).toEqual(
      evidenceExport.leaves.map((l) => l.leafHash),
    );
    expect(toMerkleSubmit(parsed)).toEqual({
      root: evidenceExport.root,
      declaredCount: 3,
    });
    expect(toManifestSubmit(parsed)).toEqual({
      manifestHash: hashManifest(evidenceExport.manifest),
      itemCount: 3,
    });
    expect(toManifestSubmit(parsed).manifestHash).not.toBe(evidenceExport.root);
  });

  it("rejects tampered manifestHash and tampered leafHash", () => {
    const { evidenceExport } = makeFileDelivery({ files: [new Uint8Array([1])] });
    const json = JSON.parse(serializeExport(evidenceExport)) as Record<string, unknown>;
    json.manifestHash = "0x" + "00".repeat(32);
    expect(() => parseExport(json)).toThrow(/manifestHash/);

    const json2 = JSON.parse(serializeExport(evidenceExport)) as {
      leaves: Array<{ leafHash: string }>;
    };
    json2.leaves[0]!.leafHash = "0x" + "ff".repeat(32);
    expect(() => parseExport(json2)).toThrow(/leafHash/);
  });
});
