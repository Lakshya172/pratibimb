/**
 * DEV-ONLY analysis: why the threshold rule was wrong, and what should replace it.
 *
 *   node tools/detector/qg03-dev-analysis.mjs
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE TEST SPLIT IS NOT OPENED HERE, AND CANNOT BE
 *
 * The held-out test result has already been observed once — mAP@0.5 0.7955, recall 0.9229,
 * grounding 0.0547. Choosing a new rule while able to see those numbers would make the
 * rule a function of the test set, and every figure produced under it afterwards would be
 * a description of that choice rather than of the detector.
 *
 * So this script loads DEV predictions and DEV samples only, and asserts that nothing from
 * the test split entered the analysis before it writes anything. That assertion is not
 * ceremony: the predictions file contains both splits, and one wrong filter is all it
 * would take.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THE OLD RULE ACTUALLY GOT WRONG
 *
 * The rule was "max mAP@0.5 on DEV". It is not that the rule was too permissive. It is
 * that it optimised a quantity which is, by construction, nearly INDEPENDENT of the thing
 * it was choosing.
 *
 * Average precision is a RANKING metric: it integrates precision over the recall curve
 * obtained by sweeping the ranking. Lowering the emit threshold appends low-confidence
 * predictions to the TAIL of that ranking, where recall is already near its maximum, so
 * they barely move the area under it. Across dev, mAP moved 0.0004 between thresholds 0.05
 * and 0.20 while grounding accuracy moved from 0.058 to 0.201 — a 3.5x change in whether
 * the detector's output is usable, and a change the selection rule could not see.
 *
 * A rule that maximises a threshold-invariant metric will land on whichever end of the
 * plateau the tie-break happens to favour. Here it landed on the end with 11,845
 * predictions for 40 screens.
 *
 * The replacement must therefore be built from quantities that DO vary with the operating
 * point, and it must not invent a metric the project does not already report.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DATA = join(ROOT, "artifacts", "datasets", "t1-ui-v1");
const MODEL = join(ROOT, "artifacts", "models", "t1-ui-head");
const OUT_DIR = join(ROOT, "artifacts", "gates", "T1-detector-training");

const DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
for (const p of [DIST, join(DATA, "manifest.json"), join(MODEL, "predictions.json"), join(MODEL, "model-card.json")]) {
  if (!existsSync(p)) {
    console.error(`missing: ${p}`);
    process.exit(1);
  }
}
const E = await import(pathToFileURL(DIST).href);

const dataset = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8"));
const allPreds = JSON.parse(readFileSync(join(MODEL, "predictions.json"), "utf8"));
const card = JSON.parse(readFileSync(join(MODEL, "model-card.json"), "utf8"));

const devSamples = dataset.samples.filter((s) => s.split === "dev");
const devIds = new Set(devSamples.map((s) => s.id));
const devPreds = allPreds.dev.filter((p) => devIds.has(p.sampleId));

// The guard. Cheap, and the only thing standing between a disciplined analysis and a
// contaminated one.
const leaked = allPreds.dev.filter((p) => !devIds.has(p.sampleId));
if (leaked.length) {
  console.error(`REFUSED: ${leaked.length} predictions in the dev list do not belong to dev samples.`);
  process.exit(1);
}
console.log(`DEV ONLY — ${devSamples.length} samples, ${devPreds.length} predictions.`);
console.log("The test split is not read by this script.\n");

const hydrate = (list) => list.map((p) => ({ ...p, box: E.cssBox ? E.cssBox(p.box.x, p.box.y, p.box.w, p.box.h) : p.box }));
const ctx = {
  modelId: card.modelId,
  modelRevision: card.revision,
  backend: "none",
  browser: "node (ONNX artifact, ORT-verified)",
  preprocessing: card.preprocessing,
  evaluatedAt: new Date().toISOString(),
};

// ── 1. an EXTENDED dev sweep ────────────────────────────────────────────────────────
// Extended past the original grid deliberately. A maximum sitting on the edge of a grid is
// not a maximum, it is the edge of a grid, and the original sweep stopped at 0.70.
const GRID = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
const hydrated = hydrate(devPreds);
const sweep = E.sweepThreshold(dataset, hydrated, "dev", ctx, GRID);

const f1 = (r, p) => (r + p > 0 ? (2 * r * p) / (r + p) : 0);
const rows = sweep.map((s) => {
  const r = s.result;
  const recall = r.elementRecall.value;
  const grounding = Number.isNaN(r.groundingAccuracy.value) ? 0 : r.groundingAccuracy.value;
  return {
    threshold: s.threshold,
    mAP50: r.mAP50.value,
    recall,
    grounding,
    f1: f1(recall, grounding),
    predictions: r.totals.predictions,
    predictionsPerScreen: r.totals.predictions / devSamples.length,
    tp: r.totals.truePositives,
    fp: r.totals.falsePositives,
    fn: r.totals.falseNegatives,
    result: r,
  };
});

console.log("DEV sweep (tuning only — never reported as performance)");
console.log("  thr    mAP@0.5   recall  grounding      F1   preds  preds/screen");
for (const r of rows) {
  console.log(
    `  ${r.threshold.toFixed(2)}   ${r.mAP50.toFixed(4)}   ${r.recall.toFixed(4)}     ${r.grounding.toFixed(4)}  ` +
      `${r.f1.toFixed(4)}  ${String(r.predictions).padStart(6)}  ${r.predictionsPerScreen.toFixed(1).padStart(6)}`
  );
}

// ── 2. quantify the old rule's blindness ────────────────────────────────────────────
const mapVals = rows.map((r) => r.mAP50);
const plateau = rows.filter((r) => r.mAP50 >= Math.max(...mapVals) - 0.001);
const insensitivity = {
  mAPRangeAcrossGrid: Math.max(...mapVals) - Math.min(...mapVals),
  mAPRangeWithinPlateau: Math.max(...plateau.map((r) => r.mAP50)) - Math.min(...plateau.map((r) => r.mAP50)),
  plateauThresholds: plateau.map((r) => r.threshold),
  groundingRangeWithinPlateau:
    Math.max(...plateau.map((r) => r.grounding)) - Math.min(...plateau.map((r) => r.grounding)),
  predictionsRangeWithinPlateau: [
    Math.min(...plateau.map((r) => r.predictions)),
    Math.max(...plateau.map((r) => r.predictions)),
  ],
  verdict:
    "mAP@0.5 varies by " +
    (Math.max(...plateau.map((r) => r.mAP50)) - Math.min(...plateau.map((r) => r.mAP50))).toFixed(4) +
    " across the plateau while grounding varies by " +
    (Math.max(...plateau.map((r) => r.grounding)) - Math.min(...plateau.map((r) => r.grounding))).toFixed(4) +
    ". Maximising mAP cannot express a preference between these operating points.",
};
console.log("\nold rule (max mAP@0.5 on DEV) — why it could not work");
console.log(`  ${insensitivity.verdict}`);

// ── 3. the candidate rule, evaluated on DEV ─────────────────────────────────────────
// Harmonic mean of the two figures the DOSSIER ALREADY REQUIRES for this metric — element
// recall and grounding accuracy (which is precision: "fraction of predictions that land on
// the right element"). No new metric, no invented constant, and both terms vary strongly
// with the threshold, which is the property the old rule lacked.
let best = rows[0];
for (const r of rows) if (r.f1 > best.f1 + 1e-9) best = r;
// Tie-break to the HIGHER threshold: fewer predictions is the safer failure for a detector
// feeding a fusion stage that pairs against DOM nodes at IoU 0.5.
const ties = rows.filter((r) => Math.abs(r.f1 - best.f1) <= 1e-9);
const chosen = ties[ties.length - 1];

const interior = chosen.threshold !== GRID[0] && chosen.threshold !== GRID[GRID.length - 1];
console.log("\ncandidate rule: max F1(element recall, grounding accuracy) on DEV, ties to the higher threshold");
console.log(`  selects threshold ${chosen.threshold}  F1 ${chosen.f1.toFixed(4)}  ` +
  `recall ${chosen.recall.toFixed(4)}  grounding ${chosen.grounding.toFixed(4)}  ` +
  `${chosen.predictionsPerScreen.toFixed(1)} predictions/screen`);
console.log(`  interior maximum: ${interior ? "YES" : "NO — the grid boundary is doing the choosing"}`);

// ── 4. failure taxonomy at the incumbent and the candidate ──────────────────────────
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};

/**
 * Classify every false positive, because "12,000 false positives" is a symptom and the
 * question is which of six different diseases produced it. The categories are ordered so
 * each prediction lands in exactly one, most-specific first.
 */
