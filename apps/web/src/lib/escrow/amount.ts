/** MockUSDC uses 6 decimals. Convert a human decimal string to base units. */
export function parseMockUsdcToBaseUnits(human: string): bigint {
  const trimmed = human.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error("Invalid MockUSDC amount");
  }
  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  if (fracRaw.length > 6) {
    throw new Error("MockUSDC supports at most 6 decimal places");
  }
  const whole = BigInt(wholeRaw);
  const frac = BigInt(fracRaw.padEnd(6, "0") || "0");
  const value = whole * 1_000_000n + frac;
  if (value <= 0n) {
    throw new Error("Amount must be greater than zero");
  }
  return value;
}

export function formatMockUsdc(baseUnits: bigint | number | string): string {
  const value = BigInt(baseUnits);
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const body = frac ? `${whole.toString()}.${frac}` : whole.toString();
  return neg ? `-${body}` : body;
}
