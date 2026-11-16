import { getBytecode } from "viem/actions";
import { getDeploymentAddresses } from "./addresses";
import { createAnvilPublicClient } from "./client";
import { ANVIL_CHAIN_ID, getConfiguredChainId, getRpcUrl } from "./config";
import { readEvidenceMode, readNextEscrowId, readTokenAddress } from "./read";

export type ChainStatus = {
  ok: boolean;
  rpcUrl: string;
  expectedChainId: number;
  actualChainId: number | null;
  rpcReachable: boolean;
  chainIdMatch: boolean;
  addressesConfigured: boolean;
  addresses: {
    mockUSDC: `0x${string}` | null;
    individualHashEscrow: `0x${string}` | null;
    merkleRootEscrow: `0x${string}` | null;
  };
  bytecode: {
    mockUSDC: boolean;
    individualHashEscrow: boolean;
    merkleRootEscrow: boolean;
  };
  reads: {
    individualToken: string | null;
    individualNextEscrowId: string | null;
    individualEvidenceMode: string | null;
    merkleToken: string | null;
    merkleNextEscrowId: string | null;
    merkleEvidenceMode: string | null;
  };
  errors: string[];
};

async function hasCode(
  client: ReturnType<typeof createAnvilPublicClient>,
  address: `0x${string}` | null,
): Promise<boolean> {
  if (!address) return false;
  const code = await getBytecode(client, { address });
  return typeof code === "string" && code !== "0x" && code.length > 2;
}

export async function getChainStatus(): Promise<ChainStatus> {
  const rpcUrl = getRpcUrl();
  const expectedChainId = getConfiguredChainId();
  const addresses = getDeploymentAddresses();
  const errors: string[] = [];

  const status: ChainStatus = {
    ok: false,
    rpcUrl,
    expectedChainId,
    actualChainId: null,
    rpcReachable: false,
    chainIdMatch: false,
    addressesConfigured: Boolean(
      addresses.mockUSDC && addresses.individualHashEscrow && addresses.merkleRootEscrow,
    ),
    addresses: {
      mockUSDC: addresses.mockUSDC,
      individualHashEscrow: addresses.individualHashEscrow,
      merkleRootEscrow: addresses.merkleRootEscrow,
    },
    bytecode: {
      mockUSDC: false,
      individualHashEscrow: false,
      merkleRootEscrow: false,
    },
    reads: {
      individualToken: null,
      individualNextEscrowId: null,
      individualEvidenceMode: null,
      merkleToken: null,
      merkleNextEscrowId: null,
      merkleEvidenceMode: null,
    },
    errors,
  };

  if (expectedChainId !== ANVIL_CHAIN_ID) {
    errors.push(`Configured chainId ${expectedChainId} is not Anvil ${ANVIL_CHAIN_ID}.`);
  }

  if (!status.addressesConfigured) {
    errors.push("Contract addresses are not configured. Run `pnpm deploy:local`.");
  }

  const client = createAnvilPublicClient(rpcUrl);

  try {
    const chainId = await client.getChainId();
    status.actualChainId = chainId;
    status.rpcReachable = true;
    status.chainIdMatch = chainId === expectedChainId;
    if (!status.chainIdMatch) {
      errors.push(`RPC chainId is ${chainId}, expected ${expectedChainId}.`);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "RPC unreachable");
    return status;
  }

  try {
    status.bytecode.mockUSDC = await hasCode(client, addresses.mockUSDC);
    status.bytecode.individualHashEscrow = await hasCode(client, addresses.individualHashEscrow);
    status.bytecode.merkleRootEscrow = await hasCode(client, addresses.merkleRootEscrow);
    if (status.addressesConfigured) {
      if (!status.bytecode.mockUSDC) errors.push("MockUSDC has no bytecode at configured address.");
      if (!status.bytecode.individualHashEscrow) {
        errors.push("IndividualHashEscrow has no bytecode at configured address.");
      }
      if (!status.bytecode.merkleRootEscrow) {
        errors.push("MerkleRootEscrow has no bytecode at configured address.");
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "Bytecode check failed");
  }

  if (status.addressesConfigured && status.bytecode.individualHashEscrow) {
    try {
      const [token, nextId, mode] = await Promise.all([
        readTokenAddress("individual", client),
        readNextEscrowId("individual", client),
        readEvidenceMode("individual", client),
      ]);
      status.reads.individualToken = token;
      status.reads.individualNextEscrowId = nextId.toString(10);
      status.reads.individualEvidenceMode = mode;
    } catch (err) {
      errors.push(err instanceof Error ? `Individual reads: ${err.message}` : "Individual reads failed");
    }
  }

  if (status.addressesConfigured && status.bytecode.merkleRootEscrow) {
    try {
      const [token, nextId, mode] = await Promise.all([
        readTokenAddress("merkle", client),
        readNextEscrowId("merkle", client),
        readEvidenceMode("merkle", client),
      ]);
      status.reads.merkleToken = token;
      status.reads.merkleNextEscrowId = nextId.toString(10);
      status.reads.merkleEvidenceMode = mode;
    } catch (err) {
      errors.push(err instanceof Error ? `Merkle reads: ${err.message}` : "Merkle reads failed");
    }
  }

  status.ok =
    status.rpcReachable &&
    status.chainIdMatch &&
    status.addressesConfigured &&
    status.bytecode.mockUSDC &&
    status.bytecode.individualHashEscrow &&
    status.bytecode.merkleRootEscrow &&
    status.reads.individualEvidenceMode === "individual-hash" &&
    status.reads.merkleEvidenceMode === "merkle-root" &&
    errors.length === 0;

  return status;
}
