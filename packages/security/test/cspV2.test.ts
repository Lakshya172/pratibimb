/**
 * ADR-0013 — the amended extension_pages policy (v2). ADR-0001's v1 tests (`csp.test.ts`) stay as the
 * record of v1; these pin v2: everything closed by default, only the extension's own resource classes
 * named, and no way to widen it by argument.
 */
import { describe, expect, it } from "vitest";

import { CSP_POLICY_VERSION, CspConfigurationError, buildExtensionPagesCspV2, styleHashSource } from "../src/csp.js";

const HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";
const PRODUCT = { connect: ["http://127.0.0.1:8995/v1/chat/completions"], styleHashes: [HASH] };
const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));

describe("ADR-0013 policy v2", () => {
  it("is version 2 and exactly these directives, in order", () => {
    expect(CSP_POLICY_VERSION).toBe(2);
    expect(buildExtensionPagesCspV2(PRODUCT)).toBe(
      "default-src 'none'; " +
        "script-src 'self' 'wasm-unsafe-eval'; " +
        "worker-src 'self'; " +
        "connect-src 'self' http://127.0.0.1:8995/v1/chat/completions; " +
        `style-src ${HASH}; ` +
        "object-src 'none'; " +
        "base-uri 'none'; " +
        "form-action 'none'"
    );
  });

  it("closes img, frame, media, font, manifest and child by default-src 'none' (none of them is named)", () => {
    const d = directives(buildExtensionPagesCspV2(PRODUCT));
    expect(d["default-src"]).toEqual(["'none'"]);
    for (const closed of ["img-src", "frame-src", "child-src", "media-src", "font-src", "manifest-src", "prefetch-src"]) expect(d[closed], closed).toBeUndefined();
  });

  it("object/embed, <base> and form submission are closed explicitly", () => {
    const d = directives(buildExtensionPagesCspV2(PRODUCT));
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'none'"]);
    expect(d["form-action"]).toEqual(["'none'"]);
  });

  it("carries no permissive token anywhere", () => {
    const csp = buildExtensionPagesCspV2(PRODUCT);
    for (const bad of ["'unsafe-inline'", "'unsafe-hashes'", "'strict-dynamic'", "*", "data:", "blob:", "filesystem:", "https:", "http: "]) expect(csp.includes(bad), bad).toBe(false);
    expect(csp).not.toMatch(/(^|[^-])'unsafe-eval'/);
  });

  it("connect-src: 'self' plus exactly the sources given; none given means 'self' only", () => {
    expect(directives(buildExtensionPagesCspV2({ connect: [], styleHashes: [] }))["connect-src"]).toEqual(["'self'"]);
    expect(directives(buildExtensionPagesCspV2({ connect: ["http://127.0.0.1:8995"], styleHashes: [] }))["connect-src"]).toEqual(["'self'", "http://127.0.0.1:8995"]);
  });

  it("style-src: the given hashes, or 'none'", () => {
    expect(directives(buildExtensionPagesCspV2({ connect: [], styleHashes: [] }))["style-src"]).toEqual(["'none'"]);
  });

  it.each([
    ["a wildcard host", "http://*.example.com"],
    ["a bare wildcard", "*"],
    ["a trailing slash (a prefix match)", "http://127.0.0.1:8995/"],
    ["a path prefix", "http://127.0.0.1:8995/v1/"],
    ["a query", "http://127.0.0.1:8995/v1?x=1"],
    ["a fragment", "http://127.0.0.1:8995/v1#x"],
    ["a bare host", "127.0.0.1:8995"],
    ["a scheme only", "http://"],
    ["a scheme source", "https:"],
    ["data:", "data:"],
  ])("refuses a connect source that is %s", (_, bad) => {
    expect(() => buildExtensionPagesCspV2({ connect: [bad], styleHashes: [] })).toThrow(CspConfigurationError);
  });

  it.each([["'unsafe-inline'"], ["sha256-abc"], ["'sha384-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"], ["'self'"]])("refuses a style source %s", (bad) => {
    expect(() => buildExtensionPagesCspV2({ connect: [], styleHashes: [bad] })).toThrow(CspConfigurationError);
  });

  it("styleHashSource is the CSP hash of the exact text", async () => {
    expect(await styleHashSource("")).toBe(HASH);
    expect(await styleHashSource("a")).not.toBe(await styleHashSource("a\n"));
  });
});
