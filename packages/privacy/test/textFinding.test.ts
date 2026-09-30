/**
 * The fail-closed `TextFinding` and the visual redaction plan, on the PRODUCT types.
 *
 * The first block ports M9's fourteen reference-model cases (`tests/browser/support/
 * m9-text-region-contract.test.mjs`) one for one. The reference model is not imported — the same
 * inputs and the same expected policy results are asserted against `@pratibimb/privacy` itself, and
 * a test below fails if any privacy source or test reaches for the reference model at runtime.
 *
 * Everything else pins what the reference model could not: compile-time exclusion of text, length,
 * class and reference; exhaustive fail-closed statuses; serialization; and that the plan is exactly
 * the canonical geometry, never a second implementation of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PII_CLASSES,
  READ_TEXT_KEYS,
  REDACT_UNREAD,
  TIER_OF,
  UNREAD_REGION_KEYS,
  failClosedMask,
  findingRequiresRedaction,
  maskCoverage,
  mustRedact,
  parseTextFinding,
  planVisualRedaction,
  rectArea,
  redactionMask,
  unreadRegion,
  type ReadText,
  type Rect,
  type TextFinding,
  type TextRegionReport,
  type UnreadRegion,
  type VisualRedactionPlan,
  type VisualRegion,
} from "../src/index.js";

const canvas: VisualRegion = { id: "canvas-1", rect: { x: 100, y: 100, w: 400, h: 200 } };
const image: VisualRegion = { id: "img-1", rect: { x: 600, y: 100, w: 300, h: 300 } };

/** A serialized unread region, as it would arrive from another realm, with overrides. */
const region = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "UNREAD_REGION",
  box: { x: 120, y: 120, w: 80, h: 20 },
  score: 0.9,
  regionId: "canvas-1",
  treatment: "REDACT_UNREAD",
  ...over,
});

const read = (piiClass: unknown, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "READ_TEXT",
  box: { x: 0, y: 0, w: 10, h: 10 },
  length: 4,
  piiClass,
  ref: null,
  ...over,
});

const ok = (findings: readonly unknown[]) => ({ status: "OK", findings });

/** The mask of one region in a PLANNED plan; fails the test on a REFUSED plan. */
function maskOf(plan: VisualRedactionPlan, id: string): readonly Rect[] {
  if (plan.outcome !== "PLANNED") throw new Error(`plan was REFUSED: ${plan.detail}`);
  const entry = plan.regions.find((r) => r.regionId === id);
  if (!entry) throw new Error(`no region ${id} in the plan`);
  return entry.mask;
}

const failClosed = (plan: VisualRedactionPlan) => (plan.outcome === "PLANNED" ? plan.failClosed : null);
const reason = (plan: VisualRedactionPlan) => (plan.outcome === "PLANNED" ? plan.reason : null);

// ───────────────────────────── M9 reference-model parity ─────────────────────────────

describe("M9 parity 1-5 — UNREAD_REGION carries no text and no class", () => {
  it("[M9-01] has exactly the allowlisted fields — none can hold characters, a count, a class or a reference", () => {
    expect(UNREAD_REGION_KEYS).toEqual(["kind", "box", "score", "regionId", "treatment"]);
    for (const banned of ["text", "chars", "value", "transcript", "length", "piiClass", "ref"]) {
      expect(UNREAD_REGION_KEYS).not.toContain(banned);
    }
    const u = unreadRegion({ box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.9, regionId: "canvas-1" });
    expect(Object.keys(u).sort()).toEqual([...UNREAD_REGION_KEYS].sort());
  });

  it("[M9-02] is always redacted, whatever its score", () => {
    const at = (score: number) => unreadRegion({ box: { x: 1, y: 1, w: 1, h: 1 }, score, regionId: "canvas-1" });
    expect(findingRequiresRedaction(at(0.9))).toBe(true);
    expect(findingRequiresRedaction(at(0.01))).toBe(true);
    expect(findingRequiresRedaction(at(0))).toBe(true);
    expect(mustRedact(region())).toBe(true);
    expect(mustRedact(region({ score: 0.01 }))).toBe(true);
  });

  it("[M9-03] cannot be expressed as piiClass null or UNKNOWN — the parser refuses both", () => {
    expect(parseTextFinding(region({ piiClass: null }))).toEqual({ ok: false, code: "UNREAD_REGION_EXTRA_FIELD:piiClass" });
    expect(parseTextFinding(region({ piiClass: "UNKNOWN" }))).toEqual({ ok: false, code: "UNREAD_REGION_EXTRA_FIELD:piiClass" });
  });

  it("[M9-04] refuses a smuggled string under any name", () => {
    for (const k of ["text", "transcript", "value", "label", "chars", "length", "ref"]) {
      expect(parseTextFinding(region({ [k]: "7712" })).ok, k).toBe(false);
    }
  });

  it("[M9-05] refuses non-finite or degenerate geometry, a missing region and a different treatment", () => {
    expect(parseTextFinding(region({ box: { x: NaN, y: 0, w: 1, h: 1 } })).ok).toBe(false);
    expect(parseTextFinding(region({ box: { x: 0, y: 0, w: 0, h: 1 } })).ok).toBe(false);
    expect(parseTextFinding(region({ regionId: "" })).ok).toBe(false);
    expect(parseTextFinding(region({ treatment: "ALLOW" })).ok).toBe(false);
  });
});

