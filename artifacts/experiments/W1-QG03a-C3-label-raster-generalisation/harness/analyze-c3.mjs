/**
 * QG-03a-C3 — paired A-versus-B comparison and the verdict.
 *
 *   node artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness/analyze-c3.mjs
 *
 * Applies the APPROVED QG-03a-C criterion through the comparator rule pre-registered in design.md:
 *
 *   PASS          every C3-A cell is no worse than the worst C3-B control on mAP@0.5, element
 *                 recall (ceiling-relative), grounding and minimum matched IoU, and minimum IoU
 *                 stays above 0.5.
 *   FAIL          an unambiguous breach needing no new number: minimum matched IoU at or below
 *                 0.5, or a metric collapsing to zero.
 *   INCONCLUSIVE  anything in between — a degradation whose materiality cannot be judged without
 *                 a number the approved criterion does not contain. Escalated, not resolved here.
 *
 * No tolerance is invented. Recall is compared ceiling-relative, because the frozen CLIPPED
 * definition makes the reachable maximum differ per viewport, and that is not a geometry effect.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CELLS, EXPERIMENT, MODEL, OPERATING_POINT, VIEWS } from "./c3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGS = join(HERE, "..", "logs");
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(1); };

const logs = {};
for (const c of CELLS) {
  const p = join(LOGS, `c3-${c.id}.json`);
  if (!existsSync(p)) refuse(`cell ${c.id} has no log: the matrix is incomplete, so there is nothing to compare`);
  logs[c.id] = JSON.parse(readFileSync(p, "utf8"));
}

// Every cell must describe the same artifact, runtime and operating point, or the cells are not
// comparable and the comparison would be measuring the harness instead of the geometry.
for (const c of CELLS) {
  const l = logs[c.id];
  if (l.model.sha256 !== MODEL.sha256) refuse(`${c.id}: different model`);
  if (l.runtime.ortVersions.web !== logs[CELLS[0].id].runtime.ortVersions.web) refuse(`${c.id}: different ORT version`);
  if (l.operatingPoint !== OPERATING_POINT) refuse(`${c.id}: different operating point`);
  if (l.shippedConstants.score !== logs[CELLS[0].id].shippedConstants.score) refuse(`${c.id}: different shipped score floor`);
  if (l.rows.length !== logs[CELLS[0].id].rows.length) refuse(`${c.id}: different sample count`);
}

// Cells are paired by seed; assert the pairing actually holds before leaning on it.
const seedsOf = (id) => logs[id].rows.map((r) => r.seed).join(",");
for (const c of CELLS) if (seedsOf(c.id) !== seedsOf(CELLS[0].id)) refuse(`${c.id}: seed set differs, so the cells are not paired`);
const specPairing = CELLS.every((c) => logs[c.id].rows.every((r, i) => r.specSha256 === logs[CELLS[0].id].rows[i].specSha256));

const A = CELLS.filter((c) => c.kind === "A").map((c) => c.id);
const B = CELLS.filter((c) => c.kind === "B").map((c) => c.id);

const cellSummary = {};
for (const c of CELLS) {
  const l = logs[c.id];
  cellSummary[c.id] = {
    kind: c.kind,
    viewport: l.viewport,
    dpr: l.dpr,
    captureSize: l.captureSize,
    trainingGeometry: l.trainingGeometry,
    datasetHash: l.dataset.hash,
    samples: l.dataset.samples,
    clippingCeiling: l.clippingCeiling,
    views: l.views,
    timing: {
      preprocessMedianMs: median(l.rows.map((r) => r.preprocessMs)),
      inferMedianMs: median(l.rows.map((r) => r.inferMs)),
      decodeNmsMedianMs: median(l.rows.map((r) => r.decodeNmsMs)),
    },
  };
}
function median(a) { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; }

/** Recall as a fraction of what the frozen CLIPPED definition makes reachable at all. */
const ceilingRelative = (recall, ceiling) => (Number.isFinite(recall) && Number.isFinite(ceiling) && ceiling > 0 ? recall / ceiling : Number.NaN);

