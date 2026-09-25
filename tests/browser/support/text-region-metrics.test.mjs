/**
 * The visual-text screen metrics, pinned on hand-computed cases.
 *
 * These are the numbers every text-region candidate is judged by, so they are tested directly
 * rather than trusted because a harness happened to print something plausible.
 */
import { describe, expect, it } from "vitest";
import { CRITERIA, iou, screen, unionContainment } from "./text-region-metrics.mjs";

const box = (x, y, w, h) => ({ x, y, w, h });

describe("the pre-registered thresholds", () => {
  it("are exactly the ones docs/perception/text-region-acceptance.md froze", () => {
    expect(CRITERIA).toEqual({ localisationIou: 0.5, secretContainment: 0.95, floodAreaRatio: 3, wholeCanvasShare: 0.9 });
    expect(Object.isFrozen(CRITERIA)).toBe(true);
  });
});

describe("iou", () => {
  it("is 1 for identical boxes, 0 for disjoint ones, and exact for a half overlap", () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
    expect(iou(box(0, 0, 10, 10), box(20, 20, 5, 5))).toBe(0);
    // 50 shared of 150 total.
    expect(iou(box(0, 0, 10, 10), box(5, 0, 10, 10))).toBeCloseTo(50 / 150, 12);
  });
});

describe("unionContainment", () => {
  it("does not double-count overlapping predictions, so a flood cannot exceed 100%", () => {
    const region = box(0, 0, 10, 10);
    expect(unionContainment(region, [box(0, 0, 10, 10), box(0, 0, 10, 10), box(-5, -5, 30, 30)])).toBe(1);
  });

  it("measures the uncovered strip exactly", () => {
    // Two boxes leave the right-most 2 px of a 10x10 region uncovered: 80%.
    expect(unionContainment(box(0, 0, 10, 10), [box(0, 0, 5, 10), box(4, 0, 4, 10)])).toBeCloseTo(0.8, 12);
  });
});

describe("screen", () => {
  const canvas = box(0, 0, 400, 200);
  const regions = [
    { id: "secret", sensitive: true, chars: 10, ...box(10, 10, 100, 20) },
    { id: "label", sensitive: false, chars: 5, ...box(10, 50, 50, 10) },
  ];

  it("passes a detector that boxes the text tightly and nothing else", () => {
    const r = screen("tight", [box(10, 10, 100, 20), box(10, 50, 50, 10)], regions, canvas);
    expect(r.criteria).toEqual({ localisation: true, secretCoverage: true, noFlood: true });
  });

  it("fails a detector that covers the secret only by swallowing the canvas", () => {
    const r = screen("flood", [box(0, 0, 400, 200)], regions, canvas);
    expect(r.perRegion[0].containment).toBe(1);
    expect(r.criteria.noFlood).toBe(false);
    expect(r.criteria.localisation).toBe(false);
  });

  it("fails a detector that finds nothing", () => {
    const r = screen("empty", [], regions, canvas);
    expect(r.criteria.localisation).toBe(false);
    expect(r.criteria.secretCoverage).toBe(false);
  });
});