describe("M9 parity 6-8 — READ_TEXT keeps the existing reader semantics (no reading producer is adopted)", () => {
  it("[M9-06] still has no string field", () => {
    expect(READ_TEXT_KEYS).toEqual(["kind", "box", "length", "piiClass", "ref"]);
    expect(READ_TEXT_KEYS).not.toContain("text");
  });

  it("[M9-07] masks a sensitive class and leaves null or a PUBLIC class unmasked, as the classifier defines them", () => {
    expect(mustRedact(read("AADHAAR"))).toBe(true);
    expect(mustRedact(read("OTP"))).toBe(true);
    expect(mustRedact(read(null))).toBe(false);
    expect(mustRedact(read("UNKNOWN"))).toBe(false);
  });

  it("[M9-08] the UNKNOWN -> PUBLIC mapping it relies on is the privacy package's own", () => {
    expect(TIER_OF.UNKNOWN).toBe("PUBLIC");
    const classes = readFileSync(fileURLToPath(new URL("../src/classes.ts", import.meta.url)), "utf8");
    expect(classes).toMatch(/UNKNOWN: "PUBLIC"/);
  });
});

describe("M9 parity 9 — anything unrecognised is protective", () => {
  it("[M9-09] masks an object with no kind or an unknown kind", () => {
    expect(parseTextFinding({ box: { x: 0, y: 0, w: 1, h: 1 } })).toEqual({ ok: false, code: "MISSING_KIND" });
    expect(parseTextFinding({ kind: "SAFE_REGION" })).toEqual({ ok: false, code: "UNKNOWN_KIND" });
    expect(mustRedact({ kind: "SAFE_REGION" })).toBe(true);
    expect(mustRedact(undefined)).toBe(true);
  });
});

describe("M9 parity 10-14 — planVisualRedaction: canonical geometry, INV-23", () => {
  it("[M9-10] masks detected regions with redactionMask, clipped to their visual-only region", () => {
    const plan = planVisualRedaction([canvas], ok([region()]));
    expect(failClosed(plan)).toBe(false);
    expect(maskOf(plan, "canvas-1")).toEqual(redactionMask([{ x: 120, y: 120, w: 80, h: 20 }], canvas.rect));
  });

  it("[M9-11] masks every region whole on ERROR, TIMEOUT, UNAVAILABLE or no report", () => {
    for (const status of ["ERROR", "TIMEOUT", "UNAVAILABLE"]) {
      const plan = planVisualRedaction([canvas], { status, findings: [] });
      expect(failClosed(plan)).toBe(true);
      expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
    }
    expect(failClosed(planVisualRedaction([canvas], undefined))).toBe(true);
  });

  it("[M9-12] masks every region whole when any finding is malformed — one bad finding spoils the report", () => {
    const plan = planVisualRedaction([canvas], ok([region(), region({ piiClass: null })]));
    expect(failClosed(plan)).toBe(true);
    expect(reason(plan)).toBe("MALFORMED:UNREAD_REGION_EXTRA_FIELD:piiClass");
    expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
  });

  it("[M9-13] masks every region whole when a finding names a region the frame does not have", () => {
    const plan = planVisualRedaction([canvas], ok([region({ regionId: "elsewhere" })]));
    expect(reason(plan)).toBe("MALFORMED:UNKNOWN_REGION");
    expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
  });

  it("[M9-14] an OK report with no findings masks nothing in that region — a MISS is not an error (the stated limitation)", () => {
    const plan = planVisualRedaction([canvas], ok([]));
    expect(failClosed(plan)).toBe(false);
    expect(maskOf(plan, "canvas-1")).toEqual([]);
  });
});

