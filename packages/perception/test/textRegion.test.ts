/**
 * M10 — the detector-only text-region contract (ADR-0011), on hand-computed cases.
 *
 * The exhaustive equivalence against the SCREENED implementation (M8.1 / M8.2 / M8.2a) is
 * `tests/browser/support/m10-text-region-golden.test.mjs`. This file pins the contract itself: the
 * identity, the arithmetic, what counts as malformed, and — most of all — that a failure is never
 * an empty result and that nothing here can carry a character.
 */
import { describe, expect, it } from "vitest";

import {
  type CaptureFrame,
  type CaptureGeometry,
  type Detection,
  type TextRegionRuntime,
  DB_POSTPROCESS,
  PerceptionError,
  TEXT_REGION_LABEL,
  TEXT_REGION_ROLE,
  TR01,
  TR01_RESIZE,
  captureBox,
  createTextRegionDetector,
  cssBox,
  cssToCapture,
  cssToCapturePixelRect,
  dbPostprocess,
  frameId,
  preprocessTextRegion,
  textRegionInputSize,
  validateTextRegionOutput,
} from "../src/index.js";

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────
const geometry = (vw: number, vh: number, cw: number, ch: number, dpr = cw / vw): CaptureGeometry => ({
  dpr,
  zoom: 1,
  viewportCss: { w: vw, h: vh },
  captureSize: { w: cw, h: ch },
  scroll: { x: 0, y: 0 },
  origin: "https://fixture.invalid",
});
const frame = (w = 64, h = 40): CaptureFrame => ({ id: frameId("f1"), capturedAt: 0, source: "live", geometry: geometry(w, h, w, h, 1) });
/** A deterministic RGBA image: a light page with one dark bar. */
function image(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dark = y >= 10 && y < 20 && x >= 8 && x < 40;
      rgba[i] = dark ? 20 : 240;
      rgba[i + 1] = dark ? 30 : 235;
      rgba[i + 2] = dark ? 40 : 230;
      rgba[i + 3] = 255;
    }
  return { width: w, height: h, rgba };
}
/** A probability map with filled rectangles [x0, y0, x1, y1, p], inclusive. */
function map(W: number, H: number, fills: readonly (readonly [number, number, number, number, number])[]) {
  const p = new Float32Array(W * H);
  for (const [x0, y0, x1, y1, v] of fills) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p[y * W + x] = v;
  return p;
}
/** A runtime whose `infer` returns a fixed map at the input's own size. */
function runtime(over: Partial<TextRegionRuntime> & { output?: (dims: readonly [1, 3, number, number]) => { data: Float32Array; dims: readonly number[] } } = {}): TextRegionRuntime {
  const { output, ...rest } = over;
  return {
    modelId: TR01.modelId,
    revision: TR01.revision,
    acceptedBackends: TR01.acceptedBackends,
    pixels: () => image(64, 40),
    infer: async (_t, dims) =>
      output ? output(dims) : { data: map(dims[3], dims[2], [[40, 40, 200, 90, 0.9]]), dims: [1, 1, dims[2], dims[3]] },
    ...rest,
  };
}

// ── identity ───────────────────────────────────────────────────────────────────────────────────
describe("TR-01 identity", () => {
  it("is the pinned M8.1 conversion, on wasm only", () => {
    expect(TR01).toMatchObject({
      modelId: "PP-OCRv4_mobile_det",
      revision: "3cc09f3a5b424e8e010abc7a4271aea12999c2f7",
      onnxSha256: "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8",
      onnxBytes: 4_766_440,
    });
    expect(TR01.acceptedBackends).toEqual(["wasm"]);
    expect(Object.isFrozen(TR01)).toBe(true);
  });

  it("declares the role ADR-0011 adds, and a single constant label", () => {
    expect(TEXT_REGION_ROLE).toBe("TextRegionDetector");
    expect(TEXT_REGION_LABEL).toBe("text-region");
    expect(createTextRegionDetector(null).role).toBe("TextRegionDetector");
  });

  it("uses the parameters TR-01's inference.yml declares", () => {
    expect(TR01_RESIZE).toEqual({ type: "long-side", resizeLong: 960, stride: 128 });
    expect(DB_POSTPROCESS).toEqual({ thresh: 0.3, boxThresh: 0.6, maxCandidates: 1000, unclipRatio: 1.5, minSize: 3 });
  });
});

