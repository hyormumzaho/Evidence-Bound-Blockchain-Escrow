#!/usr/bin/env node
/**
 * Export ABIs from Foundry `out/` into packages/contracts/abis and apps/web.
 * Does not hand-maintain ABIs — regenerates from forge artifacts.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const contractsRoot = join(here, "..");
const repoRoot = join(contractsRoot, "../..");

const contracts = [
  { artifact: "MockUSDC.sol/MockUSDC.json", name: "MockUSDC" },
  { artifact: "IndividualHashEscrow.sol/IndividualHashEscrow.json", name: "IndividualHashEscrow" },
  { artifact: "ManifestHashEscrow.sol/ManifestHashEscrow.json", name: "ManifestHashEscrow" },
  { artifact: "MerkleRootEscrow.sol/MerkleRootEscrow.json", name: "MerkleRootEscrow" },
];

const targets = [
  join(contractsRoot, "abis"),
  join(repoRoot, "apps/web/src/lib/chain/abis"),
];

function forgeBuild() {
  const result = spawnSync("forge", ["build"], { cwd: contractsRoot, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("forge build failed");
  }
}

function exportOne(name, artifactRel) {
  const artifactPath = join(contractsRoot, "out", artifactRel);
  if (!existsSync(artifactPath)) {
    throw new Error(`Missing artifact ${artifactPath}. Run forge build first.`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    throw new Error(`Artifact ${artifactRel} has no abi array`);
  }
  const payload = {
    contractName: name,
    sourceName: artifactRel.split("/")[0],
    abi: artifact.abi,
  };
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.json`), body);
  }
  console.log(`Exported ${name} (${artifact.abi.length} ABI entries)`);
}

forgeBuild();
for (const entry of contracts) {
  exportOne(entry.name, entry.artifact);
}
console.log("ABI export complete.");
