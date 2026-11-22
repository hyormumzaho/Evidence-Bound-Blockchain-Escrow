"use client";

import { createConnector, type CreateConnectorFn } from "wagmi";
import { getAddress, numberToHex, type Address, type Hex } from "viem";

/** Public Anvil defaults. The chain unlocks these accounts; this app does not store their keys. */
export const ANVIL_ROLES = [
  {
    id: "anvil-client",
    name: "Client",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
  },
  {
    id: "anvil-provider",
    name: "Provider",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address,
  },
  {
    id: "anvil-arbitrator",
    name: "Arbitrator",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address,
  },
] as const;

const ROLE_STORAGE_KEY = "eb-anvil-role";

function storedRole(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(ROLE_STORAGE_KEY);
}

export function anvilAccountConnector(role: (typeof ANVIL_ROLES)[number]): CreateConnectorFn {
  const account = getAddress(role.address);
  let connected = false;

  return createConnector((config) => ({
    id: role.id,
    name: role.name,
    type: "anvilAccount",
    async setup() {
      connected = storedRole() === role.id;
    },
    async connect() {
      connected = true;
      if (typeof window !== "undefined") window.sessionStorage.setItem(ROLE_STORAGE_KEY, role.id);
      const chainId = config.chains[0]?.id ?? 31337;
      config.emitter.emit("connect", { accounts: [account], chainId });
      return { accounts: [account] as const, chainId };
    },
    async disconnect() {
      connected = false;
      if (storedRole() === role.id && typeof window !== "undefined") {
        window.sessionStorage.removeItem(ROLE_STORAGE_KEY);
      }
    },
    async getAccounts() {
      return connected ? ([account] as const) : [];
    },
    async getChainId() {
      return config.chains[0]?.id ?? 31337;
    },
    async isAuthorized() {
      return connected || storedRole() === role.id;
    },
    async switchChain({ chainId }) {
      const chain = config.chains.find((item) => item.id === chainId);
      if (!chain) throw new Error(`Chain ${chainId} is not configured`);
      return chain;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
    async getProvider() {
      const url = config.chains[0]?.rpcUrls.default.http[0];
      if (!url) throw new Error("Anvil RPC URL is not configured");
      return {
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return numberToHex(config.chains[0]?.id ?? 31337);
          if (method === "wallet_switchEthereumChain") return null;
          let rpcMethod = method;
          let rpcParams = params;
          if (method === "personal_sign") {
            const [data, who] = (params ?? []) as [Hex, Address];
            rpcMethod = "eth_sign";
            rpcParams = [who, data];
          }
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: rpcMethod, params: rpcParams ?? [] }),
          });
          const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
          if (body.error) throw new Error(body.error.message ?? "Anvil RPC error");
          return body.result;
        },
      };
    },
  }));
}
