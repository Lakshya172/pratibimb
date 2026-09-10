/**
 * QG-02 — the coordinate contract, implemented.
 *
 * `docs/architecture/coordinate-contract.md` is FROZEN and defines four spaces with CSS
 * viewport pixels canonical. This module is the ONLY place any of them convert. Every
 * other module in the perception tier takes geometry it was given and calls in here.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE TRAP: `dpr` AND `zoom` ARE NOT INDEPENDENT MULTIPLIERS.
 *
 * `window.devicePixelRatio` ALREADY INCLUDES browser zoom. On a physically-2.0 display at
 * 125% zoom it reports 2.5, not 2.0. So the CSS→device factor is `dpr` alone.
 *
 * Multiplying by `dpr * zoom` is the obvious-looking implementation and it is wrong by
 * exactly the zoom factor. It is invisible at 100% zoom — which is every developer machine
 * by default — and it puts every click 25% off on the judging machine. That is precisely
 * the silent HiDPI failure the frozen contract was written to prevent.
 *
 * `zoom` is therefore recorded but NEVER multiplied here. The manifest schema requires it
 * present regardless ("Never omit a field because it happens to be 1.0 on the dev
 * machine"), the ledger displays it, and a wrong `dpr` is diagnosable from it. It is
 * provenance, not arithmetic.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY `scaleToCss` IS ONE NUMBER AND NOT DERIVED FROM `dpr`.
 *
 * The capture may be downscaled before it is sent. Reconstructing capture→CSS from `dpr`
 * would silently assume it was not. `scaleToCss = viewportCssWidth / captureWidth` folds
 * the device ratio and any downscale into a single measured factor, which is also exactly
 * what the manifest field name promises. It is derived from the two dimensions actually
 * observed, so it cannot disagree with the frame that exists.
 */
import {
  type CssBox,
  type CaptureBox,
  type DeviceBox,
  type DocBox,
  cssBox,
  captureBox,
  deviceBox,
  docBox,
} from "./space.js";
import { PerceptionError } from "./failure.js";

/** Integer device-pixel dimensions of something. */
export interface Size {
  readonly w: number;
  readonly h: number;
}

/** Scroll offset in CSS pixels. */
export interface ScrollOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * The complete coordinate contract for one frame. This is the `capture` block of the
 * manifest, plus the viewport size needed to derive `scaleToCss`.
 *
 * Every field is required. There is no partial geometry, because a partial geometry is an
 * ambiguous transform and the contract's answer to an ambiguous transform is to refuse.
 */
export interface CaptureGeometry {
  /** `window.devicePixelRatio` verbatim. Already includes zoom. Never multiplied by zoom. */
  readonly dpr: number;
  /** Browser zoom factor. Recorded for provenance and diagnosis. NEVER used as a multiplier. */
  readonly zoom: number;
  /** CSS-pixel size of the visual viewport. */
  readonly viewportCss: Size;
  /** Pixel size of the captured frame as it actually exists. */
  readonly captureSize: Size;
  /** Scroll offset in CSS pixels, for document-space conversion. */
  readonly scroll: ScrollOffset;
  /** Page origin. Part of the manifest `capture` block. */
  readonly origin: string;
}

/** `scale_to_css` — multiply a capture-pixel value by this to get CSS pixels. */
export function scaleToCss(g: CaptureGeometry): number {
  assertGeometryConsistent(g);
  return g.viewportCss.w / g.captureSize.w;
}

/**
 * Refuse an internally inconsistent geometry rather than transform through it.
 *
 * "Coordinate transform ambiguous" is a required fail-closed state. A transform derived
 * from a zero, a negative, a NaN, or from width and height that disagree about the aspect
 * ratio is not a transform — it is a guess, and a guess here becomes a click in the wrong
 * place with full confidence attached.
 */
export function assertGeometryConsistent(g: CaptureGeometry): void {
  const finitePositive = (n: number) => Number.isFinite(n) && n > 0;

  for (const [name, value] of [
    ["dpr", g.dpr],
    ["zoom", g.zoom],
    ["viewportCss.w", g.viewportCss.w],
    ["viewportCss.h", g.viewportCss.h],
    ["captureSize.w", g.captureSize.w],
    ["captureSize.h", g.captureSize.h],
  ] as const) {
    if (!finitePositive(value)) {
      throw new PerceptionError(
        `Coordinate transform is ambiguous: ${name} = ${String(value)}. ` +
          "A transform cannot be derived from a non-finite or non-positive value.",
        "COORDINATE_TRANSFORM_AMBIGUOUS"
      );
    }
  }

  if (!Number.isFinite(g.scroll.x) || !Number.isFinite(g.scroll.y)) {
    throw new PerceptionError(
      `Coordinate transform is ambiguous: scroll = (${g.scroll.x}, ${g.scroll.y}).`,
      "COORDINATE_TRANSFORM_AMBIGUOUS"
    );
  }

  // The capture is a scaled image OF the viewport. If the two aspect ratios disagree
  // materially, one horizontal factor cannot describe both axes, and quietly using the
  // horizontal one would skew every box vertically.
  const sx = g.viewportCss.w / g.captureSize.w;
  const sy = g.viewportCss.h / g.captureSize.h;
  const skew = Math.abs(sx - sy) / Math.max(sx, sy);
  if (skew > ASPECT_TOLERANCE) {
    throw new PerceptionError(
      `Capture dimensions are inconsistent with the viewport: ` +
        `viewport ${g.viewportCss.w}x${g.viewportCss.h} CSS px vs capture ` +
        `${g.captureSize.w}x${g.captureSize.h} px gives x-scale ${sx.toFixed(6)} and ` +
        `y-scale ${sy.toFixed(6)} (${(skew * 100).toFixed(2)}% apart). A single ` +
        "scale_to_css cannot describe both axes.",
      "CAPTURE_DIMENSION_MISMATCH"
    );
  }
}

