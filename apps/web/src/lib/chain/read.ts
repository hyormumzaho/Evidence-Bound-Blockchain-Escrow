import type { Address } from "viem";
import { individualHashEscrowAbi, merkleRootEscrowAbi, mockUsdcAbi, type EscrowVariant, escrowAbi } from "./abis";
import { createAnvilPublicClient, type AnvilPublicClient } from "./client";
import { getDeploymentAddresses, requireAddress } from "./addresses";

export type EscrowView = {
  payer: Address;
  provider: Address;
  arbitrator: Address;
  amount: bigint;
  agreementHash: `0x${string}`;
  templateHash: `0x${string}`;
  deliveryDeadline: bigint;
  currentDeliveryDeadline: bigint;
  reviewPeriod: bigint;
  revisionDeliveryWindow: bigint;
  reviewDeadline: bigint;
  deliveryVersion: number;
  revisionsUsed: number;
  state: number;
  providerApproved: boolean;
};

function clientOrDefault(client?: AnvilPublicClient): AnvilPublicClient {
  return client ?? createAnvilPublicClient();
}

export async function readTokenAddress(variant: EscrowVariant, client?: AnvilPublicClient): Promise<Address> {
  const c = clientOrDefault(client);
  const addresses = getDeploymentAddresses();
  const escrow =
    variant === "individual"
      ? requireAddress(addresses.individualHashEscrow, "IndividualHashEscrow")
      : requireAddress(addresses.merkleRootEscrow, "MerkleRootEscrow");

  return c.readContract({
    address: escrow,
    abi: escrowAbi(variant),
    functionName: "token",
  }) as Promise<Address>;
}

export async function readNextEscrowId(variant: EscrowVariant, client?: AnvilPublicClient): Promise<bigint> {
  const c = clientOrDefault(client);
  const addresses = getDeploymentAddresses();
  const escrow =
    variant === "individual"
      ? requireAddress(addresses.individualHashEscrow, "IndividualHashEscrow")
      : requireAddress(addresses.merkleRootEscrow, "MerkleRootEscrow");

  return c.readContract({
    address: escrow,
    abi: escrowAbi(variant),
    functionName: "nextEscrowId",
  }) as Promise<bigint>;
}

export async function readEvidenceMode(variant: EscrowVariant, client?: AnvilPublicClient): Promise<string> {
  const c = clientOrDefault(client);
  const addresses = getDeploymentAddresses();
  const escrow =
    variant === "individual"
      ? requireAddress(addresses.individualHashEscrow, "IndividualHashEscrow")
      : requireAddress(addresses.merkleRootEscrow, "MerkleRootEscrow");

  return c.readContract({
    address: escrow,
    abi: escrowAbi(variant),
    functionName: "evidenceMode",
  }) as Promise<string>;
}

export async function readEscrowView(
  variant: EscrowVariant,
  escrowId: bigint,
  client?: AnvilPublicClient,
): Promise<EscrowView> {
  const c = clientOrDefault(client);
  const addresses = getDeploymentAddresses();
  const escrow =
    variant === "individual"
      ? requireAddress(addresses.individualHashEscrow, "IndividualHashEscrow")
      : requireAddress(addresses.merkleRootEscrow, "MerkleRootEscrow");

  const view = (await c.readContract({
    address: escrow,
    abi: variant === "individual" ? individualHashEscrowAbi : merkleRootEscrowAbi,
    functionName: "getEscrow",
    args: [escrowId],
  })) as EscrowView;
  return view;
}

export async function readMockUsdcMeta(client?: AnvilPublicClient): Promise<{
  name: string;
  symbol: string;
  decimals: number;
}> {
  const c = clientOrDefault(client);
  const token = requireAddress(getDeploymentAddresses().mockUSDC, "MockUSDC");
  const [name, symbol, decimals] = await Promise.all([
    c.readContract({ address: token, abi: mockUsdcAbi, functionName: "name" }) as Promise<string>,
    c.readContract({ address: token, abi: mockUsdcAbi, functionName: "symbol" }) as Promise<string>,
    c.readContract({ address: token, abi: mockUsdcAbi, functionName: "decimals" }) as Promise<number>,
  ]);
  return { name, symbol, decimals: Number(decimals) };
}
