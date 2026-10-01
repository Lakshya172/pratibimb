/**
 * M12 — QG-04 ITEM 1, MADE DURABLE: no network primitive outside the egress authority.
 *
 * QG-04: "The lint rule fails the build on `fetch`, `XMLHttpRequest`, `sendBeacon` or `WebSocket`
 * outside the egress module." This repository has no lint stage, so the rule is this test: every
 * product source file is read, and every network-capable primitive found must be on the list below,
 * at exactly the count recorded. A new call anywhere else fails. So does a listed call that
 * disappears, so the list cannot rot.
 *
 * THE ONLY EXCEPTIONS, and why each is not egress:
 *   EGRESS_AUTHORITY      `@pratibimb/egress` — the one module allowed to put bytes on the wire.
 *   PACKAGED_RESOURCE     reads of files inside the extension package (`resolvePackagedAsset`, i.e.
 *                         `chrome.runtime.getURL`): the UI-head model, the pinned ORT bundle.
 *   PINNED_LOADER         `@pratibimb/security`'s loaders: fetch a packaged artifact and refuse it
 *                         unless its SHA-256 and length equal the pin. Their URL comes from the
 *                         caller's `resolveAssetUrl`, which is `resolvePackagedAsset` in every caller.
 *   TEST_BUILD_ONLY       `probe/` files that `wxt.config.ts` resolves only when an evidence flag
 *                         is set; a product build gets their `-absent` stubs, which must be clean.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Line-leading comments removed: a sentence ABOUT `fetch` is not a call. Trailing comments stay (fail-safe). */
const code = (p: string) => read(p).replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*\*.*$/gm, "");
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = `${dir}/${f}`;
    if (["node_modules", ".output", ".wxt", "dist", "test"].includes(f)) return [];
    return statSync(join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|mts|mjs|js)$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
  });

const PRODUCT_SOURCES = [
  ...["host", "host-lib", "entrypoints", "e6", "probe"].flatMap((d) => walk(`apps/extension/${d}`)),
  ...readdirSync(join(ROOT, "packages")).flatMap((p) => walk(`packages/${p}/src`)),
  ...walk("apps/demo/src"),
];

/** Network-capable primitives. `typeof fetch` (a type) does not match; `x.fetch` and `fetch(` do. */
const PRIMITIVE = /\bfetch\s*\(|\.fetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b|\bimportScripts\b|\bfetchLater\b|\bRTCPeerConnection\b|\bconnectNative\b/g;

type Reason = "EGRESS_AUTHORITY" | "PACKAGED_RESOURCE" | "PINNED_LOADER" | "TEST_BUILD_ONLY";
/** file → the exact primitive matches allowed there, and why. A whole-file entry covers a test-build-only probe. */
const ALLOWED: Record<string, { readonly reason: Reason; readonly matches: readonly string[] } | { readonly reason: "TEST_BUILD_ONLY"; readonly wholeFile: true }> = {
  "packages/egress/src/guard.ts": { reason: "EGRESS_AUTHORITY", matches: ["fetch("] },
  "packages/egress/src/frame.ts": { reason: "EGRESS_AUTHORITY", matches: ["fetch("] },
  "apps/extension/host/offscreen/main.ts": { reason: "PACKAGED_RESOURCE", matches: ["fetch(", "fetch("] },
  "apps/extension/host/tr01-worker.ts": { reason: "PACKAGED_RESOURCE", matches: ["importScripts", "importScripts"] },
  "packages/security/src/modelPin.ts": { reason: "PINNED_LOADER", matches: [".fetch"] },
  "packages/security/src/ortRuntimePin.ts": { reason: "PINNED_LOADER", matches: [".fetch"] },
  "apps/extension/probe/egress-evidence.ts": { reason: "TEST_BUILD_ONLY", wholeFile: true },
  "apps/extension/probe/tr01.ts": { reason: "TEST_BUILD_ONLY", wholeFile: true },
  "apps/extension/probe/tr01-instrument.ts": { reason: "TEST_BUILD_ONLY", wholeFile: true },
};

const found = Object.fromEntries(PRODUCT_SOURCES.map((f) => [f, (code(f).match(PRIMITIVE) ?? []).map((m) => m.replace(/\s+/g, ""))]).filter(([, m]) => (m as string[]).length > 0)) as Record<string, string[]>;

describe("QG-04 item 1: no network primitive outside the egress authority", () => {
  it("scans the whole product source tree", () => {
    expect(PRODUCT_SOURCES.length).toBeGreaterThan(100);
    expect(PRODUCT_SOURCES).toContain("apps/extension/host/offscreen/main.ts");
    expect(PRODUCT_SOURCES).toContain("packages/egress/src/guard.ts");
  });

  it("every network primitive is on the list, in a listed file", () => {
    const unlisted = Object.keys(found).filter((f) => !(f in ALLOWED));
    expect(unlisted, `network primitive(s) outside the egress authority: ${unlisted.map((f) => `${f} → ${found[f]?.join(", ")}`).join("; ")}`).toEqual([]);
  });

  it.each(Object.entries(ALLOWED).filter(([, v]) => !("wholeFile" in v)))("%s holds exactly its listed calls", (file, allowed) => {
    expect(found[file] ?? [], file).toEqual("matches" in allowed ? [...allowed.matches] : []);
  });

  it("only @pratibimb/egress may fetch an address it was given", () => {
    const egress = Object.entries(ALLOWED).filter(([, v]) => v.reason === "EGRESS_AUTHORITY").map(([f]) => f);
    expect(egress.every((f) => f.startsWith("packages/egress/src/"))).toBe(true);
    for (const f of ["apps/extension/host/offscreen/main.ts"]) for (const line of code(f).split("\n").filter((l) => /\bfetch\s*\(/.test(l))) expect(line, f).toContain("fetch(resolvePackagedAsset(");
    expect(code("apps/extension/host/tr01-worker.ts")).toMatch(/importScripts\(resolvePackagedAsset\(ORT_PIN\.bundle\.name\)\)/);
    for (const caller of ["apps/extension/host/tr01-worker.ts"]) expect(code(caller)).toMatch(/loadVerifiedModel\(\{[^}]*resolveAssetUrl: resolvePackagedAsset/);
  });

  it("test-build-only probes are absent from a product build: every alias defaults to a clean stub", () => {
    const wxt = read("apps/extension/wxt.config.ts");
    for (const [alias, real, stub, flag] of [
      ["#egress-evidence-probe", "probe/egress-evidence.ts", "probe/egress-evidence-absent.ts", "EGRESS_EVIDENCE_PROBE"],
      ["#tr01-probe", "probe/tr01.ts", "probe/tr01-absent.ts", "TR01_PROBE"],
      ["#tr01-instrument", "probe/tr01-instrument.ts", "probe/tr01-instrument-absent.ts", "TR01_PROBE"],
    ] as const) {
      expect(wxt).toContain(`"${alias}": ${flag} ? "${real}" : "${stub}",`);
      expect(wxt).toContain(`const ${flag} = process.env.${flag} === "1";`);
      expect(code(`apps/extension/${stub}`).match(PRIMITIVE) ?? [], stub).toEqual([]);
    }
  });

  it("the product offscreen document no longer carries CSP_PROBE or E4_EMIT", () => {
    const main = code("apps/extension/host/offscreen/main.ts");
    expect(main).not.toMatch(/cspProbe|e4Emit|E4_COLLECTOR|host-csp-probe|"CSP_PROBE"|"E4_EMIT"/);
    expect(main).toContain('from "#egress-evidence-probe"');
  });
});
