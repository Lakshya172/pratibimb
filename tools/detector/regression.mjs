/**
 * PHASE 8 — the T1 detector regression benchmark.
 *
 *   node tools/detector/regression.mjs            check against the frozen baseline
 *   node tools/detector/regression.mjs --freeze   record the current result AS the baseline
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PROTECTS, AND WHAT IT CANNOT
 *
 * A detector's evidence is only meaningful while everything it was measured against stays
 * put. A change to preprocessing, to the letterbox, to NMS, to the dataset, or to the
 * evaluator can move the numbers without touching a single line of the model — and the old
 * evidence would silently keep its authority while describing a pipeline that no longer
 * exists.
 *
 * So the baseline pins the whole chain, not just the score:
 *
 *   model revision + artifact sha256   which weights
 *   dataset name + version + hash      which data
 *   preprocessing + postprocessing     how pixels became predictions
 *   threshold + selection rule         how the operating point was chosen
 *   the metrics themselves             what came out
 *
 * A mismatch in ANY of them fails the check, because a metric compared across a changed
 * pipeline is not a comparison.
 *
 * THIS IS A SYNTHETIC BENCHMARK. It detects regression against itself. It says nothing
 * about real-world accuracy, and passing it is not evidence the detector works on a
 * government portal.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GATE = join(ROOT, "artifacts", "gates", "T1-detector-training");
const RESULT = join(GATE, "qg05-detector-evaluation.json");
const BASELINE = join(GATE, "regression-baseline.json");

const FREEZE = process.argv.includes("--freeze");

/**
 * How far a metric may fall before it counts as a regression.
 *
 * Absolute, not relative, and deliberately tight. Training is seeded and the evaluator is
 * deterministic, so a correct re-run should reproduce the numbers exactly; the tolerance
 * exists for float and platform drift, not for "close enough". A generous band here would
 * let a real degradation accumulate across several changes, each one individually "within
 * tolerance".
 */
const TOLERANCE = 0.02;

if (!existsSync(RESULT)) {
  console.error(`no evaluation result at ${RESULT}\nRun: node tools/detector/run-qg05-eval.mjs`);
  process.exit(1);
}
const current = JSON.parse(readFileSync(RESULT, "utf8"));

const fingerprint = (r) => ({
  modelRevision: r.model.revision,
  artifactSha256: r.model.artifact.sha256,
  datasetName: r.dataset.name,
  datasetVersion: r.dataset.version,
  datasetHash: r.dataset.hash,
  thresholdRule: r.thresholdSelection.rule,
  threshold: r.thresholdSelection.chosen,
});

const metrics = (r) => ({
  mAP50: r.heldOutTest.mAP50.value,
  elementRecall: r.heldOutTest.elementRecall.value,
  groundingAccuracy: r.heldOutTest.groundingAccuracy.value,
  perClassRecall: Object.fromEntries(
    r.heldOutTest.perClass
      .filter((c) => c.groundTruth > 0)
      .map((c) => [c.cls, Number.isNaN(c.recall.value) ? 0 : c.recall.value])
  ),
});

if (FREEZE) {
  const card = JSON.parse(readFileSync(join(ROOT, "artifacts/models/t1-ui-head/model-card.json"), "utf8"));
  const baseline = {
    frozenAt: new Date().toISOString(),
    note:
      "SYNTHETIC regression baseline for the T1 head. Detects regression against itself. " +
      "NOT evidence of real-world accuracy.",
    fingerprint: fingerprint(current),
    preprocessing: card.preprocessing,
    postprocessing: card.postprocessing,
    evaluator: { package: "@pratibimb/evaluation", metric: "element mAP@0.5 / recall / grounding" },
    tolerance: TOLERANCE,
    metrics: metrics(current),
  };
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2));
  console.log(`froze baseline -> ${BASELINE}`);
  console.log(`  mAP@0.5 ${baseline.metrics.mAP50.toFixed(4)}  recall ${baseline.metrics.elementRecall.toFixed(4)}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`no baseline at ${BASELINE}\nRun once with --freeze after a credible result.`);
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));

const failures = [];

// ── the pipeline must be the same pipeline ─────────────────────────────────────────
const fpNow = fingerprint(current);
for (const [k, v] of Object.entries(baseline.fingerprint)) {
  if (fpNow[k] !== v) {
    failures.push(
      `${k}: baseline "${v}", now "${fpNow[k]}". A metric compared across a changed ` +
        "pipeline is not a comparison — re-freeze deliberately if the change is intended."
    );
  }
}

// ── and the numbers must not have fallen ───────────────────────────────────────────
const mNow = metrics(current);
for (const key of ["mAP50", "elementRecall", "groundingAccuracy"]) {
  const was = baseline.metrics[key];
  const now = mNow[key];
  if (now < was - TOLERANCE) {
    failures.push(`${key}: ${was.toFixed(4)} -> ${now.toFixed(4)} (dropped ${(was - now).toFixed(4)})`);
  }
}
for (const [cls, was] of Object.entries(baseline.metrics.perClassRecall)) {
  const now = mNow.perClassRecall[cls] ?? 0;
  if (now < was - TOLERANCE) {
    failures.push(`recall[${cls}]: ${was.toFixed(4)} -> ${now.toFixed(4)}`);
  }
}

console.log(`T1 detector regression check (tolerance ${TOLERANCE})`);
console.log(`  baseline frozen ${baseline.frozenAt}`);
for (const key of ["mAP50", "elementRecall", "groundingAccuracy"]) {
  const was = baseline.metrics[key];
  const now = mNow[key];
  const delta = now - was;
  console.log(
    `  ${key.padEnd(19)} ${was.toFixed(4)} -> ${now.toFixed(4)}  ` +
      `(${delta >= 0 ? "+" : ""}${delta.toFixed(4)})`
  );
}

if (failures.length) {
  console.log("\nREGRESSION:");
  for (const f of failures) console.log(`  !! ${f}`);
  process.exit(1);
}
console.log("\nPASS — no material regression.");
console.log("NOTE: synthetic. Regression against itself, not evidence of real-world accuracy.");