// ───────────────────────────── beyond the reference model ─────────────────────────────

describe("unread detector regions", () => {
  it("the detector constructor takes only box, score and region, and copies them", () => {
    const box = { x: 1, y: 2, w: 3, h: 4 };
    const u = unreadRegion({ box, score: 0.5, regionId: "canvas-1" });
    expect(u).toEqual({ kind: "UNREAD_REGION", box: { x: 1, y: 2, w: 3, h: 4 }, score: 0.5, regionId: "canvas-1", treatment: REDACT_UNREAD });
    expect(u.box).not.toBe(box);
    expect(Object.isFrozen(u)).toBe(true);
    expect(Object.isFrozen(u.box)).toBe(true);
  });

  it("refuses an invalid detector box rather than producing a region that masks nothing", () => {
    const bad = [
      { x: NaN, y: 0, w: 1, h: 1 },
      { x: 0, y: Infinity, w: 1, h: 1 },
      { x: 0, y: 0, w: -1, h: 1 },
      { x: 0, y: 0, w: 1, h: 0 },
    ];
    for (const box of bad) expect(() => unreadRegion({ box, score: 0.5, regionId: "c" })).toThrow(/UNREAD_REGION_GEOMETRY/);
    expect(() => unreadRegion({ box: { x: 0, y: 0, w: 1, h: 1 }, score: NaN, regionId: "c" })).toThrow(/UNREAD_REGION_SCORE/);
    expect(() => unreadRegion({ box: { x: 0, y: 0, w: 1, h: 1 }, score: 1.5, regionId: "c" })).toThrow(/UNREAD_REGION_SCORE/);
    expect(() => unreadRegion({ box: { x: 0, y: 0, w: 1, h: 1 }, score: 0.5, regionId: "" })).toThrow(/UNREAD_REGION_REGION/);
  });

  it("cannot be turned into READ_TEXT by the constructor, whatever extra data a caller holds", () => {
    const smuggler = { box: { x: 0, y: 0, w: 1, h: 1 }, score: 0.5, regionId: "c", piiClass: null, kind: "READ_TEXT", length: 3 };
    const u = unreadRegion(smuggler);
    expect(u.kind).toBe("UNREAD_REGION");
    expect(Object.keys(u).sort()).toEqual([...UNREAD_REGION_KEYS].sort());
  });

  it("refuses a box carrying anything besides x, y, w, h — a string cannot ride inside the geometry", () => {
    expect(parseTextFinding(region({ box: { x: 0, y: 0, w: 1, h: 1, text: "7712" } }))).toEqual({ ok: false, code: "UNREAD_REGION_GEOMETRY" });
    expect(parseTextFinding(region({ box: [0, 0, 1, 1] }))).toEqual({ ok: false, code: "UNREAD_REGION_GEOMETRY" });
  });

  it("refuses a missing field rather than defaulting it", () => {
    for (const k of UNREAD_REGION_KEYS.filter((k) => k !== "kind")) {
      const v = region();
      delete v[k];
      expect(parseTextFinding(v), k).toEqual({ ok: false, code: `UNREAD_REGION_MISSING_FIELD:${k}` });
    }
  });

  it("refuses a symbol-keyed field as an extra field", () => {
    expect(parseTextFinding({ ...region(), [Symbol("text")]: "7712" }).ok).toBe(false);
  });
});

