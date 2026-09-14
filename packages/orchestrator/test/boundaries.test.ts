/**
 * What the orchestrator is not allowed to decide.
 *
 * It sequences authorities; it is not one. This file scans its own source, because "we would notice"
 * is not a control — and because we did not notice: an earlier revision of `machine.ts` carried its
 * own field classifier, a handful of regular expressions over accessible names, whose answer fed
 * `bind()`'s class check. Two classifiers that could disagree about what a field is, with the weaker
 * one deciding. It is gone, and this file is what keeps it gone.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });

/** Strip comments so a rule naming a forbidden token does not trip its own tripwire. */
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const FILES = sourceFiles(SRC);
const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, "/");
const ALL = FILES.map((f) => code(f)).join("\n");

describe("the scan is wired up", () => {
  it("finds the orchestrator sources", () => {
    expect(FILES.length).toBeGreaterThan(1);
    expect(FILES.some((f) => f.endsWith("machine.ts"))).toBe(true);
  });
});

describe("it decides nothing privacy decides", () => {
  it.each(["createVault", "new Vault(", "holdsLiteral", "checkLiteral", "parseToken", "TIER_OF", "verifyHandoff"])(
    "does not call %s itself",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token)).map(rel);
      expect(offenders, "privacy owns this; the orchestrator may only sequence it").toEqual([]);
    }
  );

  it("classifies no field of its own", () => {
    // The one regression this file exists for. What a field accepts is `classifyField`'s answer.
    expect(ALL).toContain("classifyField(");
    expect(ALL).not.toMatch(/accepts\s*:\s*"(PHONE|AADHAAR|DOB|NAME|OTP)"/);
    expect(ALL).not.toMatch(/\/.*(aadhaar|one\[-\s\]\?time|mobile\|phone).*\/[gimsuy]*\.test\(/i);
  });

  it("reaches a value only through rehydrate", () => {
    // `rehydrate` is the single path from a reference to a secret. Nothing else here may produce one.
    expect(ALL).toContain("rehydrate(");
    expect(ALL).not.toContain("REVEAL");
  });
});

describe("it dispatches nothing", () => {
  it.each([".click(", "dispatchEvent", "elementFromPoint", "document.querySelector", "mintDispatchPermit"])(
    "does not contain %s",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token)).map(rel);
      expect(offenders, "guardedAct is the only executor, and it mints its own permit").toEqual([]);
    }
  );

  it("goes through guardedAct and nothing else", () => {
    expect(ALL).toContain("guardedAct(");
    expect(ALL).not.toMatch(/\bact\s*\(/);
  });
});

describe("it holds no lifetime of its own", () => {
  it("has no default TTL anywhere: every lifetime is supplied by the caller", () => {
    // A default would be a policy nobody decided. See docs/architecture/prototype-lifetimes.md.
    expect(ALL).not.toMatch(/(ttlMs|TtlMs)\s*(=|\?\?)\s*\d/);
    expect(ALL).not.toMatch(/DEFAULT_[A-Z_]*TTL/);
  });
});
