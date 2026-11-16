import { SiweMessage, generateNonce } from "siwe";
import { verifyMessage, getAddress, type Hex, type Address } from "viem";
import { eq, and, lt } from "drizzle-orm";
import type { AppDb } from "@/lib/db/client";
import { authNonces } from "@/lib/db/schema";
import { ANVIL_CHAIN_ID } from "@/lib/chain/config";

const NONCE_TTL_MS = 10 * 60 * 1000;

export function getSiweDomain(): string {
  return process.env.SIWE_DOMAIN ?? "localhost";
}

export function getSiweUri(): string {
  return process.env.SIWE_URI ?? "http://localhost:3000";
}

export function getSiweStatement(): string {
  return process.env.SIWE_STATEMENT ?? "EvidenceBound Escrow local file access";
}

export async function issueNonce(db: AppDb, addressRaw: string): Promise<{
  address: Address;
  nonce: string;
  expiresAt: number;
  message: string;
}> {
  const address = getAddress(addressRaw);
  const nonce = generateNonce();
  const expiresAt = Date.now() + NONCE_TTL_MS;

  // drop expired nonces for this address
  db.delete(authNonces).where(and(eq(authNonces.address, address.toLowerCase()), lt(authNonces.expiresAt, Date.now()))).run();

  db.insert(authNonces)
    .values({ address: address.toLowerCase(), nonce, expiresAt })
    .run();

  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(expiresAt).toISOString();
  const siwe = new SiweMessage({
    domain: getSiweDomain(),
    address,
    statement: getSiweStatement(),
    uri: getSiweUri(),
    version: "1",
    chainId: ANVIL_CHAIN_ID,
    nonce,
    issuedAt,
    expirationTime,
  });

  return { address, nonce, expiresAt, message: siwe.prepareMessage() };
}

export async function verifySiweSignature(
  db: AppDb,
  message: string,
  signature: Hex,
): Promise<{ address: Address }> {
  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    throw new Error("Invalid SIWE message");
  }

  if (siwe.chainId !== ANVIL_CHAIN_ID) {
    throw new Error(`SIWE chainId must be ${ANVIL_CHAIN_ID}`);
  }
  if (siwe.domain !== getSiweDomain()) {
    throw new Error("SIWE domain mismatch");
  }

  const address = getAddress(siwe.address);
  const row = db
    .select()
    .from(authNonces)
    .where(and(eq(authNonces.address, address.toLowerCase()), eq(authNonces.nonce, siwe.nonce)))
    .get();

  if (!row) {
    throw new Error("Unknown or reused nonce");
  }
  if (row.expiresAt < Date.now()) {
    db.delete(authNonces)
      .where(and(eq(authNonces.address, address.toLowerCase()), eq(authNonces.nonce, siwe.nonce)))
      .run();
    throw new Error("Nonce expired");
  }

  if (siwe.expirationTime && Date.parse(siwe.expirationTime) < Date.now()) {
    throw new Error("SIWE message expired");
  }

  const valid = await verifyMessage({
    address,
    message,
    signature,
  });
  if (!valid) {
    throw new Error("Invalid SIWE signature");
  }

  db.delete(authNonces)
    .where(and(eq(authNonces.address, address.toLowerCase()), eq(authNonces.nonce, siwe.nonce)))
    .run();

  return { address };
}
