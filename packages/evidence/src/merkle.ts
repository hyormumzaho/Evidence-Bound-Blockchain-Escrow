import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  LEAF_ENCODING,
  MAX_EVIDENCE_ITEMS,
  type EvidenceLeafFields,
  type Hex,
} from "@evidencebound/shared";
import { normalizeHex } from "./hex.js";
import { hashEvidenceLeaf, leafValues, type LeafValueTuple } from "./leaf.js";

export interface DeliveryTree {
  root: Hex;
  leafHashesInIndexOrder: Hex[];
  fieldsInIndexOrder: EvidenceLeafFields[];
  getProof(index: number): Hex[];
  /** Underlying OZ tree. Prefer getProof / root helpers. */
  tree: StandardMerkleTree<LeafValueTuple>;
}

/**
 * Build an OpenZeppelin standard Merkle tree (sortLeaves: true by default).
 * Leaf order in `fields` is item-index order; the tree may sort leaves internally.
 */
export function buildDeliveryTree(fields: EvidenceLeafFields[]): DeliveryTree {
  if (fields.length === 0 || fields.length > MAX_EVIDENCE_ITEMS) {
    throw new Error(`Evidence item count must be 1..${MAX_EVIDENCE_ITEMS}, got ${fields.length}`);
  }

  for (let i = 0; i < fields.length; i++) {
    const leaf = fields[i]!;
    if (leaf.itemIndex !== i) {
      throw new Error(`Leaf itemIndex must equal array position: expected ${i}, got ${leaf.itemIndex}`);
    }
  }

  const values = fields.map((f) => leafValues(f));
  const tree = StandardMerkleTree.of(values, LEAF_ENCODING as unknown as string[]);
  const leafHashesInIndexOrder = fields.map((f) => hashEvidenceLeaf(f));

  return {
    root: normalizeHex(tree.root),
    leafHashesInIndexOrder,
    fieldsInIndexOrder: fields,
    tree,
    getProof(index: number): Hex[] {
      if (!Number.isInteger(index) || index < 0 || index >= fields.length) {
        throw new Error(`Proof index out of range: ${index}`);
      }
      return tree.getProof(index).map((p) => normalizeHex(p));
    },
  };
}

export function verifyLeafProof(root: Hex, fields: EvidenceLeafFields, proof: Hex[]): boolean {
  return StandardMerkleTree.verify(
    normalizeHex(root),
    LEAF_ENCODING as unknown as string[],
    leafValues(fields),
    proof,
  );
}
