/**
 * Headless gas and size measurements for the three escrow variants.
 * Starts a private Anvil on 127.0.0.1:8546, deploys, and writes JSON receipts.
 * Anvil's published default keys are used only against that local port.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { buildExport, buildManifest, canonicalizeManifest, hashFileBytes, keccak256Utf8 } from "../../packages/evidence/src/index.ts";
import type { EvidenceExport, Hex } from "../../packages/shared/src/index.ts";

const SUITE = process.argv[2] === "full" ? "full" : "small";
const RPC = "http://127.0.0.1:8546";
const CHAIN_ID = 31337;
const SEED = "evidencebound-synthetic-1";
const AMOUNT = "1000000";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACTS = join(ROOT, "packages/contracts");
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PROVIDER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ARBITRATOR_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

type VariantName = "individual-hash" | "manifest-hash" | "merkle-root";

type Measurement = {
  scenario: string;
  variant: VariantName;
  artifactCount: number;
  deliveryVersion: number;
  functionName: string;
  executionKind: "mined" | "off-chain";
  gasUsed: number | null;
  calldataBytes: number | null;
  manifestBytes: number | null;
  proofBytes: number | null;
  txHash: string | null;
  expected: string;
  actual: string;
  pass: boolean;
  failureReason: string | null;
};

type Timing = {
  operation: string;
  variant: VariantName;
  artifactCount: number;
  trials: number;
  medianMs: number;
  p95Ms: number;
};

const records: Measurement[] = [];
const timings: Timing[] = [];

function tool(bin: string, args: string[]): string {
  const result = spawnSync(bin, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${bin} ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function addressOf(key: string): string {
  return tool("cast", ["wallet", "address", "--private-key", key]);
}

function send(key: string, to: string, signature: string, args: string[]): { hash: string; gasUsed: number; status: string } {
  const output = tool("cast", [
    "send",
    "--json",
    "--rpc-url",
    RPC,
    "--private-key",
    key,
    to,
    signature,
    ...args,
  ]);
  const receipt = JSON.parse(output) as { transactionHash?: string; gasUsed?: string | number; status?: string };
  const hash = receipt.transactionHash;
  if (!hash) throw new Error(`No transaction hash from cast send: ${output.slice(0, 400)}`);
  const gasUsed = typeof receipt.gasUsed === "number" ? receipt.gasUsed : Number(receipt.gasUsed);
  return { hash, gasUsed, status: String(receipt.status ?? "1") };
}

function calldataBytes(signature: string, args: string[]): number {
  const data = tool("cast", ["calldata", signature, ...args]);
  return (data.length - 2) / 2;
}

function now(): number {
  return Number(tool("cast", ["block", "latest", "--rpc-url", RPC, "--field", "timestamp"]).split(/\s+/)[0]);
}

function fileBytes(index: number): Uint8Array {
  return Uint8Array.from(Buffer.from(keccak256Utf8(`${SEED}:file:${index}`).slice(2), "hex"));
}

function salt(index: number): Hex {
  return keccak256Utf8(`${SEED}:salt:${index}`);
}

function buildDelivery(contract: string, escrowId: number, count: number): EvidenceExport {
  const manifest = buildManifest({
    chainId: CHAIN_ID,
    escrowContract: contract,
    escrowId,
    deliveryVersion: 1,
    items: Array.from({ length: count }, (_, index) => {
      const bytes = fileBytes(index);
      return {
        index,
        evidenceType: "evidencebound.file.v1",
        contentHash: hashFileBytes(bytes),
        salt: salt(index),
        byteLength: bytes.byteLength,
        storageKey: `seed${SEED}${index}`.replace(/[^a-z0-9]/gi, "").slice(0, 32),
      };
    }),
  });
  return buildExport(manifest);
}

function proofBytes(evidenceExport: EvidenceExport): number {
  return evidenceExport.leaves.reduce((sum, leaf) => sum + leaf.proof.reduce((inner, part) => inner + (part.length - 2) / 2, 0), 0);
}

function recordMined(input: {
  scenario: string;
  variant: VariantName;
  artifactCount: number;
  functionName: string;
  signature: string;
  args: string[];
  to: string;
  key: string;
  manifestBytes: number | null;
  proofBytes: number | null;
}) {
  const bytes = calldataBytes(input.signature, input.args);
  try {
    const receipt = send(input.key, input.to, input.signature, input.args);
    const pass = receipt.status === "1" || receipt.status === "0x1";
    records.push({
      scenario: input.scenario,
      variant: input.variant,
      artifactCount: input.artifactCount,
      deliveryVersion: 1,
      functionName: input.functionName,
      executionKind: "mined",
      gasUsed: receipt.gasUsed,
      calldataBytes: bytes,
      manifestBytes: input.manifestBytes,
      proofBytes: input.proofBytes,
      txHash: receipt.hash,
      expected: "success",
      actual: pass ? "success" : `status ${receipt.status}`,
      pass,
      failureReason: pass ? null : `status ${receipt.status}`,
    });
  } catch (err) {
    records.push({
      scenario: input.scenario,
      variant: input.variant,
      artifactCount: input.artifactCount,
      deliveryVersion: 1,
      functionName: input.functionName,
      executionKind: "mined",
      gasUsed: null,
      calldataBytes: bytes,
      manifestBytes: input.manifestBytes,
      proofBytes: input.proofBytes,
      txHash: null,
      expected: "success",
      actual: "revert",
      pass: false,
      failureReason: err instanceof Error ? err.message.slice(0, 500) : "send failed",
    });
  }
}

function openFunded(escrow: string, variant: VariantName, scenario: string): number {
  const deadline = String(now() + 7 * 24 * 3600);
  const agreement = keccak256Utf8(`${SEED}:agreement:${variant}:${scenario}:${records.length}`);
  const template = keccak256Utf8("website-milestone-v1");
  const payer = addressOf(PAYER_KEY);
  const provider = addressOf(PROVIDER_KEY);
  const arbitrator = addressOf(ARBITRATOR_KEY);
  recordMined({
    scenario,
    variant,
    artifactCount: 0,
    functionName: "createEscrow",
    signature: "createEscrow(address,address,uint256,uint64,uint64,uint64,bytes32,bytes32)",
    args: [provider, arbitrator, AMOUNT, deadline, "259200", "172800", agreement, template],
    to: escrow,
    key: PAYER_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  const nextId = Number(tool("cast", ["call", escrow, "nextEscrowId()(uint256)", "--rpc-url", RPC]).split(/\s+/)[0]);
  const id = String(nextId - 1);
  recordMined({
    scenario,
    variant,
    artifactCount: 0,
    functionName: "approveAgreement",
    signature: "approveAgreement(uint256,bytes32)",
    args: [id, agreement],
    to: escrow,
    key: PROVIDER_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  const token = tool("cast", ["call", escrow, "token()(address)", "--rpc-url", RPC]).split(/\s+/)[0]!;
  recordMined({
    scenario,
    variant,
    artifactCount: 0,
    functionName: "approve",
    signature: "approve(address,uint256)",
    args: [escrow, AMOUNT],
    to: token,
    key: PAYER_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  recordMined({
    scenario,
    variant,
    artifactCount: 0,
    functionName: "fund",
    signature: "fund(uint256)",
    args: [id],
    to: escrow,
    key: PAYER_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  void payer;
  return Number(id);
}

function submit(escrow: string, variant: VariantName, id: number, evidenceExport: EvidenceExport, scenario: string) {
  const manifestBytes = Buffer.byteLength(canonicalizeManifest(evidenceExport.manifest));
  const proofs = proofBytes(evidenceExport);
  const count = String(evidenceExport.declaredItemCount);
  if (variant === "individual-hash") {
    const list = `[${evidenceExport.leaves.map((leaf) => leaf.leafHash).join(",")}]`;
    recordMined({
      scenario,
      variant,
      artifactCount: evidenceExport.declaredItemCount,
      functionName: "submitDelivery",
      signature: "submitDelivery(uint256,bytes32[])",
      args: [String(id), list],
      to: escrow,
      key: PROVIDER_KEY,
      manifestBytes,
      proofBytes: 0,
    });
  } else if (variant === "manifest-hash") {
    recordMined({
      scenario,
      variant,
      artifactCount: evidenceExport.declaredItemCount,
      functionName: "submitDelivery",
      signature: "submitDelivery(uint256,bytes32,uint32)",
      args: [String(id), evidenceExport.manifestHash, count],
      to: escrow,
      key: PROVIDER_KEY,
      manifestBytes,
      proofBytes: 0,
    });
  } else {
    recordMined({
      scenario,
      variant,
      artifactCount: evidenceExport.declaredItemCount,
      functionName: "submitDelivery",
      signature: "submitDelivery(uint256,bytes32,uint32)",
      args: [String(id), evidenceExport.root, count],
      to: escrow,
      key: PROVIDER_KEY,
      manifestBytes,
      proofBytes: proofs,
    });
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[Math.max(0, index)]!;
}

function timePreparation(variant: VariantName, count: number) {
  const once = () => {
    const manifest = buildManifest({
      chainId: CHAIN_ID,
      escrowContract: "0x1111111111111111111111111111111111111111",
      escrowId: 1,
      deliveryVersion: 1,
      items: Array.from({ length: count }, (_, index) => ({
        index,
        evidenceType: "evidencebound.file.v1",
        contentHash: hashFileBytes(fileBytes(index)),
        salt: salt(index),
        byteLength: 32,
        storageKey: `time${index}`.padEnd(8, "0"),
      })),
    });
    buildExport(manifest);
  };
  once();
  const samples: number[] = [];
  for (let trial = 0; trial < 20; trial += 1) {
    const start = performance.now();
    once();
    samples.push(performance.now() - start);
  }
  timings.push({
    operation: "manifest-and-tree",
    variant,
    artifactCount: count,
    trials: samples.length,
    medianMs: Number(median(samples).toFixed(3)),
    p95Ms: Number(p95(samples).toFixed(3)),
  });
}

async function waitForChain() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync("cast", ["chain-id", "--rpc-url", RPC], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim().startsWith("31337")) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Anvil did not answer on ${RPC}`);
}

function deploy(): Record<VariantName, string> {
  process.env.PRIVATE_KEY = PAYER_KEY;
  process.env.PAYER_ADDRESS = addressOf(PAYER_KEY);
  process.env.MINT_AMOUNT = "1000000000000";
  const payer = addressOf(PAYER_KEY);
  const forged = spawnSync(
    "forge",
    ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--private-key", PAYER_KEY, "--broadcast", "-vv"],
    { encoding: "utf8" },
  );
  const output = `${forged.stdout ?? ""}\n${forged.stderr ?? ""}`;
  if (forged.status !== 0) throw new Error(output.slice(-4000));
  const pick = (label: string) => {
    const line = output.split("\n").find((entry) => entry.includes(label));
    const match = line?.match(/0x[0-9a-fA-F]{40}/);
    if (!match) throw new Error(`Deploy output missing ${label}\n${output.slice(-2500)}`);
    return match[0];
  };
  void payer;
  return {
    "individual-hash": pick("IndividualHashEscrow"),
    "manifest-hash": pick("ManifestHashEscrow"),
    "merkle-root": pick("MerkleRootEscrow"),
  };
}

function submissionCounts(): number[] {
  return SUITE === "full" ? [1, 2, 5, 10, 20, 50, 100] : [1, 5, 10];
}

function run() {
  const contracts = deploy();
  const variants = Object.entries(contracts) as Array<[VariantName, string]>;
  for (const count of submissionCounts()) {
    for (const [variant] of variants) timePreparation(variant, count);
    for (const [variant, escrow] of variants) {
      const id = openFunded(escrow, variant, "submission");
      const evidenceExport = buildDelivery(escrow, id, count);
      submit(escrow, variant, id, evidenceExport, "submission");
    }
  }

  for (const [variant, escrow] of variants) {
    const id = openFunded(escrow, variant, "accept");
    submit(escrow, variant, id, buildDelivery(escrow, id, 1), "accept");
    recordMined({
      scenario: "accept",
      variant,
      artifactCount: 1,
      functionName: "acceptDelivery",
      signature: "acceptDelivery(uint256)",
      args: [String(id)],
      to: escrow,
      key: PAYER_KEY,
      manifestBytes: null,
      proofBytes: null,
    });
    recordMined({
      scenario: "accept",
      variant,
      artifactCount: 1,
      functionName: "withdraw",
      signature: "withdraw(uint256)",
      args: [String(id)],
      to: escrow,
      key: PROVIDER_KEY,
      manifestBytes: null,
      proofBytes: null,
    });
  }

  const disputeEscrow = contracts["manifest-hash"];
  const disputeId = openFunded(disputeEscrow, "manifest-hash", "arbitration-split");
  submit(disputeEscrow, "manifest-hash", disputeId, buildDelivery(disputeEscrow, disputeId, 1), "arbitration-split");
  recordMined({
    scenario: "arbitration-split",
    variant: "manifest-hash",
    artifactCount: 1,
    functionName: "openDispute",
    signature: "openDispute(uint256,bytes32)",
    args: [String(disputeId), keccak256Utf8(`${SEED}:dispute`)],
    to: disputeEscrow,
    key: PAYER_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  recordMined({
    scenario: "arbitration-split",
    variant: "manifest-hash",
    artifactCount: 1,
    functionName: "resolveDispute",
    signature: "resolveDispute(uint256,uint256)",
    args: [String(disputeId), "5000"],
    to: disputeEscrow,
    key: ARBITRATOR_KEY,
    manifestBytes: null,
    proofBytes: null,
  });
  for (const key of [PROVIDER_KEY, PAYER_KEY]) {
    recordMined({
      scenario: "arbitration-split",
      variant: "manifest-hash",
      artifactCount: 1,
      functionName: "withdraw",
      signature: "withdraw(uint256)",
      args: [String(disputeId)],
      to: disputeEscrow,
      key,
      manifestBytes: null,
      proofBytes: null,
    });
  }
}

function writeResults() {
  const gitCommit = tool("git", ["-C", ROOT, "rev-parse", "HEAD"]);
  const dirty = tool("git", ["-C", ROOT, "status", "--porcelain"]).length > 0;
  const forgeVersion = tool("forge", ["--version"]).split("\n")[0] ?? "forge";
  const document = {
    runId: `${SUITE}-${Date.now()}`,
    gitCommit,
    dirty,
    createdAt: new Date().toISOString(),
    suite: SUITE,
    datasetSeed: SEED,
    synthetic: true,
    chainId: CHAIN_ID,
    compiler: { solc: "0.8.38", optimizer: true, optimizerRuns: 200, viaIr: false, evm: "cancun" },
    tools: { forge: forgeVersion, node: process.version },
    note: "Gas figures are mined-transaction gasUsed. Off-chain timings exclude one warmup trial. Artifacts are synthetic.",
    records,
    timings,
  };
  const dir = join(ROOT, "experiments/results");
  mkdirSync(join(dir, "raw"), { recursive: true });
  const rawPath = join(dir, "raw", `${document.runId}.json`);
  writeFileSync(rawPath, `${JSON.stringify(document, null, 2)}\n`);
  writeFileSync(join(dir, "latest.json"), `${JSON.stringify(document, null, 2)}\n`);
  const failed = records.filter((row) => !row.pass).length;
  console.log(`Wrote ${rawPath}`);
  console.log(`${records.length} transactions, ${failed} failed, suite ${SUITE}`);
  if (failed > 0) process.exitCode = 1;
}

let anvil: ChildProcess | undefined;

async function main() {
  anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", "8546", "--chain-id", "31337", "--silent"], {
    stdio: "ignore",
  });
  await waitForChain();
  process.chdir(CONTRACTS);
  run();
  writeResults();
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    anvil?.kill("SIGTERM");
  });
