/**
 * M10.5 — FULL-FRAME TR-01 → FAIL-CLOSED PLAN → CANONICAL GEOMETRY → OPAQUE PIXELS. Pure.
 *
 * The perception realm owns the frame. This file is the pure part of what it does with it after TR-01
 * has run, and it is where the coordinate spaces meet, so it states them:
 *
 *     TR-01 box            CAPTURE pixels (the full frame TR-01 saw — never a crop)
 *        │ captureToCss     ÷ scale_to_css, the ONE conversion in `@pratibimb/perception`
 *        ▼
 *     UNREAD_REGION box    CSS viewport pixels (INV-24) — the space visualRegions and the frozen
 *        │                 union are defined in; association, dilation, merging and clipping all
 *        │                 happen HERE, by the canonical `planVisualRedaction` → `redactionMask`
 *        ▼
 *     mask rectangle       CSS pixels, clipped to its visual-only region
 *        │ cssToCapturePixelRect   × scale_to_css⁻¹, rounded OUTWARD, clipped to the frame
 *        ▼
 *     pixel rectangle      whole CAPTURE pixels → `fillOpaque`, in place
 *
 * WHY THE FULL FRAME. TR-01 was screened (M8.1), feasibility-tested (M8.2, M8.2a) and RE-1-scored on
 * full viewport frames through its declared resize. Cropping a region and resizing it would change the
 * detector's input scale and distribution, which none of that evidence covers. So TR-01 sees the
 * frame; regions are applied afterwards, geometrically.
 *
 * REGION ASSOCIATION IS RE-1's. The RE-1 scorer computes `redactionMask(allBoxes, region)`: every box
 * on the page is offered to the visual-only region, and the canonical dilate → merge → clip decides
 * what lands inside it. This does exactly that, per region: every full-frame detection becomes an
 * UNREAD_REGION for every visual region, and the planner's canonical clip keeps what belongs. No
 * pre-filtering, because a filter would change which boxes merge and so change the geometry RE-1 was
 * scored on. A box that touches two regions is masked in both; one that touches none masks nothing
 * (it is DOM-rendered text, which the DOM path handles).
 *
 * FAIL CLOSED, AND REFUSED IS TERMINAL.
 *   - Any detector failure → a failure report → every visual region masked WHOLE. The sanitized frame
 *     may continue.
 *   - No trustworthy region or frame geometry → REFUSED. The frame is WIPED (every pixel filled) and
 *     NO frame is returned: not an empty mask, not a sanitized success.
 *
 * No network, no DOM, no model, no text, no encode, no egress: geometry and pixels only.
 */
import { captureBox, captureToCss, cssBox, cssToCapturePixelRect, assertGeometryConsistent, type CaptureGeometry } from "@pratibimb/perception";
import {
  fillOpaque,
  planVisualRedaction,
  unreadRegion,
  wipeFrame,
  type PixelRect,
  type Rect,
  type RgbaFrame,
  type TextRegionFailureStatus,
  type TextRegionReport,
  type UnreadRegion,
  type VisualRegion,
} from "@pratibimb/privacy";

import type { Tr01HostRefusalCode, Tr01Outcome } from "./tr01-host";

const STATUS_OF: Readonly<Record<Tr01HostRefusalCode, TextRegionFailureStatus>> = {
  DETECTOR_TIMEOUT: "TIMEOUT",
  DETECTOR_UNAVAILABLE: "UNAVAILABLE",
  DETECTOR_DISPOSED: "UNAVAILABLE",
  MODEL_OUTPUT_MALFORMED: "MALFORMED",
  DETECTOR_ERROR: "ERROR",
  DETECTOR_BUSY: "ERROR",
};

/**
 * One full-frame TR-01 outcome → the planner's report.
 *
 * A failure of any kind is a failure status — never `findings: []`. A success maps every capture-pixel
 * box to CSS and offers it to every visual region (see the header). A geometry that cannot convert,
 * or a box that is not a valid rectangle, makes the report MALFORMED, which the planner also masks
 * whole.
 */
export function reportFromFullFrame(outcome: Tr01Outcome, geometry: CaptureGeometry, regions: readonly VisualRegion[]): TextRegionReport {
  if (!outcome.ok) return { status: STATUS_OF[outcome.code] };
  const findings: UnreadRegion[] = [];
  try {
    for (const d of outcome.detections) {
      const css = captureToCss(captureBox(d.x, d.y, d.w, d.h), geometry);
      const box: Rect = { x: css.x, y: css.y, w: css.w, h: css.h };
      for (const region of regions) findings.push(unreadRegion({ box, score: d.score, regionId: region.id }));
    }
  } catch {
    return { status: "MALFORMED" };
  }
  return { status: "OK", findings };
}

