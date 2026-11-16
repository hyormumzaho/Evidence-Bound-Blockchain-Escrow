import { describe, it, expect } from "vitest";
import { createWalletClient, http, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANVIL_KEY_0, ANVIL_KEY_1 } from "./helpers";
import { availableEscrowActions, ESCROW_STATE } from "@/lib/escrow/states";
import { buildCreateAgreement } from "@/lib/escrow/agreement";
import { parseMockUsdcToBaseUnits } from "@/lib/escrow/amount";
import { parseEscrowCreatedFromReceipt } from "@/lib/escrow/events";
import { individualHashEscrowAbi, mockUsdcAbi } from "@/lib/chain/abis";
import { formatWalletError } from "@/lib/wagmi/errors";

const ANVIL_KEY_2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

function loadDeployment(): {
  mockUSDC: Address;
  individualHashEscrow: Address;
  merkleRootEscrow: Address;
} | null {
  const candidates = [
    join(process.cwd(), "../../packages/contracts/deployments/31337.json"),
    join(process.cwd(), "../contracts/deployments/31337.json"),
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

describe("Stage 3.6 action availability", () => {
  const payer = privateKeyToAccount(ANVIL_KEY_0).address;
  const provider = privateKeyToAccount(ANVIL_KEY_1).address;
  const arbitrator = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const extras = {
    arbitrator,
    currentDeliveryDeadline: deadline,
    reviewDeadline: deadline,
    revisionsUsed: 0,
    claimable: 0n,
  };

  it("only provider can approveAgreement in Created", () => {
    const base = {
      chainOk: true as const,
      payer,
      provider,
      state: ESCROW_STATE.Created,
      providerApproved: false,
      amount: 1_000_000n,
      balance: 1_000_000n,
      allowance: 0n,
      deliveryDeadline: deadline,
      ...extras,
    };
    expect(availableEscrowActions({ ...base, connected: provider }).canApproveAgreement).toBe(true);
    expect(availableEscrowActions({ ...base, connected: payer }).canApproveAgreement).toBe(false);
  });

  it("funding requires approval + allowance + balance", () => {
    const lowAllow = availableEscrowActions({
      connected: payer,
      chainOk: true,
      payer,
      provider,
      state: ESCROW_STATE.Created,
      providerApproved: true,
      amount: 10n,
      balance: 100n,
      allowance: 5n,
      deliveryDeadline: deadline,
      ...extras,
    });
    expect(lowAllow.canApproveToken).toBe(true);
    expect(lowAllow.canFund).toBe(false);

    const ready = availableEscrowActions({
      connected: payer,
      chainOk: true,
      payer,
      provider,
      state: ESCROW_STATE.Created,
      providerApproved: true,
      amount: 10n,
      balance: 100n,
      allowance: 10n,
      deliveryDeadline: deadline,
      ...extras,
    });
    expect(ready.canFund).toBe(true);
    expect(ready.canApproveToken).toBe(false);

    const lowBal = availableEscrowActions({
      connected: payer,
      chainOk: true,
      payer,
      provider,
      state: ESCROW_STATE.Created,
      providerApproved: true,
      amount: 10n,
      balance: 5n,
      allowance: 10n,
      deliveryDeadline: deadline,
      ...extras,
    });
    expect(lowBal.canFund).toBe(false);
  });

  it("cancel only for payer in Created; fund blocked when already Funded", () => {
    expect(
      availableEscrowActions({
        connected: payer,
        chainOk: true,
        payer,
        provider,
        state: ESCROW_STATE.Created,
        providerApproved: false,
        amount: 1n,
        balance: 1n,
        allowance: 0n,
        deliveryDeadline: deadline,
        ...extras,
      }).canCancelUnfunded,
    ).toBe(true);

    const funded = availableEscrowActions({
      connected: payer,
      chainOk: true,
      payer,
      provider,
      state: ESCROW_STATE.Funded,
      providerApproved: true,
      amount: 1n,
      balance: 1n,
      allowance: 1n,
      deliveryDeadline: deadline,
      ...extras,
    });
    expect(funded.canFund).toBe(false);
    expect(funded.canCancelUnfunded).toBe(false);
  });

  it("wrong network disables actions; rejected tx error is mapped", () => {
    const wrong = availableEscrowActions({
      connected: provider,
      chainOk: false,
      payer,
      provider,
      state: ESCROW_STATE.Created,
      providerApproved: false,
      amount: 1n,
      balance: 1n,
      allowance: 0n,
      deliveryDeadline: deadline,
      ...extras,
    });
    expect(wrong.canApproveAgreement).toBe(false);
    expect(wrong.reasons.some((r) => /Anvil/i.test(r))).toBe(true);
    expect(formatWalletError({ code: 4001, message: "User rejected the request" })).toMatch(/rejected/i);
  });
});

describe("Stage 3.6 Anvil approve + fund + cancel e2e (optional)", () => {
  it("provider approveAgreement → ERC-20 approve → fund; wrong hash / double fund / cancel", async () => {
    const deployment = loadDeployment();
    if (!deployment) {
      console.warn("skip Anvil e2e: no deployment");
      return;
    }
    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const payer = privateKeyToAccount(ANVIL_KEY_0);
    const provider = privateKeyToAccount(ANVIL_KEY_1);
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2);

    const payerClient = createWalletClient({
      account: payer,
      chain: { ...foundry, id: 31337 },
      transport: http(rpc, { timeout: 3_000 }),
    }).extend(publicActions);

    let chainId: number;
    try {
      chainId = await payerClient.getChainId();
    } catch {
      console.warn("skip Anvil e2e: RPC unreachable");
      return;
    }
    expect(chainId).toBe(31337);

    const providerClient = createWalletClient({
      account: provider,
      chain: { ...foundry, id: 31337 },
      transport: http(rpc),
    }).extend(publicActions);

    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const amount = parseMockUsdcToBaseUnits("5");
    const built = buildCreateAgreement({
      agreementNonce: `fund-${Date.now()}`,
      amountBaseUnits: amount,
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

    const createHash = await payerClient.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "createEscrow",
      args: [
        provider.address,
        arbitrator.address,
        amount,
        BigInt(deadline),
        3600n,
        7200n,
        built.agreementHash,
        built.templateHash,
      ],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    const createReceipt = await payerClient.waitForTransactionReceipt({ hash: createHash });
    const created = parseEscrowCreatedFromReceipt(createReceipt, "individual");
    const escrowId = created.escrowId;

    // Wrong agreement hash rejected
    await expect(
      providerClient.writeContract({
        address: deployment.individualHashEscrow,
        abi: individualHashEscrowAbi,
        functionName: "approveAgreement",
        args: [escrowId, ("0x" + "ab".repeat(32)) as Hex],
        chain: { ...foundry, id: 31337 },
        account: provider,
      }),
    ).rejects.toThrow();

    // Only provider — payer cannot approveAgreement
    await expect(
      payerClient.writeContract({
        address: deployment.individualHashEscrow,
        abi: individualHashEscrowAbi,
        functionName: "approveAgreement",
        args: [escrowId, built.agreementHash],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    ).rejects.toThrow();

    const approveHash = await providerClient.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "approveAgreement",
      args: [escrowId, built.agreementHash],
      chain: { ...foundry, id: 31337 },
      account: provider,
    });
    await providerClient.waitForTransactionReceipt({ hash: approveHash });

    // Ensure payer has MockUSDC (deploy mints to PAYER_PRIVATE_KEY account; mint here as token owner).
    const mintHash = await payerClient.writeContract({
      address: deployment.mockUSDC,
      abi: mockUsdcAbi,
      functionName: "mint",
      args: [payer.address, amount * 2n],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    await payerClient.waitForTransactionReceipt({ hash: mintHash });

    // Fund without ERC-20 allowance should fail
    await expect(
      payerClient.writeContract({
        address: deployment.individualHashEscrow,
        abi: individualHashEscrowAbi,
        functionName: "fund",
        args: [escrowId],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    ).rejects.toThrow();

    const erc20Approve = await payerClient.writeContract({
      address: deployment.mockUSDC,
      abi: mockUsdcAbi,
      functionName: "approve",
      args: [deployment.individualHashEscrow, amount],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    await payerClient.waitForTransactionReceipt({ hash: erc20Approve });

    const fundHash = await payerClient.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "fund",
      args: [escrowId],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    await payerClient.waitForTransactionReceipt({ hash: fundHash });

    const view = (await payerClient.readContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "getEscrow",
      args: [escrowId],
    })) as { state: number; providerApproved: boolean };
    expect(view.state).toBe(ESCROW_STATE.Funded);
    expect(view.providerApproved).toBe(true);

    // Double fund impossible
    await expect(
      payerClient.writeContract({
        address: deployment.individualHashEscrow,
        abi: individualHashEscrowAbi,
        functionName: "fund",
        args: [escrowId],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    ).rejects.toThrow();

    // Separate escrow for cancelUnfunded
    const built2 = buildCreateAgreement({
      agreementNonce: `cancel-${Date.now()}`,
      amountBaseUnits: amount,
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
    const create2 = await payerClient.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "createEscrow",
      args: [
        provider.address,
        arbitrator.address,
        amount,
        BigInt(deadline),
        3600n,
        7200n,
        built2.agreementHash,
        built2.templateHash,
      ],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    const receipt2 = await payerClient.waitForTransactionReceipt({ hash: create2 });
    const created2 = parseEscrowCreatedFromReceipt(receipt2, "individual");

    const cancelHash = await payerClient.writeContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "cancelUnfunded",
      args: [created2.escrowId],
      chain: { ...foundry, id: 31337 },
      account: payer,
    });
    await payerClient.waitForTransactionReceipt({ hash: cancelHash });
    const cancelled = (await payerClient.readContract({
      address: deployment.individualHashEscrow,
      abi: individualHashEscrowAbi,
      functionName: "getEscrow",
      args: [created2.escrowId],
    })) as { state: number };
    expect(cancelled.state).toBe(ESCROW_STATE.Cancelled);
  }, 90_000);
});