describe("null and UNKNOWN can never make a detector region safe", () => {
  it("refuses every PiiClass, null and undefined on an unread region, and redacts it", () => {
    for (const piiClass of [null, undefined, ...PII_CLASSES]) {
      expect(parseTextFinding(region({ piiClass })).ok).toBe(false);
      expect(mustRedact(region({ piiClass }))).toBe(true);
      const plan = planVisualRedaction([canvas], ok([region({ piiClass })]));
      expect(failClosed(plan)).toBe(true);
      expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
    }
  });

  it("a region whose type-level shape was forged through a non-literal is still refused at runtime", () => {
    // Structural typing cannot see an extra property on a non-literal. The planner re-parses, so it
    // does not matter: the object is refused, and the region is masked whole.
    const forged = { kind: "UNREAD_REGION" as const, box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.9, regionId: "canvas-1", treatment: REDACT_UNREAD, piiClass: null };
    const typed: UnreadRegion = forged;
    const report: TextRegionReport = { status: "OK", findings: [typed] };
    const plan = planVisualRedaction([canvas], report);
    expect(reason(plan)).toBe("MALFORMED:UNREAD_REGION_EXTRA_FIELD:piiClass");
    expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
  });
});

describe("READ_TEXT is parsed strictly, and absent fields are not safe defaults", () => {
  it("refuses a missing piiClass instead of reading it as null ('not sensitive')", () => {
    const v = read(null);
    delete v["piiClass"];
    expect(parseTextFinding(v)).toEqual({ ok: false, code: "READ_TEXT_MISSING_FIELD:piiClass" });
    expect(mustRedact(v)).toBe(true);
  });

  it("refuses a class the classifier does not know, a bad length, a bad ref and extra fields", () => {
    expect(parseTextFinding(read("SECRET")).ok).toBe(false);
    expect(parseTextFinding(read("toString")).ok).toBe(false);
    expect(parseTextFinding(read(null, { length: -1 })).ok).toBe(false);
    expect(parseTextFinding(read(null, { length: 1.5 })).ok).toBe(false);
    expect(parseTextFinding(read(null, { ref: 7 })).ok).toBe(false);
    expect(parseTextFinding(read(null, { text: "hello" }))).toEqual({ ok: false, code: "READ_TEXT_EXTRA_FIELD:text" });
    expect(parseTextFinding(read(null, { regionId: "canvas-1" })).ok).toBe(false);
  });

  it("maps every class through the existing tier table and nothing else", () => {
    for (const cls of PII_CLASSES) {
      expect(mustRedact(read(cls)), cls).toBe(TIER_OF[cls] !== "PUBLIC");
    }
  });
});

describe("fail-closed statuses — never [] for a failure", () => {
  const regions = [canvas, image];
  const failures: [string, unknown, string][] = [
    ["UNAVAILABLE", { status: "UNAVAILABLE" }, "UNAVAILABLE"],
    ["ERROR", { status: "ERROR" }, "ERROR"],
    ["TIMEOUT", { status: "TIMEOUT" }, "TIMEOUT"],
    ["MALFORMED (detector refusal)", { status: "MALFORMED" }, "MALFORMED"],
    ["undefined report", undefined, "NO_REPORT"],
    ["null report", null, "NO_REPORT"],
    ["string report", "OK", "MALFORMED:REPORT_NOT_AN_OBJECT"],
    ["array report", [], "MALFORMED:REPORT_NOT_AN_OBJECT"],
    ["unrecognised status", { status: "SAFE", findings: [] }, "MALFORMED:REPORT_STATUS"],
    ["lower-case ok", { status: "ok", findings: [] }, "MALFORMED:REPORT_STATUS"],
    ["missing status", { findings: [] }, "MALFORMED:REPORT_STATUS"],
    ["OK without findings", { status: "OK" }, "MALFORMED:REPORT_MISSING_FIELD:findings"],
    ["OK with findings null", { status: "OK", findings: null }, "MALFORMED:FINDINGS_NOT_ARRAY"],
    ["OK with an extra field", { status: "OK", findings: [], text: "x" }, "MALFORMED:REPORT_EXTRA_FIELD:text"],
    ["OK with a non-object finding", ok(["7712"]), "MALFORMED:NOT_AN_OBJECT"],
    ["OK with a null finding", ok([null]), "MALFORMED:NOT_AN_OBJECT"],
  ];

  it.each(failures)("%s masks every visual-only region whole", (_name, report, expected) => {
    const plan = planVisualRedaction(regions, report);
    expect(failClosed(plan)).toBe(true);
    expect(reason(plan)).toBe(expected);
    for (const r of regions) {
      const mask = maskOf(plan, r.id);
      expect(mask).toEqual(failClosedMask(r.rect));
      expect(mask.length).toBeGreaterThan(0);
      expect(maskCoverage(r.rect, mask)).toBe(rectArea(r.rect));
    }
  });

  it("an empty region list is only reachable through a clean OK report with nothing found", () => {
    const clean = planVisualRedaction(regions, ok([]));
    expect(failClosed(clean)).toBe(false);
    for (const r of regions) expect(maskOf(clean, r.id)).toEqual([]);
    for (const [, report] of failures) {
      const plan = planVisualRedaction(regions, report);
      for (const r of regions) expect(maskOf(plan, r.id)).not.toEqual([]);
    }
  });

  it("a frame with no visual-only regions has nothing to mask, whatever the tier said", () => {
    expect(planVisualRedaction([], { status: "ERROR" })).toEqual({ outcome: "PLANNED", failClosed: true, reason: "ERROR", regions: [] });
    expect(planVisualRedaction([], ok([]))).toEqual({ outcome: "PLANNED", failClosed: false, reason: null, regions: [] });
  });
});

