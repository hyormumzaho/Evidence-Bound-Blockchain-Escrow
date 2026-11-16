import { afterEach, describe, expect, it } from "vitest";
import { createWalletClient, http, publicActions, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  hashFileBytes,
  hashUrlReference,
  parseExportJson,
  toIndividualSubmit,
  toMerkleSubmit,
} from "@evidencebound/evidence";
import { EvidenceStatus } from "@evidencebound/shared";
import { ANVIL_KEY_0, ANVIL_KEY_1, makeTempWorkspace } from "./helpers";
import { availableEscrowActions, ESCROW_STATE } from "@/lib/escrow/states";
import { buildCreateAgreement } from "@/lib/escrow/agreement";
import { parseMockUsdcToBaseUnits } from "@/lib/escrow/amount";
import { parseEscrowCreatedFromReceipt } from "@/lib/escrow/events";
import { confirmCreateEscrow } from "@/lib/escrow/persist";
import { storeUpload } from "@/lib/uploads/service";
import {
  buildDeliveryExport,
  draftFromUploadedFile,
  individualBundleCommitment,
  newUrlDraft,
  submitPayloadForVariant,
} from "@/lib/evidence/build";
import { confirmDeliverySubmission, getDeliveryForExport } from "@/lib/evidence/persist";
import { parseDeliverySubmittedFromReceipt } from "@/lib/evidence/events";
import {
  individualHashEscrowAbi,
  merkleRootEscrowAbi,
  mockUsdcAbi,
  type EscrowVariant,
} from "@/lib/chain/abis";
import { resetDbCache } from "@/lib/db/client";
import type { AgreementDocument } from "@evidencebound/shared";

const ANVIL_KEY_2 = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;
const ANVIL_KEY_3 = "0x7c852118294e51e653532a3df304b3bb701d756f5c32ce7c4e2bd4b970e2f7c3" as const;

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

