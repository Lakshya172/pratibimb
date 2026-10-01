/**
 * Where this package stops.
 *
 * THREE DIFFERENT THINGS ARE CALLED "VALIDATION" IN THIS REPOSITORY, and conflating any two of them
 * would put one layer's authority inside another:
 *
 * 1. **`bind()` / `rehydrate()` — here.** Authority over *values*. "May this reference be turned back
 *    into a secret, into this field, on this origin, in this session, now?" It answers about a
 *    reference and a field. It knows nothing about actions, permits, points or clicks.
 * 2. **`validatePlan()` — the next section, and it does not exist yet.** Authority over *plan
 *    structure*. "Is this sequence of steps well formed, does every token in it exist, is every
 *    target one the current view actually has?" It must *call* `bind()` for the value question rather
 *    than re-deciding it, and it must never reimplement class, origin, session, grant or consumed
 *    checks. A second answer to "may this value be used" is a second privacy authority.
 * 3. **`guardedAct`'s VALIDATE stage — `@pratibimb/agent`, already built and unchanged.** Authority
 *    over *one live action*: freshness against the page, HIT-TEST, permit mint, dispatch, VERIFY
 *    RESULT. It remains the final and only click execution layer.
 *
 * This file pins the boundary structurally, because "we would notice" is not a control. It scans the
 * package's own source: the privacy layer may not reach into the execution layer, and it may not grow
 * a planner, a permit or a second reveal path.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

/** Strip comments so a rule naming a forbidden token does not trip its own tripwire. */
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const FILES = sourceFiles(SRC);
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, "/");

describe("the scan is wired up", () => {
  it("finds the privacy sources", () => {
    // A scan over an empty file list passes every rule below while proving nothing.
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.some((f) => f.endsWith("bind.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("vault.ts"))).toBe(true);
  });
});

describe("the privacy layer does not reach into the execution layer", () => {
  it.each(["@pratibimb/agent", "@pratibimb/extension-transport"])("no source file imports %s", (pkg) => {
    const offenders = FILES.filter((f) => code(f).includes(pkg)).map(rel);
    expect(offenders, `${pkg} must stay out of the privacy layer`).toEqual([]);
  });

  it("declares only the perception dependency, in any dependency field", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
    const declared = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].flatMap(
      (field) => Object.keys(pkg[field] ?? {})
    );
    expect([...new Set(declared)].sort()).toEqual(["@pratibimb/perception"]);
  });

  it.each(["guardedAct", "mintDispatchPermit", "DispatchPermit", "EXECUTABLE_ACTIONS", "hitTest"])(
    "does not name the execution authority %s",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token)).map(rel);
      expect(offenders, "clicking is guardedAct's authority, not this package's").toEqual([]);
    }
  );

  it("dispatches nothing: no click, no typing, no DOM writes", () => {
    for (const f of FILES) {
      const s = code(f);
      expect(s, rel(f)).not.toMatch(/\.click\s*\(/);
      expect(s, rel(f)).not.toMatch(/dispatchEvent|elementFromPoint|document\.querySelector/);
    }
  });
});

describe("the privacy layer does not grow a planner", () => {
  it.each(["validatePlan", "PlanStep", "planValidate", "executePlan"])("does not declare %s", (token) => {
    const offenders = FILES.filter((f) => code(f).includes(token)).map(rel);
    expect(offenders, "plan validation is the next section's, and must call bind() rather than replace it").toEqual([]);
  });
});

describe("there is one path from a reference to a value", () => {
  it("only bind.ts reaches the vault's reveal symbol", () => {
    const reachers = FILES.filter((f) => code(f).includes("REVEAL")).map(rel).sort();
    expect(reachers).toEqual(["bind.ts", "internal.ts", "vault.ts"]);
  });

  it("does not export the reveal symbol to callers", () => {
    expect(code(join(SRC, "index.ts"))).not.toContain("internal.js");
    expect(code(join(SRC, "index.ts"))).not.toContain("REVEAL");
  });

  it("exposes no vault method that returns a value", () => {
    const vault = code(join(SRC, "vault.ts"));
    // `holdsLiteral` answers with a class, `describe` with a descriptor, `toJSON` with counts.
    expect(vault).not.toMatch(/^\s*(get\s+)?(values|entries|refs|reveal|read|dump)\s*\(/m);
  });
});
