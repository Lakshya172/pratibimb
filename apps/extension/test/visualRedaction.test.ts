/**
 * M10.5 — full-frame TR-01 outcome → fail-closed plan → canonical geometry → opaque pixels, in Node.
 *
 * Pixel-exact: there is no encoder yet, so every assertion compares RGBA bytes directly. "Covered"
 * means the pixel IS the fill; "unchanged" means byte-identical to a copy taken before masking. The
 * fixture's expected numbers are hand-computed (`support/maskFixture.expected.json`).
 *
 * The canonical-geometry golden vectors are carried through the same path in
 * `tests/browser/support/m10-mask-golden.test.mjs`; the real frame and the real worker are
 * `tests/browser/extension/run-visual-mask.mjs`.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssBox, cssToCapture, type CaptureGeometry } from "@pratibimb/perception";
import { MASK_FILL, PixelMaskError, fillOpaque, redactionMask, wipeFrame, type PixelRect, type RgbaFrame, type VisualRegion } from "@pratibimb/privacy";

import type { Tr01Outcome } from "../host-lib/tr01-host";
import { reportFromFullFrame, sanitizeFrame, type SanitizeOutcome } from "../host-lib/visual-redaction";
import { generateFrame, HEIGHT, WIDTH, type Rect } from "./support/maskFixture";

const EXPECTED = JSON.parse(readFileSync(new URL("./support/maskFixture.expected.json", import.meta.url), "utf8"));
const ROOT = new URL("../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const REGIONS: VisualRegion[] = EXPECTED.regions.map((r: { id: string; rect: Rect }) => ({ id: r.id, rect: r.rect }));
const geometry = (w = WIDTH, h = HEIGHT, dpr = 1, vw = w / dpr, vh = h / dpr): CaptureGeometry => ({
  dpr,
  zoom: 1,
  viewportCss: { w: vw, h: vh },
  captureSize: { w, h },
  scroll: { x: 0, y: 0 },
  origin: "http://127.0.0.1:8975",
});
const okOutcome = (detections: readonly { x: number; y: number; w: number; h: number; score: number }[]): Tr01Outcome => ({
  ok: true,
  runId: 1,
  detections: detections.map(({ x, y, w, h, score }) => ({ x, y, w, h, score })),
  ms: { preprocess: 0, infer: 0, postprocess: 0, total: 0 },
});
const failed = (code: Extract<Tr01Outcome, { ok: false }>["code"]): Tr01Outcome => ({ ok: false, runId: 1, code, detail: "synthetic" });

const isFill = (rgba: Uint8ClampedArray | Uint8Array, i: number) =>
  rgba[i * 4] === MASK_FILL.r && rgba[i * 4 + 1] === MASK_FILL.g && rgba[i * 4 + 2] === MASK_FILL.b && rgba[i * 4 + 3] === MASK_FILL.a;
const samePixel = (a: Uint8ClampedArray | Uint8Array, b: Uint8ClampedArray | Uint8Array, i: number) =>
  a[i * 4] === b[i * 4] && a[i * 4 + 1] === b[i * 4 + 1] && a[i * 4 + 2] === b[i * 4 + 2] && a[i * 4 + 3] === b[i * 4 + 3];

/** Pixels in the union of integer pixel rects (clipped to the frame), as a set of indices. */
function pixelsIn(rects: readonly PixelRect[], width: number, height: number): Set<number> {
  const s = new Set<number>();
  for (const r of rects)
    for (let y = Math.max(0, r.y); y < Math.min(height, r.y + r.h); y++)
      for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.w); x++) s.add(y * width + x);
  return s;
}

/** Every pixel under the mask is the fill; every pixel outside it is byte-identical to `before`. */
function verify(before: Uint8ClampedArray, after: RgbaFrame, masked: Set<number>) {
  let covered = 0;
  let accidental = 0;
  let notCovered = 0;
  let changed = 0;
  for (let i = 0; i < after.width * after.height; i++) {
    const same = samePixel(before, after.rgba, i);
    if (!same) changed += 1;
    if (masked.has(i)) (isFill(after.rgba, i) ? covered++ : notCovered++);
    else if (!same) accidental += 1;
  }
  return { covered, notCovered, accidental, changed, unchanged: after.width * after.height - changed };
}

