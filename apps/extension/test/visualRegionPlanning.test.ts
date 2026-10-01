/**
 * M10 — OBSERVE → visualRegions → (synthetic) UNREAD_REGION findings → `planVisualRedaction`.
 *
 * No detector runs: the findings are synthetic, and TR-01 stays uncalled. What this pins is that the
 * regions the observation delivers feed the privacy planner DIRECTLY — the same objects, no adapter,
 * no second privacy path — and the owner-approved REFUSED rule:
 *
 *   INVALID VISUAL REGION → REFUSED → the frame must not leave the privacy boundary.
 *
 * REFUSED is terminal. It is not an empty mask, not zero detections, not a sanitized success, and it
 * cannot reach an encode or egress step. No encoder exists yet, so the "encode" step below is a
 * TEST-ONLY sentinel with the only shape such a step may have: it takes a plan and needs its masks.
 */
import { describe, expect, it } from "vitest";

import { parsePageReply, visualRegionsFrom, type VisualRegionReading } from "@pratibimb/extension-transport";
import {
  failClosedMask,
  planVisualRedaction,
  redactionMask,
  unreadRegion,
  type VisualRedactionPlan,
  type VisualRegion,
} from "@pratibimb/privacy";

const OBSERVE = {
  op: "OBSERVE",
  requestId: "r1",
  measurements: [],
  focus: { state: "NONE" },
  viewport: { w: 1280, h: 720, dpr: 1.5, scrollX: 0, scrollY: 0 },
  structure: { watching: true, seq: 1, nodes: 0, attributes: 0, text: 0, resizes: 0, tracked: 0, at: null },
};

/** What the page sends, parsed exactly as the core realm parses it. */
function observedRegions(visualRegions: unknown): readonly VisualRegionReading[] | null {
  const reply = parsePageReply({ ...OBSERVE, visualRegions });
  return reply && reply.op === "OBSERVE" ? reply.visualRegions : null;
}

const regions = observedRegions(
  visualRegionsFrom([
    { kind: "canvas", ordinal: 0, rect: { x: 100, y: 100, w: 400, h: 200 }, display: "inline", visibility: "visible" },
    { kind: "canvas", ordinal: 1, rect: { x: 0, y: 0, w: 0, h: 0 }, display: "none", visibility: "visible" },
    { kind: "img", ordinal: 0, rect: { x: 600.5, y: 100.25, w: 300, h: 300 }, display: "inline", visibility: "visible" },
  ])
)!;

/**
 * TEST-ONLY SENTINEL for the encode step that does not exist yet. It can only be handed a PLANNED
 * plan's masks; a REFUSED plan has none to hand it (and, below, the type system agrees).
 */
function sentinelEncode(plan: VisualRedactionPlan): { readonly encoded: boolean; readonly maskedRegions: number } {
  if (plan.outcome !== "PLANNED") return { encoded: false, maskedRegions: 0 };
  return { encoded: true, maskedRegions: plan.regions.length };
}

