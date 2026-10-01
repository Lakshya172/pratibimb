#!/usr/bin/env node
/**
 * M8.2 — turn the raw launch records into the protocol's outputs, with the committed rules only:
 *
 *   results/cells.json               the four values and verdict of every cell, per candidate
 *   teardown/summary.json            protocol §5
 *   coexistence/summary.json         protocol §6
 *   benchmarks/summary.json          protocol §7
 *   results/qg03-verdict.json        protocol §9, per candidate, independently
 *   artifacts/benchmarks/M8.2-text-region-qg03.json   QG-03 item 7
 *
 * Reads every results/*.json except smoke-* (harness debugging, discarded by protocol) and diag-*
 * (post-hoc diagnostics, which decide nothing). Also
 * re-scores each cell's boxes with the committed RE-1 scorer (protocol §4.5).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreImage, scoreSet } from "../../../../tests/browser/support/redaction-metrics.mjs";
import { plaintextCheck } from "../../../../tests/browser/support/text-detector-screening.mjs";
import {
  CELL,
  REQUIRED_CELLS,
  cellVerdict,
  coexistencePass,
  modeVerdict,
  qg03Verdict,
  slowModeLabels,
  summarise,
  teardownPass,
} from "../../../../tests/browser/support/qg03-feasibility.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const M81 = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, v) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(v, null, 1));
};
const r2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);
const sum2 = (v) => Object.fromEntries(Object.entries(summarise(v)).map(([k, x]) => [k, r2(x)]));

const frozen = read(join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"));
const devTruth = read(join(EXP, "models", "fixtures", "dev-truth.json"));
const launches = readdirSync(join(EXP, "results"))
  .filter((f) => f.endsWith(".json") && !f.startsWith("smoke-") && !f.startsWith("diag-") && !["cells.json", "qg03-verdict.json"].includes(f))
  .flatMap((f) => read(join(EXP, "results", f)).launches.map((l) => ({ ...l, file: f })));
const CANDIDATES = ["TR-01", "TR-02"];
const conv = Object.fromEntries(CANDIDATES.map((c) => [c, read(join(M81, "logs", `${c.toLowerCase()}-conversion.json`))]));
const m81 = Object.fromEntries(CANDIDATES.map((c) => [c, read(join(M81, "results", `${c.toLowerCase()}-run1.json`))]));

const CELLS = {
  "Chrome WASM": (l) => l.browser === "chromium" && l.backend === "wasm",
  "Chrome WebGPU": (l) => l.browser === "chromium" && l.backend === "webgpu",
  "Firefox WebGPU": (l) => l.browser === "firefox" && l.platform === "windows" && l.backend === "webgpu",
  "Firefox WASM (Linux)": (l) => l.browser === "firefox" && l.platform === "linux-wsl2" && l.backend === "wasm",
  "Firefox WASM (Windows) — supplementary": (l) => l.browser === "firefox" && l.platform === "windows" && l.backend === "wasm",
};
const foreignExceptCollector = (net) => (net ?? []).filter((n) => n.foreign && !/^http:\/\/127\.0\.0\.1:8913$/.test(n.origin));

/** One launch reduced to what a cell needs. */
function cellLaunch(l, cid) {
  const r = l.result ?? {};
  const loaded = r.conclusion === "completed" && r.sessionCreated === true;
  const realistic = ["dev", ...frozen.images.map((i) => i.image)];
  const inputs = r.inputs ?? {};
  const correct = loaded && inputs.dev?.judge?.pass === true && inputs.dev?.outputCountEqual === true;
  const heapMb = Math.max(0, ...(r.memory ?? []).map((m) => m.wasm.mb));
  const jsMb = Math.max(0, ...(r.memory ?? []).map((m) => m.js?.usedMB ?? 0));
  return {
    loaded,
    correct,
    allRealisticPass: loaded && realistic.every((n) => inputs[n]?.judge?.pass === true && inputs[n]?.outputCountEqual === true),
    relErr: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.judge?.relErrSumAbs])),
    outputsEqualM81: loaded && realistic.every((n) => inputs[n]?.outputSha256 === m81[cid].inputs[n].wasm.outputSha256),
    boxesEqualM81: loaded && realistic.every((n) => inputs[n]?.boxesSha256 === m81[cid].inputs[n].boxesSha256),
    boxesSha: realistic.map((n) => inputs[n]?.boxesSha256).join(","),
    deterministic: r.determinism?.identical === true,
    warmMs: r.warmMs ?? [],
    coldLoadMs: r.coldLoadMs,
    coldInferenceMs: r.coldInferenceMs,
    postprocessMs: r.postprocessMs?.dev,
    heapMb,
    jsHeapMb: jsMb || null,
    foreign: foreignExceptCollector(r.network).length,
    gpuAdapter: r.gpu?.adapterInfo ?? null,
    timerResolutionMs: r.timerResolutionMs,
    types: Object.values(inputs).flatMap((v) => v.types ?? []),
    boxes: r.boxes ?? null,
    errors: [...(r.errors ?? []), ...(l.runError ? [l.runError] : []), ...(l.timedOut ? ["no report (timed out)"] : [])],
    browserVersion: l.browserVersion,
    userAgent: r.userAgent ?? null,
  };
}