/**
 * Rounding slack. A viewport of 1043 CSS px at DPR 1.5 captures as 1564 or 1565 device px
 * depending on how the browser rounds, so the two axes legitimately differ by a fraction
 * of a percent. Anything beyond this is a real mismatch, not rounding.
 */
const ASPECT_TOLERANCE = 0.01;

// ───────────────────────────── device ⇄ css ─────────────────────────────

/** Device pixels → CSS pixels. Divides by `dpr` ALONE. See the header. */
export function deviceToCss(b: DeviceBox, g: CaptureGeometry): CssBox {
  assertGeometryConsistent(g);
  return cssBox(b.x / g.dpr, b.y / g.dpr, b.w / g.dpr, b.h / g.dpr);
}

/** CSS pixels → device pixels. Multiplies by `dpr` ALONE. */
export function cssToDevice(b: CssBox, g: CaptureGeometry): DeviceBox {
  assertGeometryConsistent(g);
  return deviceBox(b.x * g.dpr, b.y * g.dpr, b.w * g.dpr, b.h * g.dpr);
}

// ──────────────────────────── capture ⇄ css ─────────────────────────────

/**
 * Capture pixels → CSS pixels.
 *
 * This is the conversion applied to every visual detector output, because detectors see
 * the capture and the rest of the system speaks CSS.
 */
export function captureToCss(b: CaptureBox, g: CaptureGeometry): CssBox {
  const s = scaleToCss(g);
  return cssBox(b.x * s, b.y * s, b.w * s, b.h * s);
}

/** CSS pixels → capture pixels. */
export function cssToCapture(b: CssBox, g: CaptureGeometry): CaptureBox {
  const s = scaleToCss(g);
  return captureBox(b.x / s, b.y / s, b.w / s, b.h / s);
}

// ─────────────────────────── css ⇄ document ─────────────────────────────

/**
 * CSS viewport pixels → document pixels, by adding scroll.
 *
 * Document space is where off-screen elements live. The contract is explicit that a
 * document-space box is **never sent as an action target without a preceding scroll**.
 */
export function cssToDocument(b: CssBox, g: CaptureGeometry): DocBox {
  assertGeometryConsistent(g);
  return docBox(b.x + g.scroll.x, b.y + g.scroll.y, b.w, b.h);
}

/** Document pixels → CSS viewport pixels, by subtracting scroll. May land outside the
 *  viewport; that is the caller's business to classify, not this function's to hide. */
export function documentToCss(b: DocBox, g: CaptureGeometry): CssBox {
  assertGeometryConsistent(g);
  return cssBox(b.x - g.scroll.x, b.y - g.scroll.y, b.w, b.h);
}

// ───────────────────────────── containment ──────────────────────────────

/** Where a CSS-space box sits relative to the captured viewport. */
export type Containment = "INSIDE" | "CLIPPED" | "OUTSIDE";

/**
 * Classify a CSS box against the viewport that was actually captured.
 *
 * The three-way answer matters. "Partly visible" is not "visible": a detector can only be
 * asked about the part that exists in the frame, and an action targeting the centre of a
 * half-clipped element may target a point that is not on screen.
 */
export function classifyContainment(b: CssBox, g: CaptureGeometry): Containment {
  assertGeometryConsistent(g);
  const { w: vw, h: vh } = g.viewportCss;

  const right = b.x + b.w;
  const bottom = b.y + b.h;

  // Zero-area boxes are degenerate; treat them as outside rather than inventing a rule.
  if (b.w <= 0 || b.h <= 0) return "OUTSIDE";
  if (right <= 0 || bottom <= 0 || b.x >= vw || b.y >= vh) return "OUTSIDE";
  if (b.x >= 0 && b.y >= 0 && right <= vw && bottom <= vh) return "INSIDE";
  return "CLIPPED";
}

/** Intersection of a box with the captured viewport, or `null` when there is none. */
export function clipToViewport(b: CssBox, g: CaptureGeometry): CssBox | null {
  assertGeometryConsistent(g);
  const x = Math.max(b.x, 0);
  const y = Math.max(b.y, 0);
  const right = Math.min(b.x + b.w, g.viewportCss.w);
  const bottom = Math.min(b.y + b.h, g.viewportCss.h);
  if (right <= x || bottom <= y) return null;
  return cssBox(x, y, right - x, bottom - y);
}
