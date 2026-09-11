/**
 * Fold the four cells' raw run logs into one metrics.json and print the QG-03 table.
 *
 *   node artifacts/experiments/W1-QG03-t1-detector-runtime/harness/aggregate-qg03.mjs
 *
 * The matrix's unit of evidence is BROWSER x BACKEND x MODEL ARTIFACT x DISPLAY MODE, and
 * nothing is merged across those axes. Firefox headful and Firefox headless are separate
 * rows here because they DISAGREE — the WebGPU adapter is available in one and absent in
 * the other — and averaging them would produce a number describing neither.
 *
 * Aggregation across REPEATED RUNS of the same cell is legitimate and is what happens:
 * p50 of the per-run p50s, worst-case correctness, and any disagreement between runs
 * surfaced rather than smoothed.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const LOGS = join(EXP, "logs");

const files = readdirSync(LOGS).filter((f) => f.startsWith("results-") && f.endsWith(".json"));
if (!files.length) {
  console.error(`no run logs in ${LOGS}`);
  process.exit(1);
}

const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

const cells = [];
for (const f of files) {
  const log = JSON.parse(readFileSync(join(LOGS, f), "utf8"));
  for (const mode of [false, true]) {
    const runs = log.runs.filter((r) => r.headless === mode);
    if (!runs.length) continue;
    const results = runs.map((r) => r.result).filter(Boolean);
    const ok = results.filter((r) => r.sessionCreated);

    const cell = {
      browser: log.browser,
      backend: log.backend,
      display: mode ? "headless" : "headful",
      platform: log.platform,
      runs: runs.length,
      // LOAD — the dossier's first required field
      sessionCreated: `${ok.length}/${runs.length}`,
      sessionLoads: ok.length === runs.length && runs.length > 0,
    };

    if (!ok.length) {
      cell.correct = false;
      cell.failure = results[0]?.error?.message || results[0]?.conclusion || runs[0]?.webExtLogTail?.join(" ") || "no report delivered";
      cell.verdict = "REJECT";
      cells.push(cell);
      continue;
    }

    // The cell's LABEL must match what the probe actually requested. These are produced by
    // different code paths — the runner labels the file, the probe reports what it ran — so
    // a disagreement means the harness mislabelled a cell. That happened once: an
    // interrupted run left a backend baked into the Firefox extension and a cell labelled
    // "webgpu" throughout its own log had in fact measured WASM. Refusing here is the only
    // thing that turns that into a loud failure instead of a plausible table row.
    const requested = [...new Set(ok.map((r) => r.requestedBackend))];
    if (requested.length !== 1 || requested[0] !== log.backend) {
      console.error(
        `REFUSED: ${log.browser}/${log.display ?? (mode ? "headless" : "headful")} is labelled ` +
          `backend "${log.backend}" but the probe reported ${JSON.stringify(requested)}. ` +
          "A mislabelled cell corrupts the matrix. Re-run the cell after rebuilding the extension."
      );
      process.exit(1);
    }

    cell.ortVersion = ok[0].ortVersion;
    cell.userAgent = ok[0].userAgent;
    cell.modelSha256 = ok[0].model.sha256Observed;
    cell.modelBytes = ok[0].model.bytesObserved;
    cell.ortPin = ok[0].pin;
    cell.schema = ok[0].schema;
    cell.inputDims = [1, 3, 640, 640];
    cell.outputDims = ok[0].cases[0]?.outputDims ?? null;
    cell.outputType = ok[0].cases[0]?.outputType ?? null;

    // CORRECT — worst case across runs and cases, never the average. One incorrect run in
    // three is an incorrect cell.
    const allCases = ok.flatMap((r) => r.cases);
    cell.correctness = {
      cases: [...new Set(allCases.map((c) => c.name))],
      allCorrect: allCases.every((c) => c.correct === true),
      inputsMatchedReference: allCases.every((c) => c.inputMatchesReference === true),
      worstBoxChannelAbs: Math.max(...allCases.map((c) => c.diff?.boxChannelsMaxAbs ?? Infinity)),
      worstClassChannelAbs: Math.max(...allCases.map((c) => c.diff?.classChannelsMaxAbs ?? Infinity)),
      criterion: allCases[0]?.criterion ?? null,
      nonFinite: allCases.reduce((n, c) => n + (c.diff?.nonFinite ?? 0), 0),
      postprocessingAgrees: allCases.every((c) => c.postprocessingAgrees === true),
      worstCssCoordinateDeltaPx: Math.max(...allCases.map((c) => c.boxAgreement?.worstCssCoordinateDeltaPx ?? 0)),
      labelMismatches: allCases.reduce((n, c) => n + (c.boxAgreement?.labelMismatches ?? 0), 0),
      typedContractOk: allCases.every((c) => c.detectorContract?.ok === true),
      detectionsValid: allCases.every((c) => c.detectionsValid === true),
      boundsValid: allCases.every((c) => c.boundsValid === true),
      provenanceComplete: allCases.every(
        (c) => c.provenance?.allCarryFrameId && c.provenance?.allCarryModelId && c.provenance?.allCarryRevision
      ),
    };
    cell.correct = cell.correctness.allCorrect && cell.correctness.postprocessingAgrees;

    cell.determinism = {
      bitwiseIdenticalEveryRun: ok.every((r) => r.determinism?.bitwiseIdentical === true),
      // Across-run stability is a different question from within-session stability: a fresh
      // process could compile different kernels. Both are checked.
      identicalAcrossRuns: new Set(ok.flatMap((r) => r.cases.map((c) => c.name + ":" + c.diff?.boxChannelsMaxAbs))).size ===
        new Set(ok[0].cases.map((c) => c.name + ":" + c.diff?.boxChannelsMaxAbs)).size,
    };

    // LATENCY — cold and warm kept apart, as Rule 1 of the benchmark contract requires.
    cell.latency = {
      sessionCreateMs: { runs: ok.map((r) => r.latency.sessionCreateMs), p50: median(ok.map((r) => r.latency.sessionCreateMs)) },
      firstInferenceMs: { runs: ok.map((r) => r.latency.firstInferenceMs), p50: median(ok.map((r) => r.latency.firstInferenceMs)) },
      warmP50Ms: median(ok.map((r) => r.latency.warm.p50)),
      warmP95Ms: median(ok.map((r) => r.latency.warm.p95).filter((v) => v != null)),
      warmMinMs: Math.min(...ok.map((r) => r.latency.warm.min)),
      warmMaxMs: Math.max(...ok.map((r) => r.latency.warm.max)),
      warmRunsPerSample: ok[0].latency.warm.runs,
      releaseMs: median(ok.map((r) => r.latency.releaseMs)),
      note: "warm figures are on the synthetic deterministic tensor; the work is identical every run",
    };

    // MEMORY — three different quantities, never one.
    const at = (r, label) => r.memory.snapshots.find((s) => s.label === label);
    cell.memory = {
      modelFileBytes: ok[0].model.bytesObserved,
      wasmHeapMB: {
        baseline: median(ok.map((r) => at(r, "baseline-before-anything").wasm.mb)),
        afterSessionCreate: median(ok.map((r) => at(r, "after-session-create").wasm.mb)),
        afterFirstInference: median(ok.map((r) => at(r, "after-first-inference").wasm.mb)),
        steadyState: median(ok.map((r) => at(r, "steady-state-after-warm").wasm.mb)),
        afterRelease: median(ok.map((r) => at(r, "after-release")?.wasm.mb ?? null)),
      },
      jsHeapMB: {
        baseline: median(ok.map((r) => at(r, "baseline-before-anything").js?.usedMB).filter((v) => v != null)),
        steadyState: median(ok.map((r) => at(r, "steady-state-after-warm").js?.usedMB).filter((v) => v != null)),
        available: ok.some((r) => at(r, "baseline-before-anything").js != null),
      },
      caution:
        "model file size, WASM linear memory and JS heap are three different quantities. " +
        "The WASM heap is dominated by the ORT runtime itself, not by this 0.30 MB model; " +
        "the JS heap is GC-timing-dominated and is not evidence about the WASM arena.",
    };

    cell.backendIdentity = {
      requested: log.backend,
      verdict: ok[0].backendEvidence?.verdict ?? null,
      gpuSubmitsDuringInference: ok[0].backendEvidence?.gpuSubmitsDuringInference ?? null,
      computePipelines: ok[0].gpu?.computePipelinesCreated ?? null,
      consistentAcrossRuns: new Set(ok.map((r) => r.backendEvidence?.executedOnGpu)).size === 1,
      // Firefox exposes an EMPTY adapterInfo (S-02), so no Firefox figure can be attributed
      // to a specific GPU. Recorded from what the browser actually returned rather than
      // assumed from the browser's name.
      adapterInfo: ok[0].gpu?.adapterInfo ?? null,
      adapterIdentified: ok[0].gpu?.adapterInfo?.identified ?? null,
    };

    cell.network = {
      foreignArrivals: Math.max(...ok.map((r) => r.network?.foreign ?? 0)),
      modelFetchedAtRuntime: ok.some((r) => r.network?.modelFetched),
      urls: [...new Set(ok.flatMap((r) => r.network?.urls ?? []))],
    };

    const pp = ok[0].preprocessingParity ?? [];
    cell.preprocessingParity = pp.map((p) => ({
      sample: p.name,
      variants: Object.fromEntries(
        Object.entries(p.variants ?? {}).map(([k, v]) => [
          k,
          {
            maxAbsDiff255: v.maxAbsDiff255,
            meanAbsDiff255: v.meanAbsDiff255,
            detections: v.detections,
            referenceDetections: v.referenceDetections,
            matchedAtIou50: v.matchedAtIou50,
            agreementRate: v.agreementRate,
          },
        ])
      ),
      bestAgreementRate: Math.max(...Object.values(p.variants ?? {}).map((v) => v.agreementRate ?? 0)),
    }));

    // The verdict uses the project's gate semantics, and CONDITIONAL is not a soft pass.
    cell.verdict = !cell.sessionLoads
      ? "REJECT"
      : !cell.correct
        ? "REJECT"
        : "ACCEPT";
    cells.push(cell);
  }
}

const out = {
  experiment: "W1-QG03-t1-detector-runtime",
  question:
    "Can the ACTUAL shipped T1 UIElementDetector ONNX artifact execute correctly, " +
    "reproducibly and within lightweight constraints across the dossier's browser/backend matrix?",
  spikeLineage: "S-03c — 'repeat with a real detector before any latency figure is quoted'",
  unitOfEvidence: "browser x backend x model artifact x display mode",
  generatedAt: new Date().toISOString(),
  cells,
};
writeFileSync(join(EXP, "metrics.json"), JSON.stringify(out, null, 2));

console.log("QG-03 — T1 UIElementDetector, revision ba6d9e93695b\n");
const h = "browser    backend  display   LOAD  CORRECT  p50 warm  cold create  first inf  WASM heap  verdict";
console.log(h);
console.log("-".repeat(h.length));
for (const c of cells) {
  console.log(
    `${c.browser.padEnd(10)} ${c.backend.padEnd(8)} ${c.display.padEnd(9)} ` +
      `${String(c.sessionCreated).padEnd(5)} ${String(c.correct).padEnd(8)} ` +
      `${c.latency ? String(c.latency.warmP50Ms).padStart(6) + " ms" : "     — "}  ` +
      `${c.latency ? String(c.latency.sessionCreateMs.p50).padStart(8) + " ms" : "       — "}  ` +
      `${c.latency ? String(c.latency.firstInferenceMs.p50).padStart(7) + " ms" : "      — "}  ` +
      `${c.memory ? String(c.memory.wasmHeapMB.steadyState).padStart(6) + " MB" : "     — "}  ${c.verdict}`
  );
}
console.log(`\nwrote ${join(EXP, "metrics.json")}`);