function rescore(cid, boxes, g5, deterministic) {
  if (!boxes) return null;
  const perImage = frozen.images.map((img) => ({ image: img.image, ...scoreImage({ boxes: boxes[img.image] }, img) }));
  const plain = plaintextCheck(conv[cid].graph, [], Object.values(boxes).flat());
  const set = scoreSet(perImage, { wasmPassedOnEveryInput: g5, deterministic, noPlaintextOutput: plain.pass });
  const dev = scoreImage({ boxes: boxes.dev }, devTruth);
  return {
    heldOutSetPass: set.pass,
    gates: set.gates,
    exposed: perImage.reduce((n, p) => n + p.exposedSensitiveGlyphs, 0),
    worstOverMask: r2(Math.max(...perImage.map((p) => p.overMaskRatio))),
    worstLargestBox: r2(Math.max(...perImage.map((p) => p.largestSingleBoxRegionShare))),
    devScreen: { exposed: dev.exposedSensitiveGlyphs, overMask: r2(dev.overMaskRatio), largest: r2(dev.largestSingleBoxRegionShare), gates: dev.gates },
  };
}

const cells = {};
for (const cid of CANDIDATES) {
  cells[cid] = {};
  for (const [name, match] of Object.entries(CELLS)) {
    const ls = launches.filter((l) => l.candidate === cid && l.mode === "cell" && match(l));
    const modes = {};
    for (const [modeName, headless] of [["headful", false], ["headless", true]]) {
      const mine = ls.filter((l) => l.headless === headless).map((l) => cellLaunch(l, cid));
      if (mine.length === 0) {
        modes[modeName] = null;
        continue;
      }
      const v = modeVerdict(mine);
      const sameBoxes = mine.every((m) => m.boxesSha === mine[0].boxesSha);
      const firstLoaded = mine.find((m) => m.loaded);
      modes[modeName] = {
        ...v,
        LOAD: v.loaded,
        P50: sum2(mine.flatMap((m) => m.warmMs)).median,
        warm: sum2(mine.flatMap((m) => m.warmMs)),
        HEAP_WASM_MB: Math.max(...mine.map((m) => m.heapMb)),
        jsHeapMb: mine.some((m) => m.jsHeapMb) ? Math.max(...mine.map((m) => m.jsHeapMb ?? 0)) : null,
        CORRECT: v.correct,
        devRelErr: mine.map((m) => m.relErr.dev ?? null),
        worstRealisticRelErr: Math.max(...mine.flatMap((m) => Object.entries(m.relErr).filter(([k]) => k !== "synthetic").map(([, x]) => x ?? Infinity))),
        syntheticRelErr: mine.map((m) => m.relErr.synthetic ?? null),
        allRealisticPass: mine.every((m) => m.allRealisticPass),
        deterministicWithinLaunch: mine.every((m) => m.deterministic),
        boxesIdenticalAcrossLaunches: sameBoxes,
        outputsEqualM81: mine.every((m) => m.outputsEqualM81),
        boxesEqualM81: mine.every((m) => m.boxesEqualM81),
        coldLoadMs: sum2(mine.map((m) => m.coldLoadMs)),
        coldInferenceMs: sum2(mine.map((m) => m.coldInferenceMs)),
        postprocessMs: sum2(mine.map((m) => m.postprocessMs)),
        foreignRequests: mine.reduce((n, m) => n + m.foreign, 0),
        g6: plaintextCheck(conv[cid].graph, mine.flatMap((m) => m.types), mine.flatMap((m) => (m.boxes ? Object.values(m.boxes).flat() : []))),
        re1: firstLoaded ? rescore(cid, firstLoaded.boxes, mine.every((m) => m.allRealisticPass), mine.every((m) => m.deterministic) && sameBoxes) : null,
        gpuAdapter: firstLoaded?.gpuAdapter ?? null,
        timerResolutionMs: firstLoaded?.timerResolutionMs ?? null,
        browserVersion: firstLoaded?.browserVersion ?? mine[0].browserVersion,
        userAgent: firstLoaded?.userAgent ?? null,
        errors: mine.flatMap((m) => m.errors),
      };
    }
    cells[cid][name] = { verdict: cellVerdict(modes.headful, modes.headless), modes };
  }
}
write(join(EXP, "results", "cells.json"), cells);