// ── preprocessing ──────────────────────────────────────────────────────────────────────────────
describe("preprocessing", () => {
  it("resizes the long side to 960 and rounds each side UP to a multiple of 128", () => {
    expect(textRegionInputSize(TR01_RESIZE, 720, 1280)).toEqual([640, 1024]); // M8.1: 640x1024
    expect(textRegionInputSize(TR01_RESIZE, 1440, 2560)).toEqual([640, 1024]);
    expect(textRegionInputSize(TR01_RESIZE, 900, 1600)).toEqual([640, 1024]);
    expect(textRegionInputSize(TR01_RESIZE, 1280, 720)).toEqual([1024, 640]);
    expect(textRegionInputSize(TR01_RESIZE, 40, 64)).toEqual([640, 1024]);
  });

  it("produces a [1, 3, H, W] float tensor, BGR, ImageNet-normalised", () => {
    const t = preprocessTextRegion({ width: 2, height: 2, rgba: new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]) });
    // A square source: both sides go to 960, then up to 1024.
    expect(t.dims).toEqual([1, 3, 1024, 1024]);
    expect(t.tensor.length).toBe(3 * 1024 * 1024);
    // A uniform image stays uniform: channel 0 is BLUE (30), normalised with the first mean/std.
    const plane = 1024 * 1024;
    const f = Math.fround;
    expect(t.tensor[0]).toBe(f(f(f(30 / 255) - f(0.485)) / f(0.229)));
    expect(t.tensor[plane]).toBe(f(f(f(20 / 255) - f(0.456)) / f(0.224)));
    expect(t.tensor[2 * plane]).toBe(f(f(f(10 / 255) - f(0.406)) / f(0.225)));
    expect(t.ratioH).toBe(1024 / 2);
    expect(t.ratioW).toBe(1024 / 2);
  });

  it("is deterministic", () => {
    const a = preprocessTextRegion(image(64, 40)).tensor;
    const b = preprocessTextRegion(image(64, 40)).tensor;
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });
});

// ── output validation ──────────────────────────────────────────────────────────────────────────
describe("model-output validation — malformed is refused, never salvaged", () => {
  const dims = [1, 3, 8, 8] as const;
  const good = () => ({ data: new Float32Array(64).fill(0.1), dims: [1, 1, 8, 8] });

  it("accepts a [1, 1, H, W] probability map at the input's size", () => {
    expect(validateTextRegionOutput(good(), dims)).toEqual({ ok: true, value: { H: 8, W: 8 } });
  });

  it("refuses a wrong rank, batch, channel count or spatial size", () => {
    for (const d of [[1, 8, 8], [2, 1, 8, 8], [1, 2, 8, 8], [1, 1, 8, 9], [1, 1, 4, 4]]) {
      const r = validateTextRegionOutput({ data: new Float32Array(64), dims: d }, dims);
      expect(r.ok, JSON.stringify(d)).toBe(false);
      expect(!r.ok && r.code).toBe("MODEL_OUTPUT_MALFORMED");
    }
  });

  it("refuses a wrong element count, or a non-Float32Array", () => {
    expect(validateTextRegionOutput({ data: new Float32Array(63), dims: [1, 1, 8, 8] }, dims).ok).toBe(false);
    expect(validateTextRegionOutput({ data: [0.1] as unknown as Float32Array, dims: [1, 1, 8, 8] }, dims).ok).toBe(false);
  });

  it("refuses NaN, Infinity, negatives and values above 1", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1e-6, 1.0001]) {
      const o = good();
      o.data[17] = bad;
      expect(validateTextRegionOutput(o, dims).ok, String(bad)).toBe(false);
    }
  });
});