const comparison = {};
let anyDegradation = false;
let anyHardBreach = false;
for (const view of VIEWS) {
  const bWorst = {
    mAP50: Math.min(...B.map((id) => logs[id].views[view].mAP50)),
    recallCeilingRelative: Math.min(...B.map((id) => ceilingRelative(logs[id].views[view].elementRecall, logs[id].clippingCeiling.ceiling))),
    groundingAccuracy: Math.min(...B.map((id) => logs[id].views[view].groundingAccuracy)),
    minMatchedIou: Math.min(...B.map((id) => logs[id].views[view].minMatchedIou)),
  };
  const perCell = {};
  for (const id of A) {
    const v = logs[id].views[view];
    const rel = ceilingRelative(v.elementRecall, logs[id].clippingCeiling.ceiling);
    const deltas = {
      mAP50: r6(v.mAP50 - bWorst.mAP50),
      recallCeilingRelative: r6(rel - bWorst.recallCeilingRelative),
      groundingAccuracy: r6(v.groundingAccuracy - bWorst.groundingAccuracy),
      minMatchedIou: r6(v.minMatchedIou - bWorst.minMatchedIou),
    };
    const degraded = Object.entries(deltas).filter(([, d]) => Number.isFinite(d) && d < 0).map(([k]) => k);
    const hardBreach = [];
    if (!(v.minMatchedIou > 0.5)) hardBreach.push(`minMatchedIou ${v.minMatchedIou} is not above 0.5`);
    for (const k of ["mAP50", "elementRecall", "groundingAccuracy"]) if (v[k] === 0) hardBreach.push(`${k} collapsed to 0`);
    if (degraded.length) anyDegradation = true;
    if (hardBreach.length) anyHardBreach = true;
    perCell[id] = { measured: { mAP50: v.mAP50, elementRecall: v.elementRecall, recallCeilingRelative: r6(rel), groundingAccuracy: v.groundingAccuracy, minMatchedIou: v.minMatchedIou, worstMatchedDispCss: v.worstMatchedDispCss, smallestMatchedLabelPx: v.smallestMatchedLabelPx }, deltaVsWorstControl: deltas, degraded, hardBreach };
  }
  comparison[view] = { worstControl: { ...bWorst, mAP50: r6(bWorst.mAP50), recallCeilingRelative: r6(bWorst.recallCeilingRelative), groundingAccuracy: r6(bWorst.groundingAccuracy), minMatchedIou: r6(bWorst.minMatchedIou) }, cells: perCell };
}

const worstDispAll = Math.max(...CELLS.map((c) => Math.max(...VIEWS.map((v) => logs[c.id].views[v].worstMatchedDispCss))));
const minIouAll = Math.min(...CELLS.map((c) => Math.min(...VIEWS.map((v) => logs[c.id].views[v].minMatchedIou))));

const verdict = anyHardBreach ? "FAIL" : anyDegradation ? "INCONCLUSIVE / DECISION REQUIRED" : "PASS";
const out = {
  experiment: EXPERIMENT,
  runAt: new Date().toISOString(),
  criterion: {
    approved: "The mismatch is harmless if the worst case leaves mAP@0.5, element recall and grounding unchanged, and IoU stays well above 0.5 for the smallest controls.",
    source: "QG-03a-C, approved; reused unchanged",
    comparator: "per design.md: each C3-A cell no worse than the worst C3-B control, recall compared ceiling-relative; FAIL only on minMatchedIou <= 0.5 or a metric collapsing to 0; anything else escalates",
    noNewTolerance: true,
  },
  pairing: { bySeed: true, identicalSpecContentAcrossCells: specPairing },
  model: { sha256: MODEL.sha256, revision: MODEL.revision, retrained: false },
  operatingPoint: OPERATING_POINT,
  clippedDefinition: "FROZEN and untouched; its arithmetic ceiling is reported per cell and recall is read against it",
  cells: cellSummary,
  comparison,
  worstMatchedDispCssAllCells: r6(worstDispAll),
  minMatchedIouAllCells: r6(minIouAll),
  verdict,
  closesQg03aC: false,
  note: "A C3 PASS is evidence for a governance decision on QG-03a-C, not the decision. Retraining was not performed and is not approved.",
};
writeFileSync(join(LOGS, "metrics.json"), JSON.stringify(out, null, 1));

console.log(`paired by seed: ${out.pairing.bySeed} | identical spec content across cells: ${specPairing}`);
for (const c of CELLS) {
  const s = cellSummary[c.id];
  const v = s.views.op055;
  console.log(`${c.id} [${c.kind}] ${s.viewport.w}x${s.viewport.h}@${s.dpr} cap ${s.captureSize.w}x${s.captureSize.h} training=${s.trainingGeometry} | mAP ${v.mAP50} recall ${v.elementRecall} (ceiling ${r6(s.clippingCeiling.ceiling)}) grounding ${v.groundingAccuracy} | minIoU ${v.minMatchedIou} worstDisp ${v.worstMatchedDispCss}`);
}
for (const view of VIEWS) {
  console.log(`\nview ${view}: worst control = mAP ${comparison[view].worstControl.mAP50}, recall/ceiling ${comparison[view].worstControl.recallCeilingRelative}, grounding ${comparison[view].worstControl.groundingAccuracy}, minIoU ${comparison[view].worstControl.minMatchedIou}`);
  for (const [id, r] of Object.entries(comparison[view].cells)) {
    console.log(`  ${id}: delta ${JSON.stringify(r.deltaVsWorstControl)} degraded=[${r.degraded.join(",")}] breach=[${r.hardBreach.join("; ")}]`);
  }
}
console.log(`\nworst CSS displacement across all cells: ${out.worstMatchedDispCssAllCells} | minimum matched IoU: ${out.minMatchedIouAllCells}`);
console.log(`C3 VERDICT: ${verdict}`);
console.log(`closes QG-03a-C: ${out.closesQg03aC} (governance decision, not a harness output)`);
process.exit(verdict === "PASS" ? 0 : verdict === "FAIL" ? 4 : 5);
