/**
 * THE CANONICAL VISUAL REDACTION GEOMETRY — the one implementation of the frozen union.
 *
 * `docs/security/security-invariants.md`, *Redaction union semantics — FROZEN*:
 *
 *   "Union — fail closed. Boxes dilated 4 px and merged at IoU > 0.3."
 *   "Recall is prioritised over precision, because over-masking is free and under-masking is fatal."
 *
 * This module turns detector boxes into the redaction mask those sentences define:
 *
 *   box / quadrilateral ─► axis-aligned rectangle ─► dilate 4 px ─► merge at IoU > 0.3 ─► clip to region
 *
 * and measures exactly how much of an area that mask covers. Nothing else in the repository dilates,
 * merges or clips a redaction box. The RE-1 scorer (`tests/browser/support/redaction-metrics.mjs`)
 * imports this file instead of carrying its own copy, so what an evaluation judges and what the
 * product would mask cannot drift apart. A test pins both to the geometry recorded from the scorer as
 * it was pre-registered (`redaction-geometry.golden.json`), and another fails if a second
 * implementation of dilation or merging appears in product source.
 *
 * GEOMETRY ONLY. It takes rectangles and returns rectangles. It has no field for, and no way to
 * receive, a character; it reads no pixels and no vault.
 *
 * SELF-CONTAINED ON PURPOSE. No runtime import, and only erasable TypeScript syntax, so the same file
 * is loaded by the product build, by Vitest, and by a Node harness directly (Node 24 strips the types).
 * That is why the overlap ratio is defined here rather than imported from
 * `@pratibimb/perception`'s fusion `iou`: the formula is the same, a test holds the two equal, and a
 * runtime import would stop Node from loading this file on its own.
 *
 * COORDINATES are CSS viewport pixels (INV-24), the space every `bbox` in the manifest uses.
 */

/** An axis-aligned rectangle in CSS viewport pixels. Structurally compatible with `CssBox`. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A detector's rotated box or quadrilateral, as corner points. */
export interface Quad {
  readonly points: readonly (readonly [number, number])[];
}

export type RedactionBox = Rect | Quad;

/** The frozen constants, quoted — not tuned here, and not tunable per call. */
export const REDACTION_UNION = Object.freeze({
  /** "Boxes dilated 4 px" */
  dilationPx: 4,
  /** "… and merged at IoU > 0.3" — strictly greater. */
  mergeIou: 0.3,
} as const);

export const rectArea = (r: Rect): number => Math.max(0, r.w) * Math.max(0, r.h);

/** The part of `r` inside `to`, or `null` when they do not overlap with positive area. */
export function clipTo(r: Rect, to: Rect): Rect | null {
  const x0 = Math.max(r.x, to.x);
  const y0 = Math.max(r.y, to.y);
  const x1 = Math.min(r.x + r.w, to.x + to.w);
  const y1 = Math.min(r.y + r.h, to.y + to.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Intersection over union. The same formula as `@pratibimb/perception`'s fusion `iou`. */
export function overlapRatio(a: Rect, b: Rect): number {
  const i = clipTo(a, b);
  if (!i) return 0;
  const inter = rectArea(i);
  return inter / (rectArea(a) + rectArea(b) - inter);
}

/**
 * Any detector box as an axis-aligned rectangle.
 *
 * A quadrilateral becomes its bounding rectangle. That can only ADD area to the mask — the safe
 * direction under "over-masking is free, under-masking is fatal".
 */
export function toAxisAligned(box: RedactionBox): Rect {
  if ("points" in box && Array.isArray(box.points)) {
    const xs = box.points.map((p) => p[0]);
    const ys = box.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  const r = box as Rect;
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

export function dilate(r: Rect, d: number = REDACTION_UNION.dilationPx): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

const bounds = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

const byPosition = (a: Rect, b: Rect): number => a.y - b.y || a.x - b.x || a.w - b.w || a.h - b.h;

/**
 * Merge at IoU > 0.3, until no pair qualifies.
 *
 * Deterministic: rectangles are ordered by position and the first qualifying pair is replaced by its
 * bounding rectangle, then the search restarts. Merging can only grow the mask.
 */
export function mergeOverlapping(rects: readonly Rect[]): Rect[] {
  let out = rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
  let merged = true;
  while (merged) {
    merged = false;
    out.sort(byPosition);
    outer: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        if (overlapRatio(out[i]!, out[j]!) > REDACTION_UNION.mergeIou) {
          const m = bounds(out[i]!, out[j]!);
          out = out.filter((_, k) => k !== i && k !== j);
          out.push(m);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

/**
 * THE REDACTION MASK: axis-align, dilate 4 px, merge at IoU > 0.3, clip to the region.
 *
 * `region` is the visual-only area being redacted — the canvas or image the DOM cannot describe.
 * The mask is the union of the returned rectangles.
 */
export function redactionMask(boxes: readonly RedactionBox[], region: Rect): Rect[] {
  const dilated = boxes.map((b) => dilate(toAxisAligned(b)));
  return mergeOverlapping(dilated)
    .map((r) => clipTo(r, region))
    .filter((r): r is Rect => r !== null);
}

/**
 * INV-23: "A detector that errors or times out counts as a positive." The whole region is masked.
 */
export const failClosedMask = (region: Rect): Rect[] => [{ x: region.x, y: region.y, w: region.w, h: region.h }];

/**
 * Exact area of `within` covered by the union of `mask`, excluding the union of `exclude`.
 *
 * Coordinate compression over every edge involved; each elementary cell is tested at its centre.
 * Exact for axis-aligned rectangles — no pixel grid, no sampling, no rounding.
 */
export function maskCoverage(within: Rect, mask: readonly Rect[], exclude: readonly Rect[] = []): number {
  const parts = mask.map((r) => clipTo(r, within)).filter((r): r is Rect => r !== null);
  if (parts.length === 0) return 0;
  const cuts = exclude.map((r) => clipTo(r, within)).filter((r): r is Rect => r !== null);
  const xs = new Set<number>([within.x, within.x + within.w]);
  const ys = new Set<number>([within.y, within.y + within.h]);
  for (const r of [...parts, ...cuts]) {
    xs.add(r.x).add(r.x + r.w);
    ys.add(r.y).add(r.y + r.h);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const inside = (rs: readonly Rect[], cx: number, cy: number): boolean =>
    rs.some((r) => cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h);
  let total = 0;
  for (let i = 0; i + 1 < X.length; i += 1) {
    const cx = (X[i]! + X[i + 1]!) / 2;
    for (let j = 0; j + 1 < Y.length; j += 1) {
      const cy = (Y[j]! + Y[j + 1]!) / 2;
      if (inside(parts, cx, cy) && !inside(cuts, cx, cy)) total += (X[i + 1]! - X[i]!) * (Y[j + 1]! - Y[j]!);
    }
  }
  return total;
}
