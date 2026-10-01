/**
 * THE PIXEL MASK — the frozen redaction method applied to real RGBA pixels. Pure.
 *
 * `docs/security/security-invariants.md` (supporting rules, dossier appendix):
 *
 *   "Every transmitted mask is a constant-colour opaque fill … Never blur or pixelation on the
 *    outgoing buffer — both are recoverable in distribution."
 *   "The un-redacted bitmap is closed immediately after masking and never referenced again."
 *
 * So this fills, and only fills: every pixel under a mask rectangle becomes `MASK_FILL`, fully opaque.
 * No blur, no pixelation, no partial alpha, no label (a semantic label, if ever composited, comes
 * strictly after the fill and is not this module's).
 *
 * IN PLACE, ON PURPOSE. The frame passed in IS the frame that comes out. After `fillOpaque` returns,
 * the un-redacted pixels under the mask no longer exist anywhere this function could have kept them —
 * there is no second, raw copy for a later step to reach by mistake. A caller that needs the original
 * (a test verifying the fill) copies it first, itself.
 *
 * INPUT is integer CAPTURE-pixel rectangles. Canonical geometry is CSS (INV-24); turning a CSS mask
 * into capture pixels — rounded OUTWARD, so a mask can only grow — happens at the edge, in the realm
 * that owns the frame (`cssToCapturePixelRect`). A rectangle that is not integer, not finite or not
 * positive is REFUSED (throws), never rounded here: rounding is the edge's decision, not this one's.
 * The part of a rectangle outside the frame is clipped away — those pixels do not exist.
 *
 * No browser API, no network, no model, no text. Deterministic.
 */

/** The constant fill: opaque black. Alpha 255 always — a partially transparent mask is not a mask. */
export const MASK_FILL = Object.freeze({ r: 0, g: 0, b: 0, a: 255 } as const);

/** A rectangle of whole capture pixels: columns [x, x+w), rows [y, y+h). */
export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** RGBA, row-major, 4 bytes per pixel — the representation the perception realm decodes into. */
export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray | Uint8Array;
}

export class PixelMaskError extends Error {
  override readonly name = "PixelMaskError";
  constructor(message: string, readonly code: "FRAME_INVALID" | "PIXEL_RECT_INVALID") {
    super(message);
  }
}

export function assertRgbaFrame(frame: RgbaFrame): void {
  const { width, height, rgba } = frame;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new PixelMaskError(`frame dimensions ${width}x${height} are not positive integers`, "FRAME_INVALID");
  }
  if (!(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length !== width * height * 4) {
    throw new PixelMaskError(`frame carries ${rgba?.length ?? "no"} bytes, expected ${width * height * 4}`, "FRAME_INVALID");
  }
}

function assertPixelRect(r: PixelRect): void {
  if (![r.x, r.y, r.w, r.h].every(Number.isInteger) || r.w <= 0 || r.h <= 0) {
    throw new PixelMaskError(`mask rectangle (${r.x}, ${r.y}, ${r.w}, ${r.h}) is not a positive integer rectangle`, "PIXEL_RECT_INVALID");
  }
}

function fillRows(rgba: Uint8ClampedArray | Uint8Array, width: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y += 1) {
    let o = (y * width + x0) * 4;
    for (let x = x0; x < x1; x += 1, o += 4) {
      rgba[o] = MASK_FILL.r;
      rgba[o + 1] = MASK_FILL.g;
      rgba[o + 2] = MASK_FILL.b;
      rgba[o + 3] = MASK_FILL.a;
    }
  }
}

/**
 * Fill every rectangle, IN PLACE. Validates everything before writing anything, so an invalid
 * rectangle leaves no half-masked frame behind — the caller refuses the frame instead.
 *
 * Returns how many rectangles touched the frame and how many pixel writes were made (overlapping
 * rectangles write the same pixel twice; that is idempotent and counted honestly).
 */
export function fillOpaque(frame: RgbaFrame, rects: readonly PixelRect[]): { readonly rectsApplied: number; readonly pixelWrites: number } {
  assertRgbaFrame(frame);
  for (const r of rects) assertPixelRect(r);
  let rectsApplied = 0;
  let pixelWrites = 0;
  for (const r of rects) {
    const x0 = Math.max(0, r.x);
    const y0 = Math.max(0, r.y);
    const x1 = Math.min(frame.width, r.x + r.w);
    const y1 = Math.min(frame.height, r.y + r.h);
    if (x1 <= x0 || y1 <= y0) continue;
    fillRows(frame.rgba, frame.width, x0, y0, x1, y1);
    rectsApplied += 1;
    pixelWrites += (x1 - x0) * (y1 - y0);
  }
  return { rectsApplied, pixelWrites };
}

/**
 * Overwrite the WHOLE frame with the fill. For a frame that must not leave in any form — a REFUSED
 * plan — so that no raw pixels survive in a buffer somebody still holds.
 */
export function wipeFrame(frame: RgbaFrame): void {
  assertRgbaFrame(frame);
  fillRows(frame.rgba, frame.width, 0, 0, frame.width, frame.height);
}
