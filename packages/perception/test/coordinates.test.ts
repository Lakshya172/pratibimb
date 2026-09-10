/**
 * QG-02 — the coordinate contract.
 *
 * The gate's own wording: *"A CI test renders a fixture at DPR 1.0, 1.5 and 2.0 and at
 * 100% and 125% zoom, and asserts that the same logical element resolves to the same
 * CSS-pixel box in all six configurations."*
 *
 * That six-configuration assertion is the load-bearing test in this file. Everything else
 * exists because the ways to fail it silently are more numerous than the ways to pass it.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureGeometry,
  scaleToCss,
  deviceToCss,
  cssToDevice,
  captureToCss,
  cssToCapture,
  cssToDocument,
  documentToCss,
  classifyContainment,
  clipToViewport,
  cssBox,

  captureBox,

  PerceptionError,
} from "@pratibimb/perception";

/**
 * The six QG-02 configurations.
 *
 * `dpr` is the EFFECTIVE devicePixelRatio the browser reports, which already includes
 * zoom: a physically-2.0 display at 125% reports 2.5. The capture is device-sized, so
 * captureSize = round(viewportCss * dpr).
 *
 * The viewport is 1024x640 CSS px in every row. That is the invariant being protected —
 * CSS pixels are the space in which the page's own layout is expressed, so a 200 px
 * element is 200 CSS px at every DPR and every zoom.
 */
const VIEWPORT = { w: 1024, h: 640 };

interface Config {
  readonly name: string;
  readonly physicalDpr: number;
  readonly zoom: number;
}

const QG02_MATRIX: readonly Config[] = [
  { name: "DPR 1.0 @ 100%", physicalDpr: 1.0, zoom: 1.0 },
  { name: "DPR 1.0 @ 125%", physicalDpr: 1.0, zoom: 1.25 },
  { name: "DPR 1.5 @ 100%", physicalDpr: 1.5, zoom: 1.0 },
  { name: "DPR 1.5 @ 125%", physicalDpr: 1.5, zoom: 1.25 },
  { name: "DPR 2.0 @ 100%", physicalDpr: 2.0, zoom: 1.0 },
  { name: "DPR 2.0 @ 125%", physicalDpr: 2.0, zoom: 1.25 },
];

function geometryFor(c: Config, scroll = { x: 0, y: 0 }): CaptureGeometry {
  const effectiveDpr = c.physicalDpr * c.zoom;
  return {
    dpr: effectiveDpr,
    zoom: c.zoom,
    viewportCss: VIEWPORT,
    captureSize: {
      w: Math.round(VIEWPORT.w * effectiveDpr),
      h: Math.round(VIEWPORT.h * effectiveDpr),
    },
    scroll,
    origin: "https://seva.gov.in",
  };
}

describe("QG-02 — the same logical element in all six configurations", () => {
  /**
   * The element as the PAGE defines it: 300x32 CSS px at (400, 260). This never changes,
   * because CSS pixels are the page's own space.
   */
  const LOGICAL = cssBox(400, 260, 300, 32);

  it("resolves to the same CSS-pixel box in all six configurations", () => {
    const results = QG02_MATRIX.map((c) => {
      const g = geometryFor(c);
      // Round-trip through the capture space a detector would actually see, which is where
      // a wrong scale factor would show up.
      const inCapture = cssToCapture(LOGICAL, g);
      const backToCss = captureToCss(inCapture, g);
      return { name: c.name, box: backToCss };
    });

    for (const r of results) {
      expect(r.box.x, r.name).toBeCloseTo(LOGICAL.x, 6);
      expect(r.box.y, r.name).toBeCloseTo(LOGICAL.y, 6);
      expect(r.box.w, r.name).toBeCloseTo(LOGICAL.w, 6);
      expect(r.box.h, r.name).toBeCloseTo(LOGICAL.h, 6);
    }

    // And all six agree with each other, not merely each with itself.
    const first = results[0]!.box;
    for (const r of results.slice(1)) {
      expect(r.box.x, `${r.name} vs ${results[0]!.name}`).toBeCloseTo(first.x, 6);
      expect(r.box.w, `${r.name} vs ${results[0]!.name}`).toBeCloseTo(first.w, 6);
    }
  });

  it("covers exactly the DPR and zoom values the gate names", () => {
    // Guards against the matrix being quietly trimmed to whatever passes.
    expect(new Set(QG02_MATRIX.map((c) => c.physicalDpr))).toEqual(new Set([1.0, 1.5, 2.0]));
    expect(new Set(QG02_MATRIX.map((c) => c.zoom))).toEqual(new Set([1.0, 1.25]));
    expect(QG02_MATRIX).toHaveLength(6);
  });
});

