import { describe, expect, it } from "vitest";
import { EVIDENCE_TYPE_LABELS, SCHEMAS } from "@evidencebound/shared";
import { buildAgreement, hashAgreement, canonicalizeAgreement } from "../src/agreement.js";
import { hashFileBytes, hashUrlReference } from "../src/content.js";
import { hashEvidenceType } from "../src/evidence-type.js";
import { keccak256Utf8 } from "../src/hash.js";

describe("content and evidence type hashing", () => {
  it("hashes raw file bytes without a prefix", () => {
    const bytes = new TextEncoder().encode("demo-file-bytes");
    expect(hashFileBytes(bytes)).toBe(keccak256Utf8("demo-file-bytes"));
  });

  it("hashes URL references via canonical JSON", () => {
    const hash = hashUrlReference("https://example.test/page");
    const expected = keccak256Utf8(
      '{"schema":"evidencebound.url-reference.v1","url":"https://example.test/page"}',
    );
    expect(hash).toBe(expected);
  });

  it("hashes recommended evidence type labels", () => {
    expect(hashEvidenceType(EVIDENCE_TYPE_LABELS.file)).toBe(
      keccak256Utf8("evidencebound.file.v1"),
    );
  });
});

describe("agreement hashing", () => {
  const base = {
    agreementNonce: "nonce-1",
    amount: 1_000_000_000,
    arbitrator: "0x3333333333333333333333333333333333333333",
    chainId: 31337,
    deliveryDeadline: 1_700_000_000,
    escrowContract: "0x1111111111111111111111111111111111111111",
    payer: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    provider: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    reviewPeriod: 259200,
    revisionDeliveryWindow: 172800,
    templateHash: ("0x" + "11".repeat(32)) as `0x${string}`,
    token: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  };

  it("uses decimal strings and lowercase addresses", () => {
    const doc = buildAgreement(base);
    expect(doc.schema).toBe(SCHEMAS.agreement);
    expect(doc.amount).toBe("1000000000");
    expect(doc.chainId).toBe("31337");
    expect(doc.maxRevisions).toBe("1");
    expect(doc.payer).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(doc.provider).toBe("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("is deterministic and key-order independent at the input layer", () => {
    const a = hashAgreement(buildAgreement(base));
    const b = hashAgreement(buildAgreement(base));
    expect(a).toBe(b);
    expect(a.startsWith("0x")).toBe(true);
    expect(a.length).toBe(66);
  });

  it("changes when a field changes", () => {
    const a = hashAgreement(buildAgreement(base));
    const b = hashAgreement(buildAgreement({ ...base, agreementNonce: "nonce-2" }));
    expect(a).not.toBe(b);
  });

  it("rejects non-distinct participants and wrong maxRevisions", () => {
    expect(() =>
      buildAgreement({
        ...base,
        provider: base.payer,
      }),
    ).toThrow(/distinct/);
    expect(() => buildAgreement({ ...base, maxRevisions: 2 })).toThrow(/maxRevisions/);
  });

  it("canonical JSON contains only the required keys", () => {
    const canonical = canonicalizeAgreement(buildAgreement(base));
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "agreementNonce",
        "amount",
        "arbitrator",
        "chainId",
        "deliveryDeadline",
        "escrowContract",
        "maxRevisions",
        "payer",
        "provider",
        "reviewPeriod",
        "revisionDeliveryWindow",
        "schema",
        "templateHash",
        "token",
      ].sort(),
    );
  });
});
