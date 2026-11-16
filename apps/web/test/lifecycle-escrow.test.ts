import { describe, expect, it } from "vitest";
import {
  createWalletClient,
  http,
  publicActions,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256Utf8 } from "@evidencebound/evidence";
import { ANVIL_KEY_0, ANVIL_KEY_1 } from "./helpers";
import { actionBase } from "./lifecycle-actions";
import { availableEscrowActions, ESCROW_STATE } from "@/lib/escrow/states";
import { BPS_DENOMINATOR, hashReasonText, MAX_REVISIONS } from "@/lib/escrow/reason";
import { buildCreateAgreement } from "@/lib/escrow/agreement";
import { parseMockUsdcToBaseUnits } from "@/lib/escrow/amount";
import { parseEscrowCreatedFromReceipt } from "@/lib/escrow/events";
import {
  buildDeliveryExport,
  draftFromUploadedFile,
  submitPayloadForVariant,
} from "@/lib/evidence/build";
import { hashFileBytes, randomSalt } from "@evidencebound/evidence";
import {
  individualHashEscrowAbi,
  merkleRootEscrowAbi,
  mockUsdcAbi,
  type EscrowVariant,
} from "@/lib/chain/abis";

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
    if (doc.mockUSDC && doc.individualHashEscrow && doc.merkleRootEscrow) {
      return {
        mockUSDC: doc.mockUSDC,
        individualHashEscrow: doc.individualHashEscrow,
        merkleRootEscrow: doc.merkleRootEscrow,
      };
    }
  }
  return null;
}

type Client = WalletClient & PublicClient;

function wallet(key: `0x${string}`, rpc: string): Client {
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: { ...foundry, id: 31337 },
    transport: http(rpc, { timeout: 5_000 }),
  }).extend(publicActions) as Client;
}

