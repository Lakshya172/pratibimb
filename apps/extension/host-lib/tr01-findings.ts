/**
 * M10.4 — worker outcomes → the privacy planner's `TextRegionReport`. Pure; NOT wired to any pass yet.
 *
 * The perception realm runs TR-01 once per visual-only region crop and remembers, per run, which
 * region the crop was and where it sits in CSS space. This turns those runs into the report
 * `planVisualRedaction` consumes, and nothing else:
 *
 * - every detection becomes an `UNREAD_REGION` via `unreadRegion` — box mapped from crop pixels to
 *   CSS (`origin + box × scaleToCss`), the detector's score, the region id the REALM held. No class,
 *   no count, no reference exists to be set;
 * - ANY run that did not succeed makes the whole report a failure status, so the planner masks every
 *   region whole (INV-23). Timeout → TIMEOUT, unavailable/disposed → UNAVAILABLE, malformed →
 *   MALFORMED, anything else (error, busy) → ERROR. There is no path from a failure to `findings: []`.
 */
import { unreadRegion, type TextRegionFailureStatus, type TextRegionReport, type UnreadRegion } from "@pratibimb/privacy";

import type { Tr01HostRefusalCode, Tr01Outcome } from "./tr01-host";

export interface RegionRun {
  readonly regionId: string;
  readonly outcome: Tr01Outcome;
  /** The crop's top-left corner in CSS viewport pixels. */
  readonly originCss: { readonly x: number; readonly y: number };
  /** CSS pixels per crop pixel. */
  readonly scaleToCss: number;
}

const STATUS_OF: Readonly<Record<Tr01HostRefusalCode, TextRegionFailureStatus>> = {
  DETECTOR_TIMEOUT: "TIMEOUT",
  DETECTOR_UNAVAILABLE: "UNAVAILABLE",
  DETECTOR_DISPOSED: "UNAVAILABLE",
  MODEL_OUTPUT_MALFORMED: "MALFORMED",
  DETECTOR_ERROR: "ERROR",
  DETECTOR_BUSY: "ERROR",
};

export function textRegionReportFrom(runs: readonly RegionRun[]): TextRegionReport {
  const findings: UnreadRegion[] = [];
  for (const run of runs) {
    if (!run.outcome.ok) return { status: STATUS_OF[run.outcome.code] };
    const s = run.scaleToCss;
    if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(run.originCss.x) || !Number.isFinite(run.originCss.y)) {
      return { status: "MALFORMED" };
    }
    for (const d of run.outcome.detections) {
      try {
        findings.push(
          unreadRegion({
            box: { x: run.originCss.x + d.x * s, y: run.originCss.y + d.y * s, w: d.w * s, h: d.h * s },
            score: d.score,
            regionId: run.regionId,
          })
        );
      } catch {
        return { status: "MALFORMED" };
      }
    }
  }
  return { status: "OK", findings };
}
