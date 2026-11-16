import { describe, it, expect, afterEach } from "vitest";
import { hashFileBytes } from "@evidencebound/evidence";
import { eq } from "drizzle-orm";
import {
  ANVIL_KEY_0,
  ANVIL_KEY_1,
  loginAs,
  makeTempWorkspace,
  privateKeyToAccount,
} from "./helpers";
import { createStagingEscrow, loadUploadForDownload, storeUpload } from "@/lib/uploads/service";
import { issueNonce, verifySiweSignature } from "@/lib/auth/siwe";
import { createSession, getSession } from "@/lib/auth/session";
import { sessions } from "@/lib/db/schema";
import { assertSafeStorageKey, resolveUploadPath } from "@/lib/storage/files";
import { MAX_FILE_BYTES } from "@/lib/storage/limits";
import type { Hex } from "viem";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

describe("Stage 3.4 uploads + SIWE", () => {
  const workspaces: Array<ReturnType<typeof makeTempWorkspace>> = [];

  afterEach(() => {
    while (workspaces.length) workspaces.pop()?.cleanup();
  });

  function ws() {
    const w = makeTempWorkspace();
    workspaces.push(w);
    return w;
  }

  it("uploads and downloads successfully for a participant", async () => {
    const { db, uploadDir } = ws();
    const { address } = await loginAs(db, ANVIL_KEY_0);
    const payer = address;
    const provider = privateKeyToAccount(ANVIL_KEY_1).address;

    const staging = createStagingEscrow(db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: CONTRACT,
      payer,
      provider,
      arbitrator: payer,
      creator: address,
    });

    const bytes = new TextEncoder().encode("Hello EvidenceBound Escrow");
    const expected = hashFileBytes(bytes);
    const stored = storeUpload(db, {
      escrowRowId: staging.id,
      uploader: address,
      bytes,
      expectedContentHash: expected,
      originalFilename: "note.txt",
      uploadDir,
    });

    expect(stored.contentHash).toBe(expected);
    expect(stored.storageKey).toMatch(/^[a-f0-9]{32}$/);

    const loaded = loadUploadForDownload(db, stored.storageKey, address, uploadDir);
    expect(new TextDecoder().decode(loaded.bytes)).toBe("Hello EvidenceBound Escrow");
    expect(loaded.contentHash).toBe(expected);
  });

  it("rejects invalid SIWE signature", async () => {
    const { db } = ws();
    const account = privateKeyToAccount(ANVIL_KEY_0);
    const other = privateKeyToAccount(ANVIL_KEY_1);
    const issued = await issueNonce(db, account.address);
    const badSig = await other.signMessage({ message: issued.message });
    await expect(verifySiweSignature(db, issued.message, badSig as Hex)).rejects.toThrow(/Invalid SIWE signature/);
  });

  it("rejects expired session", async () => {
    const { db } = ws();
    const { address } = await loginAs(db, ANVIL_KEY_0);
    const session = createSession(db, address);
    db.update(sessions).set({ expiresAt: Date.now() - 1 }).where(eq(sessions.id, session.id)).run();
    expect(getSession(db, session.id)).toBeNull();
  });

  it("rejects expired SIWE nonce", async () => {
    const { db } = ws();
    const account = privateKeyToAccount(ANVIL_KEY_0);
    const issued = await issueNonce(db, account.address);
    // force expire nonce row
    const { authNonces } = await import("@/lib/db/schema");
    db.update(authNonces)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(authNonces.nonce, issued.nonce))
      .run();
    const sig = await account.signMessage({ message: issued.message });
    await expect(verifySiweSignature(db, issued.message, sig as Hex)).rejects.toThrow(/Nonce expired/);
  });

  it("denies stranger download", async () => {
    const { db, uploadDir } = ws();
    const owner = await loginAs(db, ANVIL_KEY_0);
    const stranger = await loginAs(db, ANVIL_KEY_1);

    const staging = createStagingEscrow(db, {
      chainId: 31337,
      variant: "merkle",
      contractAddress: CONTRACT,
      payer: owner.address,
      provider: owner.address,
      arbitrator: owner.address,
      creator: owner.address,
    });

    const stored = storeUpload(db, {
      escrowRowId: staging.id,
      uploader: owner.address,
      bytes: new TextEncoder().encode("secret"),
      uploadDir,
    });

    expect(() => loadUploadForDownload(db, stored.storageKey, stranger.address, uploadDir)).toThrow(
      /Forbidden/,
    );
  });

  it("rejects path traversal storage keys", () => {
    expect(() => assertSafeStorageKey("../etc/passwd")).toThrow(/Invalid storage key/);
    expect(() => assertSafeStorageKey("aaaa/bbbb")).toThrow(/Invalid storage key/);
    expect(() => assertSafeStorageKey("..\\secret")).toThrow(/Invalid storage key/);
    expect(() => resolveUploadPath("../x", "/tmp/uploads")).toThrow();
  });

  it("rejects oversized files", async () => {
    const { db, uploadDir } = ws();
    const { address } = await loginAs(db, ANVIL_KEY_0);
    const staging = createStagingEscrow(db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: CONTRACT,
      payer: address,
      provider: address,
      arbitrator: address,
      creator: address,
    });

    const bytes = new Uint8Array(MAX_FILE_BYTES + 1);
    expect(() =>
      storeUpload(db, {
        escrowRowId: staging.id,
        uploader: address,
        bytes,
        uploadDir,
      }),
    ).toThrow(/exceeds/);
  });

  it("rejects content hash mismatch", async () => {
    const { db, uploadDir } = ws();
    const { address } = await loginAs(db, ANVIL_KEY_0);
    const staging = createStagingEscrow(db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: CONTRACT,
      payer: address,
      provider: address,
      arbitrator: address,
      creator: address,
    });

    const bytes = new TextEncoder().encode("actual");
    const wrong = hashFileBytes(new TextEncoder().encode("other"));
    expect(() =>
      storeUpload(db, {
        escrowRowId: staging.id,
        uploader: address,
        bytes,
        expectedContentHash: wrong,
        uploadDir,
      }),
    ).toThrow(/Content hash mismatch/);
  });

  it("rejects unauthenticated conceptual access (no session)", async () => {
    const { db, uploadDir } = ws();
    const owner = await loginAs(db, ANVIL_KEY_0);
    const staging = createStagingEscrow(db, {
      chainId: 31337,
      variant: "individual",
      contractAddress: CONTRACT,
      payer: owner.address,
      provider: owner.address,
      arbitrator: owner.address,
      creator: owner.address,
    });
    const stored = storeUpload(db, {
      escrowRowId: staging.id,
      uploader: owner.address,
      bytes: new TextEncoder().encode("x"),
      uploadDir,
    });
    // stranger address with no role
    const strangerAddr = privateKeyToAccount(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    ).address;
    expect(() => loadUploadForDownload(db, stored.storageKey, strangerAddr, uploadDir)).toThrow(/Forbidden/);
  });
});
