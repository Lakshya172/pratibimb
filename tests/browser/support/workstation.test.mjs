/**
 * The provenance resolver, tested for the failure it exists to prevent.
 *
 * The interesting cases are all refusals: an unknown machine, a contradicting environment, and a
 * write aimed at another workstation's file. A resolver that merely returns the right answer on a
 * known machine would not have caught the original defect, because the original defect returned
 * the right answer on W2 too.
 */
import { describe, expect, it } from "vitest";

import {
  WORKSTATIONS,
  WorkstationError,
  assertOwnEvidencePath,
  evidenceFileName,
  filePrefix,
  provenanceOf,
  resolveWorkstation,
} from "./workstation.mjs";

const W1 = "LAPTOP-6E14K34L";
const W2 = "LAPTOP-SRCINK2B";

describe("resolveWorkstation", () => {
  it("names the machine from the registry, not from a literal", () => {
    expect(resolveWorkstation({ env: {}, host: W1 })).toEqual({
      id: "W1",
      host: W1,
      source: "registry",
    });
    expect(resolveWorkstation({ env: {}, host: W2 }).id).toBe("W2");
  });

  it("refuses an unknown machine rather than defaulting", () => {
    expect(() => resolveWorkstation({ env: {}, host: "SOME-CI-RUNNER" })).toThrow(WorkstationError);
    // The message has to say what to do, or the next person hardcodes a string again.
    expect(() => resolveWorkstation({ env: {}, host: "SOME-CI-RUNNER" })).toThrow(
      /PRATIBIMB_WORKSTATION/
    );
  });

  it("lets an unregistered machine declare itself explicitly", () => {
    expect(resolveWorkstation({ env: { PRATIBIMB_WORKSTATION: "W3" }, host: "NEW-BOX" })).toEqual({
      id: "W3",
      host: "NEW-BOX",
      source: "environment",
    });
  });

  it("treats a contradicting environment as a conflict, never an override", () => {
    expect(() =>
      resolveWorkstation({ env: { PRATIBIMB_WORKSTATION: "W2" }, host: W1 })
    ).toThrow(/contradicts this machine/);
  });

  it("accepts an environment value that agrees with the registry", () => {
    expect(resolveWorkstation({ env: { PRATIBIMB_WORKSTATION: "W1" }, host: W1 }).id).toBe("W1");
  });

  it("rejects a malformed id", () => {
    for (const bad of ["w1", "W-1", "workstation1", "W0", "1"]) {
      expect(() => resolveWorkstation({ env: { PRATIBIMB_WORKSTATION: bad }, host: "NEW-BOX" }))
        .toThrow(WorkstationError);
    }
  });

  it("keeps the registry aligned with what the handoff documents record", () => {
    expect(WORKSTATIONS[W1]).toBe("W1");
    expect(WORKSTATIONS[W2]).toBe("W2");
  });
});

describe("evidenceFileName", () => {
  const w1 = { id: "W1", host: W1, source: "registry" };
  const w2 = { id: "W2", host: W2, source: "registry" };

  it("prefixes with the machine, so two workstations coexist in one directory", () => {
    expect(evidenceFileName(w1, "cft153-sih-rehearsal.json")).toBe("w1-cft153-sih-rehearsal.json");
    expect(evidenceFileName(w2, "cft153-sih-rehearsal.json")).toBe("w2-cft153-sih-rehearsal.json");
  });

  it("refuses a slug that already carries a prefix", () => {
    expect(() => evidenceFileName(w1, "w2-cft153-sih-rehearsal.json")).toThrow(WorkstationError);
  });

  it("refuses a slug that is a path", () => {
    expect(() => evidenceFileName(w1, "logs/x.json")).toThrow(WorkstationError);
    expect(() => evidenceFileName(w1, "")).toThrow(WorkstationError);
  });

  it("filePrefix lowercases the id", () => {
    expect(filePrefix(w1)).toBe("w1");
  });
});

describe("assertOwnEvidencePath", () => {
  const w1 = { id: "W1", host: W1, source: "registry" };

  it("refuses to overwrite another workstation's evidence", () => {
    expect(() =>
      assertOwnEvidencePath("artifacts/x/logs/w2-cft153-sih-rehearsal.json", w1)
    ).toThrow(/belongs to W2/);
  });

  it("allows this workstation's own file through unchanged", () => {
    const p = "artifacts/x/logs/w1-cft153-sih-rehearsal.json";
    expect(assertOwnEvidencePath(p, w1)).toBe(p);
  });

  it("allows an unprefixed filename", () => {
    const p = "artifacts/x/logs/metrics.json";
    expect(assertOwnEvidencePath(p, w1)).toBe(p);
  });

  it("works on Windows separators too", () => {
    expect(() => assertOwnEvidencePath("D:\\PratiBimb\\logs\\w2-x.json", w1)).toThrow(
      /belongs to W2/
    );
  });
});

describe("provenanceOf", () => {
  it("records how the machine was identified, not just what it claims to be", () => {
    expect(provenanceOf({ id: "W1", host: W1, source: "registry" })).toEqual({
      workstation: "W1",
      host: W1,
      workstationSource: "registry",
    });
  });
});
