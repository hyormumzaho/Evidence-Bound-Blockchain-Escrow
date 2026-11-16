import { describe, expect, it } from "vitest";
import { assertJsonSerializable, jsonSafe } from "@/lib/json/safe";

describe("jsonSafe bigint serialization (Escrow Room regression)", () => {
  it("converts getEscrow-like bigint fields to decimal strings", () => {
    const raw = {
      payer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      provider: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      arbitrator: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      amount: 10_000_000n,
      agreementHash: "0xada784dcc4f7156914e9479461191f5cfb3aeff497315c1603f0c33dae3b4464",
      templateHash: "0x4a2a3b3b97794b4ef29c2b5ced3789d979f5a5fcb296be492f8f52d3622c0daa",
      deliveryDeadline: 1_795_183_903n,
      currentDeliveryDeadline: 1_795_183_903n,
      reviewPeriod: 3600n,
      revisionDeliveryWindow: 7200n,
      reviewDeadline: 0n,
      deliveryVersion: 0,
      revisionsUsed: 0,
      state: 1,
      providerApproved: false,
    };

    expect(() => assertJsonSerializable(raw)).toThrow(/BigInt/i);

    const safe = jsonSafe(raw);
    expect(safe.amount).toBe("10000000");
    expect(safe.deliveryDeadline).toBe("1795183903");
    expect(safe.reviewPeriod).toBe("3600");
    expect(safe.reviewDeadline).toBe("0");
    expect(safe.state).toBe(1);
    expect(safe.providerApproved).toBe(false);
    expect(typeof safe.amount).toBe("string");
    expect(Number.isSafeInteger(Number(safe.amount))).toBe(true);

    // Large amount: must stay decimal string, not Number
    const huge = jsonSafe({ amount: 2n ** 80n });
    expect(huge.amount).toBe((2n ** 80n).toString(10));
    expect(() => assertJsonSerializable(safe)).not.toThrow();
    expect(() => assertJsonSerializable({ onChain: safe })).not.toThrow();
  });

  it("walks nested arrays/objects without coercing to Number", () => {
    const safe = jsonSafe({
      leaves: [{ amount: 1_000_000_000_000_000_000n }, { amount: 2n }],
    });
    expect(safe.leaves[0].amount).toBe("1000000000000000000");
    expect(safe.leaves[1].amount).toBe("2");
    expect(JSON.parse(assertJsonSerializable(safe)).leaves[0].amount).toBe("1000000000000000000");
  });
});
