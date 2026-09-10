/**
 * Controlled baselines that validate the EVALUATOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE QUOTING ANY NUMBER FROM HERE
 *
 * These are not detectors. The perfect baseline copies the ground truth; it scores 1.0 by
 * construction and that fact is a statement about arithmetic, NOT about detector
 * performance. Reporting it as detector accuracy would be the single most misleading thing
 * this repository could do, which is why every function here is named for what it is and
 * why `PerfectBaseline` is not called anything resembling a model.
 *
 * What they DO establish is that the evaluator is trustworthy before any real detector is
 * measured by it: a perfect input scores exactly 1, an empty input scores exactly 0, a
 * shifted input degrades in the direction and roughly the magnitude the IoU geometry
 * predicts, and malformed input is rejected rather than absorbed.
 */
import { cssBox } from "@pratibimb/perception";
import type { Dataset, Sample } from "./dataset.js";
import type { Prediction } from "./evaluator.js";

/** Identity stamped on baseline predictions so they can never be mistaken for a model. */
export const BASELINE_MODEL = {
  perfect: "BASELINE-perfect-passthrough (NOT A DETECTOR)",
  empty: "BASELINE-empty (NOT A DETECTOR)",
  shifted: "BASELINE-shifted (NOT A DETECTOR)",
  revision: "evaluator-validation",
} as const;

const evaluatableOf = (s: Sample) => s.annotations.filter((a) => a.visibility !== "OFFSCREEN");

/**
 * Copies ground truth verbatim. Scores 1.0 by construction.
 *
 * Its only job is to prove the evaluator returns 1.0 when it should. If this ever returns
 * less than 1.0, the evaluator has a bug — matching, sorting, or the AP integration.
 */
export function perfectBaseline(dataset: Dataset, split: Sample["split"]): readonly Prediction[] {
  const out: Prediction[] = [];
  for (const s of dataset.samples) {
    if (s.split !== split) continue;
    for (const a of evaluatableOf(s)) {
      out.push({
        sampleId: s.id,
        cls: a.cls,
        box: a.box,
        confidence: 1.0,
        frameId: `baseline-${s.id}`,
        modelId: BASELINE_MODEL.perfect,
        revision: BASELINE_MODEL.revision,
      });
    }
  }
  return out;
}

/** Predicts nothing. Proves recall and mAP go to exactly 0 and every element is a miss. */
export function emptyBaseline(): readonly Prediction[] {
  return [];
}

/**
 * Ground truth translated by a fixed offset in CSS pixels.
 *
 * The point is that degradation is PREDICTABLE. For a box of width w and height h shifted
 * by dx horizontally, IoU falls to (w-dx)/(w+dx) — so a shift chosen relative to element
 * size lands either side of the 0.5 threshold in a way that can be reasoned about rather
 * than merely observed. That is what makes this a test of the evaluator instead of a
 * demonstration that moving boxes changes numbers.
 */
export function shiftedBaseline(
  dataset: Dataset,
  split: Sample["split"],
  dx: number,
  dy = 0
): readonly Prediction[] {
  const out: Prediction[] = [];
  for (const s of dataset.samples) {
    if (s.split !== split) continue;
    for (const a of evaluatableOf(s)) {
      out.push({
        sampleId: s.id,
        cls: a.cls,
        box: cssBox(a.box.x + dx, a.box.y + dy, a.box.w, a.box.h),
        confidence: 0.9,
        frameId: `baseline-${s.id}`,
        modelId: BASELINE_MODEL.shifted,
        revision: BASELINE_MODEL.revision,
      });
    }
  }
  return out;
}

/**
 * Ground truth with every class replaced by a different one.
 *
 * Proves the evaluator is class-aware. A class-blind matcher would score this identically
 * to the perfect baseline, and a detector that found every element but labelled them all
 * "icon" would look flawless.
 */
export function classSwappedBaseline(
  dataset: Dataset,
  split: Sample["split"]
): readonly Prediction[] {
  return perfectBaseline(dataset, split).map((p) => ({
    ...p,
    cls: p.cls === "button" ? "icon" : "button",
  }));
}
