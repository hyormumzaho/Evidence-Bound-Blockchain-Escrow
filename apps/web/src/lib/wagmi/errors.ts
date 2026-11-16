/** Map wallet / RPC errors into short UI copy. */
export function formatWalletError(err: unknown): string {
  if (!err) return "Unknown wallet error";

  const anyErr = err as {
    code?: number | string;
    name?: string;
    shortMessage?: string;
    message?: string;
    cause?: { code?: number | string; message?: string };
  };

  const code = anyErr.code ?? anyErr.cause?.code;
  const message = (anyErr.shortMessage ?? anyErr.message ?? anyErr.cause?.message ?? "").toLowerCase();

  if (code === 4001 || code === "ACTION_REJECTED" || message.includes("user rejected") || message.includes("user denied")) {
    return "Request rejected in the wallet.";
  }
  if (code === 4902 || message.includes("unrecognized chain") || message.includes("chain has not been added")) {
    return "Anvil network is not in MetaMask yet. Try Switch to Anvil again to add it.";
  }
  if (message.includes("does not exist") && message.includes("metamask")) {
    return "MetaMask is not installed.";
  }
  if (message.includes("provider not found") || message.includes("no provider")) {
    return "No injected wallet found. Install MetaMask.";
  }
  if (message.includes("disconnected") || message.includes("not connected")) {
    return "Wallet is disconnected.";
  }
  if (message.includes("network") && message.includes("changed")) {
    return "Wallet network changed.";
  }
  if (message.includes("failed to fetch") || message.includes("http request failed") || message.includes("timeout")) {
    return "RPC unreachable. Is Anvil running on 127.0.0.1:8545?";
  }

  return anyErr.shortMessage ?? anyErr.message ?? "Wallet request failed.";
}

export function isMetaMaskInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const eth = (window as Window & { ethereum?: { isMetaMask?: boolean } }).ethereum;
  return Boolean(eth?.isMetaMask);
}
