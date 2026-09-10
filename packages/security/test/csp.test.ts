/**
 * ADR-0001 §7.1 / §7.2 — the approved CSP, and the ways it must refuse to be widened.
 *
 * This is the policy that also carries Invariant E mechanism (3), so every test here is
 * about the policy refusing to become more permissive than the ADR approved.
 */
import { describe, it, expect } from "vitest";
import { buildExtensionPagesCsp, assertApprovedCsp, CspConfigurationError } from "../src/csp.js";

const ORIGIN = "https://api.pratibimb.example";

describe("the approved policy", () => {
  it("is exactly the three ADR-0001 directives, in order", () => {
    expect(buildExtensionPagesCsp(ORIGIN)).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; " +
        "object-src 'self'; " +
        `connect-src 'self' ${ORIGIN}`
    );
  });

  it("declares 'wasm-unsafe-eval' and NOT 'unsafe-eval'", () => {
    const csp = buildExtensionPagesCsp(ORIGIN);
    expect(csp).toContain("'wasm-unsafe-eval'");
    // 'unsafe-eval' would widen JavaScript execution and breach INV-15/INV-16. The two
    // tokens differ by a prefix, so this asserts on the surrounding characters.
    expect(csp).not.toMatch(/(^|[^-])'unsafe-eval'/);
  });

  it("pins connect-src rather than leaving it absent", () => {
    // An absent connect-src inherits default-src / falls open for permitted hosts, which
    // is exactly what S-02a-2a-4's unpinned control showed reaching a foreign origin.
    expect(buildExtensionPagesCsp(ORIGIN)).toContain(`connect-src 'self' ${ORIGIN}`);
  });

  it("accepts a loopback origin with a port", () => {
    expect(buildExtensionPagesCsp("http://127.0.0.1:8000")).toContain(
      "connect-src 'self' http://127.0.0.1:8000"
    );
  });
});

describe("refuses to be widened", () => {
  for (const bad of [
    ["a wildcard host", "https://*.example.com"],
    ["a bare wildcard", "*"],
    ["a scheme wildcard", "https://*"],
  ] as const) {
    it(`rejects ${bad[0]}`, () => {
      expect(() => buildExtensionPagesCsp(bad[1])).toThrow(CspConfigurationError);
    });
  }

  for (const bad of [
    ["a path", "https://api.example.com/v1"],
    ["a trailing slash", "https://api.example.com/"],
    ["a scheme only", "https://"],
    ["a bare host", "api.example.com"],
    ["an empty string", ""],
    ["whitespace", "   "],
  ] as const) {
    it(`rejects ${bad[0]}`, () => {
      expect(() => buildExtensionPagesCsp(bad[1])).toThrow(CspConfigurationError);
    });
  }

  it("has no permissive mode — the origin is required", () => {
    expect(() => buildExtensionPagesCsp(undefined as unknown as string)).toThrow(
      CspConfigurationError
    );
  });
});

describe("drift detection", () => {
  it("accepts the policy it generated", () => {
    expect(() => assertApprovedCsp(buildExtensionPagesCsp(ORIGIN), ORIGIN)).not.toThrow();
  });

  it("rejects a hand-edited manifest that adds a source", () => {
    const widened = buildExtensionPagesCsp(ORIGIN) + " https://cdn.example.com";
    expect(() => assertApprovedCsp(widened, ORIGIN)).toThrow(CspConfigurationError);
  });

  it("rejects a policy for a different origin", () => {
    expect(() =>
      assertApprovedCsp(buildExtensionPagesCsp("https://evil.example"), ORIGIN)
    ).toThrow(CspConfigurationError);
  });

  it("rejects a policy that drops connect-src entirely", () => {
    expect(() =>
      assertApprovedCsp("script-src 'self' 'wasm-unsafe-eval'; object-src 'self'", ORIGIN)
    ).toThrow(CspConfigurationError);
  });
});
