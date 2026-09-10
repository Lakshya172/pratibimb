/**
 * Evaluator validation, via controlled baselines.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THESE ARE NOT DETECTOR RESULTS
 *
 * The perfect baseline copies the ground truth. It scores 1.0 by construction, and that
 * is a statement about arithmetic — not about any detector. Quoting it as detector
 * accuracy would be the most misleading thing this repository could do.
 *
 * What these establish is that the evaluator is trustworthy BEFORE a real detector is
 * measured by it: perfect input scores exactly 1, empty input scores exactly 0, shifted
 * input degrades the way the IoU geometry predicts, class errors are caught, and malformed
 * input is rejected rather than absorbed.
 */
import { describe, it, expect } from "vitest";
import { cssBox } from "@pratibimb/perception";
import {
  type Prediction,
  IOU_THRESHOLD,
  BASELINE_MODEL,
  generateDataset,
  evaluate,
  sweepThreshold,
  iou,
  rejectionReason,
  perfectBaseline,
  emptyBaseline,
  shiftedBaseline,
  classSwappedBaseline,
} from "@pratibimb/evaluation";

const SPEC = {
  name: "t1-synthetic-ui",
  version: "1.0.0",
  seed: 20260910,
  counts: { train: 6, dev: 4, test: 4 },
  createdAt: "2026-09-10T00:00:00.000Z",
};
const DATASET = generateDataset(SPEC);

const CTX = {
  modelId: "baseline",
  modelRevision: "evaluator-validation",
  backend: "none" as const,
  browser: "node",
  preprocessing: "none",
  evaluatedAt: "2026-09-10T00:00:00.000Z",
};

describe("IoU", () => {
  it("is 1 for identical boxes, 0 for disjoint, 0 for merely touching", () => {
    expect(iou(cssBox(0, 0, 10, 10), cssBox(0, 0, 10, 10))).toBe(1);
    expect(iou(cssBox(0, 0, 10, 10), cssBox(50, 50, 10, 10))).toBe(0);
    expect(iou(cssBox(0, 0, 10, 10), cssBox(10, 0, 10, 10))).toBe(0);
  });

  it("matches the closed form for a pure horizontal shift", () => {
    // For a shift dx of a box of width w: IoU = (w - dx) / (w + dx).
    const w = 100;
    const dx = 20;
    const v = iou(cssBox(0, 0, w, 40), cssBox(dx, 0, w, 40));
    expect(v).toBeCloseTo((w - dx) / (w + dx), 9);
  });
});

describe("BASELINE 1 — perfect passthrough", () => {
  const preds = perfectBaseline(DATASET, "test");
  const r = evaluate(DATASET, preds, "test", CTX);

  it("scores exactly 1.0 on all three dossier figures", () => {
    // If this is ever below 1.0 the evaluator has a bug in matching, sorting or the AP
    // integration - not the "detector".
    expect(r.mAP50.value).toBeCloseTo(1.0, 9);
    expect(r.elementRecall.value).toBeCloseTo(1.0, 9);
    expect(r.groundingAccuracy.value).toBeCloseTo(1.0, 9);
  });

  it("reports zero false positives and zero misses", () => {
    expect(r.totals.falsePositives).toBe(0);
    expect(r.totals.falseNegatives).toBe(0);
    expect(r.totals.invalidPredictions).toBe(0);
  });

  it("is stamped NOT A DETECTOR", () => {
    // The name is the guard. A number from here must be impossible to mistake for a model.
    expect(preds[0]!.modelId).toContain("NOT A DETECTOR");
    expect(BASELINE_MODEL.perfect).toContain("NOT A DETECTOR");
  });

  it("EXCLUDES off-screen elements rather than counting them as misses", () => {
    // No detector can see them; counting them would penalise a perfect detector for the
    // laws of optics. The count is reported so the exclusion is visible.
    expect(r.totals.excludedOffscreen).toBeGreaterThan(0);
    expect(r.totals.groundTruth).toBe(r.totals.evaluatable + r.totals.excludedOffscreen);
  });
});

describe("BASELINE 2 — empty detector", () => {
  const r = evaluate(DATASET, emptyBaseline(), "test", CTX);

  it("scores exactly 0 recall and 0 mAP", () => {
    expect(r.elementRecall.value).toBe(0);
    expect(r.mAP50.value).toBe(0);
  });

  it("counts every evaluatable element as a miss", () => {
    expect(r.totals.falseNegatives).toBe(r.totals.evaluatable);
    expect(r.totals.truePositives).toBe(0);
  });

  it("reports grounding accuracy as NaN, not as zero", () => {
    // Nothing was predicted, so "what fraction of predictions were right" has no answer.
    // Reporting 0 would claim every prediction was wrong, which is a different statement.
    expect(Number.isNaN(r.groundingAccuracy.value)).toBe(true);
  });
});