// ── teardown ─────────────────────────────────────────────────────────────────────────────────
const teardown = {};
for (const cid of CANDIDATES) {
  const runs = launches.filter((l) => l.candidate === cid && l.mode === "teardown").map((l) => {
    const r = l.result ?? {};
    const ctx = r.contextTeardown
      ? {
          ok: r.contextTeardown.closed === true && r.contextTeardown.recreated === true && r.contextTeardown.result?.cycles?.[0]?.ok === true,
          freshHeap: r.contextTeardown.result?.memory?.[0]?.wasm?.bytes === 0 && r.contextTeardown.result?.memory?.[0]?.wasm?.instances === 0,
          outputSha256: r.contextTeardown.result?.cycles?.[0]?.outputSha256,
        }
      : null;
    const cycles = r.cycles ?? [];
    return {
      env: `${l.browser}/${l.platform}/${l.backend}/${l.headless ? "headless" : "headful"}`,
      ...teardownPass(cycles, ctx),
      cycles: cycles.map((c) => ({ cycle: c.cycle, ok: c.ok, grows: c.grows, createMs: r2(c.createMs), inferenceMs: r2(c.inferenceMs), afterCreateMb: c.afterCreate?.mb, afterInferenceMb: c.afterInference?.mb, afterReleaseMb: c.afterRelease?.mb, error: c.error ?? null })),
      contextTeardown: ctx ? { ...ctx, newContextBaselineMb: r.contextTeardown.result?.memory?.[0]?.wasm?.mb, newContextAfterInferenceMb: r.contextTeardown.result?.cycles?.[0]?.afterInference?.mb } : "not measured (Firefox event page is not torn down by the harness)",
      errors: [...(r.errors ?? []), ...(l.timedOut ? ["no report"] : [])],
    };
  });
  teardown[cid] = { pass: runs.length === 4 && runs.every((x) => x.pass), runs };
}
write(join(EXP, "teardown", "summary.json"), teardown);