describe("observed regions feed the planner directly", () => {
  it("enumerates the rendered canvas and image, not the hidden canvas", () => {
    expect(regions.map((r) => r.id)).toEqual(["canvas:0", "img:0"]);
  });

  it("the observation's region type IS the planner's input type — no adapter", () => {
    const input: readonly VisualRegion[] = regions;
    expect(input).toBe(regions);
  });

  it("synthetic unread findings are masked with the canonical geometry, in their own region", () => {
    const findings = [
      unreadRegion({ box: { x: 120, y: 120, w: 80, h: 20 }, score: 0.8, regionId: "canvas:0" }),
      unreadRegion({ box: { x: 650, y: 150, w: 60, h: 20 }, score: 0.02, regionId: "img:0" }),
    ];
    const plan = planVisualRedaction(regions, { status: "OK", findings });
    expect(plan.outcome).toBe("PLANNED");
    if (plan.outcome !== "PLANNED") return;
    expect(plan.failClosed).toBe(false);
    expect(plan.regions.map((r) => r.regionId)).toEqual(["canvas:0", "img:0"]);
    expect(plan.regions[0]!.mask).toEqual(redactionMask([{ x: 120, y: 120, w: 80, h: 20 }], regions[0]!.rect));
    expect(plan.regions[1]!.mask).toEqual(redactionMask([{ x: 650, y: 150, w: 60, h: 20 }], regions[1]!.rect));
  });

  it("a detector that failed masks every observed region whole, and the frame may continue sanitized", () => {
    for (const status of ["UNAVAILABLE", "ERROR", "TIMEOUT", "MALFORMED"] as const) {
      const plan = planVisualRedaction(regions, { status });
      expect(plan.outcome === "PLANNED" && plan.failClosed).toBe(true);
      if (plan.outcome !== "PLANNED") return;
      for (const [i, r] of plan.regions.entries()) expect(r.mask).toEqual(failClosedMask(regions[i]!.rect));
      expect(sentinelEncode(plan)).toEqual({ encoded: true, maskedRegions: 2 });
    }
  });

  it("a finding naming a region the observation does not have masks everything whole", () => {
    const plan = planVisualRedaction(regions, {
      status: "OK",
      findings: [unreadRegion({ box: { x: 1, y: 1, w: 5, h: 5 }, score: 0.5, regionId: "canvas:1" })],
    });
    expect(plan.outcome === "PLANNED" && plan.reason).toBe("MALFORMED:UNKNOWN_REGION");
  });
});

describe("REFUSED is terminal (owner decision, M10)", () => {
  const invalid: [string, readonly VisualRegion[]][] = [
    ["a NaN rectangle", [{ id: "canvas:0", rect: { x: NaN, y: 0, w: 10, h: 10 } }]],
    ["an Infinity rectangle", [{ id: "canvas:0", rect: { x: 0, y: 0, w: Infinity, h: 10 } }]],
    ["a zero-size rectangle", [{ id: "img:0", rect: { x: 0, y: 0, w: 0, h: 10 } }]],
    ["a negative extent", [{ id: "img:0", rect: { x: 0, y: 0, w: 10, h: -4 } }]],
    ["duplicate ids", [...regions, { id: "canvas:0", rect: { x: 1, y: 1, w: 1, h: 1 } }]],
  ];

  it.each(invalid)("%s → REFUSED, whatever the detector said, and nothing is encoded", (_name, bad) => {
    for (const report of [
      { status: "OK", findings: [] },
      { status: "ERROR" },
      undefined,
      { status: "OK", findings: [unreadRegion({ box: { x: 1, y: 1, w: 1, h: 1 }, score: 1, regionId: bad[0]!.id })] },
    ]) {
      const plan = planVisualRedaction(bad, report);
      expect(plan.outcome).toBe("REFUSED");
      // Not an empty mask, not zero detections, not a sanitized success: there are no masks at all.
      expect(plan).not.toHaveProperty("regions");
      expect(plan).not.toHaveProperty("failClosed");
      expect(sentinelEncode(plan)).toEqual({ encoded: false, maskedRegions: 0 });
    }
  });

  it("a REFUSED plan offers no masks to an encode step at compile time either", () => {
    const plan = planVisualRedaction([{ id: "canvas:0", rect: { x: NaN, y: 0, w: 1, h: 1 } }], { status: "OK", findings: [] });
    // @ts-expect-error — `regions` exists only on a PLANNED plan; an encoder must narrow first
    const masks = plan.regions;
    expect(masks).toBeUndefined();
  });

  it("the invalid rectangle never gets as far as the planner from the wire: the observation is refused whole", () => {
    for (const rect of [
      { x: NaN, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 0, h: 10 },
      { x: 0, y: 0, w: -1, h: 10 },
      { x: 0, y: 0, w: Infinity, h: 10 },
    ]) {
      expect(observedRegions([{ id: "canvas:0", kind: "canvas", rect }])).toBeNull();
      expect(observedRegions(JSON.parse(JSON.stringify([{ id: "canvas:0", kind: "canvas", rect }])))).toBeNull();
    }
  });
});