function taxonomy(threshold) {
  const preds = devPreds.filter((p) => p.confidence >= threshold);
  const bySample = new Map();
  for (const p of preds) {
    if (!bySample.has(p.sampleId)) bySample.set(p.sampleId, []);
    bySample.get(p.sampleId).push(p);
  }

  const fp = { duplicate: 0, classConfusion: 0, localization: 0, spurious: 0 };
  const fn = { noOverlapAtAll: 0, overlappedWrongClass: 0, overlappedPoorLocalization: 0 };
  const confusion = {};
  let totalGt = 0;
  let matchedGt = 0;
  const bySize = {};
  const byPosition = { top: [0, 0], middle: [0, 0], bottom: [0, 0] };
  const byDensity = {};
  const byClipping = { clipped: [0, 0], whole: [0, 0] };
  const perClass = {};

  const bucketOf = (side) => (side < 20 ? "tiny <20" : side < 40 ? "small 20-40" : side < 100 ? "med 40-100" : "large >100");

  for (const s of devSamples) {
    const gts = s.annotations.filter((a) => a.visibility !== "OFFSCREEN");
    const mine = (bySample.get(s.id) || []).slice().sort((a, b) => b.confidence - a.confidence);
    const density = gts.length;
    const dBucket = density < 15 ? "sparse <15" : density < 25 ? "medium 15-24" : "dense >=25";

    // Greedy highest-confidence-first matching, the same discipline the evaluator uses:
    // one prediction may claim at most one ground-truth box.
    const claimed = new Set();
    const predMatch = new Map();
    for (const p of mine) {
      let bestJ = -1;
      let bestV = 0.5;
      for (let j = 0; j < gts.length; j++) {
        if (claimed.has(j) || gts[j].cls !== p.cls) continue;
        const v = iou(p.box, gts[j].box);
        if (v >= bestV) {
          bestV = v;
          bestJ = j;
        }
      }
      if (bestJ >= 0) {
        claimed.add(bestJ);
        predMatch.set(p, bestJ);
      }
    }

    for (const p of mine) {
      perClass[p.cls] = perClass[p.cls] || { gt: 0, pred: 0, tp: 0, fp: 0 };
      perClass[p.cls].pred++;
      if (predMatch.has(p)) {
        perClass[p.cls].tp++;
        continue;
      }
      // not a true positive — classify why
      let bestSame = 0;
      let bestAny = 0;
      let bestAnyCls = null;
      for (const g of gts) {
        const v = iou(p.box, g.box);
        if (v > bestAny) {
          bestAny = v;
          bestAnyCls = g.cls;
        }
        if (g.cls === p.cls && v > bestSame) bestSame = v;
      }
      perClass[p.cls].fp++;
      if (bestSame >= 0.5) {
        // same class, well overlapped, but the ground-truth box was already claimed
        fp.duplicate++;
      } else if (bestAny >= 0.5 && bestAnyCls !== p.cls) {
        fp.classConfusion++;
        const key = `${bestAnyCls}->${p.cls}`;
        confusion[key] = (confusion[key] || 0) + 1;
      } else if (bestSame >= 0.3) {
        fp.localization++;
      } else {
        fp.spurious++;
      }
    }

    for (let j = 0; j < gts.length; j++) {
      const g = gts[j];
      totalGt++;
      perClass[g.cls] = perClass[g.cls] || { gt: 0, pred: 0, tp: 0, fp: 0 };
      perClass[g.cls].gt++;
      const hit = claimed.has(j);
      if (hit) matchedGt++;

      const sizeKey = bucketOf(Math.max(g.box.w, g.box.h));
      bySize[sizeKey] = bySize[sizeKey] || [0, 0];
      bySize[sizeKey][1]++;
      if (hit) bySize[sizeKey][0]++;

      const centreY = g.box.y + g.box.h / 2;
      const third = centreY < s.viewportCss.h / 3 ? "top" : centreY < (2 * s.viewportCss.h) / 3 ? "middle" : "bottom";
      byPosition[third][1]++;
      if (hit) byPosition[third][0]++;

      byDensity[dBucket] = byDensity[dBucket] || [0, 0];
      byDensity[dBucket][1]++;
      if (hit) byDensity[dBucket][0]++;

      // The DATASET'S OWN label, not an edge-touching heuristic. A box flush against x=0
      // touches an edge without being clipped at all, and counting those as clipped
      // inflated the category by 40 annotations on the first attempt.
      const ck = g.visibility === "CLIPPED" ? "clipped" : "whole";
      byClipping[ck][1]++;
      if (hit) byClipping[ck][0]++;

      if (!hit) {
        let bestAny = 0;
        let bestSame = 0;
        for (const p of mine) {
          const v = iou(p.box, g.box);
          if (v > bestAny) bestAny = v;
          if (p.cls === g.cls && v > bestSame) bestSame = v;
        }
        if (bestAny < 0.1) fn.noOverlapAtAll++;
        else if (bestSame < 0.5 && bestAny >= 0.5) fn.overlappedWrongClass++;
        else fn.overlappedPoorLocalization++;
      }
    }
  }

  return {
    threshold,
    predictions: preds.length,
    predictionsPerScreen: preds.length / devSamples.length,
    groundTruth: totalGt,
    matched: matchedGt,
    recall: matchedGt / totalGt,
    falsePositiveTaxonomy: fp,
    falsePositiveShare: Object.fromEntries(
      Object.entries(fp).map(([k, v]) => [k, v / Math.max(1, Object.values(fp).reduce((a, b) => a + b, 0))])
    ),
    falseNegativeTaxonomy: fn,
    classConfusionPairs: Object.fromEntries(Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 10)),
    perClass: Object.fromEntries(
      Object.entries(perClass)
        .sort()
        .map(([k, v]) => [
          k,
          { ...v, recall: v.gt ? v.tp / v.gt : null, precision: v.pred ? v.tp / v.pred : null },
        ])
    ),
    recallBySize: Object.fromEntries(Object.entries(bySize).map(([k, [h, t]]) => [k, { hit: h, total: t, recall: h / t }])),
    recallByPosition: Object.fromEntries(
      Object.entries(byPosition).map(([k, [h, t]]) => [k, { hit: h, total: t, recall: t ? h / t : null }])
    ),
    recallByDensity: Object.fromEntries(
      Object.entries(byDensity).map(([k, [h, t]]) => [k, { hit: h, total: t, recall: h / t }])
    ),
    recallByClipping: Object.fromEntries(
      Object.entries(byClipping).map(([k, [h, t]]) => [k, { hit: h, total: t, recall: t ? h / t : null }])
    ),
  };
}