// ── DB post-processing ─────────────────────────────────────────────────────────────────────────
describe("DB post-processing", () => {
  it("expands a component by the unclip distance and maps it back to source pixels", () => {
    // 10x4 block at (3..12, 2..5), p = 0.9. d = 40 * 1.5 / (2 * 14).
    const { boxes, candidates } = dbPostprocess(map(20, 10, [[3, 2, 12, 5, 0.9]]), 10, 20, 1, 1, 10, 20);
    const d = 60 / 28;
    expect(candidates).toBe(1);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBeCloseTo(3 - d, 12);
    expect(boxes[0]!.y).toBe(0);
    expect(boxes[0]!.x + boxes[0]!.w).toBeCloseTo(13 + d, 12);
    expect(boxes[0]!.y + boxes[0]!.h).toBeCloseTo(6 + d, 12);
  });

  it("preserves the mean probability as the score", () => {
    const { boxes } = dbPostprocess(map(20, 10, [[3, 2, 12, 5, 0.75]]), 10, 20, 1, 1, 10, 20);
    expect(boxes[0]!.score).toBeCloseTo(0.75, 6);
  });

  it("drops a low-scoring component and one thinner than min_size, and finds nothing in an empty map", () => {
    expect(dbPostprocess(map(30, 10, [[2, 2, 10, 6, 0.5], [15, 2, 25, 3, 0.9]]), 10, 30, 1, 1, 10, 30).boxes).toEqual([]);
    expect(dbPostprocess(new Float32Array(200), 10, 20, 1, 1, 10, 20)).toEqual({ boxes: [], candidates: 0 });
  });

  it("is deterministic for identical model output", () => {
    const p = map(40, 20, [[2, 2, 12, 6, 0.9], [20, 10, 35, 16, 0.8]]);
    expect(dbPostprocess(p, 20, 40, 2, 2, 10, 20)).toEqual(dbPostprocess(new Float32Array(p), 20, 40, 2, 2, 10, 20));
  });
});

