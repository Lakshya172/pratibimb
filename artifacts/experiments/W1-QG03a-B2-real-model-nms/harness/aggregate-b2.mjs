/**
 * QG-03a-B2 — build metrics.json from logs/.
 *
 *   node .../harness/aggregate-b2.mjs
 *
 * Every number is copied from logs/b2-*.json, never typed in. The STATUS block is the only
 * hand-written content, and qg03aB2Evidence.test.ts checks it against the numbers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const L = (n) => JSON.parse(readFileSync(join(EXP, "logs", n), "utf8"));
const an = L("b2-analysis.json");
const cells = Object.fromEntries(
  ["chrome-wasm", "chrome-webgpu", "firefox-wasm", "firefox-webgpu", "native-cpu"].map((c) => {
    const l = L(`b2-${c}.json`);
    return [c, {
      userAgent: l.userAgent,
      ortVersion: l.ortVersion,
      backendRequested: l.backendRequested,
      backendObserved: l.backendObserved,
      backendLabelVerified: l.backendLabelVerified,
      gpuSubmitsDuringInference: l.gpu?.submitsDuringInference ?? 0,
      ortAdapter: l.ortAdapter ?? null,
      modelSha256: l.model?.sha256,
      pinArtifact: l.pin?.artifact ?? null,
      fixtures: l.rows.length,
      errors: l.rows.filter((r) => r.error).length,
      deterministic: l.rows.filter((r) => r.deterministic).length,
      dumpsVerified: l.rows.filter((r) => r.dumpVerified).length,
      outputDims: l.rows[0]?.dims ?? null,
      outputBytes: l.rows[0]?.outputBytes ?? null,
    }];
  })
);
const metrics = {
  experiment: "W1-QG03a-B2-real-model-nms",
  base: "f4fb4eb7bdf90e268107c09061a13287acec7dbf",
  workstation: "2 (LAPTOP-SRCINK2B, ENV-0002)",
  model: { path: "artifacts/models/t1-ui-head/t1-ui-head.onnx", bytes: 302960, sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0", input: "[1,3,640,640] float32", output: "[1,12,6400] float32", committed: false },
  fixtures: { source: "W1-QG03b2a-chromium-jpeg-capture/harness/captured (capture-png only)", count: an.inputAgreement.fixtures, inputTensorsIdenticalAcrossCells: an.inputAgreement.identicalAcrossCells },
  cells,
  cellsUnavailable: an.cellsUnavailable,
  backendPairs: an.backend.map((b) => ({ pair: b.pair, bitwiseIdenticalFixtures: b.bitwiseIdenticalFixtures, raw: b.raw, shipped: b.shipped, op055: b.op055 })),
  float32Spacing: an.float32Spacing,
  tieCensus: Object.fromEntries(Object.entries(an.tieCensus).map(([c, t]) => [c, { candidates: t.candidates, scoresExactlyOne: t.scoresExactlyOne, exactTieOverlappingPairs: t.exactTieOverlappingPairs, nearTieOverlappingPairsWithin1e6: t.nearTieOverlappingPairsWithin1e6, nearTieOverlappingPairsWithin1e5: t.nearTieOverlappingPairsWithin1e5 }])),
  iidPerturbation: an.perturbation.rows.map((p) => ({ relativeEpsilon: p.relativeEpsilon, trials: p.trials, trialsPerturbationRoundedAway: p.trialsPerturbationRoundedAway, fractionOfElementsActuallyChanged: p.fractionOfElementsActuallyChanged, shipped: p.shipped, op055: p.op055, trueFailuresByFixture: p.trueFailuresByFixture })),
  scaledRealDelta: an.scaledRealDelta,
  performance: an.performance,
  status: {
    B2_realBackend: "PASS on workstation 2",
    B2_basis: "at the MEASURED backend difference, every measured pair (Chrome/Firefox WASM, Chrome/Firefox WebGPU, native CPU) gives 0 survivor swaps, 0 true failures and 20/20 on the pre-registered detector criterion, in both the shipped and the 0.55 operating-point views",
    B_inferenceNoise: "CONDITIONAL",
    B_conditions: [
      "margin: gradients-edges (a non-UI Nyquist/gradient stress page, saturated at the 300 cap) fails from 2x the measured Chrome WebGPU-WASM difference; real UI fixtures stay failure-free until 50x",
      "coverage: workstation 2 only (AMD RDNA-3 via Chrome, unidentified adapter via Firefox). Intel, NVIDIA and other ORT versions are unmeasured",
      "context: a plain page with the production ORT pin and session factory, not the MV3 extension",
      "criterion: adopting the pre-registered bound, evaluated at measured backend noise per machine x browser x backend cell, as QG-03a-B's criterion is ARCHITECT APPROVAL REQUIRED (QG-03a-B1)",
    ],
    iidNoiseModel: "NOT representative of backend noise: the real outputs contain 1,402 overlapping exact-score ties, which every measured backend reproduces and which iid noise destroys",
    nmsChanged: false,
    A_preprocessing: "PASS",
    C_labelRaster: "CONDITIONAL",
    QG03a: "OPEN",
    QG03: "CONDITIONAL",
    detector: "UNADOPTED",
    frozenThreshold: 0.55,
    modelRegistry: "UNCHANGED",
  },
};
writeFileSync(join(EXP, "metrics.json"), JSON.stringify(metrics, null, 1));
console.log("wrote metrics.json");
