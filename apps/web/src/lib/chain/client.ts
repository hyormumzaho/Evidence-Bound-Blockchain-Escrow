import { createPublicClient, http } from "viem";
import { anvil, getRpcUrl } from "./config";

/** Read-only viem client for local Anvil. No private keys. */
export function createAnvilPublicClient(rpcUrl = getRpcUrl()) {
  return createPublicClient({
    chain: anvil,
    transport: http(rpcUrl, { timeout: 3_000 }),
  });
}

export type AnvilPublicClient = ReturnType<typeof createAnvilPublicClient>;
