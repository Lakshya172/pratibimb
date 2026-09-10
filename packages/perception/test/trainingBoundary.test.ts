/**
 * The training infrastructure must stay outside the shipped runtime.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS BOUNDARY EXISTS
 *
 * Training needs things the browser path must never have: a filesystem, a dataset, image
 * decoding, and — with PyTorch in the mix — an enormous native dependency. All of that
 * lives in `tools/`, which does not ship.
 *
 * The failure this prevents is gradual and reasonable-looking at every step. Someone needs
 * a preprocessing constant that already exists in the trainer, so they import it. Now the
 * shipped package depends on a module that reads files. Then something in that module
 * needs a URL. Nothing in the G5 source scan fires, because the offending code is not in
 * `packages/`, and the perception tier has quietly acquired a filesystem and a network.
 *
 * So the rule is directional and absolute: `tools/` may read from `packages/`, and
 * `packages/` may never read from `tools/`.
 *
 * The shared preprocessing constants are duplicated deliberately — the letterbox pad value
 * and class list exist in both `head.py` and `uiDetectorHead.ts`. That duplication is
 * guarded by the contract test below rather than removed by a shared import, because the
 * import is the thing that would breach the boundary.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAD_CONTRACT, UI_CLASSES } from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const PKGS = join(REPO, "packages");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") return [];
      return tsFiles(p);
    }
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

describe("packages never import from tools/", () => {
  it("no package source or test reaches into the training tree", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(PKGS)) {
      const s = readFileSync(f, "utf8");
      // Any import path that climbs out of packages/ and into tools/.
      if (/from\s+["'][^"']*\/tools\//.test(s) || /import\(["'][^"']*\/tools\//.test(s)) {
        offenders.push(f.replace(REPO, ""));
      }
    }
    expect(
      offenders,
      "packages/ must not depend on tools/. Training code has a filesystem and a native " +
        "dependency; the shipped perception path must have neither."
    ).toEqual([]);
  });

  it("no package source imports node:fs — the shipped tier reads no files", () => {
    // Tests legitimately read source for the G5 scans; src must not.
    const offenders: string[] = [];
    for (const f of tsFiles(join(PKGS))) {
      if (!f.includes(`${"src"}`)) continue;
      const s = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
      if (/from\s+["']node:(fs|path|child_process)["']/.test(s)) offenders.push(f.replace(REPO, ""));
    }
    expect(offenders).toEqual([]);
  });
});

describe("the trainer and the runtime agree on the contract", () => {
  const headPy = join(REPO, "tools", "detector", "head.py");

  it("the training head exists where the boundary expects it", () => {
    expect(existsSync(headPy)).toBe(true);
  });

  it("class list matches, in order", () => {
    // Order is load-bearing: the class index IS the output channel offset. A reordering
    // here would silently relabel every prediction the model makes.
    const py = readFileSync(headPy, "utf8");
    const m = /^CLASSES = \[(.*?)\]$/ms.exec(py);
    expect(m, "CLASSES not found in head.py").toBeTruthy();
    const pyClasses = [...m![1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    expect(pyClasses).toEqual([...UI_CLASSES]);
  });

  it("input size matches", () => {
    const py = readFileSync(headPy, "utf8");
    expect(py).toMatch(new RegExp(`^INPUT_SIZE = ${HEAD_CONTRACT.inputSize}$`, "m"));
  });

  it("letterbox pad value matches", () => {
    // Training and inference must pad identically, or the model meets a distribution at
    // inference it never saw in training - and nothing anywhere would report it.
    const py = readFileSync(headPy, "utf8");
    expect(py).toMatch(/^PAD_VALUE = 114\.0 \/ 255\.0$/m);
    expect(HEAD_CONTRACT.padValue).toBeCloseTo(114 / 255, 12);
  });

  it("the exported output width matches 4 + numClasses", () => {
    // The contract is [1, 4+C, A]. A is dynamic; the channel count is not.
    expect(HEAD_CONTRACT.outputLayout).toBe("[1, 4+C, A]");
    expect(UI_CLASSES.length).toBe(8);
  });
});