// ── coexistence ──────────────────────────────────────────────────────────────────────────────
const coexistence = {};
for (const cid of CANDIDATES) {
  const runs = launches.filter((l) => l.candidate === cid && l.mode === "coexist").map((l) => {
    const r = l.result ?? {};
    const created = {};
    for (const [k, v] of Object.entries(r.created ?? {})) created[k] = v === true && r.recreated?.[k] === true;
    const verdict = coexistencePass({ solo: r.solo, rounds: r.rounds, created, errors: [...(r.errors ?? []), ...(l.timedOut ? ["no report"] : [])] });
    const per = (k) => (r.roundMs ?? []).map((m) => m[k]);
    return {
      env: `${l.browser}/${l.platform}/${l.backend}/${l.headless ? "headless" : "headful"}`,
      ...verdict,
      soloMs: Object.fromEntries(Object.entries(r.soloMs ?? {}).map(([k, v]) => [k, r2(v)])),
      coexistMs: { uiHead: sum2(per("uiHead")), yunet: sum2(per("yunet")), candidate: sum2(per("candidate")), round: sum2(per("round")) },
      createMs: Object.fromEntries(Object.entries(r.createMs ?? {}).map(([k, v]) => [k, r2(v)])),
      peakWasmMb: Math.max(0, ...(r.memory ?? []).map((m) => m.wasm.mb)),
      memory: (r.memory ?? []).map((m) => ({ label: m.label, wasmMb: m.wasm.mb, grows: m.wasm.growCount, jsMb: m.js?.usedMB ?? null })),
      uiHeadShippedDecode: r.uiHeadShippedDecode ?? null,
      responsiveness: l.responsiveness ?? "not measured (Firefox via web-ext)",
      foreignRequests: foreignExceptCollector(r.network).length,
    };
  });
  coexistence[cid] = { pass: runs.length === 5 && runs.every((x) => x.pass && x.foreignRequests === 0), runs };
}
write(join(EXP, "coexistence", "summary.json"), coexistence);

// ── controlled benchmark ─────────────────────────────────────────────────────────────────────
const benchFile = join(EXP, "results", "bench-chromium-wasm.json");
const benchRaw = existsSync(benchFile) ? read(benchFile) : null;
const benchmarks = { machineStateStart: benchRaw?.machineStateStart ?? null, machineStateEnd: benchRaw?.machineStateEnd ?? null, candidates: {} };
for (const cid of CANDIDATES) {
  benchmarks.candidates[cid] = {};
  for (const [modeName, headless] of [["headful", false], ["headless", true]]) {
    const ls = (benchRaw?.launches ?? []).filter((l) => l.candidate === cid && l.headless === headless);
    const ok = ls.filter((l) => l.result?.conclusion === "completed");
    const med = (a) => summarise(a).median;
    const launchMedians = ok.map((l) => med(l.result.warmMs));
    const controlMedians = ok.map((l) => med(l.result.controlMs));
    const slow = slowModeLabels(launchMedians);
    const ctl = slowModeLabels(controlMedians);
    const pre = ok.flatMap((l) => l.result.preprocess.slice(1));
    const decode = sum2(pre.map((p) => p.decodeMs));
    const resize = sum2(pre.map((p) => p.resizeNormaliseMs));
    const warm = sum2(ok.flatMap((l) => l.result.warmMs));
    const post = sum2(ok.flatMap((l) => l.result.postprocessMs.slice(1)));
    benchmarks.candidates[cid][modeName] = {
      launches: ls.length,
      completed: ok.length,
      warmInference: warm,
      coldLoad: sum2(ok.map((l) => l.result.coldLoadMs)),
      coldInference: sum2(ok.map((l) => l.result.coldInferenceMs)),
      decodeWarm: decode,
      decodeCold: sum2(ok.map((l) => l.result.preprocess[0].decodeMs)),
      preprocessWarm: resize,
      preprocessCold: sum2(ok.map((l) => l.result.preprocess[0].resizeNormaliseMs)),
      postprocessWarm: post,
      totalMedianMs: r2((decode.median ?? 0) + (resize.median ?? 0) + (warm.median ?? 0) + (post.median ?? 0)),
      perLaunchWarmMedians: launchMedians.map(r2),
      perLaunchControlMedians: controlMedians.map(r2),
      slowMode: { rule: "launch median > 2x lowest launch median (descriptive only)", floorMs: r2(slow.floor), slowLaunches: slow.slow, labels: slow.labels },
      controlSlowMode: { floorMs: r2(ctl.floor), slowLaunches: ctl.slow, labels: ctl.labels },
      coOccurrence: slow.labels.map((s, i) => ({ launch: i + 1, candidateSlow: s, controlSlow: ctl.labels[i] })).filter((x) => x.candidateSlow || x.controlSlow),
      uiHeadControl: sum2(ok.flatMap((l) => l.result.controlMs)),
      preprocessParity: ok.map((l) => l.result.preprocessParity),
      outputsIdenticalAcrossLaunches: ok.every((l) => l.result.outputSha256 === ok[0].result.outputSha256),
      outputEqualsM81: ok.every((l) => l.result.outputSha256 === m81[cid].inputs.dev.wasm.outputSha256),
      boxesEqualM81: ok.every((l) => l.result.boxesSha256 === m81[cid].inputs.dev.boxesSha256),
      peakWasmMb: Math.max(0, ...ok.flatMap((l) => l.result.memory.map((m) => m.wasm.mb))),
      afterLoadWasmMb: sum2(ok.map((l) => l.result.memory.find((m) => m.label === "after-create")?.wasm.mb)),
      errors: ls.flatMap((l) => [...(l.result?.errors ?? []), ...(l.runError ? [l.runError] : [])]),
    };
  }
}
write(join(EXP, "benchmarks", "summary.json"), benchmarks);