describe("Stage 3.7 evidence hashing + gating", () => {
  const payer = privateKeyToAccount(ANVIL_KEY_0).address;
  const provider = privateKeyToAccount(ANVIL_KEY_1).address;

  it("hashes file bytes and URL references via Evidence Library", () => {
    const bytes = new TextEncoder().encode("Hello EvidenceBound Escrow");
    const fileHash = hashFileBytes(bytes);
    expect(fileHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashFileBytes(bytes)).toBe(fileHash);

    const urlHash = hashUrlReference("https://example.com/report.pdf");
    expect(urlHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashUrlReference("https://example.com/report.pdf")).toBe(urlHash);
    expect(urlHash).not.toBe(fileHash);
  });

  it("builds individual commitments and merkle root from library submit helpers", () => {
    const file = draftFromUploadedFile({
      storageKey: "a".repeat(32),
      contentHash: hashFileBytes(new TextEncoder().encode("a")) as Hex,
      byteLength: 1,
      originalFilename: "a.txt",
    });
    const url = newUrlDraft("https://example.com/x");
    // Fix salts for determinism in this unit test by rebuilding with fixed salts via export path
    file.salt = ("0x" + "11".repeat(32)) as Hex;
    url.salt = ("0x" + "22".repeat(32)) as Hex;

    const evidenceExport = buildDeliveryExport({
      chainId: 31337,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 7,
      deliveryVersion: 1,
      items: [file, url],
    });

    const individual = toIndividualSubmit(evidenceExport);
    const merkle = toMerkleSubmit(evidenceExport);
    expect(individual.commitments).toEqual(evidenceExport.leaves.map((l) => l.leafHash));
    expect(merkle.root).toBe(evidenceExport.root);
    expect(merkle.declaredCount).toBe(2);
    expect(individualBundleCommitment(individual.commitments)).toMatch(/^0x[0-9a-f]{64}$/);

    // Wrong escrowId changes commitments (no reuse across deals)
    const other = buildDeliveryExport({
      chainId: 31337,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 8,
      deliveryVersion: 1,
      items: [file, url],
    });
    expect(other.leaves[0].leafHash).not.toBe(evidenceExport.leaves[0].leafHash);

    // Wrong deliveryVersion / salt changes commitments
    const wrongVersion = buildDeliveryExport({
      chainId: 31337,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 7,
      deliveryVersion: 2,
      items: [file, url],
    });
    expect(wrongVersion.leaves[0].leafHash).not.toBe(evidenceExport.leaves[0].leafHash);

    const wrongSalt = { ...file, salt: ("0x" + "33".repeat(32)) as Hex };
    const wrongSaltExport = buildDeliveryExport({
      chainId: 31337,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 7,
      deliveryVersion: 1,
      items: [wrongSalt, url],
    });
    expect(wrongSaltExport.leaves[0].leafHash).not.toBe(evidenceExport.leaves[0].leafHash);
  });

  it("only provider can submit evidence in Funded / RevisionRequested", () => {
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2).address;
    const extras = {
      arbitrator,
      currentDeliveryDeadline: deadline,
      reviewDeadline: deadline,
      revisionsUsed: 0,
      claimable: 0n,
    };
    const fundedProvider = availableEscrowActions({
      connected: provider,
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
    expect(fundedProvider.canSubmitEvidence).toBe(true);

    expect(
      availableEscrowActions({
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
      }).canSubmitEvidence,
    ).toBe(false);

    expect(
      availableEscrowActions({
        connected: provider,
        chainOk: true,
        payer,
        provider,
        state: ESCROW_STATE.Created,
        providerApproved: true,
        amount: 1n,
        balance: 1n,
        allowance: 1n,
        deliveryDeadline: deadline,
        ...extras,
      }).canSubmitEvidence,
    ).toBe(false);

    expect(
      availableEscrowActions({
        connected: provider,
        chainOk: true,
        payer,
        provider,
        state: ESCROW_STATE.Delivered,
        providerApproved: true,
        amount: 1n,
        balance: 1n,
        allowance: 1n,
        deliveryDeadline: deadline,
        ...extras,
      }).canSubmitEvidence,
    ).toBe(false);

    expect(
      availableEscrowActions({
        connected: provider,
        chainOk: true,
        payer,
        provider,
        state: ESCROW_STATE.RevisionRequested,
        providerApproved: true,
        amount: 1n,
        balance: 1n,
        allowance: 1n,
        deliveryDeadline: deadline,
        ...extras,
      }).canSubmitEvidence,
    ).toBe(true);
  });
});

describe("Stage 3.7 Anvil evidence submit + verify e2e (optional)", () => {
  const workspaces: Array<ReturnType<typeof makeTempWorkspace>> = [];
  afterEach(() => {
    for (const ws of workspaces.splice(0)) ws.cleanup();
    resetDbCache();
  });

  async function fundEscrow(opts: {
    variant: EscrowVariant;
    escrowAddress: Address;
    mockUSDC: Address;
    rpc: string;
  }) {
    const payer = privateKeyToAccount(ANVIL_KEY_0);
    const provider = privateKeyToAccount(ANVIL_KEY_1);
    const arbitrator = privateKeyToAccount(ANVIL_KEY_2);
    const abi = opts.variant === "individual" ? individualHashEscrowAbi : merkleRootEscrowAbi;

    const payerClient = createWalletClient({
      account: payer,
      chain: { ...foundry, id: 31337 },
      transport: http(opts.rpc, { timeout: 3_000 }),
    }).extend(publicActions);
    const providerClient = createWalletClient({
      account: provider,
      chain: { ...foundry, id: 31337 },
      transport: http(opts.rpc),
    }).extend(publicActions);

    const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;
    const amount = parseMockUsdcToBaseUnits("3");
    const built = buildCreateAgreement({
      agreementNonce: `ev-${opts.variant}-${Date.now()}-${Math.random()}`,
      amountBaseUnits: amount,
      arbitrator: arbitrator.address,
      chainId: 31337,
      deliveryDeadline: deadline,
      escrowContract: opts.escrowAddress,
      payer: payer.address,
      provider: provider.address,
      reviewPeriod: 3600,
      revisionDeliveryWindow: 7200,
      token: opts.mockUSDC,
    });

    const createHash = await payerClient.writeContract({
      address: opts.escrowAddress,
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
    const createReceipt = await payerClient.waitForTransactionReceipt({ hash: createHash });
    const created = parseEscrowCreatedFromReceipt(createReceipt, opts.variant);

    await providerClient.waitForTransactionReceipt({
      hash: await providerClient.writeContract({
        address: opts.escrowAddress,
        abi,
        functionName: "approveAgreement",
        args: [created.escrowId, built.agreementHash],
        chain: { ...foundry, id: 31337 },
        account: provider,
      }),
    });

    await payerClient.waitForTransactionReceipt({
      hash: await payerClient.writeContract({
        address: opts.mockUSDC,
        abi: mockUsdcAbi,
        functionName: "mint",
        args: [payer.address, amount],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    });
    await payerClient.waitForTransactionReceipt({
      hash: await payerClient.writeContract({
        address: opts.mockUSDC,
        abi: mockUsdcAbi,
        functionName: "approve",
        args: [opts.escrowAddress, amount],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    });
    await payerClient.waitForTransactionReceipt({
      hash: await payerClient.writeContract({
        address: opts.escrowAddress,
        abi,
        functionName: "fund",
        args: [created.escrowId],
        chain: { ...foundry, id: 31337 },
        account: payer,
      }),
    });

    return {
      payer,
      provider,
      arbitrator,
      payerClient,
      providerClient,
      escrowId: created.escrowId,
      agreement: built.document as AgreementDocument,
      agreementHash: built.agreementHash,
      abi,
      createReceipt,
      createTx: createHash,
    };
  }

  it("Create → Approve → Fund → Submit Evidence → Verify for both variants", async () => {
    const deployment = loadDeployment();
    if (!deployment) {
      console.warn("skip Anvil e2e: no deployment");
      return;
    }
    const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
    const probe = createWalletClient({
      account: privateKeyToAccount(ANVIL_KEY_0),
      chain: { ...foundry, id: 31337 },
      transport: http(rpc, { timeout: 3_000 }),
    }).extend(publicActions);
    try {
      expect(await probe.getChainId()).toBe(31337);
    } catch {
      console.warn("skip Anvil e2e: RPC unreachable");
      return;
    }

    process.env.NEXT_PUBLIC_MOCK_USDC = deployment.mockUSDC;
    process.env.NEXT_PUBLIC_INDIVIDUAL_ESCROW = deployment.individualHashEscrow;
    process.env.NEXT_PUBLIC_MERKLE_ESCROW = deployment.merkleRootEscrow;
    process.env.NEXT_PUBLIC_RPC_URL = rpc;

    for (const variant of ["individual", "merkle"] as const) {
      const escrowAddress =
        variant === "individual" ? deployment.individualHashEscrow : deployment.merkleRootEscrow;
      const funded = await fundEscrow({
        variant,
        escrowAddress,
        mockUSDC: deployment.mockUSDC,
        rpc,
      });

      const ws = makeTempWorkspace();
      workspaces.push(ws);
      const { db, uploadDir } = ws;

      const persisted = await confirmCreateEscrow(db, {
        variant,
        txHash: funded.createTx,
        agreement: funded.agreement,
        sessionAddress: funded.payer.address,
      });

      const bytes = new TextEncoder().encode(`evidence-${variant}-payload`);
      const uploaded = storeUpload(db, {
        escrowRowId: persisted.escrowRowId,
        uploader: funded.provider.address,
        bytes,
        originalFilename: "work.bin",
        uploadDir,
      });
      const urlDraft = newUrlDraft("https://example.com/delivery-note");
      const fileDraft = draftFromUploadedFile({
        storageKey: uploaded.storageKey,
        contentHash: uploaded.contentHash as Hex,
        byteLength: uploaded.byteLength,
        originalFilename: "work.bin",
      });

      const evidenceExport = buildDeliveryExport({
        chainId: 31337,
        escrowContract: escrowAddress,
        escrowId: Number(funded.escrowId),
        deliveryVersion: 1,
        items: [fileDraft, urlDraft],
      });
      const payload = submitPayloadForVariant(evidenceExport, variant);

      // Non-provider cannot submit
      await expect(
        funded.payerClient.writeContract({
          address: escrowAddress,
          abi: funded.abi,
          functionName: "submitDelivery",
          args:
            payload.kind === "individual"
              ? [funded.escrowId, payload.commitments]
              : [funded.escrowId, payload.root, payload.declaredCount],
          chain: { ...foundry, id: 31337 },
          account: funded.payer,
        }),
      ).rejects.toThrow();

      const submitHash = await funded.providerClient.writeContract({
        address: escrowAddress,
        abi: funded.abi,
        functionName: "submitDelivery",
        args:
          payload.kind === "individual"
            ? [funded.escrowId, payload.commitments]
            : [funded.escrowId, payload.root, payload.declaredCount],
        chain: { ...foundry, id: 31337 },
        account: funded.provider,
      });
      const submitReceipt = await funded.providerClient.waitForTransactionReceipt({ hash: submitHash });
      const submitted = parseDeliverySubmittedFromReceipt(submitReceipt, variant);
      expect(submitted.deliveryVersion).toBe(1);
      expect(submitted.itemCount).toBe(2);

      const confirmItems = [
        {
          kind: "file" as const,
          storageKey: fileDraft.storageKey,
          salt: fileDraft.salt,
          originalFilename: "work.bin",
        },
        {
          kind: "url" as const,
          storageKey: urlDraft.storageKey,
          salt: urlDraft.salt,
          url: urlDraft.url,
        },
      ];

      // Payer cannot confirm
      await expect(
        confirmDeliverySubmission(db, {
          variant,
          escrowId: Number(funded.escrowId),
          txHash: submitHash,
          items: confirmItems,
          sessionAddress: funded.payer.address,
          uploadDir,
        }),
      ).rejects.toThrow(/Forbidden/);

      const confirmed = await confirmDeliverySubmission(db, {
        variant,
        escrowId: Number(funded.escrowId),
        txHash: submitHash,
        items: confirmItems,
        sessionAddress: funded.provider.address,
        uploadDir,
      });
      expect(confirmed.duplicated).toBe(false);
      expect(confirmed.deliveryVersion).toBe(1);

      // Idempotent re-save
      const again = await confirmDeliverySubmission(db, {
        variant,
        escrowId: Number(funded.escrowId),
        txHash: submitHash,
        items: confirmItems,
        sessionAddress: funded.provider.address,
        uploadDir,
      });
      expect(again.duplicated).toBe(true);

      // Immutable: different salt rejected
      await expect(
        confirmDeliverySubmission(db, {
          variant,
          escrowId: Number(funded.escrowId),
          txHash: submitHash,
          items: [
            confirmItems[0],
            { ...confirmItems[1], salt: ("0x" + "99".repeat(32)) as Hex },
          ],
          sessionAddress: funded.provider.address,
          uploadDir,
        }),
      ).rejects.toThrow(/immutable|bundleCommitment|mismatch/i);

      // Repeat on-chain submit forbidden
      await expect(
        funded.providerClient.writeContract({
          address: escrowAddress,
          abi: funded.abi,
          functionName: "submitDelivery",
          args:
            payload.kind === "individual"
              ? [funded.escrowId, payload.commitments]
              : [funded.escrowId, payload.root, payload.declaredCount],
          chain: { ...foundry, id: 31337 },
          account: funded.provider,
        }),
      ).rejects.toThrow();

      // On-chain verify Valid
      const leaf0 = evidenceExport.leaves[0].fields;
      const leafStruct = {
        schemaVersion: leaf0.schemaVersion,
        chainId: leaf0.chainId,
        escrowContract: leaf0.escrowContract as Address,
        escrowId: leaf0.escrowId,
        deliveryVersion: leaf0.deliveryVersion,
        itemIndex: leaf0.itemIndex,
        evidenceType: leaf0.evidenceType,
        contentHash: leaf0.contentHash,
        salt: leaf0.salt,
      };

      if (variant === "individual") {
        const status = (await funded.providerClient.readContract({
          address: escrowAddress,
          abi: funded.abi,
          functionName: "verifyEvidence",
          args: [funded.escrowId, leafStruct],
        })) as number;
        expect(status).toBe(EvidenceStatus.Valid);

        const wrongEscrow = { ...leafStruct, escrowId: leaf0.escrowId + 1n };
        const bad = (await funded.providerClient.readContract({
          address: escrowAddress,
          abi: funded.abi,
          functionName: "verifyEvidence",
          args: [funded.escrowId, wrongEscrow],
        })) as number;
        expect(bad).toBe(EvidenceStatus.WrongEscrow);
      } else {
        const status = (await funded.providerClient.readContract({
          address: escrowAddress,
          abi: funded.abi,
          functionName: "verifyEvidence",
          args: [funded.escrowId, leafStruct, evidenceExport.leaves[0].proof],
        })) as number;
        expect(status).toBe(EvidenceStatus.Valid);
      }

      // Export accessible to participant; stranger forbidden
      const packed = getDeliveryForExport(db, {
        variant,
        escrowId: Number(funded.escrowId),
        deliveryVersion: 1,
        sessionAddress: funded.payer.address,
      });
      expect(packed).not.toBeNull();
      const parsed = parseExportJson(packed!.delivery.exportJson);
      expect(parsed.manifestHash).toBe(evidenceExport.manifestHash);
      expect(parsed.leaves[0].proof).toEqual(evidenceExport.leaves[0].proof);

      const stranger = privateKeyToAccount(ANVIL_KEY_3);
      expect(() =>
        getDeliveryForExport(db, {
          variant,
          escrowId: Number(funded.escrowId),
          deliveryVersion: 1,
          sessionAddress: stranger.address,
        }),
      ).toThrow(/Forbidden/);
    }
  }, 180_000);
});