// ── 4b. the recall CEILING imposed by the evaluation definition ─────────────────────
//
// A control that runs off the bottom of the viewport is labelled with its FULL CSS box,
// because that is what the DOM reports. The model can only see the part inside the frame.
// So for a clipped element the best achievable IoU against its own label is the fraction
// of its area that is actually visible — and when that fraction is below 0.5, the element
// is UNREACHABLE at the matching threshold no matter how good the detector is.
//
// This was found by asking why "clipped" recall (0.473) barely moved with the threshold
// while every other breakdown moved a lot. A model failure would have moved.
//
// The dataset already distinguishes VISIBLE / CLIPPED / OFFSCREEN. The evaluator excludes
// only OFFSCREEN, so CLIPPED elements are scored against a target that partly does not
// exist in the frame.
function reachability() {
  let clipped = 0;
  let unreachable = 0;
  let total = 0;
  const fractions = [];
  const byLabel = {};
  for (const s of devSamples) {
    for (const a of s.annotations) {
      if (a.visibility === "OFFSCREEN") continue;
      total++;
      byLabel[a.visibility] = (byLabel[a.visibility] || 0) + 1;
      if (a.visibility !== "CLIPPED") continue;
      const b = a.box;
      const x1 = Math.max(b.x, 0);
      const y1 = Math.max(b.y, 0);
      const x2 = Math.min(b.x + b.w, s.viewportCss.w);
      const y2 = Math.min(b.y + b.h, s.viewportCss.h);
      const visible = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const frac = visible / (b.w * b.h);
      clipped++;
      fractions.push(frac);
      if (frac < 0.5) unreachable++;
    }
  }
  fractions.sort((a, b) => a - b);
  return {
    evaluatableAnnotations: total,
    visibilityLabels: byLabel,
    clippedAnnotations: clipped,
    unreachableAtIou50: unreachable,
    unreachableShareOfEvaluatable: unreachable / total,
    visibleAreaFraction: {
      min: fractions[0],
      p50: fractions[Math.floor(fractions.length / 2)],
      max: fractions[fractions.length - 1],
    },
    recallCeiling: (total - unreachable) / total,
    consequence:
      "Element recall on this dataset cannot exceed " +
      (((total - unreachable) / total) * 100).toFixed(1) +
      "%. A reported recall must be read against that ceiling, not against 1.0. The fix is " +
      "an evaluator decision — score CLIPPED elements against their VISIBLE extent, or " +
      "exclude them the way OFFSCREEN elements are excluded — and it changes the metric " +
      "definition, so it must not be made while a held-out figure is being interpreted.",
  };
}
const reach = reachability();
console.log("\nrecall ceiling imposed by the evaluation definition");
console.log(
  `  ${reach.clippedAnnotations} clipped of ${reach.evaluatableAnnotations} evaluatable; ` +
    `${reach.unreachableAtIou50} are UNREACHABLE at IoU>=0.5 (visible-area fraction below 0.5).`
);
console.log(`  recall ceiling ${(reach.recallCeiling * 100).toFixed(1)}% — not 100%.`);

