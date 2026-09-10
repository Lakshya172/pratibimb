/**
 * Score the trained T1 head with the EXISTING QG-05 evaluator.
 *
 *   node tools/detector/run-qg05-eval.mjs
 *
 * The evaluator is imported from the compiled package and used as-is. It is not modified,
 * wrapped, or re-implemented here, because an evaluator adjusted while looking at a model's
 * output stops being a measurement of the model and becomes a measurement of the
 * adjustment.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE SPLIT DISCIPLINE, ENFORCED BY ORDER OF OPERATIONS
 *
 *   DEV   sweeps the confidence threshold and picks one
 *   TEST  is then scored ONCE, at that already-chosen threshold
 *
 * The test split is never swept. Picking the threshold that maximises the test number and
 * then reporting that number is the most common way a benchmark becomes fiction, and it
 * leaves no trace in the result.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DATA = join(ROOT, "artifacts", "datasets", "t1-ui-v1");
const MODEL = join(ROOT, "artifacts", "models", "t1-ui-head");

const DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
for (const p of [DIST, join(DATA, "manifest.json"), join(MODEL, "predictions.json"), join(MODEL, "model-card.json")]) {
  if (!existsSync(p)) {
    console.error(`missing: ${p}`);
    process.exit(1);
  }
}
const E = await import(pathToFileURL(DIST).href);

const dataset = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8"));
const preds = JSON.parse(readFileSync(join(MODEL, "predictions.json"), "utf8"));
const card = JSON.parse(readFileSync(join(MODEL, "model-card.json"), "utf8"));

/** Predictions arrive as plain objects; the evaluator wants branded CSS boxes. */
const hydrate = (list) =>
  list.map((p) => ({ ...p, box: E.cssBox ? E.cssBox(p.box.x, p.box.y, p.box.w, p.box.h) : p.box }));

const ctx = {
  modelId: card.modelId,
  modelRevision: card.revision,
  backend: "none",
  browser: "node (torch export, ORT-verified)",
  preprocessing: card.preprocessing,
  evaluatedAt: new Date().toISOString(),
};

// ── DEV: sweep, and pick ────────────────────────────────────────────────────────────
const THRESHOLDS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50, 0.60, 0.70];
const sweep = E.sweepThreshold(dataset, hydrate(preds.dev), "dev", ctx, THRESHOLDS);

console.log("DEV threshold sweep (tuning only — never reported as performance)");
console.log("  thr    mAP@0.5   recall   grounding   preds");
let best = null;
for (const s of sweep) {
  const r = s.result;
  const map = r.mAP50.value;
  console.log(
    `  ${s.threshold.toFixed(2)}   ${map.toFixed(4)}    ${r.elementRecall.value.toFixed(4)}   ` +
      `${(Number.isNaN(r.groundingAccuracy.value) ? 0 : r.groundingAccuracy.value).toFixed(4)}      ${r.totals.predictions}`
  );
  // Selection rule, fixed in advance: highest mAP@0.5 on dev, ties to the higher threshold
  // (fewer predictions). Stating the rule matters as much as the number it picks.
  if (!best || map > best.map + 1e-9) best = { threshold: s.threshold, map };
}
console.log(`\n  selected threshold = ${best.threshold} (rule: max mAP@0.5 on DEV)`);

// ── TEST: scored ONCE, at the threshold dev chose ───────────────────────────────────
const testPreds = hydrate(preds.test).filter((p) => p.confidence >= best.threshold);
const test = E.evaluate(dataset, testPreds, "test", ctx);

console.log("\nHELD-OUT TEST — the reported figures");
console.log(`  element mAP@0.5     ${test.mAP50.value.toFixed(4)}   [${test.mAP50.status}]`);
console.log(`  element recall      ${test.elementRecall.value.toFixed(4)}   [${test.elementRecall.status}]`);
console.log(`  grounding accuracy  ${test.groundingAccuracy.value.toFixed(4)}   [${test.groundingAccuracy.status}]`);
console.log(
  `  TP ${test.totals.truePositives}  FP ${test.totals.falsePositives}  FN ${test.totals.falseNegatives}  ` +
    `invalid ${test.totals.invalidPredictions}  off-screen excluded ${test.totals.excludedOffscreen}`
);

