import {
  hashEvidenceLeaf,
  hashFileBytes,
  hashManifest,
  parseExport,
  verifyLeafProof,
} from "@evidencebound/evidence";
import type { EvidenceExport, Hex } from "@evidencebound/shared";
import { getAddress, type Address } from "viem";
import { addressForVariant } from "@/lib/chain/addresses";
import { escrowAbi, evidenceStrategyLabel, type EscrowVariant } from "@/lib/chain/abis";
import { createAnvilPublicClient } from "@/lib/chain/client";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";

export type IndependentVerdict = {
  integrity: "valid" | "invalid" | "not-verified";
  availability: "available" | "missing-artifact" | "missing-manifest" | "missing-proof" | "chain-unavailable";
  strategy: string | null;
  summary: string;
  checks: Array<{ name: string; result: string }>;
};

function variantForContract(contract: string): EscrowVariant | null {
  const want = contract.toLowerCase();
  for (const variant of ["individual", "manifest", "merkle"] as const) {
    const address = addressForVariant(variant);
    if (address && address.toLowerCase() === want) return variant;
  }
  return null;
}

function fail(partial: Omit<IndependentVerdict, "checks"> & { checks?: IndependentVerdict["checks"] }): IndependentVerdict {
  return { checks: partial.checks ?? [], ...partial };
}