// ── QG-03 benchmark artifact, then the verdict ────────────────────────────────────────────────
const artifact = {
  gate: "QG-03",
  experiment: "M8.2-qg03-visual-text-feasibility",
  role: "text-region detection (no recognition)",
  workstation: "W1 (LAPTOP-6E14K34L)",
  runtime: "onnxruntime-web 1.29.0, pinned wasm db816fad…, numThreads 1",
  candidates: Object.fromEntries(
    CANDIDATES.map((cid) => [
      cid,
      {
        model: { source: conv[cid].source.repo, revision: conv[cid].source.revision, onnxSha256: conv[cid].output.sha256, bytes: conv[cid].output.bytes },
        cells: Object.fromEntries(Object.entries(cells[cid]).map(([n, c]) => [n, { verdict: c.verdict, modes: Object.fromEntries(Object.entries(c.modes).map(([m, v]) => [m, v && { LOAD: v.LOAD, P50: v.P50, HEAP_WASM_MB: v.HEAP_WASM_MB, CORRECT: v.CORRECT, devRelErr: v.devRelErr, browser: v.browserVersion }])) }])),
        controlledBenchmark: benchmarks.candidates[cid],
      },
    ])
  ),
  note: "W1 only. No threshold is set from these figures; QG-03 defines none.",
};
const ARTIFACT = join(ROOT, "artifacts", "benchmarks", "M8.2-text-region-qg03.json");
write(ARTIFACT, artifact);

const registry = readFileSync(join(ROOT, "agentos", "registry", "model-registry.md"), "utf8");
const verdicts = {};
for (const cid of CANDIDATES) {
  const cellVerdicts = Object.fromEntries(REQUIRED_CELLS.map((n) => [n, cells[cid][n]?.verdict ?? CELL.blocked]));
  verdicts[cid] = {
    ...qg03Verdict({
      pinned: registry.includes(conv[cid].source.revision.slice(0, 8)),
      licence: conv[cid].identity.licenceAtRevision === "apache-2.0",
      cells: cellVerdicts,
      coexistence: coexistence[cid].runs.length ? coexistence[cid].pass : undefined,
      teardown: teardown[cid].runs.length ? teardown[cid].pass : undefined,
      benchmarkArtifact: existsSync(ARTIFACT) && benchmarks.candidates[cid].headful.completed > 0,
    }),
    cells: cellVerdicts,
    supplementary: { "Firefox WASM (Windows)": cells[cid]["Firefox WASM (Windows) — supplementary"].verdict },
    item8: "ADR — not triggered by feasibility; required at adoption (OCRProvider's pinned default)",
  };
}
write(join(EXP, "results", "qg03-verdict.json"), verdicts);
console.log(JSON.stringify(Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, { verdict: v.verdict, cells: v.cells, failures: v.failures, blocked: v.blockedCells }])), null, 1));