const sanitized = (o: SanitizeOutcome) => {
  if (o.outcome !== "SANITIZED") throw new Error(`expected SANITIZED, got REFUSED ${o.code}: ${o.detail}`);
  return o;
};

// ───────────────────────────── the pure fill ─────────────────────────────

describe("fillOpaque — constant-colour opaque fill, in place", () => {
  const blank = (w = 10, h = 8): RgbaFrame & { rgba: Uint8ClampedArray } => ({ width: w, height: h, rgba: new Uint8ClampedArray(w * h * 4).fill(200) });
  const filled = (f: RgbaFrame) => [...Array(f.width * f.height).keys()].filter((i) => isFill(f.rgba, i));

  it("fills exactly one rectangle, fully opaque, in the buffer it was given", () => {
    const f = blank();
    const buffer = f.rgba.buffer;
    expect(fillOpaque(f, [{ x: 2, y: 1, w: 3, h: 2 }])).toEqual({ rectsApplied: 1, pixelWrites: 6 });
    expect(f.rgba.buffer).toBe(buffer);
    expect(filled(f)).toEqual([12, 13, 14, 22, 23, 24]);
    expect(MASK_FILL).toEqual({ r: 0, g: 0, b: 0, a: 255 });
  });

  it("overlapping rectangles fill their union (writes counted honestly)", () => {
    const f = blank();
    const out = fillOpaque(f, [{ x: 0, y: 0, w: 3, h: 3 }, { x: 2, y: 2, w: 3, h: 3 }]);
    expect(out.pixelWrites).toBe(18);
    expect(filled(f).length).toBe(17);
  });

  it("touching rectangles leave no gap and no overlap", () => {
    const f = blank();
    fillOpaque(f, [{ x: 0, y: 0, w: 5, h: 2 }, { x: 5, y: 0, w: 5, h: 2 }]);
    expect(filled(f)).toEqual([...Array(20).keys()]);
  });

  it("edge-touching, partly outside and wholly outside the frame", () => {
    const f = blank();
    const out = fillOpaque(f, [{ x: 8, y: 6, w: 2, h: 2 }, { x: -3, y: -3, w: 4, h: 4 }, { x: 50, y: 50, w: 3, h: 3 }]);
    expect(out.rectsApplied).toBe(2);
    expect(filled(f)).toEqual([0, 68, 69, 78, 79]);
  });

  it("a 1×1 rectangle, and a rectangle covering the whole frame", () => {
    const a = blank();
    fillOpaque(a, [{ x: 4, y: 3, w: 1, h: 1 }]);
    expect(filled(a)).toEqual([34]);
    const b = blank();
    fillOpaque(b, [{ x: 0, y: 0, w: 10, h: 8 }]);
    expect(filled(b)).toHaveLength(80);
  });

  it("no rectangles changes nothing", () => {
    const f = blank();
    const before = f.rgba.slice();
    expect(fillOpaque(f, [])).toEqual({ rectsApplied: 0, pixelWrites: 0 });
    expect(f.rgba).toEqual(before);
  });

  it.each([
    ["a fractional x", { x: 1.5, y: 0, w: 2, h: 2 }],
    ["a NaN", { x: NaN, y: 0, w: 2, h: 2 }],
    ["Infinity", { x: 0, y: 0, w: Infinity, h: 2 }],
    ["zero width", { x: 0, y: 0, w: 0, h: 2 }],
    ["negative height", { x: 0, y: 0, w: 2, h: -2 }],
  ])("refuses %s and writes NOTHING, even for the valid rectangles beside it", (_n, bad) => {
    const f = blank();
    const before = f.rgba.slice();
    expect(() => fillOpaque(f, [{ x: 0, y: 0, w: 2, h: 2 }, bad])).toThrow(PixelMaskError);
    expect(f.rgba).toEqual(before);
  });

  it("refuses a malformed frame", () => {
    expect(() => fillOpaque({ width: 10, height: 8, rgba: new Uint8ClampedArray(7) }, [])).toThrow(/FRAME|bytes/);
    expect(() => fillOpaque({ width: 2.5, height: 8, rgba: new Uint8ClampedArray(80) }, [])).toThrow(PixelMaskError);
  });

  it("is deterministic", () => {
    const rects = [{ x: 1, y: 1, w: 4, h: 3 }, { x: 3, y: 2, w: 5, h: 5 }];
    const a = blank();
    const b = blank();
    fillOpaque(a, rects);
    fillOpaque(b, rects);
    expect(a.rgba).toEqual(b.rgba);
  });

  it("wipeFrame overwrites every pixel", () => {
    const f = blank();
    wipeFrame(f);
    expect(filled(f)).toHaveLength(80);
  });
});

