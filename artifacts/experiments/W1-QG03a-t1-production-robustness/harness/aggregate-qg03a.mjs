/**
 * QG-03a — build metrics.json from the raw logs.
 *
 *   node .../harness/aggregate-qg03a.mjs
 *
 * Every number in metrics.json is copied from logs/ or reference.json, never typed in. The
 * only hand-written content is the STATUS block, and each status names the evidence behind
 * it. qg03aRobustness.test.ts then checks the statuses against the numbers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const L = (n) => JSON.parse(readFileSync(join(EXP, "logs", n), "utf8"));
const ref = JSON.parse(readFileSync(join(HERE, "reference.json"), "utf8"));
const node = { before: L("a-raster-node-before.json"), after: L("a-raster-node-after.json") };
const br = {
  chrome: { before: L("a-browser-chrome-before.json"), after: L("a-browser-chrome-after.json") },
  firefox: { before: L("a-browser-firefox-before.json"), after: L("a-browser-firefox-after.json") },
};
const b = L("b-nms.json");
const c = L("c-labels-coords.json");

const cell = (x) => ({
  fixtures: x.summary.fixtures,
  conformant: x.summary.conformant,
  nonConformant: x.summary.nonConformant,
  nonConformantNames: x.summary.nonConformantNames,
  ...(x.userAgent ? { userAgent: x.userAgent } : { runtime: x.runtime }),
});
const b1pos = b.b1.rows.filter((r) => r.deltaRepresentable && r.delta > 0);
const b1neg = b.b1.rows.filter((r) => r.delta <= 0 || !r.deltaRepresentable);

const metrics = {
  experiment: "W1-QG03a-t1-production-robustness",
  base: "3d97284ac08986cad9b1b8a6ba8ea2ed032af246",
  workstation: "2 (LAPTOP-SRCINK2B, ENV-0002)",
  modelArtifactUsed: false,
  heldOutTestSplitEvaluated: false,
  a: {
    reference: ref.reference,
    historicalDigestsReproduced: ref.historicalCheck.matchCommittedDigests,
    historicalFixtures: ref.historicalCheck.fixtures,
    fixtures: ref.fixtures.length,
    exactHalfFixtures: ref.fixtures.filter((f) => f.exactHalf.w || f.exactHalf.h).map((f) => f.name),
    before: { node: cell(node.before), chrome: cell(br.chrome.before), firefox: cell(br.firefox.before) },
    after: { node: cell(node.after), chrome: cell(br.chrome.after), firefox: cell(br.firefox.after) },
    beforeDivergence: node.before.rows
      .filter((r) => !r.conformant)
      .map((r) => ({
        name: r.name,
        firstDivergence: r.firstDivergence,
        shipped: r.shipped,
        reference: r.reference,
        letterboxedMaxAbs: r.letterboxedDiff?.maxAbs ?? null,
        letterboxedMeanAbs: r.letterboxedDiff?.meanAbs ?? null,
        fractionDiffering: r.letterboxedDiff?.fractionDiffering ?? null,
      })),
    timing: {
      nodeMedianOf7: node.after.timing,
      chromeSingleRun: br.chrome.after.timingSingleRunMs,
      firefoxSingleRun: br.firefox.after.timingSingleRunMs,
      dossierBudget: "Capture + downscale 18 ms — PROJECTED (dossier §10), not a measurement",
    },
    roundingDisagreementPrevalence: c.a3.prevalence,
  },
  a3: {
    geometries: c.a3.rows.length,
    accepted: c.a3.rows.filter((r) => r.geometryAccepted).length,
    dpr: [...new Set(c.a3.rows.map((r) => r.dpr))],
    zoom: [...new Set(c.a3.rows.map((r) => r.zoom))],
    maxRoundTripErrorCssPx: Math.max(...c.a3.rows.map((r) => r.maxRoundTripErrorCssPx)),
    maxLabelRasterOffsetCssPx: Math.max(...c.a3.rows.map((r) => r.labelRasterWorstCssPx)),
  },
  b: {
    shippedDecode: b.shippedDecode,
    observedBackendScoreDelta: b.observedBackendScoreDelta,
    b1: {
      pair: b.b1.pair,
      survivorSwapsForEveryRepresentablePositiveDelta: b1pos.every((r) => r.survivor.startsWith("B")),
      survivorUnchangedOtherwise: b1neg.every((r) => r.survivor.startsWith("A")),
      swapDisplacementCssPx: Math.max(...b.b1.rows.map((r) => r.displacementFromTieSurvivorCssPx)),
      float32SmallestVisibleIncrementAt09: b.b1.float32SmallestVisibleIncrementAt09,
    },
    swapGeometry: b.b1.swapGeometry,
    mechanisms: b.b2.map((m) => ({ mechanism: m.mechanism, outcomeChangesAt: m.outcomeChangesAt })),
    b3Scenes: b.b3.scenes,
    b3: b.b3.rows,
    diagnosticOnlyWeightedMerge: b.diagnosticOnlyWeightedMerge,
  },
  c: { c1: c.c1, c2: c.c2 },
  status: {
    A_preprocessing: "PASS",
    A_scope: "after the QG-03a-A1 fix; Windows workstation 2; Node, Chrome 153 and Firefox 155 in a plain page context. Linux UNKNOWN. Extension-context cells are QG-03b's (workstation 1).",
    A3_coordinates: "PASS",
    B_inferenceNoise: "OPEN",
    B_reason: "mechanism localised (hard greedy NMS is discontinuous at score near-ties); consequence is model-dependent and cannot be measured without the artifact; the pre-registered 2.0 CSS px bound is incompatible with hard NMS and a replacement criterion is an architect decision",
    C_labelRaster: "CONDITIONAL",
    C_reason: "bounded (<= 0.681 model px) and metric-neutral at IoU 0.5 even in the worst case; does not justify a retrain on its own; remains technical debt to bundle with the next training change",
    QG03a: "OPEN",
    QG03: "CONDITIONAL",
    detector: "UNADOPTED",
    frozenThreshold: 0.55,
    modelRegistry: "UNCHANGED",
  },
};

writeFileSync(join(EXP, "metrics.json"), JSON.stringify(metrics, null, 1));
console.log("wrote metrics.json");
console.log(JSON.stringify({ a: { before: metrics.a.before, after: metrics.a.after }, timing: metrics.a.timing }, null, 1));
