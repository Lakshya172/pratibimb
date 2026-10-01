/**
 * WHAT CHECKS THIS EXTENSION'S SOURCE — now a closed gap rather than an open one.
 *
 * M6 recorded the finding: `apps/extension` had no `tsconfig.json` and was absent from the root
 * project references, so `npm run typecheck` checked none of it and a type error in an extension
 * entrypoint was caught by nothing. A probe measured the gap at **81 errors, every one of them a
 * missing `chrome` name or namespace** and none of any other kind.
 *
 * M6.1 closed it **without adding a dependency**. `@wxt-dev/browser` already ships the WebExtension
 * API surface as `export namespace Browser`, and WXT is in the frozen stack, so it is already
 * installed; `types/wxt-globals.d.ts` gives that surface the global name the source uses and
 * declares WXT's two entrypoint wrappers from their published module paths. Nothing in the
 * typecheck depends on `apps/extension/.wxt/`, which is git-ignored and would have made a fresh
 * clone fail until something ran `wxt prepare`.
 *
 * WHAT IT FOUND IMMEDIATELY, which is the argument for having done it:
 *
 *   - `sidepanel/main.ts` declared `const status`, colliding with `window.status` (a DOM global of
 *     type `string`). The file had been typed against the wrong `status` for its whole life.
 *   - `offscreen/main.ts` passed `body: undefined` to `fetch`, which `exactOptionalPropertyTypes`
 *     forbids.
 *   - Four test fixtures had drifted from the types they claim: a `PerceptionSummary` missing the
 *     three fields M3.1 and M4 added, and an `ElementNode` missing `parent` and `children`.
 *
 * | check                    | covers                                                          |
 * |--------------------------|-----------------------------------------------------------------|
 * | `npm run typecheck`      | **TYPES of every file under `host-lib/`, `host/`, `e6/`, `entrypoints/`, `test/`** |
 * | `npm test` (Vitest)      | runtime behaviour — only files a test IMPORTS                   |
 * | `npm run build` (WXT)    | that everything an entrypoint reaches actually bundles          |
 *
 * So the remaining boundary is about RUNTIME coverage, not types: some files are exercised by a
 * test and some are only ever run in a browser. This file keeps that distinction explicit, so a new
 * file forces the decision instead of landing silently on the unexercised side.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const EXTENSION = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const ROOT = join(EXTENSION, "..", "..");

/** Imported by a Vitest test, so its RUNTIME behaviour is exercised in the ordinary gate. */
const EXERCISED_BY_TESTS = [
  "e6/absent.ts",
  "host-lib/boundary-protocol.ts",
  "host-lib/capture-authority.ts",
  "host-lib/extension-csp.ts",
  "host-lib/page-privacy-boundary.ts",
  "host-lib/perception-realm.ts",
  "host-lib/remote-privacy-boundary.ts",
  "host-lib/text-perception.ts",
  "host-lib/tr01-host.ts",
  "host-lib/tr01-pin.ts",
  "host-lib/tr01-protocol.ts",
  "host-lib/tr01-worker-core.ts",
  "host-lib/value-release.ts",
  "host-lib/visual-redaction.ts",
];

/**
 * Type-checked like everything else, but only ever RUN in a browser.
 *
 * Every entry either touches a `chrome.*` API, a WXT global or the live DOM, so exercising it in
 * Node would mean faking the browser rather than testing the file. What covers them instead is the
 * browser harnesses under `tests/browser/extension/`, which run the real thing.
 */
const EXERCISED_ONLY_IN_A_BROWSER = [
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
  // M10.4: the TR-01 worker entry — ORT, the packaged model and a real worker scope. Its logic is
  // `tr01-worker-core.ts` (tested); this glue runs in `run-tr01-worker.mjs`.
  "host/tr01-worker.ts",
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

describe("the extension is type-checked, and its runtime coverage is explicit", () => {
  it("apps/extension is in the typecheck command, and its tsconfig needs no generated directory", () => {
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
    expect(pkg, "the typecheck script must actually reach this package").toMatch(/apps\/extension\/tsconfig\.json/);

    const config = readFileSync(join(EXTENSION, "tsconfig.json"), "utf8");
    // `.wxt/` is git-ignored. A typecheck that included it would pass here and fail on a clone.
    expect(config, "the typecheck must not depend on a git-ignored generated directory").not.toMatch(/\.wxt/);
  });

  it("the chrome global is declared from an installed package, not from a new dependency", () => {
    const globals = readFileSync(join(EXTENSION, "types/wxt-globals.d.ts"), "utf8");
    expect(globals).toMatch(/@wxt-dev\/browser/);

    // If this ever fails, someone added @types/chrome — which is an ADR decision under AGENTS.md
    // §4.6, not a convenience. Record the decision rather than deleting the assertion.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(declared)).not.toContain("@types/chrome");
  });

  it("every source file is on exactly one runtime-coverage list, so a new file forces the decision", () => {
    const declared = new Set([...EXERCISED_BY_TESTS, ...EXERCISED_ONLY_IN_A_BROWSER]);
    const undeclared = ALL.filter((f) => !declared.has(f));
    expect(
      undeclared,
      "a new extension source file must be added to EXERCISED_BY_TESTS (import it from a test) or to " +
        "EXERCISED_ONLY_IN_A_BROWSER (accepting that only a browser harness runs it). Its TYPES are " +
        "checked either way; this list is about whether anything RUNS it."
    ).toEqual([]);

    expect([...declared].filter((f) => !ALL.includes(f)), "listed but no longer present").toEqual([]);
    expect(EXERCISED_BY_TESTS.filter((f) => EXERCISED_ONLY_IN_A_BROWSER.includes(f))).toEqual([]);
  });

  it("the files claimed to be exercised by a test really are imported by one", () => {
    const tests = readdirSync(join(EXTENSION, "test"))
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(EXTENSION, "test", f), "utf8"))
      .join("\n");
    const missing = EXERCISED_BY_TESTS.filter((f) => !tests.includes(`../${f.replace(/\.ts$/, "")}`));
    expect(missing, "listed as test-exercised but no test imports it").toEqual([]);
  });

  it("the structural signal's browser adapter is browser-only, and a harness covers it", () => {
    // `page-surface-dom.ts` holds the only MutationObserver and ResizeObserver in the product. It
    // cannot be exercised in Node without faking both, so the thing that covers it is a real
    // browser run — which is why `run-structural-stale.mjs` exists rather than a unit test.
    expect(EXERCISED_ONLY_IN_A_BROWSER).toContain("host-lib/page-surface-dom.ts");
    const source = readFileSync(join(EXTENSION, "host-lib/page-surface-dom.ts"), "utf8");
    expect(source).toMatch(/new MutationObserver/);
    expect(source).toMatch(/new ResizeObserver/);
    const harness = readFileSync(join(ROOT, "tests/browser/extension/run-structural-stale.mjs"), "utf8");
    expect(harness).toMatch(/TRACKED_RESIZE/);
  });
});
