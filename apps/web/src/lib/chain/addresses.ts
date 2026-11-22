import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";
import { isAddress } from "viem";
import bundledDeployment from "./deployments/31337.json";
import type { EscrowVariant } from "./abis";
import { ANVIL_CHAIN_ID } from "./config";

export type DeploymentAddresses = {
  chainId: number;
  rpcUrl: string;
  mockUSDC: Address | null;
  individualHashEscrow: Address | null;
  manifestHashEscrow: Address | null;
  merkleRootEscrow: Address | null;
  payer: Address | null;
  mintAmount: string | null;
  deployedAt: string | null;
  blockNumber: number | null;
};

type DeploymentFile = {
  chainId?: number;
  rpcUrl?: string;
  mockUSDC?: string | null;
  individualHashEscrow?: string | null;
  manifestHashEscrow?: string | null;
  merkleRootEscrow?: string | null;
  payer?: string | null;
  mintAmount?: string | null;
  deployedAt?: string | null;
  blockNumber?: number | null;
};

function optionalAddress(value: unknown, label: string): Address | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label} address: ${String(value)}`);
  }
  return value;
}

function fromEnv(name: string): Address | null {
  const value = process.env[name];
  if (!value) return null;
  if (!isAddress(value)) {
    throw new Error(`Invalid ${name}: ${value}`);
  }
  return value;
}

function isLive(file: DeploymentFile): boolean {
  return Boolean(file.mockUSDC && file.individualHashEscrow && file.merkleRootEscrow);
}

/** Prefer live JSON written by `pnpm deploy:local` over the bundled placeholder. */
function loadDeploymentFile(): DeploymentFile {
  const candidates = [
    join(process.cwd(), "src/lib/chain/deployments/31337.json"),
    join(process.cwd(), "packages/contracts/deployments/31337.json"),
    join(process.cwd(), "../../packages/contracts/deployments/31337.json"),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as DeploymentFile;
      if (isLive(parsed)) return parsed;
    } catch {
      // try next candidate
    }
  }

  return bundledDeployment as DeploymentFile;
}

/**
 * Resolve contract addresses.
 * Precedence: NEXT_PUBLIC_* env overrides → live deployments/31337.json → bundled placeholder.
 */
export function getDeploymentAddresses(): DeploymentAddresses {
  const file = loadDeploymentFile();

  return {
    chainId: file.chainId ?? ANVIL_CHAIN_ID,
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? file.rpcUrl ?? "http://127.0.0.1:8545",
    mockUSDC: fromEnv("NEXT_PUBLIC_MOCK_USDC") ?? optionalAddress(file.mockUSDC, "mockUSDC"),
    individualHashEscrow:
      fromEnv("NEXT_PUBLIC_INDIVIDUAL_ESCROW") ??
      optionalAddress(file.individualHashEscrow, "individualHashEscrow"),
    manifestHashEscrow:
      fromEnv("NEXT_PUBLIC_MANIFEST_ESCROW") ??
      optionalAddress(file.manifestHashEscrow, "manifestHashEscrow"),
    merkleRootEscrow:
      fromEnv("NEXT_PUBLIC_MERKLE_ESCROW") ?? optionalAddress(file.merkleRootEscrow, "merkleRootEscrow"),
    payer: optionalAddress(file.payer, "payer"),
    mintAmount: file.mintAmount ?? null,
    deployedAt: file.deployedAt ?? null,
    blockNumber: file.blockNumber ?? null,
  };
}

export function addressForVariant(variant: EscrowVariant): Address | null {
  const addresses = getDeploymentAddresses();
  if (variant === "individual") return addresses.individualHashEscrow;
  if (variant === "manifest") return addresses.manifestHashEscrow;
  return addresses.merkleRootEscrow;
}

export function requireAddress(value: Address | null, label: string): Address {
  if (!value) {
    throw new Error(
      `${label} address is not configured. Run \`pnpm deploy:local\` or set the matching NEXT_PUBLIC_* env var.`,
    );
  }
  return value;
}
