import { describe, expect, it } from "vitest";
import { buildDeliveryTree, verifyLeafProof } from "../src/merkle.js";
import { makeFileDelivery } from "./helpers.js";

function files(n: number): Uint8Array[] {
  return Array.from({ length: n }, (_, i) => new Uint8Array([i & 0xff, (i >> 8) & 0xff, 7]));
}

describe("Merkle proofs for 1, 3, 5, and 100 items", () => {
  for (const count of [1, 3, 5, 100] as const) {
    it(`builds a valid tree for ${count} item(s)`, () => {
      const { evidenceExport } = makeFileDelivery({ files: files(count) });
      expect(evidenceExport.declaredItemCount).toBe(count);
      expect(evidenceExport.leaves).toHaveLength(count);

      const tree = buildDeliveryTree(evidenceExport.leaves.map((l) => l.fields));
      expect(tree.root).toBe(evidenceExport.root);

      if (count === 1) {
        expect(evidenceExport.leaves[0]!.proof).toEqual([]);
        expect(evidenceExport.root).toBe(evidenceExport.leaves[0]!.leafHash);
      }

      for (let i = 0; i < count; i++) {
        const leaf = evidenceExport.leaves[i]!;
        expect(verifyLeafProof(evidenceExport.root, leaf.fields, leaf.proof)).toBe(true);
        // Wrong proof / wrong leaf fails.
        if (count > 1) {
          const other = evidenceExport.leaves[(i + 1) % count]!;
          expect(verifyLeafProof(evidenceExport.root, leaf.fields, other.proof)).toBe(false);
        }
      }
    });
  }
});
