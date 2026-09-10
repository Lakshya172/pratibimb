/**
 * Letterbox geometry — the model-input space, and the full chain back to canonical.
 *
 * The bug hunted hardest here is the forgotten padding offset. At 1024x640 into a 640
 * square the vertical padding is 120 model px; skipping the un-pad puts every box about
 * 190 CSS px too low. It does not crash, it does not look absurd in a log, and it is
 * wrong on every element on the page.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  computeLetterbox,
  modelToCapture,
  captureToModel,
  isInsideContent,
  clipToContent,
  captureToCss,
  modelBox,
  captureBox,
  cssBox,
  cssToCapture,
  PerceptionError,
} from "@pratibimb/perception";

/** The six QG-02 configurations, reused so the model space is exercised across them. */
const MATRIX = [
  { name: "DPR 1.0 @ 100%", dpr: 1.0 },
  { name: "DPR 1.0 @ 125%", dpr: 1.25 },
  { name: "DPR 1.5 @ 100%", dpr: 1.5 },
  { name: "DPR 1.5 @ 125%", dpr: 1.875 },
  { name: "DPR 2.0 @ 100%", dpr: 2.0 },
  { name: "DPR 2.0 @ 125%", dpr: 2.5 },
];

const geometryAt = (dpr: number, zoom = 1.0): CaptureGeometry => ({
  dpr,
  zoom,
  viewportCss: { w: 1024, h: 640 },
  captureSize: { w: Math.round(1024 * dpr), h: Math.round(640 * dpr) },
  scroll: { x: 0, y: 0 },
  origin: "https://seva.gov.in",
});

describe("computeLetterbox", () => {
  it("preserves aspect ratio and centres the padding", () => {
    const t = computeLetterbox({ w: 1024, h: 640 }, 640);
    expect(t.scale).toBeCloseTo(640 / 1024, 9); // 0.625, limited by width
    expect(t.contentSize.w).toBeCloseTo(640, 9);
    expect(t.contentSize.h).toBeCloseTo(400, 9); // 640 * 0.625
    expect(t.padX).toBeCloseTo(0, 9);
    expect(t.padY).toBeCloseTo(120, 9); // (640 - 400) / 2, split evenly
  });

  it("pads horizontally for a tall frame", () => {
    const t = computeLetterbox({ w: 400, h: 800 }, 640);
    expect(t.scale).toBeCloseTo(0.8, 9); // limited by height
    expect(t.padX).toBeCloseTo(160, 9);
    expect(t.padY).toBeCloseTo(0, 9);
  });

  it("needs no padding for an already-square frame", () => {
    const t = computeLetterbox({ w: 512, h: 512 }, 640);
    expect(t.padX).toBe(0);
    expect(t.padY).toBe(0);
    expect(t.scale).toBeCloseTo(1.25, 9);
  });

  it.each([
    ["zero model size", { w: 100, h: 100 }, 0],
    ["negative model size", { w: 100, h: 100 }, -640],
    ["zero source width", { w: 0, h: 100 }, 640],
    ["NaN source height", { w: 100, h: Number.NaN }, 640],
  ])("REFUSES %s", (_label, source, size) => {
    expect(() => computeLetterbox(source, size)).toThrow(PerceptionError);
  });
});

