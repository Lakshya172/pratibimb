/**
 * Which canvases and images become visual-only regions — the decision, kept out of the DOM adapter.
 *
 * `apps/extension/host-lib/page-surface-dom.ts` reads each `<canvas>` and `<img>` (tag, index among
 * its tag, `getBoundingClientRect`, computed `display` and `visibility`) and hands the samples here.
 * The rule lives in this package so it runs in Node under test, like every other page-agent decision.
 *
 * THE VISIBILITY RULE IS THE OBSERVATION'S OWN. An element is left out exactly when the element
 * graph's `cssHidden` would be true for it: `display: none`, `visibility: hidden`, or a rectangle
 * with zero width or height. Each of those provably contributes no pixel to a captured frame. Nothing
 * else is left out:
 *
 * - An element partly or wholly outside the viewport keeps its FULL rectangle. Clipping to the
 *   capture is the coordinate stage's job (`cssToCapturePixelRect` rounds outward and clips), and
 *   keeping off-screen regions means a scroll between observation and capture cannot lose one.
 * - A rectangle that is NOT a finite, positive size (NaN, Infinity, a negative extent) is not
 *   "hidden" — it is unmeasurable. It is kept exactly as measured, so the strict parser refuses the
 *   whole observation. Dropping it would silently drop a masking obligation.
 *
 * GEOMETRY ONLY. A sample has no field for a URL, alt text, a pixel or a bitmap, and neither does
 * what this returns.
 */
import { VISUAL_REGION_KINDS, type VisualRegionKind, type VisualRegionReading } from "./contracts.js";

/** What the DOM adapter reads for one element. Nothing else is read. */
export interface VisualRegionSample {
  readonly kind: VisualRegionKind;
  /** Index among every element of this tag in the document, in document order, hidden ones included. */
  readonly ordinal: number;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** Computed `display`. */
  readonly display: string;
  /** Computed `visibility`. */
  readonly visibility: string;
}

/** The selector the adapter enumerates. The kinds, and only the kinds, in `VISUAL_REGION_KINDS`. */
export const VISUAL_REGION_SELECTOR = VISUAL_REGION_KINDS.join(", ");

/** `cssHidden`, exactly as `page-surface-dom.ts` computes it for a measurement. */
const contributesNoPixels = (s: VisualRegionSample): boolean =>
  s.display === "none" || s.visibility === "hidden" || s.rect.w === 0 || s.rect.h === 0;

export const visualRegionId = (kind: VisualRegionKind, ordinal: number): string => `${kind}:${ordinal}`;

export function visualRegionsFrom(samples: readonly VisualRegionSample[]): VisualRegionReading[] {
  return samples
    .filter((s) => !contributesNoPixels(s))
    .map((s) => ({
      id: visualRegionId(s.kind, s.ordinal),
      kind: s.kind,
      rect: { x: s.rect.x, y: s.rect.y, w: s.rect.w, h: s.rect.h },
    }));
}
