/**
 * RE-1, pinned on hand-computed geometry — before any candidate is scored with it.
 *
 * Every case here is synthetic arithmetic. No model output appears in this file, and none of the
 * numbers was chosen by looking at one.
 */
import { describe, expect, it } from "vitest";
import { REDACTION_CRITERIA, coveredArea, scoreImage, scoreSet, toRect, unionMask } from "./redaction-metrics.mjs";

const rect = (x, y, w, h) => ({ x, y, w, h });
const REGION = rect(0, 0, 1000, 500);

/** A string of `n` 8x12 glyphs with 2 px spacing, at (x, y); line box 20 px tall. */
function str(id, sensitive, x, y, n) {
  const glyphs = Array.from({ length: n }, (_, i) => rect(x + i * 10, y, 8, 12));
  const ink = rect(x, y, n * 10 - 2, 12);
  const line = rect(x, y - 4, n * 10 - 2, 20);
  return { id, sensitive, ink, line, glyphs };
}

describe("the criterion's constants", () => {
  it("quote the frozen union semantics and the frozen WASM rule, and are frozen themselves", () => {
    expect(REDACTION_CRITERIA.unionDilationPx).toBe(4);
    expect(REDACTION_CRITERIA.unionMergeIou).toBe(0.3);
    expect(REDACTION_CRITERIA.wasmRtolSumAbs).toBe(2e-2);
    expect(REDACTION_CRITERIA.maxExposedSensitiveGlyphs).toBe(0);
    expect(REDACTION_CRITERIA.maxOverMaskRatio).toBe(1.0);
    expect(REDACTION_CRITERIA.maxSingleBoxRegionShare).toBe(0.9);
    expect(Object.isFrozen(REDACTION_CRITERIA)).toBe(true);
  });
});

describe("the union mask", () => {
  it("dilates by 4 px and does not merge below IoU 0.3", () => {
    // Dilated: (-4,-4,18,18) and (6,-4,18,18): overlap 8x18 = 144, union 504, IoU 0.286.
    const m = unionMask([rect(0, 0, 10, 10), rect(10, 0, 10, 10)], rect(-100, -100, 400, 400));
    expect(m).toHaveLength(2);
    expect(m[0]).toEqual(rect(-4, -4, 18, 18));
  });

  it("merges above IoU 0.3 into the bounding rectangle", () => {
    // Dilated: (-4,-4,18,18) and (4,-4,18,18): overlap 10x18 = 180, union 468, IoU 0.385.
    const m = unionMask([rect(0, 0, 10, 10), rect(8, 0, 10, 10)], rect(-100, -100, 400, 400));
    expect(m).toEqual([rect(-4, -4, 26, 18)]);
  });

  it("turns a quadrilateral into its axis-aligned bounds, which can only add area", () => {
    expect(toRect({ points: [[10, 5], [40, 10], [38, 22], [8, 17]] })).toEqual(rect(8, 5, 32, 17));
  });
});

describe("exact coverage", () => {
  it("measures an uncovered strip to the square pixel", () => {
    expect(coveredArea(rect(0, 0, 10, 10), [rect(0, 0, 5, 10), rect(4, 0, 4, 10)])).toBe(80);
  });

  it("excludes an allowed zone exactly", () => {
    expect(coveredArea(rect(0, 0, 100, 100), [rect(0, 0, 100, 100)], [rect(0, 0, 50, 100)])).toBe(5000);
  });
});

describe("gate 1 — no exposed sensitive glyph", () => {
  it("counts the frozen 4 px dilation as the tolerance: a box 3 px short still masks the glyph", () => {
    const s = str("id", true, 100, 100, 5);
    const box = rect(103, 103, s.ink.w - 6, 6); // 3 px short on every side, before dilation
    const r = scoreImage({ boxes: [box] }, { region: REGION, strings: [s] });
    expect(r.exposedSensitiveGlyphs).toBe(0);
    expect(r.gates.noExposedSensitiveGlyph).toBe(true);
  });

  it("fails a box that stops 5 px short, beyond what the dilation absorbs", () => {
    const s = str("id", true, 100, 100, 5);
    const box = rect(100, 100, s.ink.w - 5 - 4, 12); // the last glyph's right edge stays out
    const r = scoreImage({ boxes: [box] }, { region: REGION, strings: [s] });
    expect(r.exposedSensitiveGlyphs).toBe(1);
    expect(r.exposed).toEqual([{ string: "id", glyph: 4 }]);
    expect(r.gates.noExposedSensitiveGlyph).toBe(false);
  });

  it("closes the old 95%-containment loophole: one exposed glyph in thirty fails", () => {
    const s = str("long", true, 10, 100, 30);
    // Glyph 28 ends at x = 298 and glyph 29 starts at 300. A box ending at 294 dilates to exactly 298:
    // glyphs 0..28 are masked and the 30th is untouched.
    const box = rect(10, 100, 284, 12);
    const r = scoreImage({ boxes: [box] }, { region: REGION, strings: [s] });
    expect(r.strings[0].inkAreaMasked).toBeGreaterThan(0.95); // the old criterion would have passed
    expect(r.exposedSensitiveGlyphs).toBe(1);
    expect(r.gates.noExposedSensitiveGlyph).toBe(false);
  });

  it("does not gate on a missed NON-sensitive glyph", () => {
    const secret = str("secret", true, 100, 100, 4);
    const label = str("label", false, 100, 200, 4);
    const r = scoreImage({ boxes: [secret.ink] }, { region: REGION, strings: [secret, label] });
    expect(r.gates.noExposedSensitiveGlyph).toBe(true);
    expect(r.nonSensitiveGlyphsFullyMasked).toBe(0);
  });
});

