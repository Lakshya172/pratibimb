/**
 * M12 Part R — PRODUCTION FRAME EGRESS IS IMPOSSIBLE, and stays so until each blocker is lifted by
 * its own decision. Three independent locks, each asserted here on the source itself:
 *
 *   1. NO VERIFIED: nothing can attest a frame as VERIFIED. The attested states are STRUCTURE_ONLY and
 *      MASK_VERIFIED; the verdict register that would admit a VERIFIED verdict has no writer.
 *   2. NO DESTINATION: the production configuration has no origin and no authentication, and is frozen.
 *   3. NO TRANSPORT: the production sender's module contains no network primitive at all.
 *
 * And the product graph cannot reach the frame senders: outside the test-build-only `probe/` files,
 * no product file imports a value from `@pratibimb/egress` except `sendVerified`, the structure-only
 * JSON sender. The built bundle's absence of these paths is measured by
 * `tests/browser/extension/run-qg04-interception.mjs` (phase A).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FRAME_EGRESS_STATE, PRODUCTION_HANDOFF_CONFIG } from "@pratibimb/egress";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (p: string) => read(p).replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (["node_modules", ".output", ".wxt", "dist", "test"].includes(f)) return [];
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|mts|mjs|js)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });
const SOURCES = [
  ...["host", "host-lib", "entrypoints", "e6", "probe"].flatMap((d) => walk(`apps/extension/${d}`)),
  ...readdirSync(join(ROOT, "packages")).flatMap((p) => walk(`packages/${p}/src`)),
  ...walk("apps/demo/src"),
];
const TEST_BUILD_ONLY = new Set(["apps/extension/probe/tr01.ts", "apps/extension/probe/egress-evidence.ts"]);

describe("M12 Part R: no reachable production frame send path", () => {
  it("lock 1 — nothing can attest VERIFIED, and nothing admits a VERIFIED verdict", () => {
    const qg04 = code("packages/egress/src/qg04.ts");
    expect(qg04).toMatch(/export type AttestedState = "STRUCTURE_ONLY" \| "MASK_VERIFIED";/);
    expect(FRAME_EGRESS_STATE).toBe("VERIFIED");
    // The register exists so the check is real; no source anywhere writes to it.
    expect(qg04).toMatch(/const ADMITTED_VERDICTS = new WeakSet<object>\(\);/);
    for (const f of SOURCES) expect(code(f), f).not.toMatch(/ADMITTED_VERDICTS\.add\s*\(/);
    // No product source assigns VERIFIED to a state. (The test-build-only probe forges verdicts on purpose, to be refused.)
    for (const f of SOURCES.filter((f) => !TEST_BUILD_ONLY.has(f))) expect(code(f), f).not.toMatch(/state\s*:\s*"VERIFIED"/);
  });

  it("lock 2 — the production configuration has no origin, no authentication, and cannot be changed", () => {
    expect(PRODUCTION_HANDOFF_CONFIG).toEqual({ origin: null, authentication: { state: "NOT_CONFIGURED" } });
    expect(Object.isFrozen(PRODUCTION_HANDOFF_CONFIG)).toBe(true);
    expect(() => {
      (PRODUCTION_HANDOFF_CONFIG as { origin: string | null }).origin = "https://anywhere.example";
    }).toThrow();
    expect(PRODUCTION_HANDOFF_CONFIG.origin).toBeNull();
  });

  it("lock 3 — the production sender's module has no network primitive", () => {
    expect(code("packages/egress/src/qg04.ts")).not.toMatch(/\bfetch\s*\(|\.fetch\b|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
    expect(code("packages/egress/src/qg04.ts")).toMatch(/PRODUCTION_TRANSPORT_ABSENT/);
  });

  it("the product graph imports no frame sender: only `sendVerified` (structure JSON) leaves @pratibimb/egress as a value", () => {
    const valueImports: Record<string, string[]> = {};
    for (const f of SOURCES.filter((f) => !f.startsWith("packages/egress/") && !TEST_BUILD_ONLY.has(f))) {
      for (const m of code(f).matchAll(/import\s*\{([^}]*)\}\s*from\s*"@pratibimb\/egress"/g)) {
        const values = m[1]!.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type "));
        if (values.length) valueImports[f] = values;
      }
      expect(code(f), f).not.toMatch(/import\s*\*\s*as\s+\w+\s*from\s*"@pratibimb\/egress"|import\(\s*"@pratibimb\/egress"\s*\)/);
    }
    expect(valueImports).toEqual({ "packages/reasoner/src/localModel.ts": ["sendVerified"] });
  });
});