// ───────────────────────────── the frozen fixture ─────────────────────────────

describe("the frozen synthetic fixture", () => {
  it("is the frame it was frozen as, with no pixel already equal to the fill", () => {
    const f = generateFrame(EXPECTED);
    expect([f.width, f.height]).toEqual([EXPECTED.frame.width, EXPECTED.frame.height]);
    expect(createHash("sha256").update(f.rgba).digest("hex")).toBe(EXPECTED.originalSha256);
    for (let i = 0; i < f.width * f.height; i++) expect(isFill(f.rgba, i)).toBe(false);
  });

  it("detector OK: exactly the hand-computed masks, every sensitive pixel covered, nothing else touched", () => {
    const frame = generateFrame(EXPECTED);
    const before = frame.rgba.slice();
    const report = reportFromFullFrame(okOutcome(EXPECTED.detections), geometry(), REGIONS);
    const out = sanitized(sanitizeFrame({ frame, geometry: geometry(), regions: REGIONS, report }));
    expect(out.frame).toBe(frame);
    expect(out.failClosed).toBe(false);
    for (const r of out.regions) {
      expect(r.cssMask, r.regionId).toEqual(EXPECTED.expected.detectorOk.cssMask[r.regionId]);
      expect(r.pixelRects, r.regionId).toEqual(EXPECTED.expected.detectorOk.pixelRects[r.regionId]);
      expect(pixelsIn(r.pixelRects, WIDTH, HEIGHT).size, r.regionId).toBe(EXPECTED.expected.detectorOk.changedPixelsByRegion[r.regionId]);
    }
    const masked = pixelsIn(out.regions.flatMap((r) => r.pixelRects), WIDTH, HEIGHT);
    const v = verify(before, out.frame, masked);
    expect(v).toEqual({ covered: 9276, notCovered: 0, accidental: 0, changed: 9276, unchanged: WIDTH * HEIGHT - 9276 });
    expect(v.changed).toBe(EXPECTED.expected.detectorOk.changedPixels);

    // every sensitive ink pixel is the fill; the control ink outside every region is untouched
    for (const s of EXPECTED.sensitiveInk as { rect: Rect }[]) {
      for (const i of pixelsIn([s.rect], WIDTH, HEIGHT)) expect(isFill(out.frame.rgba, i)).toBe(true);
    }
    for (const c of EXPECTED.controlInk as { rect: Rect }[]) {
      for (const i of pixelsIn([c.rect], WIDTH, HEIGHT)) expect(samePixel(before, out.frame.rgba, i)).toBe(true);
    }
  });

  it("the masks ARE the canonical geometry over the full-frame boxes (RE-1's association)", () => {
    const boxes = EXPECTED.detections.map(({ x, y, w, h }: Rect) => ({ x, y, w, h }));
    for (const region of REGIONS) {
      expect(redactionMask(boxes, region.rect)).toEqual(EXPECTED.expected.detectorOk.cssMask[region.id]);
    }
  });

  it("masking is deterministic across repeated runs", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const frame = generateFrame(EXPECTED);
      sanitizeFrame({ frame, geometry: geometry(), regions: REGIONS, report: reportFromFullFrame(okOutcome(EXPECTED.detections), geometry(), REGIONS) });
      hashes.add(createHash("sha256").update(frame.rgba).digest("hex"));
    }
    expect(hashes.size).toBe(1);
  });

  it("allocates no second frame: the sanitized frame is the input buffer, and the mask is a rectangle list", () => {
    const frame = generateFrame(EXPECTED);
    const buffer = frame.rgba.buffer;
    const out = sanitized(sanitizeFrame({ frame, geometry: geometry(), regions: REGIONS, report: reportFromFullFrame(okOutcome(EXPECTED.detections), geometry(), REGIONS) }));
    expect(out.frame.rgba.buffer).toBe(buffer);
    expect(out.regions.flatMap((r) => r.pixelRects)).toHaveLength(4);
  });
});

