"use client";

import { http, createConfig, createStorage, cookieStorage, injected } from "wagmi";
import { anvil, getRpcUrl } from "@/lib/chain/config";
import { ANVIL_ROLES, anvilAccountConnector } from "@/lib/wagmi/anvil-accounts";

/** Local Anvil role accounts, plus MetaMask. No WalletConnect. */
export const wagmiConfig = createConfig({
  chains: [anvil],
  connectors: [
    ...ANVIL_ROLES.map((role) => anvilAccountConnector(role)),
    injected({
      target: "metaMask",
      shimDisconnect: true,
    }),
  ],
  transports: {
    [anvil.id]: http(getRpcUrl(), { timeout: 5_000 }),
  },
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