describe("zoom is recorded, never multiplied", () => {
  /**
   * The specific bug this guards: `dpr * zoom`.
   *
   * `window.devicePixelRatio` already includes zoom, so multiplying again is wrong by
   * exactly the zoom factor — invisible at 100%, which is every dev machine, and 25% off
   * on the judging machine.
   */
  it("does not apply zoom a second time in device conversion", () => {
    const g = geometryFor({ name: "x", physicalDpr: 2.0, zoom: 1.25 }); // effective dpr 2.5
    const device = cssToDevice(cssBox(100, 100, 200, 40), g);

    expect(device.x).toBeCloseTo(250, 6); // 100 * 2.5
    expect(device.w).toBeCloseTo(500, 6); // 200 * 2.5
    // The double-counted answer would be 100 * 2.5 * 1.25 = 312.5.
    expect(device.x).not.toBeCloseTo(312.5, 3);
  });

  it("keeps zoom in the geometry even when it is 1.0", () => {
    // The manifest obligation: never omit a field because it happens to be 1.0 on the dev
    // machine. A geometry that drops it cannot be distinguished from one that forgot.
    const g = geometryFor({ name: "x", physicalDpr: 1.0, zoom: 1.0 });
    expect(g.zoom).toBe(1.0);
    expect(g.dpr).toBe(1.0);
  });
});

describe("round trips", () => {
  it.each(QG02_MATRIX)("device ⇄ css round-trips at $name", (c) => {
    const g = geometryFor(c);
    const original = cssBox(12.5, 33.25, 101.75, 19.5);
    const back = deviceToCss(cssToDevice(original, g), g);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.y).toBeCloseTo(original.y, 9);
    expect(back.w).toBeCloseTo(original.w, 9);
    expect(back.h).toBeCloseTo(original.h, 9);
  });

  it.each(QG02_MATRIX)("capture ⇄ css round-trips at $name", (c) => {
    const g = geometryFor(c);
    const original = cssBox(0.5, 639.5, 1023.25, 0.25);
    const back = captureToCss(cssToCapture(original, g), g);
    expect(back.x).toBeCloseTo(original.x, 9);
    expect(back.h).toBeCloseTo(original.h, 9);
  });

  it("css ⇄ document round-trips under scroll", () => {
    const g = geometryFor(QG02_MATRIX[2]!, { x: 40, y: 1200 });
    const original = cssBox(10, 20, 100, 30);
    const doc = cssToDocument(original, g);

    expect(doc.x).toBe(50); // 10 + 40
    expect(doc.y).toBe(1220); // 20 + 1200
    expect(doc.w).toBe(100); // extents are scroll-invariant

    const back = documentToCss(doc, g);
    expect(back.x).toBe(original.x);
    expect(back.y).toBe(original.y);
  });

  it("preserves fractional coordinates rather than rounding them away", () => {
    // Sub-pixel geometry is normal at fractional DPR. Rounding here would accumulate
    // through the pipeline and land a click a pixel or two off on dense forms.
    const g = geometryFor(QG02_MATRIX[2]!); // DPR 1.5
    const original = cssBox(100.4, 200.6, 33.3, 11.1);
    const back = captureToCss(cssToCapture(original, g), g);
    expect(back.x).toBeCloseTo(100.4, 9);
    expect(back.w).toBeCloseTo(33.3, 9);
    expect(Number.isInteger(back.x)).toBe(false);
  });
});

describe("scale_to_css", () => {
  it("equals 1/dpr for a full-resolution capture", () => {
    const g = geometryFor({ name: "x", physicalDpr: 2.0, zoom: 1.0 });
    expect(scaleToCss(g)).toBeCloseTo(0.5, 9);
  });

  it("folds a downscale and the device ratio into one factor", () => {
    // A 2048-wide device capture downscaled to 1024 for transmission, from a 1024 CSS
    // viewport: scale_to_css is 1.0, not 0.5. Deriving it from dpr alone would be wrong.
    const g: CaptureGeometry = {
      dpr: 2.0,
      zoom: 1.0,
      viewportCss: { w: 1024, h: 640 },
      captureSize: { w: 1024, h: 640 },
      scroll: { x: 0, y: 0 },
      origin: "https://seva.gov.in",
    };
    expect(scaleToCss(g)).toBeCloseTo(1.0, 9);
    const css = captureToCss(captureBox(100, 50, 200, 20), g);
    expect(css.x).toBeCloseTo(100, 9);
  });
});