// ───────────────────────────── fail closed ─────────────────────────────

describe("fail closed: any detector or report failure masks every visual region whole", () => {
  const cases: [string, unknown][] = [
    ["detector unavailable", reportFromFullFrame(failed("DETECTOR_UNAVAILABLE"), geometry(), REGIONS)],
    ["detector timeout", reportFromFullFrame(failed("DETECTOR_TIMEOUT"), geometry(), REGIONS)],
    ["detector error", reportFromFullFrame(failed("DETECTOR_ERROR"), geometry(), REGIONS)],
    ["malformed detector output", reportFromFullFrame(failed("MODEL_OUTPUT_MALFORMED"), geometry(), REGIONS)],
    ["busy", reportFromFullFrame(failed("DETECTOR_BUSY"), geometry(), REGIONS)],
    ["missing findings", { status: "OK" }],
    ["an extra finding field", { status: "OK", findings: [{ kind: "UNREAD_REGION", box: { x: 40, y: 40, w: 10, h: 10 }, score: 1, regionId: "canvas:0", treatment: "REDACT_UNREAD", piiClass: null }] }],
    ["an unknown report status", { status: "PROBABLY_FINE", findings: [] }],
    ["no report at all", undefined],
  ];

  it.each(cases)("%s → whole regions, exactly the hand-computed area, nothing outside", (_n, report) => {
    const frame = generateFrame(EXPECTED);
    const before = frame.rgba.slice();
    const out = sanitized(sanitizeFrame({ frame, geometry: geometry(), regions: REGIONS, report }));
    expect(out.failClosed).toBe(true);
    for (const r of out.regions) {
      expect(r.cssMask).toEqual(EXPECTED.expected.failClosed.cssMask[r.regionId]);
      expect(r.pixelRects).toEqual(EXPECTED.expected.failClosed.pixelRects[r.regionId]);
    }
    const masked = pixelsIn(out.regions.flatMap((r) => r.pixelRects), WIDTH, HEIGHT);
    const v = verify(before, out.frame, masked);
    expect(v.notCovered).toBe(0);
    expect(v.accidental).toBe(0);
    expect(v.changed).toBe(EXPECTED.expected.failClosed.changedPixels);
  });

  it("a detector failure is never an empty report", () => {
    for (const code of ["DETECTOR_UNAVAILABLE", "DETECTOR_TIMEOUT", "DETECTOR_ERROR", "MODEL_OUTPUT_MALFORMED", "DETECTOR_BUSY", "DETECTOR_DISPOSED"] as const) {
      const r = reportFromFullFrame(failed(code), geometry(), REGIONS);
      expect(r.status).not.toBe("OK");
      expect(r).not.toHaveProperty("findings");
    }
  });

  it("a valid EMPTY detector result masks nothing — the only way to an empty mask", () => {
    const frame = generateFrame(EXPECTED);
    const before = frame.rgba.slice();
    const report = reportFromFullFrame(okOutcome([]), geometry(), REGIONS);
    expect(report).toEqual({ status: "OK", findings: [] });
    const out = sanitized(sanitizeFrame({ frame, geometry: geometry(), regions: REGIONS, report }));
    expect(out.failClosed).toBe(false);
    expect(out.regions.every((r) => r.cssMask.length === 0 && r.pixelRects.length === 0)).toBe(true);
    expect(out.frame.rgba).toEqual(before);
  });

  it("a geometry that cannot convert a detector box makes the report MALFORMED, not empty", () => {
    const bad = { ...geometry(), captureSize: { w: 0, h: HEIGHT } };
    expect(reportFromFullFrame(okOutcome(EXPECTED.detections), bad, REGIONS)).toEqual({ status: "MALFORMED" });
  });
});