describe("BASELINE 3 — shifted boxes degrade predictably", () => {
  it("still matches at a shift that keeps IoU above the threshold", () => {
    // A 10px shift on a 130px-wide button: IoU = 120/140 = 0.857, comfortably above 0.5.
    const r = evaluate(DATASET, shiftedBaseline(DATASET, "test", 10), "test", CTX);
    expect(r.elementRecall.value).toBeGreaterThan(0.5);
  });

  it("collapses at a shift that pushes IoU below the threshold", () => {
    // Most generated elements are under 300px wide; a 400px shift leaves no overlap at all.
    const r = evaluate(DATASET, shiftedBaseline(DATASET, "test", 400), "test", CTX);
    expect(r.elementRecall.value).toBeLessThan(0.15);
  });

  it("degrades monotonically as the shift grows", () => {
    // The direction is what matters: a metric that improved under a larger error would be
    // measuring something other than localisation.
    const recalls = [0, 5, 15, 40, 120].map(
      (dx) => evaluate(DATASET, shiftedBaseline(DATASET, "test", dx), "test", CTX).elementRecall.value
    );
    for (let i = 1; i < recalls.length; i += 1) {
      expect(recalls[i]!).toBeLessThanOrEqual(recalls[i - 1]! + 1e-9);
    }
    expect(recalls[0]).toBeCloseTo(1.0, 9);
  });

  it("makes a coordinate-space mistake visible", () => {
    // Predicting in CAPTURE pixels while the contract says CSS is exactly the mistake the
    // letterbox and DPR work exists to prevent. At DPR 2.0 that doubles every coordinate.
    const wrongSpace = perfectBaseline(DATASET, "test").map((p) => ({
      ...p,
      box: cssBox(p.box.x * 2, p.box.y * 2, p.box.w * 2, p.box.h * 2),
    }));
    const r = evaluate(DATASET, wrongSpace, "test", CTX);
    expect(r.elementRecall.value).toBeLessThan(0.5);
  });
});

describe("BASELINE 4 — class errors are caught", () => {
  it("scores near zero when every class is wrong", () => {
    // A class-blind matcher would score this identically to the perfect baseline, and a
    // detector that found every element but labelled them all "icon" would look flawless.
    const r = evaluate(DATASET, classSwappedBaseline(DATASET, "test"), "test", CTX);
    expect(r.elementRecall.value).toBeLessThan(0.35);
  });
});

describe("BASELINE 5 — malformed predictions fail closed", () => {
  const sample = DATASET.samples.find((s) => s.split === "test")!;
  const good = perfectBaseline(DATASET, "test")[0]!;
  const bad = (over: Partial<Prediction>): Prediction => ({ ...good, ...over });

  it.each([
    ["a non-finite coordinate", { box: cssBox(Number.NaN, 0, 10, 10) }, /non-finite/],
    ["a negative extent", { box: cssBox(0, 0, -10, 10) }, /non-positive extent/],
    ["confidence above 1", { confidence: 1.5 }, /outside 0\.\.1/],
    ["confidence below 0", { confidence: -0.1 }, /outside 0\.\.1/],
    ["an unknown class", { cls: "widget" as never }, /unknown class/],
    ["a missing frameId", { frameId: "" }, /missing frameId/],
    ["a missing modelId", { modelId: "" }, /missing modelId/],
    ["a missing revision", { revision: "" }, /missing revision/],
    ["a box outside the viewport", { box: cssBox(9000, 9000, 10, 10) }, /outside the/],
  ])("rejects %s", (_label, over, pattern) => {
    expect(rejectionReason(bad(over), sample)).toMatch(pattern);
  });

  it("REPORTS rejected predictions rather than silently discarding them", () => {
    // Silently discarded, a detector emitting garbage scores identically to one emitting
    // nothing. Counted as misses, the blame lands in the wrong place. So: reported.
    const preds = [...perfectBaseline(DATASET, "test"), bad({ confidence: 5 })];
    const r = evaluate(DATASET, preds, "test", CTX);
    expect(r.totals.invalidPredictions).toBe(1);
    expect(r.rejected.some((x) => /outside 0\.\.1/.test(x.reason))).toBe(true);
    // And the valid ones are unaffected.
    expect(r.elementRecall.value).toBeCloseTo(1.0, 9);
  });

  it("rejects a prediction naming a sample outside the split", () => {
    const r = evaluate(DATASET, [bad({ sampleId: "train-0000" })], "test", CTX);
    expect(r.totals.invalidPredictions).toBe(1);
    expect(r.rejected[0]!.reason).toMatch(/not in the test split/);
  });

  it("refuses to evaluate against a dataset that has drifted", () => {
    const tampered = { ...DATASET, hash: "deadbeef" };
    expect(() => evaluate(tampered, [], "test", CTX)).toThrowError(/hash mismatch/);
  });
});