describe("a visual-only region without a usable position refuses the plan", () => {
  const bad: [string, unknown][] = [
    ["NaN rect", [{ id: "a", rect: { x: NaN, y: 0, w: 1, h: 1 } }]],
    ["zero-size rect", [{ id: "a", rect: { x: 0, y: 0, w: 0, h: 1 } }]],
    ["empty id", [{ id: "", rect: { x: 0, y: 0, w: 1, h: 1 } }]],
    ["duplicate id", [canvas, { ...image, id: "canvas-1" }]],
    ["not an array", "canvas-1"],
  ];

  it.each(bad)("%s -> REFUSED, with no mask a caller could apply", (_name, regions) => {
    const plan = planVisualRedaction(regions as readonly VisualRegion[], ok([]));
    expect(plan.outcome).toBe("REFUSED");
    expect(plan).not.toHaveProperty("regions");
    expect(planVisualRedaction(regions as readonly VisualRegion[], { status: "ERROR" }).outcome).toBe("REFUSED");
  });
});

describe("mixed findings", () => {
  it("masks unread regions in their own region only, a sensitive read box everywhere it lands, and leaves known-public text", () => {
    const inCanvas = region({ box: { x: 120, y: 120, w: 80, h: 20 } });
    const inImage = region({ box: { x: 650, y: 150, w: 60, h: 20 }, regionId: "img-1", score: 0.05 });
    const aadhaar = read("AADHAAR", { box: { x: 300, y: 250, w: 100, h: 20 } });
    const heading = read(null, { box: { x: 700, y: 300, w: 100, h: 20 } });
    const unknown = read("UNKNOWN", { box: { x: 200, y: 200, w: 50, h: 10 } });

    const plan = planVisualRedaction([canvas, image], ok([inCanvas, inImage, aadhaar, heading, unknown]));
    expect(failClosed(plan)).toBe(false);
    expect(maskOf(plan, "canvas-1")).toEqual(
      redactionMask([{ x: 120, y: 120, w: 80, h: 20 }, { x: 300, y: 250, w: 100, h: 20 }], canvas.rect)
    );
    expect(maskOf(plan, "img-1")).toEqual(
      redactionMask([{ x: 650, y: 150, w: 60, h: 20 }, { x: 300, y: 250, w: 100, h: 20 }], image.rect)
    );
    // The PUBLIC-tier and null-class read boxes are not in any mask.
    expect(maskCoverage({ x: 700, y: 300, w: 100, h: 20 }, maskOf(plan, "img-1"))).toBe(0);
    expect(maskCoverage({ x: 200, y: 200, w: 50, h: 10 }, maskOf(plan, "canvas-1"))).toBe(0);
  });

  it("one malformed finding among valid ones masks every region whole", () => {
    const plan = planVisualRedaction([canvas, image], ok([region(), read("OTP"), { kind: "UNREAD_REGION" }]));
    expect(reason(plan)).toBe("MALFORMED:UNREAD_REGION_MISSING_FIELD:box,score,regionId,treatment");
    expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
    expect(maskOf(plan, "img-1")).toEqual(failClosedMask(image.rect));
  });
});