// ───────────────────────────── REFUSED is terminal ─────────────────────────────

describe("REFUSED is terminal: no sanitized frame, and the raw frame is wiped", () => {
  const refusals: [string, readonly VisualRegion[], CaptureGeometry, number, number][] = [
    ["a NaN region rectangle", [{ id: "canvas:0", rect: { x: NaN, y: 0, w: 10, h: 10 } }], geometry(), WIDTH, HEIGHT],
    ["a zero-size region", [{ id: "canvas:0", rect: { x: 0, y: 0, w: 0, h: 10 } }], geometry(), WIDTH, HEIGHT],
    ["duplicate region ids", [...REGIONS, { id: "img:0", rect: { x: 1, y: 1, w: 1, h: 1 } }], geometry(), WIDTH, HEIGHT],
    ["a frame whose size is not the geometry's", REGIONS, geometry(WIDTH + 1, HEIGHT), WIDTH, HEIGHT],
    ["an inconsistent geometry", REGIONS, { ...geometry(), viewportCss: { w: WIDTH, h: HEIGHT * 2 } }, WIDTH, HEIGHT],
  ];

  it.each(refusals)("%s → REFUSED, no frame, every pixel overwritten", (_n, regions, g) => {
    for (const report of [reportFromFullFrame(okOutcome(EXPECTED.detections), geometry(), REGIONS), { status: "TIMEOUT" }]) {
      const frame = generateFrame(EXPECTED);
      const out = sanitizeFrame({ frame, geometry: g, regions, report });
      expect(out.outcome).toBe("REFUSED");
      expect(out).not.toHaveProperty("frame");
      expect(out).not.toHaveProperty("regions");
      expect(out.outcome === "REFUSED" && out.frameWiped).toBe(true);
      for (let i = 0; i < WIDTH * HEIGHT; i++) if (!isFill(frame.rgba, i)) throw new Error(`pixel ${i} survived a REFUSED plan`);
    }
  });

  it("a malformed frame is refused too", () => {
    const out = sanitizeFrame({ frame: { width: WIDTH, height: HEIGHT, rgba: new Uint8ClampedArray(12) }, geometry: geometry(), regions: REGIONS, report: { status: "OK", findings: [] } });
    expect(out).toMatchObject({ outcome: "REFUSED", code: "FRAME_INVALID" });
  });
});

// ───────────────────────────── DPR ─────────────────────────────