export interface RegionPixelMask {
  readonly regionId: string;
  /** The canonical CSS mask for this region (from the planner). */
  readonly cssMask: readonly Rect[];
  /** The same mask in whole capture pixels, rounded outward and clipped to the frame. */
  readonly pixelRects: readonly PixelRect[];
}

export type SanitizeRefusalCode = "REGION_INVALID" | "GEOMETRY_INVALID" | "FRAME_INVALID";

export type SanitizeOutcome =
  | {
      readonly outcome: "SANITIZED";
      /** The SAME frame object that was passed in, now masked in place. */
      readonly frame: RgbaFrame;
      /** True when the detector did not produce a trustworthy report and every region was masked whole. */
      readonly failClosed: boolean;
      readonly reason: string | null;
      readonly regions: readonly RegionPixelMask[];
      readonly pixelWrites: number;
      readonly ms: { readonly plan: number; readonly pixelMapping: number; readonly fill: number };
    }
  | {
      readonly outcome: "REFUSED";
      readonly code: SanitizeRefusalCode;
      readonly detail: string;
      /** Always true: a refused frame is overwritten whole before this returns. No frame is returned. */
      readonly frameWiped: true;
    };

export interface SanitizeInput {
  readonly frame: RgbaFrame;
  readonly geometry: CaptureGeometry;
  readonly regions: readonly VisualRegion[];
  /** Untrusted: re-parsed by the planner whatever its static type. */
  readonly report: unknown;
  readonly now?: () => number;
}

/** Refuse, after overwriting the frame so no raw pixels outlive the decision. */
function refuse(frame: RgbaFrame, code: SanitizeRefusalCode, detail: string): SanitizeOutcome {
  try {
    wipeFrame(frame);
  } catch {
    // A frame too malformed to wipe is also too malformed to have been returned; there is nothing to send.
  }
  return { outcome: "REFUSED", code, detail, frameWiped: true };
}

/**
 * Plan and apply the mask to one frame, IN PLACE.
 *
 * The frame and the geometry must describe the same capture: the frame's size must be the geometry's
 * capture size, and the geometry must be consistent (INV-24's refusal of an ambiguous transform).
 */
export function sanitizeFrame(input: SanitizeInput): SanitizeOutcome {
  const now = input.now ?? (() => performance.now());
  const { frame, geometry } = input;

  const w = frame?.width;
  const h = frame?.height;
  const rgba = frame?.rgba;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || !(rgba instanceof Uint8ClampedArray || rgba instanceof Uint8Array) || rgba.length !== w * h * 4) {
    return refuse(frame, "FRAME_INVALID", "the frame is not a well-formed RGBA buffer");
  }
  try {
    assertGeometryConsistent(geometry);
  } catch (cause) {
    return refuse(frame, "GEOMETRY_INVALID", String((cause as Error)?.message ?? cause));
  }
  if (geometry.captureSize.w !== w || geometry.captureSize.h !== h) {
    return refuse(frame, "GEOMETRY_INVALID", `the frame is ${w}x${h} but its geometry describes ${geometry.captureSize.w}x${geometry.captureSize.h}`);
  }

  const t0 = now();
  const plan = planVisualRedaction(input.regions, input.report);
  const t1 = now();
  if (plan.outcome === "REFUSED") return refuse(frame, "REGION_INVALID", plan.detail);

  const regions: RegionPixelMask[] = [];
  const all: PixelRect[] = [];
  try {
    for (const r of plan.regions) {
      const pixelRects: PixelRect[] = [];
      for (const m of r.mask) {
        const px = cssToCapturePixelRect(cssBox(m.x, m.y, m.w, m.h), geometry);
        if (px !== null) pixelRects.push(px);
      }
      regions.push({ regionId: r.regionId, cssMask: r.mask, pixelRects });
      all.push(...pixelRects);
    }
  } catch (cause) {
    return refuse(frame, "GEOMETRY_INVALID", String((cause as Error)?.message ?? cause));
  }
  const t2 = now();
  const { pixelWrites } = fillOpaque(frame, all);
  const t3 = now();

  return {
    outcome: "SANITIZED",
    frame,
    failClosed: plan.failClosed,
    reason: plan.reason,
    regions,
    pixelWrites,
    ms: { plan: t1 - t0, pixelMapping: t2 - t1, fill: t3 - t2 },
  };
}
