import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { createTestDb, type AppDb } from "@/lib/db/client";
import { issueNonce, verifySiweSignature } from "@/lib/auth/siwe";
import { createSession } from "@/lib/auth/session";
import type { Hex } from "viem";

export const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export function makeTempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "eb-web-"));
  const dbPath = join(root, "test.sqlite");
  const uploadDir = join(root, "uploads");
  const db = createTestDb(dbPath);
  return {
    root,
    dbPath,
    uploadDir,
    db,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}

export async function loginAs(db: AppDb, privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  process.env.SIWE_DOMAIN = "localhost";
  process.env.SIWE_URI = "http://localhost:3000";
  const issued = await issueNonce(db, account.address);
  const signature = await account.signMessage({ message: issued.message });
  const verified = await verifySiweSignature(db, issued.message, signature as Hex);
  const session = createSession(db, verified.address);
  return { account, session, address: verified.address };
}

export { privateKeyToAccount };