const INCUMBENT = 0.05;
const analyses = { incumbent: taxonomy(INCUMBENT), candidate: taxonomy(chosen.threshold), shippedDefault: taxonomy(0.25) };

for (const [name, a] of Object.entries(analyses)) {
  console.log(`\n── ${name} (threshold ${a.threshold}) ──`);
  console.log(`  ${a.predictionsPerScreen.toFixed(1)} predictions/screen, recall ${a.recall.toFixed(4)}`);
  console.log(
    "  FP: " +
      Object.entries(a.falsePositiveTaxonomy)
        .map(([k, v]) => `${k} ${v} (${(a.falsePositiveShare[k] * 100).toFixed(0)}%)`)
        .join("  ")
  );
  console.log("  FN: " + Object.entries(a.falseNegativeTaxonomy).map(([k, v]) => `${k} ${v}`).join("  "));
}

console.log("\nper class at the candidate threshold");
console.log("  class        gt   pred    TP    FP   recall  precision");
for (const [cls, v] of Object.entries(analyses.candidate.perClass)) {
  console.log(
    `  ${cls.padEnd(10)} ${String(v.gt).padStart(4)} ${String(v.pred).padStart(6)} ${String(v.tp).padStart(5)} ` +
      `${String(v.fp).padStart(5)}   ${(v.recall ?? 0).toFixed(4)}     ${(v.precision ?? 0).toFixed(4)}`
  );
}