console.log("\nper class (test)");
console.log("  class       gt   pred    TP    FP    FN   AP@0.5   recall");
for (const c of test.perClass) {
  if (c.groundTruth === 0 && c.predictions === 0) continue;
  const ap = Number.isNaN(c.ap50.value) ? 0 : c.ap50.value;
  const rc = Number.isNaN(c.recall.value) ? 0 : c.recall.value;
  console.log(
    `  ${c.cls.padEnd(10)} ${String(c.groundTruth).padStart(4)} ${String(c.predictions).padStart(6)} ` +
      `${String(c.truePositives).padStart(5)} ${String(c.falsePositives).padStart(5)} ` +
      `${String(c.falseNegatives).padStart(5)}   ${ap.toFixed(4)}   ${rc.toFixed(4)}`
  );
}

if (test.rejected.length) {
  console.log("\nrejected predictions");
  for (const r of test.rejected) console.log(`  ${r.count}x ${r.reason}`);
}

// ── failure analysis by object size — the axis the evaluator flagged ────────────────
const testSamples = dataset.samples.filter((s) => s.split === "test");
const byId = new Map(testSamples.map((s) => [s.id, s]));
const buckets = {
  "tiny <20px": [0, 0],
  "small 20-40": [0, 0],
  "med 40-100": [0, 0],
  "large >100": [0, 0],
};
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
const bucketOf = (side) =>
  side < 20 ? "tiny <20px" : side < 40 ? "small 20-40" : side < 100 ? "med 40-100" : "large >100";

for (const s of testSamples) {
  const mine = testPreds.filter((p) => p.sampleId === s.id);
  for (const a of s.annotations) {
    if (a.visibility === "OFFSCREEN") continue;
    const b = bucketOf(Math.max(a.box.w, a.box.h));
    buckets[b][1] += 1;
    if (mine.some((p) => p.cls === a.cls && iou(p.box, a.box) >= 0.5)) buckets[b][0] += 1;
  }
}
console.log("\nrecall by object size (CSS px, longest side)");
for (const [k, [hit, tot]] of Object.entries(buckets)) {
  if (tot) console.log(`  ${k.padEnd(13)} ${String(hit).padStart(4)}/${String(tot).padStart(4)} = ${(hit / tot).toFixed(3)}`);
}

const outDir = join(ROOT, "artifacts", "gates", "T1-detector-training");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "qg05-detector-evaluation.json");
writeFileSync(
  out,
  JSON.stringify(
    {
      gate: "QG-05 visual-context, applied to the T1 head",
      warning:
        "SYNTHETIC DATA. These figures describe a model trained and tested on a rendered " +
        "synthetic set. They are NOT real-world accuracy. The dossier's evidence source for " +
        "this metric is ScreenSpot-v2 plus 300 self-labelled Indian government and banking " +
        "screens, and neither exists yet.",
      model: { id: card.modelId, revision: card.revision, artifact: card.artifact },
      dataset: { name: dataset.name, version: dataset.version, hash: dataset.hash },
      thresholdSelection: { rule: "max mAP@0.5 on DEV", split: "dev", chosen: best.threshold, sweep: THRESHOLDS },
      devSweep: sweep.map((s) => ({
        threshold: s.threshold,
        mAP50: s.result.mAP50.value,
        recall: s.result.elementRecall.value,
        grounding: s.result.groundingAccuracy.value,
        predictions: s.result.totals.predictions,
      })),
      heldOutTest: test,
      recallByObjectSize: buckets,
    },
    null,
    2
  )
);
console.log(`\nwrote ${out}`);
console.log("\nNOTE: synthetic data. Not a real-world benchmark.");
