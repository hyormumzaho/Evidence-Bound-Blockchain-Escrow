import type { Config } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { ANVIL_CHAIN_ID, anvil, getRpcUrl } from "@/lib/chain/config";

function needsAddChain(err: unknown): boolean {
  const anyErr = err as { code?: number | string; message?: string; shortMessage?: string; cause?: { code?: number | string } };
  const code = anyErr.code ?? anyErr.cause?.code;
  const msg = `${anyErr.shortMessage ?? ""} ${anyErr.message ?? ""}`.toLowerCase();
  return code === 4902 || msg.includes("unrecognized chain") || msg.includes("not been added");
}

/** Switch MetaMask to Anvil 31337; add the chain when MetaMask returns 4902. */
export async function switchToAnvil(config: Config): Promise<void> {
  try {
    await switchChain(config, { chainId: ANVIL_CHAIN_ID });
    return;
  } catch (err) {
    if (!needsAddChain(err)) throw err;
  }

  const walletClient = await getWalletClient(config);
  if (!walletClient) {
    throw new Error("Wallet is disconnected.");
  }

  const rpcUrl = getRpcUrl();
  await walletClient.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: `0x${ANVIL_CHAIN_ID.toString(16)}`,
        chainName: anvil.name,
        nativeCurrency: anvil.nativeCurrency,
        rpcUrls: [rpcUrl],
      },
    ],
  });

  await switchChain(config, { chainId: ANVIL_CHAIN_ID });
}
