import { describe, expect, it } from "vitest";
import canonicalize from "canonicalize";
import { canonicalizeJson } from "../src/canonicalize.js";

describe("RFC 8785 canonicalize", () => {
  it("sorts object keys deterministically", () => {
    const a = canonicalizeJson({ b: 1, a: 2 });
    const b = canonicalizeJson({ a: 2, b: 1 });
    expect(a).toBe('{"a":2,"b":1}');
    expect(a).toBe(b);
  });

  it("matches the canonicalize package on nested structures", () => {
    const value = {
      1: { f: { f: "hi", F: 5 }, "\n": 56.0 },
      10: {},
      "": "empty",
      a: {},
      111: [{ e: "yes", E: "no" }],
      A: {},
    };
    expect(canonicalizeJson(value)).toBe(canonicalize(value));
  });

  it("is stable for URL-reference shaped objects", () => {
    expect(
      canonicalizeJson({
        url: "https://example.test/page",
        schema: "evidencebound.url-reference.v1",
      }),
    ).toBe('{"schema":"evidencebound.url-reference.v1","url":"https://example.test/page"}');
  });
});