// ── the detector — failure is never an empty list ──────────────────────────────────────────────
describe("createTextRegionDetector", () => {
  it("returns boxes in capture pixels, labelled exactly 'text-region', with the score kept", async () => {
    const r = await createTextRegionDetector(runtime()).detect(frame(), "wasm");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(1);
    for (const d of r.value) {
      expect(d.label).toBe("text-region");
      expect(Object.keys(d).sort()).toEqual(["box", "label", "score"]);
      expect(Object.keys(d.box).sort()).toEqual(["h", "w", "x", "y"]);
      expect(d.score).toBeCloseTo(0.9, 6);
      expect(d.box.x).toBeGreaterThanOrEqual(0);
      expect(d.box.x + d.box.w).toBeLessThanOrEqual(64 + 1e-9);
    }
  });

  it("returns a VALID empty list when the model finds nothing — the only way to get []", async () => {
    const r = await createTextRegionDetector(runtime({ output: (d) => ({ data: new Float32Array(d[2] * d[3]), dims: [1, 1, d[2], d[3]] }) })).detect(frame(), "wasm");
    expect(r).toEqual({ ok: true, value: [] });
  });

  it("refuses when no runtime exists (tier unavailable), never []", async () => {
    const r = await createTextRegionDetector(null).detect(frame(), "wasm");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("DETECTOR_UNAVAILABLE");
  });

  it("refuses a backend it was not measured on", async () => {
    const r = await createTextRegionDetector(runtime()).detect(frame(), "webgpu");
    expect(!r.ok && r.code).toBe("DETECTOR_BACKEND_UNSUPPORTED");
  });

  it("maps an inference error to a refusal, never []", async () => {
    const r = await createTextRegionDetector(runtime({ infer: () => Promise.reject(new Error("session gone")) })).detect(frame(), "wasm");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.code).toBe("DETECTOR_UNAVAILABLE");
  });

  it("maps a deadline to DETECTOR_TIMEOUT, distinct from an error", async () => {
    const timeout = Object.assign(new Error("deadline 2000 ms passed"), { code: "DETECTOR_TIMEOUT" });
    const r = await createTextRegionDetector(runtime({ infer: () => Promise.reject(timeout) })).detect(frame(), "wasm");
    expect(!r.ok && r.code).toBe("DETECTOR_TIMEOUT");
  });

  it("maps a pixel-read failure to a refusal", async () => {
    const r = await createTextRegionDetector(runtime({ pixels: () => { throw new Error("no frame"); } })).detect(frame(), "wasm");
    expect(!r.ok && r.code).toBe("DETECTOR_UNAVAILABLE");
  });

  it("refuses malformed model output as a whole — fail closed", async () => {
    const cases = [
      (d: readonly [1, 3, number, number]) => ({ data: new Float32Array(d[2] * d[3]).fill(Number.NaN), dims: [1, 1, d[2], d[3]] }),
      (d: readonly [1, 3, number, number]) => ({ data: new Float32Array(10), dims: [1, 1, d[2], d[3]] }),
      (d: readonly [1, 3, number, number]) => ({ data: new Float32Array(d[2] * d[3]), dims: [1, 2, d[2], d[3]] }),
    ];
    for (const output of cases) {
      const r = await createTextRegionDetector(runtime({ output })).detect(frame(), "wasm");
      expect(!r.ok && r.code).toBe("MODEL_OUTPUT_MALFORMED");
    }
  });

  it("reports stage timings when asked, and never depends on them", async () => {
    const stages: string[] = [];
    await createTextRegionDetector(runtime({ onStage: (s) => stages.push(s) })).detect(frame(), "wasm");
    expect(stages).toEqual(["preprocess", "infer", "postprocess"]);
  });
});

// ── type safety: nothing here can carry a character ────────────────────────────────────────────
describe("no plaintext can be expressed", () => {
  it("a Detection admits no text, count, class or reference field (compile-time)", () => {
    const box = captureBox(1, 2, 3, 4);
    // @ts-expect-error — a detection has no `text`
    const a: Detection = { box, label: TEXT_REGION_LABEL, score: 0.9, text: "7712" };
    // @ts-expect-error — no `length` (a character count)
    const b: Detection = { box, label: TEXT_REGION_LABEL, score: 0.9, length: 4 };
    // @ts-expect-error — no `piiClass`
    const c: Detection = { box, label: TEXT_REGION_LABEL, score: 0.9, piiClass: null };
    // @ts-expect-error — no `ref`
    const d: Detection = { box, label: TEXT_REGION_LABEL, score: 0.9, ref: "x" };
    expect([a, b, c, d]).toHaveLength(4);
  });

  it("the runtime's output type is a float map and dims — no string field", () => {
    // @ts-expect-error — an inference output has no `text`
    const o: Parameters<typeof validateTextRegionOutput>[0] = { data: new Float32Array(1), dims: [1, 1, 1, 1], text: "x" };
    expect(o).toBeDefined();
  });
});

