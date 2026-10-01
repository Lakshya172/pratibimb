/**
 * M9 — the fail-closed semantics ADR-0011 proposes, executed against the reference model. TEST-ONLY:
 * nothing in the product imports the model; the integration milestone must port these cases.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { failClosedMask, redactionMask } from "@pratibimb/privacy";
import {
  FINDING_KIND,
  READ_KEYS,
  TREATMENT,
  UNREAD_KEYS,
  mustRedact,
  parseFinding,
  planRedaction,
  unreadRegion,
} from "../../../artifacts/experiments/M9-adoption-review/contract/text-region-contract.mjs";

const canvas = { id: "canvas-1", rect: { x: 100, y: 100, w: 400, h: 200 } };
const region = (over = {}) => ({ kind: FINDING_KIND.unread, box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.9, regionId: "canvas-1", treatment: TREATMENT.redactUnread, ...over });

describe("UNREAD_REGION carries no text and no class", () => {
  it("has exactly the allowlisted fields — none can hold characters, a count, a class or a reference", () => {
    expect(UNREAD_KEYS).toEqual(["kind", "box", "score", "regionId", "treatment"]);
    for (const banned of ["text", "chars", "value", "transcript", "length", "piiClass", "ref"]) expect(UNREAD_KEYS).not.toContain(banned);
    expect(Object.keys(unreadRegion(region())).sort()).toEqual([...UNREAD_KEYS].sort());
  });

  it("is always redacted", () => {
    expect(mustRedact(unreadRegion(region()))).toBe(true);
    expect(mustRedact(unreadRegion(region({ score: 0.01 })))).toBe(true);
  });

  it("cannot be expressed as piiClass null or UNKNOWN — the parser refuses both", () => {
    expect(parseFinding(region({ piiClass: null }))).toEqual({ ok: false, code: "UNREAD_REGION_EXTRA_FIELD:piiClass" });
    expect(parseFinding(region({ piiClass: "UNKNOWN" }))).toEqual({ ok: false, code: "UNREAD_REGION_EXTRA_FIELD:piiClass" });
  });

  it("refuses a smuggled string under any name", () => {
    for (const k of ["text", "transcript", "value", "label"]) expect(parseFinding(region({ [k]: "7712" })).ok).toBe(false);
  });

  it("refuses non-finite or degenerate geometry, a missing region and a different treatment", () => {
    expect(parseFinding(region({ box: { x: NaN, y: 0, w: 1, h: 1 } })).ok).toBe(false);
    expect(parseFinding(region({ box: { x: 0, y: 0, w: 0, h: 1 } })).ok).toBe(false);
    expect(parseFinding(region({ regionId: "" })).ok).toBe(false);
    expect(parseFinding(region({ treatment: "ALLOW" })).ok).toBe(false);
  });
});

describe("READ_TEXT keeps the existing reader semantics, for a producer that reads (none is adopted)", () => {
  const read = (piiClass) => ({ kind: FINDING_KIND.read, box: { x: 0, y: 0, w: 10, h: 10 }, length: 4, piiClass, ref: null });

  it("still has no string field", () => {
    expect(READ_KEYS).not.toContain("text");
  });

  it("masks a sensitive class and leaves null or a PUBLIC class unmasked, as the classifier defines them", () => {
    expect(mustRedact(read("AADHAAR"))).toBe(true);
    expect(mustRedact(read("OTP"))).toBe(true);
    expect(mustRedact(read(null))).toBe(false);
    expect(mustRedact(read("UNKNOWN"))).toBe(false);
  });

  it("the UNKNOWN -> PUBLIC mapping it relies on is the privacy package's own", () => {
    const classes = readFileSync(new URL("../../../packages/privacy/src/classes.ts", import.meta.url), "utf8");
    expect(classes).toMatch(/UNKNOWN: "PUBLIC"/);
  });
});

describe("anything unrecognised is protective", () => {
  it("masks an object with no kind or an unknown kind", () => {
    expect(parseFinding({ box: { x: 0, y: 0, w: 1, h: 1 } })).toEqual({ ok: false, code: "MISSING_KIND" });
    expect(parseFinding({ kind: "SAFE_REGION" })).toEqual({ ok: false, code: "UNKNOWN_KIND" });
    expect(mustRedact({ kind: "SAFE_REGION" })).toBe(true);
    expect(mustRedact(undefined)).toBe(true);
  });
});

describe("planRedaction — canonical geometry, INV-23", () => {
  it("masks detected regions with redactionMask, clipped to their visual-only region", () => {
    const plan = planRedaction([canvas], { status: "OK", findings: [region()] });
    expect(plan.failClosed).toBe(false);
    expect(plan.masks["canvas-1"]).toEqual(redactionMask([{ x: 120, y: 120, w: 80, h: 20 }], canvas.rect));
  });

  it("masks every region whole on ERROR, TIMEOUT, UNAVAILABLE or no report", () => {
    for (const status of ["ERROR", "TIMEOUT", "UNAVAILABLE"]) {
      const plan = planRedaction([canvas], { status, findings: [] });
      expect(plan.failClosed).toBe(true);
      expect(plan.masks["canvas-1"]).toEqual(failClosedMask(canvas.rect));
    }
    expect(planRedaction([canvas], undefined).failClosed).toBe(true);
  });

  it("masks every region whole when any finding is malformed — one bad finding spoils the report", () => {
    const plan = planRedaction([canvas], { status: "OK", findings: [region(), region({ piiClass: null })] });
    expect(plan.failClosed).toBe(true);
    expect(plan.reason).toBe("MALFORMED:UNREAD_REGION_EXTRA_FIELD:piiClass");
  });

  it("masks every region whole when a finding names a region the frame does not have", () => {
    expect(planRedaction([canvas], { status: "OK", findings: [region({ regionId: "elsewhere" })] }).reason).toBe("MALFORMED:UNKNOWN_REGION");
  });

  it("an OK report with no findings masks nothing in that region — a MISS is not an error (the stated limitation)", () => {
    const plan = planRedaction([canvas], { status: "OK", findings: [] });
    expect(plan.failClosed).toBe(false);
    expect(plan.masks["canvas-1"]).toEqual([]);
  });
});
