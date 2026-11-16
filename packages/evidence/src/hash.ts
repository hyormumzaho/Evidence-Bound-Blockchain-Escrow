import { keccak256 } from "ethereum-cryptography/keccak.js";
import type { Hex } from "@evidencebound/shared";
import { toHex } from "./hex.js";

export function keccak256Bytes(data: Uint8Array): Hex {
  return toHex(keccak256(data));
}

export function keccak256Utf8(text: string): Hex {
  return keccak256Bytes(new TextEncoder().encode(text));
}