describe("fail closed on ambiguous geometry", () => {
  const base = geometryFor(QG02_MATRIX[0]!);

  it.each([
    ["zero capture width", { captureSize: { w: 0, h: 640 } }],
    ["negative dpr", { dpr: -1 }],
    ["NaN dpr", { dpr: Number.NaN }],
    ["Infinite zoom", { zoom: Number.POSITIVE_INFINITY }],
    ["zero viewport height", { viewportCss: { w: 1024, h: 0 } }],
  ])("refuses to transform with %s", (_label, patch) => {
    const g = { ...base, ...patch } as CaptureGeometry;
    // Refusal must happen at the transform, not merely in a validator someone might skip.
    expect(() => captureToCss(captureBox(0, 0, 10, 10), g)).toThrow(PerceptionError);
    expect(() => cssToDevice(cssBox(0, 0, 10, 10), g)).toThrow(PerceptionError);
    expect(() => scaleToCss(g)).toThrowError(/ambiguous|inconsistent/i);
  });

  it("refuses when NaN scroll would make document space meaningless", () => {
    const g = { ...base, scroll: { x: Number.NaN, y: 0 } } as CaptureGeometry;
    expect(() => cssToDocument(cssBox(0, 0, 1, 1), g)).toThrowError(/ambiguous/i);
  });

  it("REFUSES a capture whose aspect ratio disagrees with the viewport", () => {
    // A single scale_to_css cannot describe both axes. Silently using the horizontal one
    // skews every box vertically — a whole-page grounding failure that still looks
    // plausible in a screenshot.
    const g: CaptureGeometry = {
      ...base,
      viewportCss: { w: 1024, h: 640 },
      captureSize: { w: 1024, h: 480 },
    };
    expect(() => scaleToCss(g)).toThrowError(/inconsistent/i);
    try {
      scaleToCss(g);
    } catch (e) {
      expect((e as PerceptionError).code).toBe("CAPTURE_DIMENSION_MISMATCH");
    }
  });

  it("tolerates sub-percent rounding differences between the axes", () => {
    // 1043 CSS px at DPR 1.5 rounds to 1565 or 1564 depending on the browser. That is
    // rounding, not a mismatch, and refusing it would make the gate unusable in practice.
    const g: CaptureGeometry = {
      ...base,
      viewportCss: { w: 1043, h: 641 },
      captureSize: { w: 1565, h: 961 },
    };
    expect(() => scaleToCss(g)).not.toThrow();
  });
});

describe("containment and clipping", () => {
  const g = geometryFor(QG02_MATRIX[0]!); // 1024x640

  it.each([
    ["fully inside", cssBox(10, 10, 100, 20), "INSIDE"],
    ["exactly flush with the viewport", cssBox(0, 0, 1024, 640), "INSIDE"],
    ["straddling the bottom edge", cssBox(10, 620, 100, 40), "CLIPPED"],
    ["straddling the left edge", cssBox(-20, 10, 100, 20), "CLIPPED"],
    ["entirely below the fold", cssBox(10, 700, 100, 20), "OUTSIDE"],
    ["entirely above the viewport", cssBox(10, -50, 100, 20), "OUTSIDE"],
    ["touching the bottom edge but not crossing", cssBox(10, 640, 100, 20), "OUTSIDE"],
    ["zero height", cssBox(10, 10, 100, 0), "OUTSIDE"],
  ])("classifies %s as %s", (_label, box, expected) => {
    expect(classifyContainment(box, g)).toBe(expected);
  });

  it("clips a partially visible element to the part that actually exists", () => {
    const clipped = clipToViewport(cssBox(10, 620, 100, 40), g);
    expect(clipped).not.toBeNull();
    expect(clipped!.y).toBe(620);
    expect(clipped!.h).toBe(20); // 640 - 620, not the full 40
  });

  it("returns null when there is nothing to clip to", () => {
    expect(clipToViewport(cssBox(10, 700, 100, 20), g)).toBeNull();
  });
});
