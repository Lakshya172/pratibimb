/**
 * The four coordinate spaces of `docs/architecture/coordinate-contract.md`, made into
 * types the compiler enforces.
 *
 * The contract is FROZEN and its rule is one sentence: **CSS viewport pixels is the
 * canonical space, and every component converts at its edge.** The contract also states
 * why it matters — 25% of the score is grounding accuracy, and the commonest way to lose
 * it is silently, because everything works at DPR 1.0 on the development laptop and falls
 * apart on a HiDPI judging machine at 125% zoom.
 *
 * A number is not a coordinate. `412` is meaningless until you know which space it is in,
 * and the failure mode this file exists to prevent is a device-pixel value being passed to
 * something expecting CSS pixels: it type-checks, it runs, and the click lands in the
 * wrong place on exactly the machine we cannot test on. Branding the spaces makes that a
 * compile error instead of a demo failure.
 *
 * The brands are erased at runtime. There is no wrapper object and no allocation — a
 * `CssPx` IS a number. The only cost is that you must convert deliberately.
 */

declare const SPACE: unique symbol;

/** CSS viewport pixels. **CANONICAL.** Origin at viewport top-left. */
export type CssPx = number & { readonly [SPACE]: "css-viewport" };

/** Device pixels. What `tabs.captureVisibleTab` produces before any downscale. */
export type DevicePx = number & { readonly [SPACE]: "device" };

/** Capture pixels. The (possibly downscaled) frame that would be sent to the server. */
export type CapturePx = number & { readonly [SPACE]: "capture" };

/** Document pixels. CSS pixels offset by scroll — the space off-screen elements live in. */
export type DocPx = number & { readonly [SPACE]: "document" };

/**
 * Every box is `[x, y, w, h]`, matching the manifest's `bbox` encoding exactly so no
 * reordering happens at the serialization edge.
 */
export interface Box<T extends number> {
  readonly x: T;
  readonly y: T;
  readonly w: T;
  readonly h: T;
}

export type CssBox = Box<CssPx>;
export type DeviceBox = Box<DevicePx>;
export type CaptureBox = Box<CapturePx>;
export type DocBox = Box<DocPx>;

/**
 * Constructors. These are the ONLY sanctioned way to label a raw number with a space, and
 * each one is a place a reviewer can put a breakpoint and ask "is this really that space?".
 *
 * They are deliberately not called `toCssPx` etc. Nothing is converted here — the value is
 * asserted to already be in that space. Conversion lives in `coordinates.ts` and always
 * requires the capture geometry.
 */
export const cssPx = (n: number): CssPx => n as CssPx;
export const devicePx = (n: number): DevicePx => n as DevicePx;
export const capturePx = (n: number): CapturePx => n as CapturePx;
export const docPx = (n: number): DocPx => n as DocPx;

export const cssBox = (x: number, y: number, w: number, h: number): CssBox => ({
  x: cssPx(x),
  y: cssPx(y),
  w: cssPx(w),
  h: cssPx(h),
});
export const deviceBox = (x: number, y: number, w: number, h: number): DeviceBox => ({
  x: devicePx(x),
  y: devicePx(y),
  w: devicePx(w),
  h: devicePx(h),
});
export const captureBox = (x: number, y: number, w: number, h: number): CaptureBox => ({
  x: capturePx(x),
  y: capturePx(y),
  w: capturePx(w),
  h: capturePx(h),
});
export const docBox = (x: number, y: number, w: number, h: number): DocBox => ({
  x: docPx(x),
  y: docPx(y),
  w: docPx(w),
  h: docPx(h),
});

/** Serialize to the manifest's `[x, y, w, h]` array. Space is lost here, so this is the
 *  boundary at which the value must already be canonical. */
export const toBboxArray = (b: CssBox): readonly [number, number, number, number] => [
  b.x,
  b.y,
  b.w,
  b.h,
];
