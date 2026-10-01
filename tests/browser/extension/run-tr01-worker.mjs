#!/usr/bin/env node
/**
 * M10.4 — the TR-01 detector worker in the REAL extension, on W1. No gesture, no capture, no egress.
 *
 * Requires the evidence build (the probe and the memory instrument are absent from a product build):
 *   TR01_PROBE=1 npm run build -w @pratibimb/extension
 *
 * WHAT IT DOES, through the offscreen document's `TR01_PROBE` (service worker only):
 *   1. the existing UI head in the offscreen realm: load + 1 warm-up + N runs (combined workload);
 *   2. create the host → prepare (runtime pin, model fetch + SHA-256, session) → model-load latency;
 *   3. TR-01 on the seven M8.1 frames (dev, H1–H6) — output compared EXACTLY with M8.1's recorded
 *      boxes and scores (the WASM map M8.1 recorded, same pinned runtime) — then warm repetitions;
 *   4. two concurrent requests: the second must be DETECTOR_BUSY;
 *   5. terminate (dispose) → recreate → run again → identical output;
 *   6. a run with the deadline TIGHTENED to 50 ms → DETECTOR_TIMEOUT, worker terminated → the next
 *      run recreates the worker and succeeds with identical output;
 *   7. WASM linear memory, by M8.2's method, at every stage in both realms; network arrivals.
 *
 * Frames come from M8.2's git-ignored fixtures; without them it REFUSES rather than passing.
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-tr01-worker.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release, tmpdir } from "node:os";

import { ROOT } from "../demo/server.mjs";
import { decodePng } from "../support/png-decode.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const FIX = join(ROOT, "artifacts", "experiments", "M8.2-qg03-visual-text-feasibility", "models", "fixtures");
const M81 = JSON.parse(readFileSync(join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening", "results", "tr-01-run1.json"), "utf8"));
const NAMES = ["dev", "H1", "H2", "H3", "H4", "H5", "H6"];
const WARM_DEV = 20;
const WARM_HELD_OUT = 3;
const UI_HEAD_RUNS = 10;
/** Fresh workers created for the cold statistics: model load and first inference, one sample each. */
const COLD_CYCLES = 10;
const GATES = { deadlineMs: 2_000, wasmBudgetBytes: 200 * 1024 * 1024 };

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT}`);
const offscreenChunks = readdirSync(join(EXT, "chunks")).filter((f) => f.startsWith("offscreen-")).map((f) => readFileSync(join(EXT, "chunks", f), "utf8")).join("");
if (!offscreenChunks.includes("TR01_PROBE_ONLY_FROM_SERVICE_WORKER")) {
  refuse("this build has no TR-01 probe (absent from product builds by design). Build: TR01_PROBE=1 npm run build -w @pratibimb/extension");
}
for (const n of NAMES) if (!existsSync(join(FIX, "screenshots", `${n}.png`))) refuse(`missing M8.2 fixture screenshots/${n}.png`);

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return s.length === 0 ? null : { n: s.length, min: s[0], median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, p90: q(0.9), max: s[s.length - 1] };
};
const MB = (b) => (b === null || b === undefined ? null : Math.round((b / 1048576) * 10) / 10);
const boxesOf = (o) => (o?.ok ? o.detections : null);
const sameAsM81 = (name, detections) => JSON.stringify(detections) === JSON.stringify(M81.inputs[name].boxes);

const record = { stages: {}, runs: {}, checks: {}, memory: {}, failure: null };
let context = null;
try {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m104-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await sw.evaluate(() => globalThis.__host.ensureOffscreen());
  const probe = (args) => sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
  const memory = async (label) => {
    const r = await probe({ op: "instrument" });
    record.memory[label] = { workerWasmBytes: r.worker?.wasmBytes ?? null, offscreenWasmBytes: r.offscreenWasmBytes ?? null, workerArrivals: r.worker ? { total: r.worker.arrivals, foreign: r.worker.foreignArrivals, origins: r.worker.arrivalOrigins } : null };
    return record.memory[label];
  };

  for (const name of NAMES) {
    const img = decodePng(readFileSync(join(FIX, "screenshots", `${name}.png`)));
    const loaded = await probe({ op: "frame", name, frame: { width: img.width, height: img.height, rgbaB64: Buffer.from(img.rgba.buffer, img.rgba.byteOffset, img.rgba.byteLength).toString("base64") } });
    if (loaded.error) throw new Error(loaded.error);
  }

  await memory("0-offscreen-before-any-model");

  // 1. the existing UI head, in the offscreen realm
  const uiHead = [];
  for (let i = 0; i < UI_HEAD_RUNS + 1; i++) {
    const r = await probe({ op: "uihead" });
    if (r.error) throw new Error(`uihead: ${r.error}`);
    uiHead.push(r.ms);
  }
  record.runs.uiHeadWarmMs = stats(uiHead.slice(1));
  await memory("1-offscreen-after-ui-head-warm");

  // 2. the TR-01 host: create, then prepare (one-time initialisation)
  await probe({ op: "create" });
  await memory("2-worker-not-yet-created");
  const prepared = await probe({ op: "prepare" });
  record.stages.prepare = prepared;
  if (!prepared.ready) throw new Error(`prepare failed: ${JSON.stringify(prepared.status?.lastInit)}`);
  await memory("3-worker-after-model-load");

  // 3. the seven frames, then warm repetitions
  const first = {};
  for (const name of NAMES) first[name] = await probe({ op: "detect", name });
  record.runs.firstInference = { dev: first.dev.outcome?.ms ?? null, devWallMs: first.dev.wallMs };
  await memory("4-worker-after-first-inference");
  const warm = { preprocess: [], infer: [], postprocess: [], total: [], wall: [] };
  const warmOutputs = [];
  const push = (r) => {
    if (!r.outcome?.ok) throw new Error(`warm run refused: ${JSON.stringify(r.outcome)}`);
    warm.preprocess.push(r.outcome.ms.preprocess);
    warm.infer.push(r.outcome.ms.infer);
    warm.postprocess.push(r.outcome.ms.postprocess);
    warm.total.push(r.outcome.ms.total);
    warm.wall.push(r.wallMs);
  };
  for (let i = 0; i < WARM_DEV; i++) {
    const r = await probe({ op: "detect", name: "dev" });
    push(r);
    warmOutputs.push(JSON.stringify(boxesOf(r.outcome)));
  }
  for (const name of NAMES.slice(1)) for (let i = 0; i < WARM_HELD_OUT; i++) push(await probe({ op: "detect", name }));
  record.runs.warm = Object.fromEntries(Object.entries(warm).map(([k, v]) => [k, stats(v)]));
  const peak = await memory("5-worker-after-warm-runs-peak");

  // 4. concurrency: two requests at once
  const [a, b] = await Promise.all([probe({ op: "detect", name: "dev" }), probe({ op: "detect", name: "dev" })]);
  record.stages.concurrent = { a: a.outcome?.ok ? "ok" : a.outcome?.code, b: b.outcome?.ok ? "ok" : b.outcome?.code };

  // 5. terminate → recreate → run
  await probe({ op: "dispose" });
  await memory("6-after-worker-termination");
  await probe({ op: "create" });
  const re = await probe({ op: "prepare" });
  await memory("7-recreated-worker-after-model-load");
  const second = await probe({ op: "detect", name: "dev" });
  await memory("8-recreated-worker-after-second-inference");
  record.stages.recreate = { ready: re.ready, status: second.status, sameOutput: JSON.stringify(boxesOf(second.outcome)) === JSON.stringify(boxesOf(first.dev.outcome)) };

  // 5b. cold statistics: COLD_CYCLES fresh workers, each loading the model and running once
  const cold = { runtime: [], model: [], session: [], prepareWall: [], firstInferTotal: [], firstInferInfer: [] };
  for (let i = 0; i < COLD_CYCLES; i++) {
    await probe({ op: "create" });
    const p = await probe({ op: "prepare" });
    if (!p.ready) throw new Error(`cold prepare ${i} failed`);
    cold.runtime.push(p.status.lastInit.ms.runtime);
    cold.model.push(p.status.lastInit.ms.model);
    cold.session.push(p.status.lastInit.ms.session);
    cold.prepareWall.push(p.ms);
    const r = await probe({ op: "detect", name: "dev" });
    if (!r.outcome?.ok || JSON.stringify(r.outcome.detections) !== JSON.stringify(boxesOf(first.dev.outcome))) throw new Error(`cold run ${i} differed or refused`);
    cold.firstInferTotal.push(r.outcome.ms.total);
    cold.firstInferInfer.push(r.outcome.ms.infer);
  }
  record.runs.cold = Object.fromEntries(Object.entries(cold).map(([k, v]) => [k, stats(v)]));

  // 6. the deadline, enforced by terminate(): tighten to 50 ms for one run, then recover
  const timedOut = await probe({ op: "detect", name: "dev", deadlineMs: 50 });
  const afterTimeout = await probe({ op: "detect", name: "dev" });
  record.stages.timeout = {
    outcome: timedOut.outcome,
    wallMs: timedOut.wallMs,
    statusAfterTimeout: timedOut.status,
    recovery: { ok: afterTimeout.outcome?.ok ?? false, runId: afterTimeout.outcome?.runId ?? null, status: afterTimeout.status, sameOutput: JSON.stringify(boxesOf(afterTimeout.outcome)) === JSON.stringify(boxesOf(first.dev.outcome)) },
  };
  await memory("9-after-timeout-recovery");
  await probe({ op: "dispose" });

  // ── checks ──
  const golden = Object.fromEntries(NAMES.map((n) => [n, first[n].outcome?.ok === true && sameAsM81(n, first[n].outcome.detections)]));
  const allDetections = NAMES.flatMap((n) => boxesOf(first[n].outcome) ?? []);
  const workerPeak = peak.workerWasmBytes;
  const offscreenPeak = record.memory["1-offscreen-after-ui-head-warm"].offscreenWasmBytes;
  record.memory.summary = {
    method: "WebAssembly.Memory constructor wrapped before ORT created memory; linear memory read from buffer.byteLength (never shrinks, so current = peak). Not RSS, not the JS heap.",
    workerPeakMB: MB(workerPeak),
    offscreenUiHeadPeakMB: MB(offscreenPeak),
    combinedPeakMB: workerPeak !== null && offscreenPeak !== null ? MB(workerPeak + offscreenPeak) : null,
    budgetMB: MB(GATES.wasmBudgetBytes),
  };
  const combined = workerPeak !== null && offscreenPeak !== null ? workerPeak + offscreenPeak : null;
  const arrivals = peak.workerArrivals;
  record.checks = {
    modelHashVerifiedAtRuntime: prepared.status?.lastInit?.ok === true && prepared.status.lastInit.model.sha256 === "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8" && prepared.status.lastInit.model.bytes === 4766440,
    goldenAllSevenFramesEqualM81: Object.values(golden).every(Boolean),
    deterministicWarmOutput: warmOutputs.every((o) => o === warmOutputs[0]) && warmOutputs[0] === JSON.stringify(boxesOf(first.dev.outcome)),
    geometryOnlyOutput: allDetections.length > 0 && allDetections.every((d) => JSON.stringify(Object.keys(d).sort()) === '["h","score","w","x","y"]'),
    concurrentSecondRefusedBusy: [record.stages.concurrent.a, record.stages.concurrent.b].sort().join(",") === "DETECTOR_BUSY,ok",
    terminateThenRecreateSameOutput: record.stages.recreate.ready === true && record.stages.recreate.sameOutput === true,
    timeoutIsDetectorTimeout: timedOut.outcome?.ok === false && timedOut.outcome.code === "DETECTOR_TIMEOUT" && !("detections" in timedOut.outcome),
    timeoutTerminatedTheWorker: timedOut.status?.state === "idle" && timedOut.status.terminations >= 1,
    timeoutThenRecoveredWithSameOutput: record.stages.timeout.recovery.ok && record.stages.timeout.recovery.sameOutput && afterTimeout.status?.generation > timedOut.status?.generation,
    noStaleAccepted: afterTimeout.outcome?.runId !== timedOut.outcome?.runId,
    deadlineGateEveryRunUnder2000ms:
      warm.total.every((t) => t < GATES.deadlineMs) &&
      (record.runs.cold?.firstInferTotal?.max ?? Infinity) < GATES.deadlineMs &&
      NAMES.every((n) => (first[n].outcome?.ms?.total ?? Infinity) < GATES.deadlineMs),
    memoryMeasured: workerPeak !== null && offscreenPeak !== null,
    memoryGateCombinedUnder200MB: combined !== null && combined <= GATES.wasmBudgetBytes,
    noForeignNetworkArrivals: arrivals !== null && arrivals.foreign === 0,
  };
  record.golden = golden;
} catch (e) {
  record.failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
} finally {
  if (context) await context.close();
}

const passed = record.failure === null && Object.keys(record.checks).length > 0 && Object.values(record.checks).every(Boolean);
const evidence = {
  experiment: "M10.4 — TR-01 detector worker in the real MV3 extension",
  verdict: passed ? "PASS" : "FAIL",
  notAClaim: [
    "no tab was captured; frames are M8.2's fixed screenshots handed to the offscreen document",
    "no mask, encode or egress exists yet; TR-01 is not called by any product path",
    "one workstation (W1), one browser cell; timings are this machine's",
  ],
  gates: GATES,
  fixed: { frames: NAMES, warmDevRuns: WARM_DEV, warmHeldOutRunsEach: WARM_HELD_OUT, uiHeadRuns: UI_HEAD_RUNS, coldCycles: COLD_CYCLES, timeoutTestDeadlineMs: 50 },
  units: "ms are performance.now() milliseconds; memory MB in the summary are MiB (bytes / 1,048,576); raw bytes are kept per stage",
  ...record,
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    headless: false,
    build: "TR01_PROBE=1 (evidence build)",
    manifestPermissions: JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).permissions ?? [],
  },
};
mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-tr01-worker.json")), WS);
writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(`\n${evidence.verdict}  TR-01 worker in the extension  on ${evidence.provenance.host} (${WS.id})`);
for (const [k, v] of Object.entries(record.checks)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
if (record.failure) console.log(`  failure: ${record.failure}`);
console.log(`  model load: ${JSON.stringify(record.stages.prepare?.status?.lastInit?.ms ?? null)}  first dev: ${JSON.stringify(record.runs.firstInference ?? null)}`);
console.log(`  warm total: ${JSON.stringify(record.runs.warm?.total ?? null)}`);
console.log(`  cold (n=${COLD_CYCLES}): ${JSON.stringify(record.runs.cold ?? null)}`);
console.log(`  memory: ${JSON.stringify(record.memory.summary ?? null)}`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
