/**
 * M10.5 — THE PIXEL MASK IS THE PRE-REGISTERED GEOMETRY. All 90 canonical golden vectors, through the
 * product path, down to pixels.
 *
 * `redaction-geometry.golden.json` holds the masks the RE-1 scorer produced, as pre-registered, over 90
 * box sets derived from the frozen held-out truth (M7.3). Here every one of those box sets is treated
 * as a full-frame TR-01 outcome and taken through the PRODUCT path:
 *
 *   detections (capture px) → reportFromFullFrame → UNREAD_REGION → planVisualRedaction
 *     → canonical geometry → cssToCapturePixelRect → fillOpaque
 *
 * and must give (1) exactly the golden CSS mask and (2) exactly the pixels that mask covers — computed
 * here independently, as "every pixel whose square overlaps a mask rectangle with positive area" —
 * with every other pixel byte-identical. The held-out frames are 1280×720 at DPR 1, so capture pixels
 * are CSS pixels. The golden record and the scorer are read, never written.
 *
 * Quadrilateral box sets are passed through the canonical `toAxisAligned` first: TR-01 emits
 * axis-aligned boxes, and `redactionMask` axis-aligns internally, so the mask is identical.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MASK_FILL, toAxisAligned } from "@pratibimb/privacy";

import { reportFromFullFrame, sanitizeFrame } from "../../../apps/extension/host-lib/visual-redaction.ts";
import { boxSetsFor, loadHeldOut } from "./redaction-golden-inputs.mjs";

const golden = JSON.parse(readFileSync(new URL("./redaction-geometry.golden.json", import.meta.url), "utf8"));
const heldOut = loadHeldOut();
const W = heldOut.measuredWith.viewport.width;
const H = heldOut.measuredWith.viewport.height;
const geometry = { dpr: 1, zoom: 1, viewportCss: { w: W, h: H }, captureSize: { w: W, h: H }, scroll: { x: 0, y: 0 }, origin: "http://127.0.0.1:8975" };
const BG = [90, 120, 150, 255];

function frame() {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) rgba.set(BG, i * 4);
  return { width: W, height: H, rgba };
}

/** Independent rasterisation: a pixel is masked iff its unit square overlaps some rectangle with positive area. */
function expectedPixels(mask) {
  const bits = new Uint8Array(W * H);
  for (const r of mask) {
    for (let y = Math.max(0, Math.floor(r.y) - 1); y < Math.min(H, Math.ceil(r.y + r.h) + 1); y++) {
      if (!(y < r.y + r.h && y + 1 > r.y)) continue;
      for (let x = Math.max(0, Math.floor(r.x) - 1); x < Math.min(W, Math.ceil(r.x + r.w) + 1); x++) {
        if (x < r.x + r.w && x + 1 > r.x) bits[y * W + x] = 1;
      }
    }
  }
  return bits;
}

describe("the 90 canonical golden vectors, through the product path, to pixels", () => {
  const inputs = new Map();
  for (const image of heldOut.images) for (const [set, prediction] of boxSetsFor(image)) inputs.set(`${image.image}/${set}`, { image, prediction });

  it("regenerates the same 90 inputs, at 1280×720 DPR 1", () => {
    expect([...inputs.keys()]).toEqual(golden.cases.map((c) => `${c.image}/${c.set}`));
    expect([W, H, heldOut.measuredWith.dpr]).toEqual([1280, 720, 1]);
  });

  for (const c of golden.cases) {
    it(`${c.image} · ${c.set}`, () => {
      const { image, prediction } = inputs.get(`${c.image}/${c.set}`);
      const regions = [{ id: "canvas:0", rect: image.region }];
      const outcome = prediction.failed
        ? { ok: false, runId: 1, code: "DETECTOR_TIMEOUT", detail: "golden: failed" }
        : { ok: true, runId: 1, detections: prediction.boxes.map((b) => ({ ...toAxisAligned(b), score: 1 })), ms: { preprocess: 0, infer: 0, postprocess: 0, total: 0 } };

      const f = frame();
      const out = sanitizeFrame({ frame: f, geometry, regions, report: reportFromFullFrame(outcome, geometry, regions) });
      expect(out.outcome).toBe("SANITIZED");
      expect(out.regions[0].cssMask).toEqual(c.mask);

      const want = expectedPixels(c.mask);
      let mismatches = 0;
      let masked = 0;
      for (let i = 0; i < W * H; i++) {
        const o = i * 4;
        const isFill = f.rgba[o] === MASK_FILL.r && f.rgba[o + 1] === MASK_FILL.g && f.rgba[o + 2] === MASK_FILL.b && f.rgba[o + 3] === MASK_FILL.a;
        const untouched = f.rgba[o] === BG[0] && f.rgba[o + 1] === BG[1] && f.rgba[o + 2] === BG[2] && f.rgba[o + 3] === BG[3];
        if (want[i]) {
          masked += 1;
          if (!isFill) mismatches += 1;
        } else if (!untouched) mismatches += 1;
      }
      expect(mismatches).toBe(0);
      if (c.set === "empty") expect(masked).toBe(0);
      if (c.set === "failed" || c.set === "blanket") expect(masked).toBe(image.region.w * image.region.h);
    });
  }
});
