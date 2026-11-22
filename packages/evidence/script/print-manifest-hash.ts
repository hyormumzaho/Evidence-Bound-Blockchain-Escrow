import { buildManifest, hashManifest } from "../src/manifest.js";

const [chainId, escrowContract, escrowId, deliveryVersion, contentHash, salt, storageKey, byteLength] =
  process.argv.slice(2);

if (!chainId || !escrowContract || !escrowId || !deliveryVersion || !contentHash || !salt || !storageKey || !byteLength) {
  console.error(
    "Usage: print-manifest-hash.ts <chainId> <escrowContract> <escrowId> <deliveryVersion> <contentHash> <salt> <storageKey> <byteLength>",
  );
  process.exit(1);
}

const manifest = buildManifest({
  chainId,
  escrowContract,
  escrowId,
  deliveryVersion,
  items: [
    {
      index: 0,
      evidenceType: "evidencebound.file.v1",
      contentHash: contentHash as `0x${string}`,
      salt: salt as `0x${string}`,
      byteLength,
      storageKey,
    },
  ],
});

process.stdout.write(hashManifest(manifest));
