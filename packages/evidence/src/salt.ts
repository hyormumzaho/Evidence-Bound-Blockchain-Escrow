import type { Hex } from "@evidencebound/shared";
import { toHex } from "./hex.js";

function getCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("Web Crypto API is required for randomSalt()");
  }
  return cryptoApi;
}

/** Fresh 32-byte salt from a CSPRNG (works in Node and browsers). */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  getCrypto().getRandomValues(bytes);
  return toHex(bytes);
}
