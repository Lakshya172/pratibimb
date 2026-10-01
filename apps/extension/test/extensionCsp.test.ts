/**
 * M13 Part D — the product/evidence distinction, machine-verifiable (ADR-0013).
 *
 * A product build's policy reaches exactly the reasoner endpoint; an evidence build's reaches the
 * collector origin (its test sink). Nothing else differs. The built manifests are checked against
 * the same rule by `tests/browser/extension/run-csp-negative.mjs`.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { extensionPagesCsp } from "../host-lib/extension-csp";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const BASE = { collectorOrigin: "http://127.0.0.1:8995", reasonerPath: "/v1/chat/completions", styleHashes: ["'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"] };
const connectOf = (csp: string) => /connect-src ([^;]*)/.exec(csp)?.[1];

describe("ADR-0013: product vs evidence policy", () => {
  const product = extensionPagesCsp({ ...BASE, build: "product" });
  const evidence = extensionPagesCsp({ ...BASE, build: "evidence" });

  it("the product reaches the reasoner endpoint exactly, and nothing else on the collector origin", () => {
    expect(connectOf(product)).toBe("'self' http://127.0.0.1:8995/v1/chat/completions");
    expect(product).not.toMatch(/http:\/\/127\.0\.0\.1:8995(;|\s)/);
  });

  it("the evidence build reaches the collector origin (its test sink)", () => {
    expect(connectOf(evidence)).toBe("'self' http://127.0.0.1:8995");
  });

  it("the two differ in that one connect-src source and in nothing else", () => {
    const strip = (c: string) => c.replace(/connect-src [^;]*/, "connect-src X");
    expect(strip(product)).toBe(strip(evidence));
    expect(product).not.toBe(evidence);
  });

  it("the build config chooses the evidence policy only when an evidence flag is set", () => {
    const cfg = readFileSync(join(ROOT, "apps/extension/wxt.config.ts"), "utf8");
    expect(cfg).toContain("const EVIDENCE_BUILD = E6_PROBE || STRUCTURAL_PROBE || TR01_PROBE || EGRESS_EVIDENCE_PROBE || WORKER_FRAME;");
    expect(cfg).toContain('build: EVIDENCE_BUILD ? "evidence" : "product"');
    // Each flag is an exact `=== "1"` test of its environment variable: unset means product.
    for (const flag of ["E6_PROBE", "STRUCTURAL_PROBE", "TR01_PROBE", "EGRESS_EVIDENCE_PROBE"]) expect(cfg).toMatch(new RegExp(`const ${flag} = process\\.env\\.${flag} === "1";`));
    expect(cfg).toMatch(/const WORKER_FRAME = process\.env\.M3_WORKER_FRAME === "1";/);
  });

  it("the side panel's style is admitted by hash, not by 'unsafe-inline'", () => {
    const cfg = readFileSync(join(ROOT, "apps/extension/wxt.config.ts"), "utf8");
    expect(cfg).toContain('readFileSync(join(HERE, "host", "sidepanel", "index.html"), "utf8").replace(/\\r\\n/g, "\\n")');
    expect(product).not.toContain("'unsafe-inline'");
  });
});
