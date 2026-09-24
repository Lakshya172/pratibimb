/**
 * WHAT CHECKS THIS EXTENSION'S SOURCE, AND WHAT DOES NOT — stated, so it is a decision rather than
 * an accident.
 *
 * THE FINDING THIS FILE EXISTS FOR. `apps/extension` has no `tsconfig.json` and is not referenced by
 * the root `tsconfig.json`, so **`npm run typecheck` never type-checks a line of extension source**.
 * What checks it today:
 *
 *   | check                    | covers                                                        |
 *   |--------------------------|---------------------------------------------------------------|
 *   | `npm test` (Vitest)      | syntax AND runtime behaviour — but only files a test IMPORTS  |
 *   | `npm run build` (WXT)    | syntax of everything reachable from an entrypoint; TYPES: NO  |
 *   | `npm run typecheck`      | nothing under `apps/extension`                                |
 *
 * So a TYPE error in an extension entrypoint is caught by nothing, and a SYNTAX error in one is
 * caught only by the build. That is the boundary, and this file pins it.
 *
 * WHY IT IS NOT SIMPLY FIXED HERE. Adding the package to the typecheck graph needs `@types/chrome`:
 * measured on 2026-09-24, a probe tsconfig over `host-lib/`, `host/` and `e6/` reported **81 errors,
 * every one of them `Cannot find name 'chrome'` or `Cannot find namespace 'chrome'`**, and zero of
 * any other kind. Adding a dependency is an ADR decision (`AGENTS.md` §4.6), and WXT's own generated
 * types live under `.wxt/`, which is git-ignored — a typecheck depending on them would fail on a
 * fresh clone until something ran `wxt prepare`. Both are real decisions and neither belongs in a
 * milestone about the change signal.
 *
 * WHAT THIS FILE DOES INSTEAD. It makes the boundary explicit and enforced: every extension source
 * file must be on exactly one of two lists, so adding a file forces a decision about how it is
 * checked instead of silently landing in the gap.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EXTENSION = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/**
 * Reachable from a Vitest test, and therefore parsed and type-checked by the test run.
 *
 * A file here is imported — directly or transitively — by something in `apps/extension/test`, so a
 * syntax error in it fails `npm test`. This is the list to grow.
 */
const CHECKED_BY_TESTS = [
  "e6/absent.ts",
  "host-lib/boundary-protocol.ts",
  "host-lib/capture-authority.ts",
  "host-lib/page-privacy-boundary.ts",
  "host-lib/perception-realm.ts",
  "host-lib/remote-privacy-boundary.ts",
  "host-lib/text-perception.ts",
  "host-lib/value-release.ts",
];

/**
 * Reachable only from an extension entrypoint, and therefore checked ONLY by the WXT build.
 *
 * Syntax: caught by `npm run build`. Types: caught by nothing. Every entry is a file that touches a
 * `chrome.*` API or a WXT global, which is exactly why it cannot enter the typecheck graph without
 * the dependency decision described above — and exactly why it is worth listing rather than
 * forgetting.
 */
const CHECKED_ONLY_BY_THE_BUILD = [
  "e6/probe.ts",
  "entrypoints/ortRuntime.ts",
  "host-lib/extension-ports.ts",
  "host-lib/extension-run.ts",
  "host-lib/messages.ts",
  "host-lib/page-surface-dom.ts",
  "host-lib/transport-chrome.ts",
  "host-lib/transport-control-plane.ts",
  "host/background.ts",
  "host/content.ts",
  "host/offscreen/main.ts",
  "host/sidepanel/main.ts",
];

function sourceFiles(relative: string): string[] {
  const root = join(EXTENSION, relative);
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${entry}/`);
      else if (entry.endsWith(".ts")) out.push(`${relative}/${prefix}${entry}`);
    }
  };
  walk(root, "");
  return out;
}

const ALL = [...sourceFiles("e6"), ...sourceFiles("entrypoints"), ...sourceFiles("host-lib"), ...sourceFiles("host")].sort();

describe("the extension's test/typecheck boundary is explicit", () => {
  it("every source file is on exactly one list, so a new file forces the decision", () => {
    const declared = new Set([...CHECKED_BY_TESTS, ...CHECKED_ONLY_BY_THE_BUILD]);
    const undeclared = ALL.filter((f) => !declared.has(f));
    expect(
      undeclared,
      "a new extension source file must be added to CHECKED_BY_TESTS (import it from a test) or to " +
        "CHECKED_ONLY_BY_THE_BUILD (accepting that its TYPES are checked by nothing). Do not leave it off both."
    ).toEqual([]);

    const stale = [...declared].filter((f) => !ALL.includes(f));
    expect(stale, "these files are listed but no longer exist").toEqual([]);

    const onBoth = CHECKED_BY_TESTS.filter((f) => CHECKED_ONLY_BY_THE_BUILD.includes(f));
    expect(onBoth).toEqual([]);
  });

  it("the files claimed to be reachable from a test really are imported by one", () => {
    const tests = readdirSync(join(EXTENSION, "test"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(EXTENSION, "test", f), "utf8"))
      .join("\n");
    // Direct imports only — a transitive claim would need a resolver, and this list is short enough
    // that an entry nobody imports directly is a mistake worth catching.
    const missing = CHECKED_BY_TESTS.filter((f) => !tests.includes(`../${f.replace(/\.ts$/, "")}`));
    expect(missing, "listed as test-covered but no test imports it").toEqual([]);
  });

  it("apps/extension is genuinely absent from the typecheck graph, which is the fact being recorded", () => {
    // If this ever fails, the dependency decision was taken and this file's whole premise changed:
    // update the table at the top rather than deleting the assertion.
    const root = readFileSync(new URL("../../../tsconfig.json", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), "utf8");
    expect(root).not.toMatch(/apps\/extension/);
  });

  it("the structural signal's browser adapter is on the build-only list, and says so in the source", () => {
    // `page-surface-dom.ts` is where the only MutationObserver and ResizeObserver in the product
    // live. It touches DOM globals and no `chrome.*` API, but it is imported only by the content
    // script, so nothing type-checks it — which is worth knowing when reading it.
    expect(CHECKED_ONLY_BY_THE_BUILD).toContain("host-lib/page-surface-dom.ts");
    const source = readFileSync(join(EXTENSION, "host-lib/page-surface-dom.ts"), "utf8");
    expect(source).toMatch(/MutationObserver/);
    expect(source).toMatch(/ResizeObserver/);
  });
});
