import type { Abi } from "viem";
import individualArtifact from "./abis/IndividualHashEscrow.json";
import merkleArtifact from "./abis/MerkleRootEscrow.json";
import mockUsdcArtifact from "./abis/MockUSDC.json";

type AbiFile = { contractName: string; abi: Abi };

export const mockUsdcAbi = (mockUsdcArtifact as AbiFile).abi;
export const individualHashEscrowAbi = (individualArtifact as AbiFile).abi;
export const merkleRootEscrowAbi = (merkleArtifact as AbiFile).abi;

export type EscrowVariant = "individual" | "merkle";

export function escrowAbi(variant: EscrowVariant): Abi {
  return variant === "individual" ? individualHashEscrowAbi : merkleRootEscrowAbi;
}