describe("gate 2 — over-masking is bounded, and padding up to the line box is free", () => {
  it("charges nothing for a box exactly on the line box", () => {
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ boxes: [s.line] }, { region: REGION, strings: [s] });
    expect(r.overMaskAreaPx).toBe(0);
    expect(r.gates.overMaskWithinBudget).toBe(true);
  });

  it("prices margins exactly: half a line height above and below is just over budget for a 98 px line", () => {
    // Line box 98 x 20; allowed zone is that plus the frozen 4 px. A box extending 10 px (half a line)
    // past the line box vertically, once dilated, reaches 10 px past the allowed zone on each side,
    // across the dilated width of 106 px: 2 x 10 x 106 = 2120 px2 against a 1960 px2 line box.
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ boxes: [rect(100, 86, 98, 40)] }, { region: REGION, strings: [s] });
    expect(r.overMaskAreaPx).toBe(106 * 20);
    expect(r.overMaskRatio).toBeCloseTo(2120 / 1960, 12); // 1.08
    expect(r.gates.overMaskWithinBudget).toBe(false);
  });

  it("…and nine pixels (0.45 of a line) above and below is within it", () => {
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ boxes: [rect(100, 87, 98, 38)] }, { region: REGION, strings: [s] });
    expect(r.overMaskAreaPx).toBe(106 * 18);
    expect(r.overMaskRatio).toBeCloseTo(1908 / 1960, 12); // 0.973
    expect(r.gates.overMaskWithinBudget).toBe(true);
  });

  it("fails a detector that buys coverage by masking a slab of background", () => {
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ boxes: [rect(50, 50, 300, 200)] }, { region: REGION, strings: [s] });
    expect(r.exposedSensitiveGlyphs).toBe(0);
    expect(r.gates.overMaskWithinBudget).toBe(false);
  });
});

describe("gate 3 — no blanket box", () => {
  it("fails a single box covering 90% of the region even if everything is masked", () => {
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ boxes: [rect(0, 0, 1000, 460)] }, { region: REGION, strings: [s] });
    expect(r.largestSingleBoxRegionShare).toBeGreaterThanOrEqual(0.9);
    expect(r.gates.noBlanketBox).toBe(false);
  });
});

describe("INV-23 — a failed detector counts as a positive", () => {
  it("masks the whole region: safe on gate 1, and failing on gates 2 and 3", () => {
    const s = str("id", true, 100, 100, 10);
    const r = scoreImage({ failed: true, boxes: [] }, { region: REGION, strings: [s] });
    expect(r.exposedSensitiveGlyphs).toBe(0);
    expect(r.maskedRegionShare).toBe(1);
    expect(r.gates.overMaskWithinBudget).toBe(false);
    expect(r.gates.noBlanketBox).toBe(false);
  });
});

describe("the set verdict", () => {
  const clean = () => {
    const s = str("id", true, 100, 100, 26);
    const one = scoreImage({ boxes: [s.line] }, { region: REGION, strings: [s, { ...str("id2", true, 100, 200, 26) }] });
    return one;
  };

  it("needs every gate on every image, and a large enough held-out set", () => {
    const perImage = Array.from({ length: 6 }, clean);
    const v = scoreSet(perImage, { wasmPassedOnEveryInput: true, deterministic: true, noPlaintextOutput: true });
    // Each image misses id2 entirely, so gate 1 fails everywhere.
    expect(v.gates.noExposedSensitiveGlyph).toBe(false);
    expect(v.pass).toBe(false);
    expect(v.sensitiveGlyphs).toBe(6 * 52);
    expect(v.perGlyphMissRateUpper95).toBeCloseTo(3 / 312, 12);
  });

  it("refuses a verdict on a set too small for zero exposures to mean anything", () => {
    const s = str("id", true, 100, 100, 5);
    const one = scoreImage({ boxes: [s.line] }, { region: REGION, strings: [s] });
    const v = scoreSet([one], { wasmPassedOnEveryInput: true, deterministic: true, noPlaintextOutput: true });
    expect(v.gates.heldOutLargeEnough).toBe(false);
    expect(v.pass).toBe(false);
  });
});
