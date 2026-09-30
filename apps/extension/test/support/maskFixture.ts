/**
 * M10.5 — THE FROZEN SYNTHETIC MASK FIXTURE. Synthetic pixels only; no real PII, no characters at all.
 *
 * A 400×240 RGBA frame at DPR 1 (capture pixels = CSS pixels) with:
 *
 *   canvas:0  (20, 20, 160, 100)    two dark "sensitive" ink bars, as a canvas would render text
 *   img:0     (220, 30, 150, 80)    one dark ink bar, as an image would carry text
 *   canvas:1  (-30, 150, 140, 70)   partly OFF-SCREEN (left edge at −30), one ink bar in the visible part
 *   control   (230, 170, 120, 12)   ink OUTSIDE every visual region — DOM-rendered text, never masked here
 *
 * The background is a deterministic gradient that is NEVER the mask fill (0, 0, 0, 255), so "this pixel
 * became the fill" and "this pixel changed" are the same test. Ink is (12, 12, 12) — dark, not the fill.
 *
 * The expected masks and changed-pixel areas are HAND-COMPUTED from the frozen union (4 px dilation,
 * IoU > 0.3 merge, clip) and written literally into `maskFixture.expected.json`; the tests compare
 * the product against those numbers, not against a second run of the product.
 */
import type { RgbaFrame } from "@pratibimb/privacy";

export const WIDTH = 400;
export const HEIGHT = 240;

export const INK = [12, 12, 12] as const;
export const CONTROL_INK = [40, 40, 40] as const;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Deterministic, never (0, 0, 0): every channel is at least 30. */
export function backgroundPixel(x: number, y: number): readonly [number, number, number] {
  return [((x * 7 + y * 3) % 200) + 30, ((x * 5) % 180) + 40, ((y * 11) % 170) + 50];
}

function paint(rgba: Uint8ClampedArray, r: Rect, rgb: readonly [number, number, number]): void {
  for (let y = Math.max(0, r.y); y < Math.min(HEIGHT, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(WIDTH, r.x + r.w); x++) {
      const o = (y * WIDTH + x) * 4;
      rgba[o] = rgb[0];
      rgba[o + 1] = rgb[1];
      rgba[o + 2] = rgb[2];
      rgba[o + 3] = 255;
    }
  }
}

/** A fresh copy of the fixture frame, every call. */
export function generateFrame(expected: { sensitiveInk: readonly { rect: Rect }[]; controlInk: readonly { rect: Rect }[] }): RgbaFrame & { rgba: Uint8ClampedArray } {
  const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = backgroundPixel(x, y);
      const o = (y * WIDTH + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 255;
    }
  }
  for (const s of expected.sensitiveInk) paint(rgba, s.rect, INK);
  for (const c of expected.controlInk) paint(rgba, c.rect, CONTROL_INK);
  return { width: WIDTH, height: HEIGHT, rgba };
}
