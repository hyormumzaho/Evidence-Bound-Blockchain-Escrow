#!/usr/bin/env node
/**
 * Smoke-check Anvil deployment via viem (no Next.js server, no private keys).
 * Usage: pnpm check:chain
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, getContract } from "viem";
import { foundry } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "../..");
const contractsRoot = join(repoRoot, "packages/contracts");

const deploymentCandidates = [
  join(contractsRoot, "deployments/31337.json"),
  join(webRoot, "src/lib/chain/deployments/31337.json"),
];

const abiDirCandidates = [
  join(contractsRoot, "abis"),
  join(webRoot, "src/lib/chain/abis"),
];

function loadDeployment() {
  for (const path of deploymentCandidates) {
    if (!existsSync(path)) continue;
    const deployment = JSON.parse(readFileSync(path, "utf8"));
    if (deployment.mockUSDC && deployment.individualHashEscrow && deployment.merkleRootEscrow) {
      return { path, deployment };
    }
  }
  console.error("Missing live deployments/31337.json. Run pnpm deploy:local first.");
  process.exit(1);
}

function loadAbi(name) {
  for (const dir of abiDirCandidates) {
    const path = join(dir, `${name}.json`);
    if (!existsSync(path)) continue;
    return JSON.parse(readFileSync(path, "utf8")).abi;
  }
  throw new Error(`Missing ABI for ${name}. Run: pnpm contracts:abis`);
}

const { path: deploymentPath, deployment } = loadDeployment();
const rpcUrl = process.env.RPC_URL ?? deployment.rpcUrl ?? "http://127.0.0.1:8545";

const client = createPublicClient({
  chain: { ...foundry, id: 31337 },
  transport: http(rpcUrl, { timeout: 3_000 }),
});

const chainId = await client.getChainId();
console.log("deployment", deploymentPath);
console.log("chainId", chainId);
if (chainId !== 31337) {
  console.error("Expected chain id 31337");
  process.exit(1);
}

for (const [label, address] of [
  ["MockUSDC", deployment.mockUSDC],
  ["IndividualHashEscrow", deployment.individualHashEscrow],
  ["MerkleRootEscrow", deployment.merkleRootEscrow],
]) {
  const code = await client.getBytecode({ address });
  console.log(label, address, code && code !== "0x" ? "has bytecode" : "NO BYTECODE");
  if (!code || code === "0x") process.exit(1);
}

const individual = getContract({
  address: deployment.individualHashEscrow,
  abi: loadAbi("IndividualHashEscrow"),
  client,
});
const merkle = getContract({
  address: deployment.merkleRootEscrow,
  abi: loadAbi("MerkleRootEscrow"),
  client,
});

const [iToken, iNext, iMode, mToken, mNext, mMode] = await Promise.all([
  individual.read.token(),
  individual.read.nextEscrowId(),
  individual.read.evidenceMode(),
  merkle.read.token(),
  merkle.read.nextEscrowId(),
  merkle.read.evidenceMode(),
]);

console.log("Individual token", iToken, "nextEscrowId", iNext.toString(), "mode", iMode);
console.log("Merkle token", mToken, "nextEscrowId", mNext.toString(), "mode", mMode);

if (iMode !== "individual-hash" || mMode !== "merkle-root") {
  console.error("Unexpected evidenceMode");
  process.exit(1);
}
if (iToken.toLowerCase() !== deployment.mockUSDC.toLowerCase()) {
  console.error("Individual token() mismatch");
  process.exit(1);
}
if (mToken.toLowerCase() !== deployment.mockUSDC.toLowerCase()) {
  console.error("Merkle token() mismatch");
  process.exit(1);
}
console.log("check-chain OK");
