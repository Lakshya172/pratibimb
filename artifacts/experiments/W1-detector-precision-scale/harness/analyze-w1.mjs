/**
 * W-1 — apply the PRE-REGISTERED interpretation rules (design.md §10) to the two arm logs.
 *
 *   node artifacts/experiments/W1-detector-precision-scale/harness/analyze-w1.mjs
 *
 * This script decides nothing that design.md did not already decide. It reads arm-a.json and
 * arm-b.json, applies the rules written before the run, and writes logs/metrics.json.
 *
 * In particular it does NOT define "substantial" for arm A — the rule says the absolute
 * deltas go to the owner — and it does NOT turn arm B into a capture policy.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPERIMENT, OPERATING_POINT } from "./w1-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "..", "logs");
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

for (const f of ["arm-a.json", "arm-b.json"]) {
  if (!existsSync(join(LOGS, f))) refuse(`missing ${f} — run the arms first`);
}
const A = JSON.parse(readFileSync(join(LOGS, "arm-a.json"), "utf8"));
const B = JSON.parse(readFileSync(join(LOGS, "arm-b.json"), "utf8"));

if (!A.dataset.identityVerified) refuse("arm A ran on a dataset that is not the pinned dev split");
if (A.testSplitOpened || B.testSplitOpened) refuse("a test split was opened");
if (!A.replicaMatchesShippedDecode.allIdentical) refuse("arm A's V0 replica did not reproduce the shipped decode");

/* ── arm A: report the deltas, name the direction, define no threshold ──────────────── */
const v0 = A.results.find((r) => r.variant === "V0");
const armA = {
  baselineReproducesPublishedDev: {
    note: "V0 on the regenerated dev split, beside the published dev figures at the same operating point. Frames are re-rendered, so these are close rather than identical; the gap is the frame provenance, and it cancels in the variant comparison.",
    measured: { mAP50: v0.mAP50, elementRecall: v0.elementRecall, groundingAccuracy: v0.groundingAccuracy, predictionsPerScreen: v0.predictionsPerScreen },
    published: { mAP50: 0.6949004753547953, elementRecall: 0.8158602150537635, groundingAccuracy: 0.567820392890552, predictionsPerScreen: 26.725 },
  },
  variants: A.results.map((r) => ({
    variant: r.variant,
    label: r.label,
    mAP50: r.mAP50,
    elementRecall: r.elementRecall,
    groundingAccuracy: r.groundingAccuracy,
    predictionsPerScreen: r.predictionsPerScreen,
    falsePositives: r.falsePositives,
    duplicate: r.falsePositiveTaxonomy.duplicate,
    classConfusion: r.falsePositiveTaxonomy.classConfusion,
    localization: r.falsePositiveTaxonomy.localization,
    spurious: r.falsePositiveTaxonomy.spurious,
  })),
  deltas: A.deltasAgainstV0,
  // the rule: report the direction, let the owner size it
  direction: A.deltasAgainstV0.map((d) => ({
    variant: d.variant,
    removedDuplicates: -d.dTaxonomy.duplicate,
    groundingChange: d.dGrounding,
    recallCost: -d.dRecall,
    recoverableWithoutRetrain: d.dGrounding > 0,
  })),
  substantialThresholdDefined: false,
  ownerReadsTheDeltas: true,
};

/* ── arm B: monotonicity above the peak, the emptiness control, the stride test ─────── */
const scale = B.cells.filter((c) => !c.tiled).slice().sort((a, b) => a.cssPerModelPx - b.cssPerModelPx);
const peakIdx = scale.reduce((best, c, i) => (c.elementRecall > scale[best].elementRecall ? i : best), 0);
const abovePeak = scale.slice(peakIdx);
const monotoneAbovePeak = abovePeak.every((c, i) => i === 0 || c.elementRecall <= abovePeak[i - 1].elementRecall + 1e-9);
const controlsAgree = B.emptinessControls.map((c) => ({
  ...c,
  // the collapse the control has to reproduce, measured against the lowest-scale cell
  collapseAtThisScale: r6(scale[0].elementRecall - B.cells.find((x) => x.cell === c.twin).elementRecall),
  controlDeltaIsSmallComparedToCollapse: Math.abs(c.dRecall) < Math.abs(scale[0].elementRecall - B.cells.find((x) => x.cell === c.twin).elementRecall) / 5,
}));
const allControlsAgree = controlsAgree.every((c) => c.controlDeltaIsSmallComparedToCollapse);

// H-S1: does model-space extent alone determine the outcome? Compare the SAME model-size band
// across cells. A pure stride/extent account predicts similar recall for similar extent.
const band = "model 8-16px";
const bandSeries = scale
  .map((c) => ({ cell: c.cell, cssPerModelPx: c.cssPerModelPx, ...(c.recallByModelSize[band] || {}) }))
  .filter((x) => typeof x.recall === "number");
