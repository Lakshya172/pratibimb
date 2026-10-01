/**
 * THE PRODUCTION EXTENSION HAS EXACTLY ONE ROUTE TO A CLICK.
 *
 * M2-EXEC's report named the one thing left over: `E6_CLICK`, a full pointer/mouse sequence at any
 * selector with no permit, no hit test and no plan validation, reachable through the service
 * worker's test-only control plane. "No page can reach it" is an argument about reachability, and a
 * second execution path is a fact about capability. It is now outside the bundle.
 *
 * These tests are over the SOURCE the production bundle is built from. The built artifact is
 * scanned separately by `tests/browser/extension/run-extension-loop.mjs`, which has a real build to
 * look at — a source rule and a bundle rule catch different mistakes, and neither subsumes the
 * other: source can be right while the build graph pulls in something else, and a bundle can be
 * clean today because of an accident of tree-shaking.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { serveE6 } from "../e6/absent";

const APP = join(__dirname, "..");

/** Every TypeScript file the production content script and worker are built from. */
function productionSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) out.push({ path: full.slice(APP.length + 1).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(APP, "host"));
  walk(join(APP, "host-lib"));
  return out;
}

/** Code, not prose. Comments in this repository discuss these mechanisms at length. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("one executable click authority in production", () => {
  it("constructs a pointer sequence in exactly one file, and it is the transport's adapter", () => {
    const constructs = productionSources().filter((file) => /new (Pointer|Mouse)Event\s*\(/.test(withoutComments(file.text)));
    expect(constructs.map((f) => f.path)).toEqual(["host-lib/page-surface-dom.ts"]);
  });

  it("has no element-click, no synthetic typing and no execCommand anywhere in production source", () => {
    for (const file of productionSources()) {
      const code = withoutComments(file.text);
      // `el.click()` is E6 mechanism A, which goes straight through a transparent overlay — the
      // measurement that made the product dispatch at a POINT instead. It must not come back.
      expect(code, `${file.path} calls .click()`).not.toMatch(/\.click\s*\(\s*\)/);
      expect(code, `${file.path} uses execCommand`).not.toContain("execCommand");
      expect(code, `${file.path} uses setRangeText`).not.toContain("setRangeText");
      expect(code, `${file.path} reaches for the native value setter`).not.toMatch(/getOwnPropertyDescriptor\s*\(\s*HTMLInputElement/);
    }
  });

  it("defines no E6 EXECUTION message kind in production source", () => {
    for (const file of productionSources()) {
      const code = withoutComments(file.text);
      expect(code, `${file.path} names E6_CLICK`).not.toContain("E6_CLICK");
      expect(code, `${file.path} names E6_TYPE`).not.toContain("E6_TYPE");
    }
  });

  /**
   * WHAT DELIBERATELY REMAINS, and why it is not the same thing.
   *
   * `E6_ARM` and `E6_RELEASE` are still served by the worker's test-only control plane and the
   * offscreen stub. They are the VALUE-RELEASE experiment, not an execution path: they arm a
   * single-use nonce for one tab, frame and document and hand back a synthetic canary, and they
   * dispatch nothing at a page. That authority is the same one the product's own capability uses —
   * M1 kept one authority and one set of refusals deliberately — so removing it here would weaken
   * nonce semantics to close a click path that is already closed.
   *
   * What makes that safe to leave is the thing this test asserts: with `e6/probe.ts` outside the
   * bundle, no content script asks for `E6_RELEASE`, and nothing that receives one can act.
   */
  it("leaves the E6 value-release stub, which holds a synthetic canary and cannot act", () => {
    const worker = withoutComments(readFileSync(join(APP, "host", "background.ts"), "utf8"));
    const offscreen = withoutComments(readFileSync(join(APP, "host", "offscreen", "main.ts"), "utf8"));
    expect(worker).toContain("E6_ARM");
    expect(offscreen).toContain("E6_RELEASE");
    for (const code of [worker, offscreen]) {
      expect(code).not.toMatch(/new (Pointer|Mouse)Event\s*\(/);
      expect(code).not.toMatch(/\.click\s*\(\s*\)/);
      expect(code).not.toContain("dispatchEvent");
    }
    // Nothing in the bundle asks for a release any more: the only caller was E6's own probe.
    const content = withoutComments(readFileSync(join(APP, "host", "content.ts"), "utf8"));
    expect(content).not.toContain("E6_RELEASE");
  });

  it("the production seam contains no mechanism and declines every E6 message", () => {
    const replies: unknown[] = [];
    const push = (reply: unknown): void => void replies.push(reply);

    expect(serveE6({ kind: "E6_CLICK", mechanism: "B_point_pointer_sequence", selector: "#submit" }, push)).toBe(false);
    expect(serveE6({ kind: "E6_TYPE", mechanism: "A_native_setter_events", selector: "#otp", nonce: "n" }, push)).toBe(false);
    expect(serveE6({ kind: "MEASURE" }, push)).toBe(false);
    // Declining means it answered nothing at all: the caller's own UNKNOWN_KIND is the reply.
    expect(replies).toEqual([]);

    const source = withoutComments(readFileSync(join(APP, "e6", "absent.ts"), "utf8"));
    expect(source).not.toContain("dispatchEvent");
    expect(source).not.toContain("PointerEvent");
  });

  it("keeps E6's mechanisms out of the directory the bundle is built from", () => {
    // They still exist — `e6/probe.ts` is the code that produced E6's recorded numbers, and moving
    // it rather than deleting it is what keeps that record's provenance real. It just is not here.
    expect(productionSources().map((f) => f.path)).not.toContain("host-lib/e6-mechanisms.ts");
    const probe = readFileSync(join(APP, "e6", "probe.ts"), "utf8");
    expect(probe).toContain("B_point_pointer_sequence");
  });
});