describe("canonical geometry, called and not changed", () => {
  it("dilates 4 px, merges at IoU > 0.3 and clips, exactly as redactionMask does", () => {
    // Two boxes whose dilations overlap at IoU > 0.3 merge; a third far away stays separate; one
    // straddling the region's edge is clipped.
    const boxes = [
      { x: 110, y: 110, w: 40, h: 10 },
      { x: 114, y: 110, w: 40, h: 10 },
      { x: 400, y: 250, w: 30, h: 10 },
      { x: 480, y: 290, w: 40, h: 20 },
    ];
    const plan = planVisualRedaction([canvas], ok(boxes.map((box) => region({ box }))));
    const mask = maskOf(plan, "canvas-1");
    expect(mask).toEqual(redactionMask(boxes, canvas.rect));
    expect(mask).toContainEqual({ x: 106, y: 106, w: 52, h: 18 });
    expect(mask).toContainEqual({ x: 396, y: 246, w: 38, h: 18 });
    expect(mask).toContainEqual({ x: 476, y: 286, w: 24, h: 14 });
    expect(mask).toHaveLength(3);
  });

  it("the whole-region fallback is failClosedMask and covers the region exactly", () => {
    const plan = planVisualRedaction([canvas], { status: "TIMEOUT" });
    expect(maskOf(plan, "canvas-1")).toEqual(failClosedMask(canvas.rect));
    expect(maskCoverage(canvas.rect, maskOf(plan, "canvas-1"))).toBe(rectArea(canvas.rect));
  });

  it("the planner imports the canonical geometry and defines none of its own", () => {
    const raw = readFileSync(fileURLToPath(new URL("../src/textFinding.ts", import.meta.url)), "utf8");
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toMatch(/import \{ failClosedMask, redactionMask, type Rect \} from "\.\/redactionGeometry\.js";/);
    expect(src).not.toMatch(/\b(function|const)\s+(dilate|mergeOverlapping|redactionMask|failClosedMask|clipTo|overlapRatio)\b/);
    expect(src).not.toMatch(/dilationPx|mergeIou|\b0\.3\b/);
  });

  it("the plan neither aliases nor mutates its inputs", () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    const regions = [{ id: "a", rect }];
    const findings = [region({ regionId: "a", box: { x: 10, y: 10, w: 10, h: 10 } })];
    const before = JSON.stringify({ regions, findings });
    const plan = planVisualRedaction(regions, ok(findings));
    expect(JSON.stringify({ regions, findings })).toBe(before);
    rect.w = 1;
    expect(plan.outcome === "PLANNED" && plan.regions[0]!.region.w).toBe(100);
    expect(Object.isFrozen(plan)).toBe(true);
  });
});

describe("serialization — nothing crosses a realm today, and the parser is the guard when it does", () => {
  it("round-trips an unread region through JSON and structured clone with only its five keys", () => {
    const u = unreadRegion({ box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.9, regionId: "canvas-1" });
    const json = JSON.stringify(u);
    expect(Object.keys(JSON.parse(json)).sort()).toEqual([...UNREAD_REGION_KEYS].sort());
    expect(json).not.toMatch(/piiClass|length|"ref"|text/);
    expect(parseTextFinding(JSON.parse(json))).toEqual({ ok: true, finding: u });
    expect(parseTextFinding(structuredClone(u))).toEqual({ ok: true, finding: u });
  });

  it("a non-finite score is refused after JSON (NaN serializes as null), never read as zero", () => {
    const json = JSON.stringify({ ...region(), score: NaN });
    expect(parseTextFinding(JSON.parse(json))).toEqual({ ok: false, code: "UNREAD_REGION_SCORE" });
  });

  it("a serialized unread region with its treatment stripped is refused, not defaulted", () => {
    const stripped = region();
    delete stripped["treatment"];
    const parsed = parseTextFinding(JSON.parse(JSON.stringify(stripped)));
    expect(parsed).toEqual({ ok: false, code: "UNREAD_REGION_MISSING_FIELD:treatment" });
  });

  it("a whole report survives JSON with the same plan", () => {
    const report: TextRegionReport = { status: "OK", findings: [unreadRegion({ box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.9, regionId: "canvas-1" })] };
    expect(planVisualRedaction([canvas], JSON.parse(JSON.stringify(report)))).toEqual(planVisualRedaction([canvas], report));
  });
});