export async function verifyIndependentPackage(input: {
  exportText: string;
  fileBytes?: Uint8Array;
  itemIndex?: number;
}): Promise<IndependentVerdict> {
  const checks: IndependentVerdict["checks"] = [];
  let evidenceExport: EvidenceExport;
  try {
    evidenceExport = parseExport(JSON.parse(input.exportText) as unknown);
  } catch (err) {
    return fail({
      integrity: "invalid",
      availability: "missing-manifest",
      strategy: null,
      summary: err instanceof Error ? err.message : "Export could not be parsed",
    });
  }

  const manifest = evidenceExport.manifest;
  checks.push({ name: "manifest", result: "present" });
  const index = input.itemIndex ?? 0;
  const item = manifest.items[index];
  if (!item) {
    return fail({
      integrity: "invalid",
      availability: "available",
      strategy: null,
      summary: `Export has no item at index ${index}`,
      checks,
    });
  }

  if (Number(manifest.chainId) !== ANVIL_CHAIN_ID) {
    checks.push({ name: "chain", result: `export chain ${manifest.chainId}` });
    return fail({
      integrity: "invalid",
      availability: "available",
      strategy: null,
      summary: `Wrong chain. Export is chain ${manifest.chainId}; this verifier reads chain ${ANVIL_CHAIN_ID}.`,
      checks,
    });
  }

  const variant = variantForContract(manifest.escrowContract);
  if (!variant) {
    checks.push({ name: "contract", result: manifest.escrowContract });
    return fail({
      integrity: "invalid",
      availability: "available",
      strategy: null,
      summary: "Wrong contract. The export names an escrow that is not one of the configured deployments.",
      checks,
    });
  }
  const strategy = evidenceStrategyLabel(variant);
  checks.push({ name: "strategy", result: strategy });

  const client = createAnvilPublicClient();
  const contract = getAddress(manifest.escrowContract) as Address;
  const escrowId = BigInt(manifest.escrowId);
  const deliveryVersion = Number(manifest.deliveryVersion);

  let onChainVersion = 0;
  try {
    const view = (await client.readContract({
      address: contract,
      abi: escrowAbi(variant),
      functionName: "getEscrow",
      args: [escrowId],
    })) as { deliveryVersion: number };
    onChainVersion = Number(view.deliveryVersion);
  } catch {
    return fail({
      integrity: "not-verified",
      availability: "chain-unavailable",
      strategy,
      summary: "Chain commitment unavailable, or this escrow id does not exist. Not verified.",
      checks,
    });
  }

  if (deliveryVersion < 1 || deliveryVersion > onChainVersion) {
    checks.push({ name: "delivery", result: `export ${deliveryVersion}, chain ${onChainVersion}` });
    return fail({
      integrity: "invalid",
      availability: "available",
      strategy,
      summary: `Wrong delivery version. Export says ${deliveryVersion}; the contract's current version is ${onChainVersion}.`,
      checks,
    });
  }

  let commitmentMatches = false;
  try {
    if (variant === "individual") {
      const stored = (await client.readContract({
        address: contract,
        abi: escrowAbi(variant),
        functionName: "commitmentAt",
        args: [escrowId, deliveryVersion, index],
      })) as Hex;
      const leaf = evidenceExport.leaves[index];
      if (!leaf) {
        return fail({
          integrity: "not-verified",
          availability: "missing-proof",
          strategy,
          summary: "Export is missing the leaf for this item. Not verified.",
          checks,
        });
      }
      commitmentMatches = stored.toLowerCase() === leaf.leafHash.toLowerCase();
      checks.push({ name: "stored leaf", result: commitmentMatches ? "match" : "mismatch" });
    } else if (variant === "manifest") {
      const stored = (await client.readContract({
        address: contract,
        abi: escrowAbi(variant),
        functionName: "deliveryManifestHash",
        args: [escrowId, deliveryVersion],
      })) as Hex;
      const recomputed = hashManifest(manifest);
      commitmentMatches = stored.toLowerCase() === recomputed.toLowerCase();
      checks.push({ name: "manifest hash", result: commitmentMatches ? "match" : "mismatch" });
    } else {
      const stored = (await client.readContract({
        address: contract,
        abi: escrowAbi(variant),
        functionName: "deliveryRoot",
        args: [escrowId, deliveryVersion],
      })) as Hex;
      const leaf = evidenceExport.leaves[index];
      if (!leaf) {
        return fail({
          integrity: "not-verified",
          availability: "missing-proof",
          strategy,
          summary: "Export is missing the Merkle proof for this item. Not verified.",
          checks,
        });
      }
      if (stored.toLowerCase() !== evidenceExport.root.toLowerCase()) {
        checks.push({ name: "root", result: "mismatch" });
        commitmentMatches = false;
      } else if (!verifyLeafProof(stored, leaf.fields, leaf.proof)) {
        checks.push({ name: "proof", result: "mismatch" });
        commitmentMatches = false;
      } else {
        const recomputed = hashEvidenceLeaf(leaf.fields);
        commitmentMatches = recomputed.toLowerCase() === leaf.leafHash.toLowerCase();
        checks.push({ name: "merkle proof", result: commitmentMatches ? "match" : "mismatch" });
      }
    }
  } catch {
    return fail({
      integrity: "not-verified",
      availability: "chain-unavailable",
      strategy,
      summary: "The chain did not return a commitment for this delivery. Not verified.",
      checks,
    });
  }

  if (!commitmentMatches) {
    return fail({
      integrity: "invalid",
      availability: input.fileBytes ? "available" : "missing-artifact",
      strategy,
      summary: "Invalid. The supplied package does not match the commitment stored for this escrow and delivery.",
      checks,
    });
  }

  if (!input.fileBytes) {
    checks.push({ name: "artifact", result: "not supplied" });
    return {
      integrity: "not-verified",
      availability: "missing-artifact",
      strategy,
      summary:
        "Commitment matches the chain. The artifact was not supplied, so the file bytes are not verified.",
      checks,
    };
  }

  const contentHash = hashFileBytes(input.fileBytes);
  const matches = contentHash.toLowerCase() === item.contentHash.toLowerCase();
  checks.push({ name: "artifact hash", result: matches ? "match" : "mismatch" });
  if (!matches) {
    return {
      integrity: "invalid",
      availability: "available",
      strategy,
      summary: "Invalid. The file bytes do not match the content hash in the committed manifest.",
      checks,
    };
  }

  return {
    integrity: "valid",
    availability: "available",
    strategy,
    summary: "Valid. The artifact matches the manifest, and the manifest matches the on-chain commitment.",
    checks,
  };
}

