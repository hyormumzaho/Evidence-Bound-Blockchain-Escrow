import type { Abi } from "viem";
import individualArtifact from "./abis/IndividualHashEscrow.json";
import manifestArtifact from "./abis/ManifestHashEscrow.json";
import merkleArtifact from "./abis/MerkleRootEscrow.json";
import mockUsdcArtifact from "./abis/MockUSDC.json";

type AbiFile = { contractName: string; abi: Abi };

export const mockUsdcAbi = (mockUsdcArtifact as AbiFile).abi;
export const individualHashEscrowAbi = (individualArtifact as AbiFile).abi;
export const manifestHashEscrowAbi = (manifestArtifact as AbiFile).abi;
export const merkleRootEscrowAbi = (merkleArtifact as AbiFile).abi;

export const ESCROW_VARIANTS = ["individual", "manifest", "merkle"] as const;
export type EscrowVariant = (typeof ESCROW_VARIANTS)[number];

export function isEscrowVariant(value: string): value is EscrowVariant {
  return (ESCROW_VARIANTS as readonly string[]).includes(value);
}

export function escrowAbi(variant: EscrowVariant): Abi {
  if (variant === "individual") return individualHashEscrowAbi;
  if (variant === "manifest") return manifestHashEscrowAbi;
  return merkleRootEscrowAbi;
}

export function evidenceStrategyLabel(variant: EscrowVariant): string {
  if (variant === "individual") return "individual-hash";
  if (variant === "manifest") return "manifest-hash";
  return "merkle-root";
}