describe("compile-time: a detector-only finding cannot carry, or be read as, a class", () => {
  const box = { x: 0, y: 0, w: 1, h: 1 };
  const u = unreadRegion({ box, score: 0.5, regionId: "c" });

  it("has no text, length, piiClass or ref to read", () => {
    // @ts-expect-error — an unread region has no text
    void u.text;
    // @ts-expect-error — an unread region has no character count
    void u.length;
    // @ts-expect-error — an unread region has no class
    void u.piiClass;
    // @ts-expect-error — an unread region has no reference
    void u.ref;
    expect(Object.keys(u)).not.toContain("piiClass");
  });

  it("cannot be constructed with a class, a count, a reference or text", () => {
    // @ts-expect-error — the detector constructor takes no class
    expect(() => unreadRegion({ box, score: 0.5, regionId: "c", piiClass: null })).not.toThrow();
    // @ts-expect-error — nor UNKNOWN
    expect(() => unreadRegion({ box, score: 0.5, regionId: "c", piiClass: "UNKNOWN" })).not.toThrow();
    // @ts-expect-error — nor text
    expect(() => unreadRegion({ box, score: 0.5, regionId: "c", text: "7712" })).not.toThrow();
    // @ts-expect-error — an UnreadRegion literal cannot carry a class
    const a: UnreadRegion = { kind: "UNREAD_REGION", box, score: 1, regionId: "c", treatment: REDACT_UNREAD, piiClass: null };
    // @ts-expect-error — nor a count
    const b: UnreadRegion = { kind: "UNREAD_REGION", box, score: 1, regionId: "c", treatment: REDACT_UNREAD, length: 4 };
    // @ts-expect-error — nor a reference
    const c: UnreadRegion = { kind: "UNREAD_REGION", box, score: 1, regionId: "c", treatment: REDACT_UNREAD, ref: null };
    // @ts-expect-error — a TextFinding literal of kind UNREAD_REGION cannot carry UNKNOWN either
    const d: TextFinding = { kind: "UNREAD_REGION", box, score: 1, regionId: "c", treatment: REDACT_UNREAD, piiClass: "UNKNOWN" };
    // @ts-expect-error — the treatment is a constant, not a choice
    const e: UnreadRegion = { kind: "UNREAD_REGION", box, score: 1, regionId: "c", treatment: "ALLOW" };
    // The unsafe values above were only ever types; at runtime every one of them is refused.
    for (const v of [a, b, c, d, e]) expect(mustRedact(v)).toBe(true);
  });

  it("cannot be treated as known non-sensitive text by consuming code", () => {
    // @ts-expect-error — an unread region is not READ_TEXT
    const asRead: ReadText = u;
    // On the union, `piiClass` does not exist until narrowed to READ_TEXT, so a consumer cannot
    // coerce an unread region's absent class to null ("not sensitive") without a compile error.
    // @ts-expect-error — piiClass is not readable on an un-narrowed TextFinding
    const coerce = (f: TextFinding) => f.piiClass ?? null;
    const narrowed = (f: TextFinding) => (f.kind === "READ_TEXT" ? f.piiClass : "UNREAD");
    expect(narrowed(u)).toBe("UNREAD");
    expect(findingRequiresRedaction(asRead)).toBe(true);
    // What the compile error prevents: at runtime the coercion would have read "not sensitive".
    expect(coerce(u)).toBeNull();
  });
});

describe("privacy boundary — pure, and independent of the M9 reference model", () => {
  const SRC = fileURLToPath(new URL("../src", import.meta.url));
  const TEST = fileURLToPath(new URL(".", import.meta.url));
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const src = strip(readFileSync(join(SRC, "textFinding.ts"), "utf8"));

  it("imports only the privacy package's own classes and geometry", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./classes.js", "./redactionGeometry.js"]);
  });

  it("has no network, browser, model, WASM, filesystem or pixel access", () => {
    expect(src).not.toMatch(
      /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource|chrome\.|browser\.|navigator|document|window|globalThis|importScripts|WebAssembly|InferenceSession|onnx|ort\b|OffscreenCanvas|ImageData|getImageData|createImageBitmap|require\(|node:)/
    );
  });

  it("no privacy source or test imports the M9 reference model", () => {
    const files = [
      ...readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => join(SRC, f)),
      ...readdirSync(TEST).filter((f) => f.endsWith(".ts")).map((f) => join(TEST, f)),
    ];
    for (const f of files) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/from\s+"[^"]*(text-region-contract|M9-adoption-review)[^"]*"/);
    }
  });
});
