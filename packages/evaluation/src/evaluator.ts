/**
 * The QG-05 visual-context evaluator.
 *
 * The dossier names three figures for this metric, and these are the three implemented —
 * not easier substitutes:
 *
 *   element mAP@0.5     mean over classes of average precision at IoU 0.5
 *   element recall      fraction of ground-truth elements matched at IoU 0.5
 *   grounding accuracy  fraction of predictions that land on the right element
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * EVERY FIGURE IS LABELLED `measured` OR `projected`
 *
 * QG-05: *"Every figure is labelled `measured` or `projected`. No figure is unlabelled."*
 * That is enforced by the return type — a `Figure` cannot be constructed without a label —
 * rather than by a convention in the reporting layer, because the reporting layer is
 * exactly where such conventions get dropped.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT AP@0.5 ACTUALLY REQUIRES, AND THE SHORTCUT NOT TAKEN
 *
 * Average precision is the area under the precision-recall curve, computed over
 * predictions sorted by confidence, with each ground truth matchable ONCE. The tempting
 * shortcut — precision and recall at a single threshold — is a different and much weaker
 * quantity: it cannot distinguish a detector that ranks its true positives highly from one
 * that emits them in arbitrary order, which is precisely what a confidence score is for.
 *
 * All-point interpolation is used (the COCO convention), not the 11-point sampling of the
 * old VOC metric. Both are called "mAP@0.5" in the wild and they differ by a few points,
 * so the choice is recorded here rather than left implicit.
 */
import type { CssBox } from "@pratibimb/perception";
import type { Annotation, Dataset, EvalClass, Sample } from "./dataset.js";
import { EVAL_CLASSES, validateDataset } from "./labels.js";

/** IoU threshold for the metric. Fixed by the dossier at 0.5, not a tunable. */
export const IOU_THRESHOLD = 0.5;

/**
 * A number with its epistemic status attached. Constructing one requires the label.
 */
export interface Figure {
  readonly value: number;
  readonly status: "measured" | "projected";
  /** What was actually measured, so the number can be interpreted a year later. */
  readonly basis: string;
}

export const measured = (value: number, basis: string): Figure => ({
  value,
  status: "measured",
  basis,
});

/** One detector prediction, as the evaluator requires it. */
export interface Prediction {
  readonly sampleId: string;
  readonly cls: EvalClass;
  /** CSS viewport pixels — the canonical space. */
  readonly box: CssBox;
  readonly confidence: number;
  /** Which frame this came from. A prediction without it cannot be trusted as current. */
  readonly frameId: string;
  /** Which model said so. */
  readonly modelId: string;
  readonly revision: string;
}

/** Everything needed to say what a metric describes. */
export interface RunContext {
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly datasetHash: string;
  readonly split: Sample["split"];
  readonly modelId: string;
  readonly modelRevision: string;
  readonly backend: "wasm" | "webgpu" | "none";
  readonly browser: string;
  readonly preprocessing: string;
  readonly evaluatedAt: string;
}

export interface ClassMetrics {
  readonly cls: EvalClass;
  readonly groundTruth: number;
  readonly predictions: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly ap50: Figure;
  readonly recall: Figure;
  readonly precision: Figure;
}

export interface EvaluationResult {
  readonly context: RunContext;
  /** The three figures the dossier names. */
  readonly mAP50: Figure;
  readonly elementRecall: Figure;
  readonly groundingAccuracy: Figure;
  readonly perClass: readonly ClassMetrics[];
  readonly totals: {
    readonly groundTruth: number;
    readonly evaluatable: number;
    readonly excludedOffscreen: number;
    readonly predictions: number;
    readonly invalidPredictions: number;
    readonly truePositives: number;
    readonly falsePositives: number;
    readonly falseNegatives: number;
  };
  /** Predictions rejected before scoring, with why. Never silently dropped. */
  readonly rejected: readonly { readonly reason: string; readonly count: number }[];
}