describe("every figure carries its status", () => {
  it("labels all three headline figures `measured`", () => {
    // QG-05: "Every figure is labelled measured or projected. No figure is unlabelled."
    const r = evaluate(DATASET, perfectBaseline(DATASET, "test"), "test", CTX);
    for (const f of [r.mAP50, r.elementRecall, r.groundingAccuracy]) {
      expect(f.status).toBe("measured");
      expect(f.basis.length).toBeGreaterThan(10);
    }
    for (const c of r.perClass) {
      expect(c.ap50.status).toBe("measured");
      expect(c.recall.status).toBe("measured");
    }
  });

  it("records which dataset and model a result describes", () => {
    const r = evaluate(DATASET, perfectBaseline(DATASET, "test"), "test", CTX);
    expect(r.context.datasetHash).toBe(DATASET.hash);
    expect(r.context.datasetVersion).toBe("1.0.0");
    expect(r.context.split).toBe("test");
    expect(r.context.backend).toBe("none");
  });
});

describe("reproducibility", () => {
  it("returns identical results for identical inputs", () => {
    const preds = shiftedBaseline(DATASET, "test", 7);
    const a = evaluate(DATASET, preds, "test", CTX);
    const b = evaluate(DATASET, preds, "test", CTX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is insensitive to prediction order", () => {
    // Ties are broken deterministically, so shuffling the input must not move the metric.
    const preds = shiftedBaseline(DATASET, "test", 7);
    const shuffled = [...preds].reverse();
    const a = evaluate(DATASET, preds, "test", CTX);
    const b = evaluate(DATASET, shuffled, "test", CTX);
    expect(b.mAP50.value).toBeCloseTo(a.mAP50.value, 12);
    expect(b.elementRecall.value).toBeCloseTo(a.elementRecall.value, 12);
  });
});

describe("threshold sweeps run on DEV, never on TEST", () => {
  it("sweeps and reports a result per threshold", () => {
    const preds = shiftedBaseline(DATASET, "dev", 8);
    const sweep = sweepThreshold(DATASET, preds, "dev", CTX, [0.1, 0.5, 0.95]);
    expect(sweep).toHaveLength(3);
    expect(sweep.every((s) => s.result.context.split === "dev")).toBe(true);
  });

  it("drops predictions below the threshold", () => {
    // At 0.95 the shifted baseline's 0.9 confidence is excluded entirely.
    const preds = shiftedBaseline(DATASET, "dev", 8);
    const sweep = sweepThreshold(DATASET, preds, "dev", CTX, [0.5, 0.95]);
    expect(sweep[1]!.result.totals.predictions).toBe(0);
    expect(sweep[0]!.result.totals.predictions).toBeGreaterThan(0);
  });

  it("keeps the test split untouched by tuning", () => {
    // The discipline the split exists for: the samples that choose a threshold are never
    // the samples that produce the claim.
    const devIds = new Set(DATASET.samples.filter((s) => s.split === "dev").map((s) => s.id));
    const testIds = new Set(DATASET.samples.filter((s) => s.split === "test").map((s) => s.id));
    expect([...devIds].some((i) => testIds.has(i))).toBe(false);
  });
});

describe("the metric is AP, not precision-at-one-threshold", () => {
  it("rewards ranking true positives above false ones", () => {
    // The shortcut this guards against: precision and recall at a single cut cannot tell a
    // detector that ranks well from one that emits in arbitrary order - which is the whole
    // purpose of a confidence score.
    const truth = perfectBaseline(DATASET, "test");
    const decoy = (conf: number): Prediction => ({
      ...truth[0]!,
      box: cssBox(700, 500, 40, 20),
      confidence: conf,
    });
    const wellRanked = evaluate(DATASET, [...truth, decoy(0.1)], "test", CTX);
    const badlyRanked = evaluate(
      DATASET,
      [...truth.map((p) => ({ ...p, confidence: 0.2 })), decoy(0.99)],
      "test",
      CTX
    );
    expect(wellRanked.mAP50.value).toBeGreaterThan(badlyRanked.mAP50.value);
  });

  it("gives IOU_THRESHOLD as the dossier's 0.5", () => {
    expect(IOU_THRESHOLD).toBe(0.5);
  });
});
