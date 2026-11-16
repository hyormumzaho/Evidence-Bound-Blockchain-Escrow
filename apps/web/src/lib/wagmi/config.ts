"use client";

import { http, createConfig, createStorage, cookieStorage, injected } from "wagmi";
import { anvil, getRpcUrl } from "@/lib/chain/config";

/** MetaMask (injected) only — local Anvil research UI. No WalletConnect. */
export const wagmiConfig = createConfig({
  chains: [anvil],
  connectors: [
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