async function increaseTime(client: Client, seconds: number) {
  const req = client.request.bind(client) as (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  await req({ method: "evm_increaseTime", params: [seconds] });
  await req({ method: "evm_mine", params: [] });
}

describe("Stage 3.8 lifecycle gating + reasonHash", () => {
  const payer = privateKeyToAccount(ANVIL_KEY_0).address;
  const provider = privateKeyToAccount(ANVIL_KEY_1).address;
  const arbitrator = privateKeyToAccount(ANVIL_KEY_2).address;
  const now = Math.floor(Date.now() / 1000);

  it("hashes revision/dispute reason via keccak256 utf8", () => {
    expect(hashReasonText("needs polish")).toBe(keccak256Utf8("needs polish"));
    expect(() => hashReasonText("   ")).toThrow(/required/i);
  });

  it("accept / revision / dispute / timeouts / withdraw role gates", () => {
    const reviewOpen = actionBase({
      payer,
      provider,
      arbitrator,
      state: ESCROW_STATE.Delivered,
      nowSec: now,
      reviewDeadline: BigInt(now + 100),
      currentDeliveryDeadline: BigInt(now - 10),
    });

    expect(availableEscrowActions({ ...reviewOpen, connected: payer }).canAcceptDelivery).toBe(true);
    expect(availableEscrowActions({ ...reviewOpen, connected: provider }).canAcceptDelivery).toBe(false);
    expect(availableEscrowActions({ ...reviewOpen, connected: payer }).canRequestRevision).toBe(true);
    expect(
      availableEscrowActions({ ...reviewOpen, connected: payer, revisionsUsed: MAX_REVISIONS })
        .canRequestRevision,
    ).toBe(false);

    expect(availableEscrowActions({ ...reviewOpen, connected: payer }).canOpenDispute).toBe(true);
    expect(availableEscrowActions({ ...reviewOpen, connected: provider }).canOpenDispute).toBe(true);
    expect(availableEscrowActions({ ...reviewOpen, connected: arbitrator }).canOpenDispute).toBe(false);

    const disputed = actionBase({
      payer,
      provider,
      arbitrator,
      state: ESCROW_STATE.Disputed,
      nowSec: now,
    });
    expect(availableEscrowActions({ ...disputed, connected: arbitrator }).canResolveDispute).toBe(true);
    expect(availableEscrowActions({ ...disputed, connected: payer }).canResolveDispute).toBe(false);

    const missed = actionBase({
      payer,
      provider,
      arbitrator,
      state: ESCROW_STATE.Funded,
      nowSec: now,
      currentDeliveryDeadline: BigInt(now - 1),
    });
    expect(availableEscrowActions({ ...missed, connected: payer }).canClaimMissedDelivery).toBe(true);
    expect(availableEscrowActions({ ...missed, connected: provider }).canClaimMissedDelivery).toBe(false);
    expect(
      availableEscrowActions({
        ...missed,
        connected: payer,
        currentDeliveryDeadline: BigInt(now + 10),
      }).canClaimMissedDelivery,
    ).toBe(false);

    const reviewClosed = actionBase({
      payer,
      provider,
      arbitrator,
      state: ESCROW_STATE.Delivered,
      nowSec: now,
      reviewDeadline: BigInt(now - 1),
    });
    expect(availableEscrowActions({ ...reviewClosed, connected: provider }).canClaimReviewTimeout).toBe(
      true,
    );
    expect(availableEscrowActions({ ...reviewClosed, connected: payer }).canClaimReviewTimeout).toBe(
      false,
    );
    expect(availableEscrowActions({ ...reviewClosed, connected: payer }).canAcceptDelivery).toBe(false);

    expect(
      availableEscrowActions({
        ...actionBase({
          payer,
          provider,
          arbitrator,
          state: ESCROW_STATE.Settled,
          claimable: 42n,
        }),
        connected: payer,
      }).canWithdraw,
    ).toBe(true);
    expect(
      availableEscrowActions({
        ...actionBase({
          payer,
          provider,
          arbitrator,
          state: ESCROW_STATE.Settled,
          claimable: 0n,
        }),
        connected: payer,
      }).canWithdraw,
    ).toBe(false);
  });

  it("providerBps bounds match contract (0..10000)", () => {
    expect(BPS_DENOMINATOR).toBe(10_000);
    expect(MAX_REVISIONS).toBe(1);
  });
});

describe("Stage 3.8 Anvil full lifecycle e2e (optional, sequential)", () => {
  it("both variants: accept/withdraw, revision, dispute, timeouts, role/state guards", async () => {
    const deployment = loadDeployment();
    if (!deployment) {
      console.warn("skip Anvil e2e: no deployment");
      return;
    }
    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const payerClient = wallet(ANVIL_KEY_0, rpc);
    try {
      expect(await payerClient.getChainId()).toBe(31337);
    } catch {
      console.warn("skip Anvil e2e: RPC unreachable");
      return;
    }

    const providerClient = wallet(ANVIL_KEY_1, rpc);
    const arbitratorClient = wallet(ANVIL_KEY_2, rpc);
    const payer = privateKeyToAccount(ANVIL_KEY_0);
    const provider = privateKeyToAccount(ANVIL_KEY_1);
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2);

    async function createFunded(variant: EscrowVariant, deliveryWindowSec = 7 * 24 * 3600) {
      const escrowAddress =
        variant === "individual" ? deployment!.individualHashEscrow : deployment!.merkleRootEscrow;
      const abi = variant === "individual" ? individualHashEscrowAbi : merkleRootEscrowAbi;
      const amount = parseMockUsdcToBaseUnits("2");
      const now = Number((await payerClient.getBlock()).timestamp);
      const deadline = now + deliveryWindowSec;
      const built = buildCreateAgreement({
        agreementNonce: `lc-${variant}-${Date.now()}-${Math.random()}`,
        amountBaseUnits: amount,
        arbitrator: arbitrator.address,
        chainId: 31337,
        deliveryDeadline: deadline,
        escrowContract: escrowAddress,
        payer: payer.address,
        provider: provider.address,
        reviewPeriod: 3600,
        revisionDeliveryWindow: 7200,
        token: deployment!.mockUSDC,
      });

      const createHash = await payerClient.writeContract({
        address: escrowAddress,
        abi,
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
      const created = parseEscrowCreatedFromReceipt(
        await payerClient.waitForTransactionReceipt({ hash: createHash }),
        variant,
      );

      await providerClient.waitForTransactionReceipt({
        hash: await providerClient.writeContract({
          address: escrowAddress,
          abi,
          functionName: "approveAgreement",
          args: [created.escrowId, built.agreementHash],
          chain: { ...foundry, id: 31337 },
          account: provider,
        }),
      });
      await payerClient.waitForTransactionReceipt({
        hash: await payerClient.writeContract({
          address: deployment!.mockUSDC,
          abi: mockUsdcAbi,
          functionName: "mint",
          args: [payer.address, amount],
          chain: { ...foundry, id: 31337 },
          account: payer,
        }),
      });
      await payerClient.waitForTransactionReceipt({
        hash: await payerClient.writeContract({
          address: deployment!.mockUSDC,
          abi: mockUsdcAbi,
          functionName: "approve",
          args: [escrowAddress, amount],
          chain: { ...foundry, id: 31337 },
          account: payer,
        }),
      });
      await payerClient.waitForTransactionReceipt({
        hash: await payerClient.writeContract({
          address: escrowAddress,
          abi,
          functionName: "fund",
          args: [created.escrowId],
          chain: { ...foundry, id: 31337 },
          account: payer,
        }),
      });

      return { escrowAddress, abi, escrowId: created.escrowId, amount };
    }

    async function submitEvidence(
      variant: EscrowVariant,
      escrowAddress: Address,
      abi: typeof individualHashEscrowAbi,
      escrowId: bigint,
      label: string,
    ) {
      const bytes = new TextEncoder().encode(label);
      const draft = draftFromUploadedFile({
        storageKey: "b".repeat(32),
        contentHash: hashFileBytes(bytes) as Hex,
        byteLength: bytes.byteLength,
        originalFilename: label,
      });
      draft.salt = randomSalt();
      const evidenceExport = buildDeliveryExport({
        chainId: 31337,
        escrowContract: escrowAddress,
        escrowId: Number(escrowId),
        deliveryVersion: Number(
          (
            (await payerClient.readContract({
              address: escrowAddress,
              abi,
              functionName: "getEscrow",
              args: [escrowId],
            })) as { deliveryVersion: number }
          ).deliveryVersion,
        ) + 1,
        items: [draft],
      });
      const payload = submitPayloadForVariant(evidenceExport, variant);
      const hash = await providerClient.writeContract({
        address: escrowAddress,
        abi,
        functionName: "submitDelivery",
        args:
          payload.kind === "individual"
            ? [escrowId, payload.commitments]
            : [escrowId, payload.root, payload.declaredCount],
        chain: { ...foundry, id: 31337 },
        account: provider,
      });
      await providerClient.waitForTransactionReceipt({ hash });
      return evidenceExport;
    }

    for (const variant of ["individual", "merkle"] as const) {
      // --- Accept → Withdraw ---
      {
        const funded = await createFunded(variant);
        await submitEvidence(variant, funded.escrowAddress, funded.abi, funded.escrowId, `accept-${variant}`);

        await expect(
          providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "acceptDelivery",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        ).rejects.toThrow();

        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "acceptDelivery",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });

        const view = (await payerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "getEscrow",
          args: [funded.escrowId],
        })) as { state: number };
        expect(view.state).toBe(ESCROW_STATE.Settled);

        const claimable = (await providerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, provider.address],
        })) as bigint;
        expect(claimable).toBe(funded.amount);

        await providerClient.waitForTransactionReceipt({
          hash: await providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        });
        const after = (await providerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, provider.address],
        })) as bigint;
        expect(after).toBe(0n);

        await expect(
          providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        ).rejects.toThrow();
      }

      // --- Revision → Resubmit → Accept ---
      {
        const funded = await createFunded(variant);
        await submitEvidence(variant, funded.escrowAddress, funded.abi, funded.escrowId, `rev1-${variant}`);

        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "requestRevision",
            args: [funded.escrowId, hashReasonText("please revise")],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });
        let view = (await payerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "getEscrow",
          args: [funded.escrowId],
        })) as { state: number; revisionsUsed: number };
        expect(view.state).toBe(ESCROW_STATE.RevisionRequested);
        expect(Number(view.revisionsUsed)).toBe(1);

        await submitEvidence(variant, funded.escrowAddress, funded.abi, funded.escrowId, `rev2-${variant}`);

        // Second revision blocked
        await expect(
          payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "requestRevision",
            args: [funded.escrowId, hashReasonText("again")],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        ).rejects.toThrow();

        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "acceptDelivery",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });
        view = (await payerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "getEscrow",
          args: [funded.escrowId],
        })) as { state: number; revisionsUsed: number };
        expect(view.state).toBe(ESCROW_STATE.Settled);
      }

      // --- Dispute → Resolve → Withdraw (split) ---
      {
        const funded = await createFunded(variant);
        await submitEvidence(variant, funded.escrowAddress, funded.abi, funded.escrowId, `disp-${variant}`);

        await expect(
          arbitratorClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "openDispute",
            args: [funded.escrowId, hashReasonText("arb cannot open")],
            chain: { ...foundry, id: 31337 },
            account: arbitrator,
          }),
        ).rejects.toThrow();

        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "openDispute",
            args: [funded.escrowId, hashReasonText("quality dispute")],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });

        // Timeouts frozen while disputed
        await increaseTime(payerClient, 4000);
        await expect(
          providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "claimReviewTimeout",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        ).rejects.toThrow();

        await expect(
          payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "resolveDispute",
            args: [funded.escrowId, 5000n],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        ).rejects.toThrow();

        await expect(
          arbitratorClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "resolveDispute",
            args: [funded.escrowId, BigInt(BPS_DENOMINATOR + 1)],
            chain: { ...foundry, id: 31337 },
            account: arbitrator,
          }),
        ).rejects.toThrow();

        await arbitratorClient.waitForTransactionReceipt({
          hash: await arbitratorClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "resolveDispute",
            args: [funded.escrowId, 2500n],
            chain: { ...foundry, id: 31337 },
            account: arbitrator,
          }),
        });

        const providerShare = (await providerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, provider.address],
        })) as bigint;
        const payerShare = (await payerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, payer.address],
        })) as bigint;
        expect(providerShare + payerShare).toBe(funded.amount);
        expect(providerShare).toBe((funded.amount * 2500n) / 10000n);

        await providerClient.waitForTransactionReceipt({
          hash: await providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        });
        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });
      }

      // --- Missed delivery timeout → refund ---
      {
        const funded = await createFunded(variant, 30);
        await expect(
          payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "claimMissedDeliveryRefund",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        ).rejects.toThrow();

        await increaseTime(payerClient, 40);
        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "claimMissedDeliveryRefund",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });
        const refund = (await payerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, payer.address],
        })) as bigint;
        expect(refund).toBe(funded.amount);
        await payerClient.waitForTransactionReceipt({
          hash: await payerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: payer,
          }),
        });
      }

      // --- Review timeout → provider settlement ---
      {
        const funded = await createFunded(variant);
        await submitEvidence(variant, funded.escrowAddress, funded.abi, funded.escrowId, `to-${variant}`);
        await expect(
          providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "claimReviewTimeout",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        ).rejects.toThrow();

        await increaseTime(payerClient, 3601);
        await providerClient.waitForTransactionReceipt({
          hash: await providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "claimReviewTimeout",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        });
        const claimable = (await providerClient.readContract({
          address: funded.escrowAddress,
          abi: funded.abi,
          functionName: "claimable",
          args: [funded.escrowId, provider.address],
        })) as bigint;
        expect(claimable).toBe(funded.amount);
        await providerClient.waitForTransactionReceipt({
          hash: await providerClient.writeContract({
            address: funded.escrowAddress,
            abi: funded.abi,
            functionName: "withdraw",
            args: [funded.escrowId],
            chain: { ...foundry, id: 31337 },
            account: provider,
          }),
        });
      }
    }
  }, 300_000);
});