export function iou(a: CssBox, b: CssBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Reject a prediction that cannot be scored honestly.
 *
 * A malformed prediction must never be counted as a miss OR silently discarded. Counted as
 * a miss it flatters nothing but blames the wrong thing; silently discarded it lets a
 * detector emitting garbage score identically to one emitting nothing. Both are reported.
 *
 * Missing provenance is a rejection, not a warning. A prediction with no frame or model
 * identity cannot be tied to a capture or to a weight file, so it cannot be evidence.
 */
export function rejectionReason(p: Prediction, sample: Sample): string | null {
  if (!EVAL_CLASSES.includes(p.cls)) return `unknown class "${p.cls}"`;
  const { x, y, w, h } = p.box;
  if (![x, y, w, h, p.confidence].every(Number.isFinite)) return "non-finite value";
  if (w <= 0 || h <= 0) return `non-positive extent ${w}x${h}`;
  if (p.confidence < 0 || p.confidence > 1) return `confidence ${p.confidence} outside 0..1`;
  if (!p.frameId) return "missing frameId — cannot be tied to a capture";
  if (!p.modelId) return "missing modelId — cannot be tied to a weight file";
  if (!p.revision) return "missing revision — cannot be tied to a weight file";
  const { w: vw, h: vh } = sample.viewportCss;
  // A prediction wholly outside the frame describes something the detector could not see.
  if (x >= vw || y >= vh || x + w <= 0 || y + h <= 0) {
    return `box [${x}, ${y}, ${w}, ${h}] lies outside the ${vw}x${vh} viewport`;
  }
  return null;
}

/**
 * All-point-interpolated average precision from a confidence-sorted match list.
 *
 * Precision is made monotonically non-increasing from the right before integrating, which
 * is what "interpolated" means here; skipping that step yields a saw-toothed curve and a
 * number a few points below every published AP.
 */
function averagePrecision(sorted: readonly boolean[], groundTruth: number): number {
  if (groundTruth === 0) return Number.NaN; // undefined, not zero — see the caller
  if (sorted.length === 0) return 0;

  const precisions: number[] = [];
  const recalls: number[] = [];
  let tp = 0;
  let fp = 0;
  for (const isTp of sorted) {
    if (isTp) tp += 1;
    else fp += 1;
    precisions.push(tp / (tp + fp));
    recalls.push(tp / groundTruth);
  }
  // Monotone envelope from the right.
  for (let i = precisions.length - 2; i >= 0; i -= 1) {
    precisions[i] = Math.max(precisions[i]!, precisions[i + 1]!);
  }
  let ap = 0;
  let prevRecall = 0;
  for (let i = 0; i < precisions.length; i += 1) {
    ap += (recalls[i]! - prevRecall) * precisions[i]!;
    prevRecall = recalls[i]!;
  }
  return ap;
}

/**
 * Evaluate predictions against one split of a dataset.
 *
 * Deterministic throughout: predictions are sorted by confidence with ties broken by
 * sample id then class then geometry, so an equal-confidence set cannot reorder between
 * runs and move the metric.
 */
export function evaluate(
  dataset: Dataset,
  predictions: readonly Prediction[],
  split: Sample["split"],
  context: Omit<RunContext, "datasetName" | "datasetVersion" | "datasetHash" | "split">
): EvaluationResult {
  // A metric computed over a dataset that has drifted is a number about nothing.
  validateDataset(dataset);

  const samples = dataset.samples.filter((s) => s.split === split);
  const byId = new Map(samples.map((s) => [s.id, s]));

  const rejections = new Map<string, number>();
  const usable: Prediction[] = [];
  for (const p of predictions) {
    const sample = byId.get(p.sampleId);
    if (!sample) {
      const r = `prediction references sample "${p.sampleId}" not in the ${split} split`;
      rejections.set(r, (rejections.get(r) ?? 0) + 1);
      continue;
    }
    const reason = rejectionReason(p, sample);
    if (reason) {
      rejections.set(reason, (rejections.get(reason) ?? 0) + 1);
      continue;
    }
    usable.push(p);
  }

  // OFFSCREEN annotations are excluded from scoring: no detector can see them, so counting
  // them as misses would penalise a perfect detector for the laws of optics. The count is
  // reported so the exclusion is visible rather than assumed.
  let excludedOffscreen = 0;
  const evaluatable = new Map<string, Annotation[]>();
  for (const s of samples) {
    const keep: Annotation[] = [];
    for (const a of s.annotations) {
      if (a.visibility === "OFFSCREEN") excludedOffscreen += 1;
      else keep.push(a);
    }
    evaluatable.set(s.id, keep);
  }

  const perClass: ClassMetrics[] = [];
  let totalTp = 0;
  let totalFp = 0;
  let totalGt = 0;
  let groundedHits = 0;

  for (const cls of EVAL_CLASSES) {
    const gtBySample = new Map<string, Annotation[]>();
    let gtCount = 0;
    for (const s of samples) {
      const anns = (evaluatable.get(s.id) ?? []).filter((a) => a.cls === cls);
      if (anns.length) gtBySample.set(s.id, anns);
      gtCount += anns.length;
    }

    const preds = usable
      .filter((p) => p.cls === cls)
      .sort(
        (a, b) =>
          b.confidence - a.confidence ||
          (a.sampleId < b.sampleId ? -1 : a.sampleId > b.sampleId ? 1 : 0) ||
          a.box.x - b.box.x ||
          a.box.y - b.box.y
      );

    const claimed = new Set<string>();
    const outcomes: boolean[] = [];
    let tp = 0;
    for (const p of preds) {
      const candidates = gtBySample.get(p.sampleId) ?? [];
      let bestIou = 0;
      let best: Annotation | null = null;
      for (const a of candidates) {
        if (claimed.has(a.id)) continue; // each ground truth matches at most once
        const v = iou(p.box, a.box);
        if (v > bestIou) {
          bestIou = v;
          best = a;
        }
      }
      if (best && bestIou >= IOU_THRESHOLD) {
        claimed.add(best.id);
        outcomes.push(true);
        tp += 1;
      } else {
        outcomes.push(false);
      }
    }

    const fp = preds.length - tp;
    const fn = gtCount - tp;
    totalTp += tp;
    totalFp += fp;
    totalGt += gtCount;
    groundedHits += tp;

    const ap = averagePrecision(outcomes, gtCount);
    perClass.push({
      cls,
      groundTruth: gtCount,
      predictions: preds.length,
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      ap50: measured(ap, `all-point interpolated AP at IoU>=${IOU_THRESHOLD}, ${gtCount} ground truth`),
      recall: measured(gtCount ? tp / gtCount : Number.NaN, `${tp}/${gtCount} matched`),
      precision: measured(preds.length ? tp / preds.length : Number.NaN, `${tp}/${preds.length} correct`),
    });
  }

  // mAP averages only over classes that HAVE ground truth. Averaging in a NaN for an absent
  // class would poison the mean; treating it as zero would punish a detector for a class
  // the dataset never asked about.
  const present = perClass.filter((c) => c.groundTruth > 0);
  const mAP =
    present.length === 0
      ? Number.NaN
      : present.reduce((s, c) => s + c.ap50.value, 0) / present.length;

  return {
    context: {
      ...context,
      datasetName: dataset.name,
      datasetVersion: dataset.version,
      datasetHash: dataset.hash,
      split,
    },
    mAP50: measured(mAP, `mean AP@${IOU_THRESHOLD} over ${present.length} classes with ground truth`),
    elementRecall: measured(
      totalGt ? totalTp / totalGt : Number.NaN,
      `${totalTp}/${totalGt} evaluatable elements matched at IoU>=${IOU_THRESHOLD}`
    ),
    groundingAccuracy: measured(
      usable.length ? groundedHits / usable.length : Number.NaN,
      `${groundedHits}/${usable.length} predictions landed on a correct element`
    ),
    perClass,
    totals: {
      groundTruth: totalGt + excludedOffscreen,
      evaluatable: totalGt,
      excludedOffscreen,
      predictions: predictions.length,
      invalidPredictions: predictions.length - usable.length,
      truePositives: totalTp,
      falsePositives: totalFp,
      falseNegatives: totalGt - totalTp,
    },
    rejected: [...rejections.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/**
 * Sweep a confidence threshold and report the metric at each step.
 *
 * **This must be run on the DEV split.** Choosing a threshold on the same samples used for
 * the final claim produces a number describing the tuning run rather than a prediction
 * about new pages. The evaluator cannot enforce which split a caller passes, so the
 * discipline is documented here and asserted by test.
 */
export function sweepThreshold(
  dataset: Dataset,
  predictions: readonly Prediction[],
  split: Sample["split"],
  context: Omit<RunContext, "datasetName" | "datasetVersion" | "datasetHash" | "split">,
  thresholds: readonly number[]
): readonly { readonly threshold: number; readonly result: EvaluationResult }[] {
  return thresholds.map((t) => ({
    threshold: t,
    result: evaluate(
      dataset,
      predictions.filter((p) => p.confidence >= t),
      split,
      context
    ),
  }));
}