describe("model ⇄ capture round trips", () => {
  it.each(MATRIX)("round-trips losslessly at $name", ({ dpr }) => {
    const g = geometryAt(dpr);
    const t = computeLetterbox(g.captureSize, 640);
    const original = captureBox(100.5, 200.25, 300.75, 40.125);
    const back = modelToCapture(captureToModel(original, t), t);
    expect(back.x).toBeCloseTo(original.x, 6);
    expect(back.y).toBeCloseTo(original.y, 6);
    expect(back.w).toBeCloseTo(original.w, 6);
    expect(back.h).toBeCloseTo(original.h, 6);
  });

  it("REMOVES THE PADDING — the offset bug, caught explicitly", () => {
    // 1024x640 -> 640 square: padY = 120. A detection at the top of the real content sits
    // at model y = 120, and must come back as capture y = 0.
    const t = computeLetterbox({ w: 1024, h: 640 }, 640);
    const atContentTop = modelBox(0, 120, 64, 20);
    const inCapture = modelToCapture(atContentTop, t);

    expect(inCapture.y).toBeCloseTo(0, 6);
    // Skipping the un-pad would give 120 / 0.625 = 192 capture px - plausible, and wrong
    // on every element on the page.
    expect(inCapture.y).not.toBeCloseTo(192, 1);
  });

  it("unpads before unscaling, not after", () => {
    // The two orders differ by pad/scale. Here: 120/0.625 = 192 px of pure error.
    const t = computeLetterbox({ w: 1024, h: 640 }, 640);
    const b = modelBox(50, 220, 100, 40);
    const correct = modelToCapture(b, t);
    const wrongOrder = (b.y / t.scale) - t.padY; // divide first, then subtract
    expect(correct.y).toBeCloseTo((220 - 120) / 0.625, 6);
    expect(correct.y).not.toBeCloseTo(wrongOrder, 1);
  });
});

describe("the full chain reaches canonical CSS space", () => {
  it.each(MATRIX)("model → capture → CSS lands on the original box at $name", ({ dpr }) => {
    const g = geometryAt(dpr);
    const t = computeLetterbox(g.captureSize, 640);

    // Start from a known CSS box - the QG-02 fixture's phone field.
    const originalCss = cssBox(400, 260, 300, 32);
    const inModel = captureToModel(cssToCapture(originalCss, g), t);
    const backToCss = captureToCss(modelToCapture(inModel, t), g);

    expect(backToCss.x).toBeCloseTo(400, 4);
    expect(backToCss.y).toBeCloseTo(260, 4);
    expect(backToCss.w).toBeCloseTo(300, 4);
    expect(backToCss.h).toBeCloseTo(32, 4);
  });

  it("gives the same CSS box from every DPR, as QG-02 requires", () => {
    // The detector adds a fifth space; the invariant must survive it.
    const results = MATRIX.map(({ dpr }) => {
      const g = geometryAt(dpr);
      const t = computeLetterbox(g.captureSize, 640);
      const inModel = captureToModel(cssToCapture(cssBox(400, 260, 300, 32), g), t);
      return captureToCss(modelToCapture(inModel, t), g);
    });
    for (const r of results) {
      expect(r.x).toBeCloseTo(400, 4);
      expect(r.w).toBeCloseTo(300, 4);
    }
  });
});

describe("the padding is not page content", () => {
  const t = computeLetterbox({ w: 1024, h: 640 }, 640); // padY = 120

  it("rejects a box entirely inside the padding", () => {
    // Grey bars this code invented. A detection here describes nothing real, and after the
    // transform becomes a negative coordinate that still looks like a number.
    expect(isInsideContent(modelBox(0, 0, 640, 100), t)).toBe(false);
    expect(clipToContent(modelBox(0, 0, 640, 100), t)).toBeNull();
  });

  it("accepts a box inside the content", () => {
    expect(isInsideContent(modelBox(10, 200, 100, 50), t)).toBe(true);
  });

  it("clips a box that straddles the content edge", () => {
    // A control flush against the viewport edge legitimately spills into the padding.
    const clipped = clipToContent(modelBox(10, 100, 100, 80), t);
    expect(clipped).not.toBeNull();
    expect(clipped!.y).toBeCloseTo(120, 6); // clamped to the content top
    expect(clipped!.h).toBeCloseTo(60, 6); // 180 - 120
  });

  it("never clamps a padding-only box to a zero-width sliver", () => {
    // The tempting alternative to null: clamp to the boundary. That invents a
    // degenerate element at the edge of every frame.
    for (const b of [modelBox(0, 0, 640, 119), modelBox(0, 521, 640, 119)]) {
      expect(clipToContent(b, t)).toBeNull();
    }
  });
});
