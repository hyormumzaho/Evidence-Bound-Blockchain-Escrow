import canonicalizeImport from "canonicalize";

type CanonicalizeFn = (value: unknown) => string | undefined;

function resolveCanonicalize(): CanonicalizeFn {
  if (typeof canonicalizeImport === "function") {
    return canonicalizeImport as CanonicalizeFn;
  }
  const nested = canonicalizeImport as { default?: CanonicalizeFn };
  if (typeof nested.default === "function") {
    return nested.default;
  }
  throw new Error("canonicalize module did not export a function");
}

const canonicalize = resolveCanonicalize();

/**
 * RFC 8785 JSON Canonicalization Scheme over a JSON value.
 * Returns the canonical UTF-8 string (not bytes).
 */
export function canonicalizeJson(value: unknown): string {
  const out = canonicalize(value);
  if (typeof out !== "string") {
    throw new Error("canonicalize returned a non-string result (circular or unsupported value)");
  }
  return out;
}