// ── cssToCapturePixelRect — rounding may only grow a mask ──────────────────────────────────────
describe("cssToCapturePixelRect", () => {
  const DPRS = [1, 1.25, 1.5, 2];

  it("covers the mathematically scaled rectangle at DPR 1, 1.25, 1.5 and 2", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const dpr of DPRS) {
      const g = geometry(1280, 720, Math.round(1280 * dpr), Math.round(720 * dpr), dpr);
      for (let i = 0; i < 500; i++) {
        const b = cssBox(rnd() * 1200, rnd() * 680, 0.01 + rnd() * 80, 0.01 + rnd() * 40);
        const exact = cssToCapture(b, g);
        const r = cssToCapturePixelRect(b, g);
        expect(r).not.toBeNull();
        expect(Number.isInteger(r!.x) && Number.isInteger(r!.y) && Number.isInteger(r!.w) && Number.isInteger(r!.h)).toBe(true);
        expect(r!.x).toBeLessThanOrEqual(exact.x);
        expect(r!.y).toBeLessThanOrEqual(exact.y);
        expect(r!.x + r!.w).toBeGreaterThanOrEqual(Math.min(g.captureSize.w, exact.x + exact.w));
        expect(r!.y + r!.h).toBeGreaterThanOrEqual(Math.min(g.captureSize.h, exact.y + exact.h));
      }
    }
  });

  it("maps integer, fractional and very small boxes exactly as expected", () => {
    const g2 = geometry(1280, 720, 2560, 1440, 2);
    expect(cssToCapturePixelRect(cssBox(10, 20, 30, 40), g2)).toEqual({ x: 20, y: 40, w: 60, h: 80 });
    const g125 = geometry(1280, 720, 1600, 900, 1.25);
    // 10.3*1.25 = 12.875 → 12 ; (10.3+5.1)*1.25 = 19.25 → 20
    expect(cssToCapturePixelRect(cssBox(10.3, 10.3, 5.1, 5.1), g125)).toEqual({ x: 12, y: 12, w: 8, h: 8 });
    // a sub-pixel box still covers at least one whole pixel
    expect(cssToCapturePixelRect(cssBox(5.4, 5.4, 0.01, 0.01), geometry(100, 100, 100, 100, 1))).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });

  it("handles a capture SMALLER than the viewport (a scaled stream frame)", () => {
    const g = geometry(1280, 720, 960, 540, 1); // 0.75 capture px per CSS px
    // (100, 100, 10, 10) → (75, 75, 7.5, 7.5) → [75, 83)
    expect(cssToCapturePixelRect(cssBox(100, 100, 10, 10), g)).toEqual({ x: 75, y: 75, w: 8, h: 8 });
  });

  it("clips to the frame, keeps edge-touching boxes, and returns null only outside it", () => {
    const g = geometry(100, 50, 200, 100, 2);
    expect(cssToCapturePixelRect(cssBox(-10, -10, 20, 20), g)).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(cssToCapturePixelRect(cssBox(90, 40, 20, 20), g)).toEqual({ x: 180, y: 80, w: 20, h: 20 });
    expect(cssToCapturePixelRect(cssBox(99.9, 49.9, 0.1, 0.1), g)).toEqual({ x: 199, y: 99, w: 1, h: 1 });
    expect(cssToCapturePixelRect(cssBox(100, 0, 5, 5), g)).toBeNull();
    expect(cssToCapturePixelRect(cssBox(-20, 0, 10, 5), g)).toBeNull();
  });

  it("refuses a non-finite or non-positive box — never 'nothing to mask'", () => {
    const g = geometry(100, 50, 100, 50, 1);
    for (const b of [cssBox(Number.NaN, 0, 1, 1), cssBox(0, 0, 0, 1), cssBox(0, 0, 1, -1), cssBox(0, 0, Number.POSITIVE_INFINITY, 1)]) {
      expect(() => cssToCapturePixelRect(b, g)).toThrow(PerceptionError);
    }
  });

  it("refuses an ambiguous geometry (zero, negative, skewed)", () => {
    const b = cssBox(1, 1, 1, 1);
    expect(() => cssToCapturePixelRect(b, geometry(100, 50, 0, 50, 1))).toThrow(PerceptionError);
    expect(() => cssToCapturePixelRect(b, geometry(100, 50, -100, -50, 1))).toThrow(PerceptionError);
    expect(() => cssToCapturePixelRect(b, geometry(100, 50, 200, 50, 2))).toThrow(PerceptionError);
  });
});
