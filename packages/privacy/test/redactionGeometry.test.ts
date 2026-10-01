/**
 * The canonical visual redaction geometry, on hand-computed cases.
 *
 * The exhaustive check is the golden equivalence test in `tests/browser/support/`, which pins this
 * module to the geometry the RE-1 scorer produced when it was pre-registered. These cases pin the
 * frozen rules themselves: 4 px, IoU strictly greater than 0.3, clipping, the fail-closed mask.
 */
import { describe, expect, it } from "vitest";

import {
  REDACTION_UNION,
  clipTo,
  dilate,
  failClosedMask,
  maskCoverage,
  mergeOverlapping,
  overlapRatio,
  redactionMask,
  toAxisAligned,
} from "../src/index.js";

const r = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("the frozen union, quoted", () => {
  it("is 4 px and IoU > 0.3, and cannot be changed at runtime", () => {
    expect(REDACTION_UNION).toEqual({ dilationPx: 4, mergeIou: 0.3 });
    expect(Object.isFrozen(REDACTION_UNION)).toBe(true);
  });
});

describe("dilate", () => {
  it("grows every side by 4 px by default", () => {
    expect(dilate(r(10, 20, 30, 5))).toEqual(r(6, 16, 38, 13));
  });
});

describe("mergeOverlapping", () => {
  it("does NOT merge at exactly IoU 0.3 — the frozen rule is strictly greater", () => {
    // b lies inside a: intersection 30, union 100, IoU exactly 0.3.
    expect(overlapRatio(r(0, 0, 10, 10), r(0, 0, 10, 3))).toBe(0.3);
    expect(mergeOverlapping([r(0, 0, 10, 10), r(0, 0, 10, 3)])).toHaveLength(2);
  });

  it("merges above 0.3 into the bounding rectangle, and keeps merging until stable", () => {
    // a+b: overlap 80, union 120, IoU 0.667 -> (0,0,12,10). That with c (7,0,6,10): overlap 50,
    // union 130, IoU 0.385 -> (0,0,13,10).
    expect(mergeOverlapping([r(0, 0, 10, 10), r(2, 0, 10, 10), r(7, 0, 6, 10)])).toEqual([r(0, 0, 13, 10)]);
  });

  it("leaves overlapping rectangles separate when their IoU is at or below 0.3", () => {
    // (0,0,12,10) against (8,0,6,10): overlap 40, union 140, IoU 0.286 — below the frozen bar.
    expect(mergeOverlapping([r(0, 0, 12, 10), r(8, 0, 6, 10)])).toHaveLength(2);
  });

  it("does not mutate its input", () => {
    const input = [r(0, 0, 10, 10), r(2, 0, 10, 10)];
    mergeOverlapping(input);
    expect(input).toEqual([r(0, 0, 10, 10), r(2, 0, 10, 10)]);
  });
});

describe("redactionMask", () => {
  const region = r(0, 0, 100, 50);

  it("axis-aligns a quadrilateral, which can only add area", () => {
    expect(toAxisAligned({ points: [[10, 5], [40, 10], [38, 22], [8, 17]] })).toEqual(r(8, 5, 32, 17));
  });

  it("dilates, merges above IoU 0.3, and clips to the region", () => {
    // Dilated (-2,-2,18,18) and (2,-2,18,18): overlap 252, union 396, IoU 0.636 -> one rectangle
    // (-2,-2,22,18), clipped at the region's edge to (0,0,20,16).
    expect(redactionMask([r(2, 2, 10, 10), r(6, 2, 10, 10)], region)).toEqual([r(0, 0, 20, 16)]);
  });

  it("keeps dilated boxes that overlap below IoU 0.3 as separate rectangles — their union is the mask", () => {
    // Dilated (-2,-2,18,18) and (10,-2,18,18): they overlap, but at IoU 0.2, so both stay; clipped.
    expect(redactionMask([r(2, 2, 10, 10), r(14, 2, 10, 10)], region)).toEqual([r(0, 0, 16, 16), r(10, 0, 18, 16)]);
  });

  it("drops a box entirely outside the region", () => {
    expect(redactionMask([r(500, 500, 10, 10)], region)).toEqual([]);
  });

  it("returns no mask for no boxes — the caller decides whether that is a failure", () => {
    expect(redactionMask([], region)).toEqual([]);
  });
});

describe("failClosedMask — INV-23", () => {
  it("masks the whole region, as a copy", () => {
    const region = r(5, 6, 70, 80);
    const mask = failClosedMask(region);
    expect(mask).toEqual([region]);
    expect(mask[0]).not.toBe(region);
  });
});

describe("maskCoverage", () => {
  it("is exact, and does not double-count overlapping rectangles", () => {
    expect(maskCoverage(r(0, 0, 10, 10), [r(0, 0, 10, 10), r(0, 0, 10, 10), r(-5, -5, 30, 30)])).toBe(100);
    expect(maskCoverage(r(0, 0, 10, 10), [r(0, 0, 5, 10), r(4, 0, 4, 10)])).toBe(80);
  });

  it("excludes an allowed zone exactly", () => {
    expect(maskCoverage(r(0, 0, 100, 100), [r(0, 0, 100, 100)], [r(0, 0, 50, 100)])).toBe(5000);
  });

  it("clipTo returns null for no positive-area overlap", () => {
    expect(clipTo(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBeNull();
  });
});