// ── 5. write it down ────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const out = {
  analysis: "QG-03 / QG-05 — DEV-ONLY threshold methodology and failure analysis",
  split: "dev",
  testSplitOpened: false,
  warning:
    "SYNTHETIC DATA, DEV SPLIT. Nothing here is a performance claim. The held-out figures " +
    "remain those already published in qg05-detector-evaluation.json, produced under the " +
    "OLD rule, and they are not restated or revised here.",
  model: { id: card.modelId, revision: card.revision, artifact: card.artifact },
  dataset: { name: dataset.name, version: dataset.version, hash: dataset.hash, devSamples: devSamples.length },
  oldRule: {
    rule: "max mAP@0.5 on DEV",
    chose: 0.05,
    status: "METHODOLOGICAL DEFECT — superseded, not erased",
    defect:
      "mAP@0.5 is a ranking metric and is very nearly invariant to the emit threshold, " +
      "because lowering the threshold appends predictions to the tail of the ranking where " +
      "recall is already saturated. Maximising it therefore cannot express a preference " +
      "between operating points, and the tie-break selected the end of the plateau with the " +
      "most predictions.",
    evidence: insensitivity,
  },
  candidateRule: {
    rule: "max F1(element recall, grounding accuracy) on DEV; ties broken to the HIGHER threshold",
    grid: GRID,
    selects: chosen.threshold,
    interiorMaximum: interior,
    devFigures: {
      f1: chosen.f1,
      recall: chosen.recall,
      grounding: chosen.grounding,
      mAP50: chosen.mAP50,
      predictionsPerScreen: chosen.predictionsPerScreen,
    },
    whyThisAndNotSomethingElse:
      "Both terms are figures the dossier ALREADY requires for the visual-context metric " +
      "(element recall, and grounding accuracy, which is defined as the fraction of " +
      "predictions that land on the right element). No new metric is invented and no " +
      "arbitrary constant is introduced — a constrained rule such as 'maximise recall " +
      "subject to grounding >= X' would have required choosing X, and there is no evidence " +
      "for any particular X. Both terms vary strongly with the threshold, which is exactly " +
      "the property the old rule lacked.",
    selectionIsNotSharp: {
      note:
        "F1 is flat near the optimum. On 40 dev screens the difference between thresholds " +
        "in the flat band is not resolvable, so 0.55 should be read as 'somewhere in that " +
        "band', not as a tuned value. Reporting it to two decimals would overstate the " +
        "evidence.",
      withinOnePercentOfBest: rows.filter((r) => r.f1 >= chosen.f1 - 0.01).map((r) => r.threshold),
      devScreens: devSamples.length,
    },
    tieBreakRationale:
      "Fewer predictions is the safer failure for a detector feeding a fusion stage that " +
      "pairs visual boxes against DOM nodes at IoU 0.5; surplus boxes become UNRESOLVED " +
      "visual-only elements that a planner must then reason about.",
    appliedToTest: false,
    appliedToTestNote:
      "DELIBERATELY NOT APPLIED. The test split has already been observed once, so it is no " +
      "longer fully held out. Applying a newly frozen rule to it would produce a figure whose " +
      "provenance is 'the second look at a consumed split'. The rule is frozen here; the " +
      "evaluation that uses it needs a split that has not been read.",
  },
  recallCeiling: reach,
  devSweep: rows.map(({ result, ...r }) => r),
  failureAnalysis: analyses,
  generatedAt: new Date().toISOString(),
};
const path = join(OUT_DIR, "qg03-dev-threshold-analysis.json");
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`\nwrote ${path}`);
console.log("\nDEV ONLY. The held-out figures are unchanged and were not recomputed.");
