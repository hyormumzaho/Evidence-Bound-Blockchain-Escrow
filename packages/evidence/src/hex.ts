import type { Hex } from "@evidencebound/shared";

export function toHex(bytes: Uint8Array): Hex {
  let out = "0x";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out as Hex;
}

export function fromHex(hex: string): Uint8Array {
  const normalized = normalizeHex(hex);
  const body = normalized.slice(2);
  if (body.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${hex}`);
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function normalizeHex(value: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`Expected 0x-prefixed hex, got: ${String(value)}`);
  }
  if (value.length === 2) {
    return "0x" as Hex;
  }
  return `0x${value.slice(2).toLowerCase()}` as Hex;
}

export function assertBytes32(value: string, label = "bytes32"): Hex {
  const hex = normalizeHex(value);
  if (hex.length !== 66) {
    throw new Error(`${label} must be 32 bytes, got ${hex}`);
  }
  return hex;
}

export function assertAddress(value: string, label = "address"): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} must be a 20-byte 0x address, got: ${String(value)}`);
  }
  return value.toLowerCase();
}

export function decimalString(value: bigint | number | string, label: string): string {
  if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error(`${label} must be an unsigned decimal string, got: ${value}`);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${label} must be a non-negative integer, got: ${value}`);
    }
    return String(value);
  }
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
  return value.toString(10);
}

export function parseDecimalToBigInt(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an unsigned decimal string, got: ${value}`);
  }
  return BigInt(value);
}

export function parseDecimalToNumber(value: string, label: string, max: number): number {
  const n = parseDecimalToBigInt(value, label);
  if (n > BigInt(max)) {
    throw new Error(`${label} exceeds maximum ${max}`);
  }
  return Number(n);
}
