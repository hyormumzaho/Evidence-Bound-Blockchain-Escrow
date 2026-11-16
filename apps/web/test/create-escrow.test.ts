import { describe, it, expect, afterEach } from "vitest";
import { createWalletClient, http, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { buildAgreement, hashAgreement } from "@evidencebound/evidence";
import { eq } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANVIL_KEY_0, ANVIL_KEY_1, loginAs, makeTempWorkspace } from "./helpers";
import { parseMockUsdcToBaseUnits, formatMockUsdc } from "@/lib/escrow/amount";
import { buildCreateAgreement } from "@/lib/escrow/agreement";
import { TEMPLATE_HASH } from "@/lib/escrow/template";
import { parseEscrowCreatedFromReceipt } from "@/lib/escrow/events";
import { confirmCreateEscrow } from "@/lib/escrow/persist";
import { createStagingEscrow } from "@/lib/uploads/service";
import { escrows } from "@/lib/db/schema";
import { individualHashEscrowAbi } from "@/lib/chain/abis";
import { resetDbCache } from "@/lib/db/client";

const ANVIL_KEY_2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

function loadDeployment(): {
  mockUSDC: Address;
  individualHashEscrow: Address;
  merkleRootEscrow: Address;
} | null {
  const candidates = [
    join(process.cwd(), "../../packages/contracts/deployments/31337.json"),
    join(process.cwd(), "../contracts/deployments/31337.json"),
    join(process.cwd(), "packages/contracts/deployments/31337.json"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (doc.mockUSDC && doc.individualHashEscrow) {
      return {
        mockUSDC: doc.mockUSDC,
        individualHashEscrow: doc.individualHashEscrow,
        merkleRootEscrow: doc.merkleRootEscrow,
      };
    }
  }
  return null;
}

describe("Stage 3.5 create escrow helpers", () => {
  it("parses MockUSDC 6-decimal amounts", () => {
    expect(parseMockUsdcToBaseUnits("1")).toBe(1_000_000n);
    expect(parseMockUsdcToBaseUnits("12.5")).toBe(12_500_000n);
    expect(parseMockUsdcToBaseUnits("0.000001")).toBe(1n);
    expect(formatMockUsdc(12_500_000n)).toBe("12.5");
    expect(() => parseMockUsdcToBaseUnits("1.1234567")).toThrow(/6 decimal/);
    expect(() => parseMockUsdcToBaseUnits("0")).toThrow(/greater than zero/);
    expect(() => parseMockUsdcToBaseUnits("-1")).toThrow(/Invalid/);
  });

  it("builds a stable agreement hash matching Evidence Library", () => {
    const payer = privateKeyToAccount(ANVIL_KEY_0).address;
    const provider = privateKeyToAccount(ANVIL_KEY_1).address;
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2).address;
    const built = buildCreateAgreement({
      agreementNonce: "n-1",
      amountBaseUnits: 1_000_000n,
      arbitrator,
      chainId: 31337,
      deliveryDeadline: 2_000_000_000,
      escrowContract: "0x1111111111111111111111111111111111111111",
      payer,
      provider,
      reviewPeriod: 3600,
      revisionDeliveryWindow: 7200,
      token: "0x2222222222222222222222222222222222222222",
    });
    const again = hashAgreement(
      buildAgreement({
        agreementNonce: "n-1",
        amount: 1_000_000n,
        arbitrator,
        chainId: 31337,
        deliveryDeadline: 2_000_000_000,
        escrowContract: "0x1111111111111111111111111111111111111111",
        payer,
        provider,
        reviewPeriod: 3600,
        revisionDeliveryWindow: 7200,
        templateHash: TEMPLATE_HASH,
        token: "0x2222222222222222222222222222222222222222",
      }),
    );
    expect(built.agreementHash).toBe(again);
    expect(built.templateHash).toBe(TEMPLATE_HASH);
  });

  it("rejects non-distinct participants", () => {
    const payer = privateKeyToAccount(ANVIL_KEY_0).address;
    expect(() =>
      buildCreateAgreement({
        agreementNonce: "n",
        amountBaseUnits: 1n,
        arbitrator: payer,
        chainId: 31337,
        deliveryDeadline: 2_000_000_000,
        escrowContract: "0x1111111111111111111111111111111111111111",
        payer,
        provider: payer,
        reviewPeriod: 1,
        revisionDeliveryWindow: 1,
        token: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(/distinct/);
  });

  it("requires EscrowCreated event (no nextEscrowId heuristic)", () => {
    expect(() =>
      parseEscrowCreatedFromReceipt(
        {
          logs: [
            {
              address: "0x0000000000000000000000000000000000000001",
              blockHash: ("0x" + "11".repeat(32)) as Hex,
              blockNumber: 1n,
              data: "0x",
              logIndex: 0,
              transactionHash: ("0x" + "22".repeat(32)) as Hex,
              transactionIndex: 0,
              removed: false,
              topics: [],
            },
          ],
        },
        "individual",
      ),
    ).toThrow(/EscrowCreated event not found/);
  });
});

describe("Stage 3.5 Anvil createEscrow e2e (optional)", () => {
  const workspaces: Array<ReturnType<typeof makeTempWorkspace>> = [];

  afterEach(() => {
    while (workspaces.length) workspaces.pop()?.cleanup();
    resetDbCache();
    delete process.env.NEXT_PUBLIC_INDIVIDUAL_ESCROW;
    delete process.env.NEXT_PUBLIC_MERKLE_ESCROW;
    delete process.env.NEXT_PUBLIC_MOCK_USDC;
  });

  it("creates on-chain, persists from event, idempotent, rejects foreign staging", async () => {
    const deployment = loadDeployment();
    if (!deployment) {
      console.warn("skip Anvil e2e: no deployments/31337.json");
      return;
    }

    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const payer = privateKeyToAccount(ANVIL_KEY_0);
    const provider = privateKeyToAccount(ANVIL_KEY_1);
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2);
    const client = createWalletClient({
      account: payer,
      chain: { ...foundry, id: 31337 },
      transport: http(rpc, { timeout: 3_000 }),
    }).extend(publicActions);

    let chainId: number;
    try {
      chainId = await client.getChainId();
    } catch {
      console.warn("skip Anvil e2e: RPC unreachable");
      return;
    }
    expect(chainId).toBe(31337);

    process.env.NEXT_PUBLIC_INDIVIDUAL_ESCROW = deployment.individualHashEscrow;
    process.env.NEXT_PUBLIC_MERKLE_ESCROW = deployment.merkleRootEscrow;
    process.env.NEXT_PUBLIC_MOCK_USDC = deployment.mockUSDC;

    const ws = makeTempWorkspace();
    workspaces.push(ws);
    const { address: session } = await loginAs(ws.db, ANVIL_KEY_0);

    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const built = buildCreateAgreement({
      agreementNonce: `e2e-${Date.now()}`,
      amountBaseUnits: parseMockUsdcToBaseUnits("10"),
      arbitrator: arbitrator.address,
      chainId: 31337,
      deliveryDeadline: deadline,
      escrowContract: deployment.individualHashEscrow,
      payer: payer.address,
      provider: provider.address,
      reviewPeriod: 3600,
      revisionDeliveryWindow: 7200,
      token: deployment.mockUSDC,
    });

    const hash = await client.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "createEscrow",
      args: [
        provider.address,
        arbitrator.address,
        built.document.amount === built.document.amount
          ? BigInt(built.document.amount)
          : 10_000_000n,
        BigInt(deadline),
        3600n,
        7200n,
        built.agreementHash,
        built.templateHash,
      ],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });

    const receipt = await client.waitForTransactionReceipt({ hash });
    const created = parseEscrowCreatedFromReceipt(receipt, "individual");
    expect(created.agreementHash.toLowerCase()).toBe(built.agreementHash.toLowerCase());
    expect(created.payer.toLowerCase()).toBe(payer.address.toLowerCase());

    const first = await confirmCreateEscrow(ws.db, {
      variant: "individual",
      txHash: hash,
      agreement: built.document,
      sessionAddress: session,
    });
    expect(first.duplicated).toBe(false);
    expect(first.escrowId).toBe(Number(created.escrowId));

    const second = await confirmCreateEscrow(ws.db, {
      variant: "individual",
      txHash: hash,
      agreement: built.document,
      sessionAddress: session,
    });
    expect(second.duplicated).toBe(true);
    expect(second.escrowRowId).toBe(first.escrowRowId);

    // Foreign staging: stranger creates staging then tries to link to payer's escrow
    const strangerDb = makeTempWorkspace();
    workspaces.push(strangerDb);
    const stranger = await loginAs(strangerDb.db, ANVIL_KEY_1);
    const staging = createStagingEscrow(strangerDb.db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: deployment.individualHashEscrow,
      payer: stranger.address,
      provider: arbitrator.address,
      arbitrator: payer.address,
      creator: stranger.address,
    });

    // Copy staging into payer db under foreign roles — simulate attach attempt
    const foreignStaging = createStagingEscrow(ws.db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: deployment.individualHashEscrow,
      payer: stranger.address,
      provider: arbitrator.address,
      arbitrator: payer.address,
      creator: session, // session is arbitrator on this staging
    });

    await expect(
      confirmCreateEscrow(ws.db, {
        variant: "individual",
        txHash: hash,
        agreement: built.document,
        sessionAddress: session,
        stagingRowId: foreignStaging.id,
      }),
    ).rejects.toThrow(/staging participants do not match|Forbidden/);

    // Ensure original row still singular for this escrow id
    const rows = ws.db
      .select()
      .from(escrows)
      .where(eq(escrows.escrowId, first.escrowId))
      .all();
    expect(rows.filter((r) => !r.isStaging).length).toBe(1);

    void staging;
  }, 60_000);
});
