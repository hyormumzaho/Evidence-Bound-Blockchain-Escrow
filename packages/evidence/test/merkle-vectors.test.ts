import { describe, expect, it } from "vitest";
import { hashEvidenceLeaf } from "../src/leaf.js";
import { buildDeliveryTree, verifyLeafProof } from "../src/merkle.js";
import { loadMerkleVectors, vectorToFields } from "./helpers.js";

describe("parity with packages/contracts merkle-vectors.json", () => {
  const vectors = loadMerkleVectors();

  it("matches every leafHash, root, and proof", () => {
    for (const entry of vectors.cases) {
      const fields = entry.leaves.map(vectorToFields);
      for (let i = 0; i < fields.length; i++) {
        expect(hashEvidenceLeaf(fields[i]!)).toBe(entry.leaves[i]!.leafHash);
      }

      const tree = buildDeliveryTree(fields);
      expect(tree.root).toBe(entry.root);

      for (let i = 0; i < fields.length; i++) {
        const proof = tree.getProof(i);
        expect(proof).toEqual(entry.leaves[i]!.proof.map((p) => p.toLowerCase()));
        expect(verifyLeafProof(tree.root, fields[i]!, proof)).toBe(true);
      }
    }
  });

  it("keeps duplicate content hashes distinct when salts differ", () => {
    const dup = vectors.cases.find((c) => c.name === "duplicate-content");
    expect(dup).toBeTruthy();
    expect(dup!.leaves[0]!.contentHash).toBe(dup!.leaves[1]!.contentHash);
    expect(dup!.leaves[0]!.leafHash).not.toBe(dup!.leaves[1]!.leafHash);
  });
});