describe("the coordinate path at DPR 1, 1.25, 1.5 and 2, fractional positions: a mask never shrinks", () => {
  const VW = 320;
  const VH = 200;
  const cssRegions: VisualRegion[] = [
    { id: "canvas:0", rect: { x: 10.5, y: 12.25, w: 150.75, h: 90.5 } },
    { id: "img:0", rect: { x: 180.25, y: 20.75, w: 130.5, h: 70.25 } },
    { id: "img:1", rect: { x: -20.5, y: 120.5, w: 100.25, h: 60.75 } },
  ];
  const cssBoxes = [
    { x: 30.3, y: 30.6, w: 70.2, h: 11.7 },
    { x: 200.9, y: 40.1, w: 60.4, h: 13.3 },
    { x: 5.5, y: 140.25, w: 40.75, h: 9.5 },
    { x: 150.2, y: 60.4, w: 50.1, h: 12.2 },
  ];

  for (const dpr of [1, 1.25, 1.5, 2]) {
    it(`DPR ${dpr}`, () => {
      const cw = Math.round(VW * dpr);
      const ch = Math.round(VH * dpr);
      const g = geometry(cw, ch, dpr, VW, VH);
      const frame: RgbaFrame & { rgba: Uint8ClampedArray } = { width: cw, height: ch, rgba: new Uint8ClampedArray(cw * ch * 4) };
      for (let i = 0; i < cw * ch; i++) frame.rgba.set([100, 150, 200, 255], i * 4);
      const before = frame.rgba.slice();

      // the detector saw capture pixels
      const detections = cssBoxes.map((b) => ({ x: b.x * dpr, y: b.y * dpr, w: b.w * dpr, h: b.h * dpr, score: 0.9 }));
      const out = sanitized(sanitizeFrame({ frame, geometry: g, regions: cssRegions, report: reportFromFullFrame(okOutcome(detections), g, cssRegions) }));

      for (const r of out.regions) {
        const region = cssRegions.find((x) => x.id === r.regionId)!;
        // canonical geometry, in CSS, over the full-frame boxes converted back to CSS
        // scale_to_css is ONE number (viewport width / capture width), exactly as the contract defines it
        const s = VW / cw;
        const back = detections.map((d) => ({ x: d.x * s, y: d.y * s, w: d.w * s, h: d.h * s }));
        expect(r.cssMask).toEqual(redactionMask(back, region.rect));
        // outward rounding: the pixel rectangle contains the exactly scaled rectangle
        for (const [i, m] of r.cssMask.entries()) {
          const exact = cssToCapture(cssBox(m.x, m.y, m.w, m.h), g);
          const px = r.pixelRects[i]!;
          expect(px.x).toBeLessThanOrEqual(Math.max(0, exact.x));
          expect(px.y).toBeLessThanOrEqual(Math.max(0, exact.y));
          expect(px.x + px.w).toBeGreaterThanOrEqual(Math.min(cw, exact.x + exact.w) - 1e-9);
          expect(px.y + px.h).toBeGreaterThanOrEqual(Math.min(ch, exact.y + exact.h) - 1e-9);
          // and every capture pixel the exact rectangle touches is the fill
          for (let y = Math.max(0, Math.floor(exact.y)); y < Math.min(ch, Math.ceil(exact.y + exact.h)); y++)
            for (let x = Math.max(0, Math.floor(exact.x)); x < Math.min(cw, Math.ceil(exact.x + exact.w)); x++)
              if (!isFill(frame.rgba, y * cw + x)) throw new Error(`DPR ${dpr}: pixel (${x}, ${y}) under ${r.regionId} not covered`);
        }
      }
      const v = verify(before, out.frame, pixelsIn(out.regions.flatMap((r) => r.pixelRects), cw, ch));
      expect(v.notCovered).toBe(0);
      expect(v.accidental).toBe(0);
      expect(v.changed).toBeGreaterThan(0);
    });
  }
});

// ───────────────────────────── the boundary ─────────────────────────────

describe("the masking code touches pixels and geometry only", () => {
  const files = {
    "visual-redaction.ts": strip(read("apps/extension/host-lib/visual-redaction.ts")),
    "pixelRedaction.ts": strip(read("packages/privacy/src/pixelRedaction.ts")),
  };

  it.each(Object.entries(files))("%s: no network, DOM, model, text, OCR, encode, egress or action", (_n, src) => {
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|chrome\.|navigator\b|document\b|window\b/);
    expect(src).not.toMatch(/InferenceSession|onnx|WebAssembly|importScripts|new Worker/);
    expect(src).not.toMatch(/OCRProvider|recogni[sz]|TextDecoder|textContent|innerText|transcript|piiClass/);
    expect(src).not.toMatch(/convertToBlob|toDataURL|toBlob|image\/webp|@pratibimb\/egress|sendVerified|guardedAct|dispatchEvent|\.click\(/);
    expect(src).not.toMatch(/blur|pixelat|globalAlpha|filter\s*[:=]/i);
  });

  it("imports only the coordinate contract, the privacy package and the worker's outcome type", () => {
    const imports = [...files["visual-redaction.ts"].matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./tr01-host", "@pratibimb/perception", "@pratibimb/privacy"]);
    expect([...files["pixelRedaction.ts"].matchAll(/from\s+"([^"]+)"/g)]).toEqual([]);
  });

  it("does not define any geometry of its own", () => {
    for (const src of Object.values(files)) expect(src).not.toMatch(/\b(function|const)\s+(dilate|mergeOverlapping|redactionMask|failClosedMask|clipTo|overlapRatio)\b/);
  });
});
