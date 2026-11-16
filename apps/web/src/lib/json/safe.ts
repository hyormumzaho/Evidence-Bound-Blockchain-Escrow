/**
 * Recursively convert bigint → decimal string for JSON responses.
 * Do not use Number() — monetary / deadline values can exceed safe integer range.
 */
export function jsonSafe<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = walk(nested);
    }
    return out;
  }
  return value;
}

/** Assert a value is JSON-serializable (throws the same TypeError as JSON.stringify on bigint). */
export function assertJsonSerializable(value: unknown): string {
  return JSON.stringify(value);
}
