import { defineChain } from "viem";

/** Local Anvil — Phase 1/3 research target. */
export const ANVIL_CHAIN_ID = 31337;

export const anvil = defineChain({
  id: ANVIL_CHAIN_ID,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545"] },
  },
});

export function getRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
}

export function getConfiguredChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
  if (!raw) return ANVIL_CHAIN_ID;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid NEXT_PUBLIC_CHAIN_ID: ${raw}`);
  }
  return n;
}