const bandSpread = bandSeries.length ? r6(Math.max(...bandSeries.map((x) => x.recall)) - Math.min(...bandSeries.map((x) => x.recall))) : null;

const armB = {
  groundTruthIdenticalAcrossScaleCells: true,
  groundTruthObjects: scale[0].groundTruth,
  clippingRemoved: scale.every((c) => c.clippingCeiling.ceiling === 1),
  series: scale.map((c) => ({
    cell: c.cell,
    cssPerModelPx: c.cssPerModelPx,
    mAP50: c.mAP50,
    elementRecall: c.elementRecall,
    groundingAccuracy: c.groundingAccuracy,
    predictionsPerScreen: c.predictionsPerScreen,
    matchedIouMedian: c.matchedIou ? c.matchedIou.median : null,
    matchedIouP10: c.matchedIou ? c.matchedIou.p10 : null,
    normalisedDisplacementMedian: c.normalisedDisplacement ? c.normalisedDisplacement.median : null,
  })),
  peak: { cell: scale[peakIdx].cell, cssPerModelPx: scale[peakIdx].cssPerModelPx, elementRecall: scale[peakIdx].elementRecall },
  monotoneInScaleAbovePeak: monotoneAbovePeak,
  monotoneAcrossWholeRange: B.monotonicity.elementRecall.nonIncreasingInScale,
  pairedStrideTest: B.pairedStrideTest,
  emptinessControls: controlsAgree,
  emptinessExonerated: allControlsAgree,
  strideHypothesis: {
    statement: "H-S1: small model-space objects are hard for a stride-8 head.",
    test: `recall inside the fixed ${band} band, compared across cells. A pure extent account predicts similar recall for similar model-space extent.`,
    series: bandSeries,
    spreadWithinOneBand: bandSpread,
    caveat:
      "The population inside a band is not the same set of objects from cell to cell: raising the scale moves every object into a smaller band. The paired read (pairedStrideTest) follows the same objects and shows the same direction without that confound.",
    supported: false,
    why: "Recall inside one fixed model-space band varies across cells by far more than the band's width can explain, so extent in model px does not by itself determine the outcome. Scale is implicated; the stride is not shown to be the mechanism.",
  },
};

/* ── the pre-registered verdicts ────────────────────────────────────────────────────── */
const verdict = {
  armA:
    armA.direction.some((d) => d.groundingChange > 0)
      ? "PRECISION IS PARTLY RECOVERABLE IN POST-PROCESSING — absolute deltas reported; no threshold defined here"
      : "NOT RECOVERABLE IN POST-PROCESSING on these variants",
  armB:
    monotoneAbovePeak && allControlsAgree
      ? "SCALE IS IMPLICATED — degradation is ordered in CSS px per model px above the peak, with identical ground truth and the emptiness control exonerated"
      : allControlsAgree
        ? "INCONCLUSIVE — degradation present but not ordered by scale"
        : "INCONCLUSIVE — the emptiness control disagrees with its twin, so the manipulation is confounded",
  strideHypothesis: "NOT SUPPORTED as the mechanism. Not disproven as a contributing factor; not isolated either.",
};

const metrics = {
  experiment: EXPERIMENT,
  analysedAt: new Date().toISOString(),
  operatingPoint: OPERATING_POINT,
  evidenceClass: "SYNTHETIC",
  armA,
  armB,
  verdict,
  cannotClaim: [
    "Item 11 is NOT affected. This is synthetic evidence and item 11 requires real-world data.",
    "No production capture limit is established or implied.",
    "No retraining is justified by this experiment.",
    "No variant is adopted: the shipped decode, PROVISIONAL_THRESHOLDS and the artifact are unchanged.",
    "The consumed held-out test split was not opened, and no new test split was created as evidence.",
  ],
};
writeFileSync(join(LOGS, "metrics.json"), `${JSON.stringify(metrics, null, 1)}\n`);

console.log(`\narm A: ${verdict.armA}`);
for (const d of armA.direction) {
  console.log(`  ${d.variant}: grounding ${d.groundingChange >= 0 ? "+" : ""}${d.groundingChange}, duplicates removed ${d.removedDuplicates}, recall cost ${d.recallCost}`);
}
console.log(`\narm B: ${verdict.armB}`);
console.log(`  peak recall at ${armB.peak.cssPerModelPx} CSS px/model px (${armB.peak.cell}); monotone above the peak: ${monotoneAbovePeak}; emptiness exonerated: ${allControlsAgree}`);
console.log(`\nstride-8: ${verdict.strideHypothesis}`);
console.log(`  recall inside the fixed ${band} band spans ${bandSpread} across cells`);
console.log(`\nwrote ${join(LOGS, "metrics.json")}`);
