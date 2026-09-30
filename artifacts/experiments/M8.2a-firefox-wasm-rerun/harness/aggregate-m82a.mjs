#!/usr/bin/env node
/**
 * M8.2a — validation verdict, the re-run cell, its comparisons, RE-1, and the interpretation.
 *
 * Same rules as M8.2, imported, not re-implemented: modeVerdict / cellVerdict / qg03Verdict /
 * teardownPass / coexistencePass (qg03-feasibility.mjs), judgeWasm's results as the probe recorded
 * them, plaintextCheck, and the committed RE-1 scorer. A launch is "loaded" and "correct" exactly as
 * M8.2's aggregate.mjs defines it.
 *
 * Writes results/validation-summary.json and results/m82a-summary.json. Reads M8.2 and M8.1
 * records read-only; writes nothing outside this experiment.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scoreImage, scoreSet } from "../../../../tests/browser/support/redaction-metrics.mjs";
import { dbPostprocess, plaintextCheck } from "../../../../tests/browser/support/text-detector-screening.mjs";
import { cellVerdict, coexistencePass, modeVerdict, qg03Verdict, summarise, teardownPass } from "../../../../tests/browser/support/qg03-feasibility.mjs";
import { AMENDMENT, onlyTheAmendmentDiffers } from "./amendment.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const M81 = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening");
const M82 = join(ROOT, "artifacts", "experiments", "M8.2-qg03-visual-text-feasibility");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const CANDIDATES = ["TR-01", "TR-02"];
const REALISTIC = ["dev", "H1", "H2", "H3", "H4", "H5", "H6"];
const frozen = read(join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"));
const devTruth = read(join(M82, "models", "fixtures", "dev-truth.json"));
const conv = Object.fromEntries(CANDIDATES.map((c) => [c, read(join(M81, "logs", `${c.toLowerCase()}-conversion.json`))]));
const m81 = Object.fromEntries(CANDIDATES.map((c) => [c, read(join(M81, "results", `${c.toLowerCase()}-run1.json`))]));
const lastAt = (r) => (r?.memory?.length ? r.memory[r.memory.length - 1].at : null);
const launchesOf = (file) => (existsSync(file) ? read(file).launches : []);
const fileOf = (dir, label) => join(dir, `${label}.json`);

/** M8.2's definition, verbatim in meaning. */
const loaded = (l) => l.result?.conclusion === "completed" && l.result?.sessionCreated === true;
const correct = (l) => loaded(l) && l.result.inputs?.dev?.judge?.pass === true && l.result.inputs?.dev?.outputCountEqual === true;
const outHashes = (l) => REALISTIC.map((n) => l.result?.inputs?.[n]?.outputSha256 ?? null);
const boxHashes = (l) => REALISTIC.map((n) => l.result?.inputs?.[n]?.boxesSha256 ?? null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** M8.2's completed Firefox WASM (Linux) launches, as the reference for "M8.2 outputs". */
function m82Linux(cid) {
  const c = cid.toLowerCase();
  return ["headful", "headless"].flatMap((m) => launchesOf(join(M82, "results", `${c}-cell-firefox-linux-wsl2-wasm-${m}.json`))).filter(loaded);
}

// ── canonical post-processing: the probe's injected source is today's module, byte for byte ────
const build = read(join(M82, "models", "ext", "build.json"));
const libNow = sha(dbPostprocess.toString());
const postprocessing = {
  dbPostprocessSha256Now: libNow,
  equalsM82Build: libNow === build.lib.dbPostprocess,
  injectedVerbatim: Object.fromEntries(CANDIDATES.map((c) => [c, readFileSync(join(M82, "models", "ext", c, "firefox", "m82-lib.js"), "utf8").includes(dbPostprocess.toString())])),
};

// ── validation (protocol §3) ────────────────────────────────────────────────────────────────
const V = join(EXP, "results", "validation");
const validation = {};
if (existsSync(V)) {
  validation.v1 = CANDIDATES.map((cid) => {
    const l = launchesOf(fileOf(V, `v1-${cid.toLowerCase()}-amended-warm40`))[0];
    const ok = !!l && !l.timedOut && loaded(l) && lastAt(l.result) > 30000 && correct(l);
    return { candidate: cid, reported: !!l && !l.timedOut, probeRuntimeMs: lastAt(l?.result), warm: l?.result?.warmMs?.length ?? null, correct: !!l && correct(l), pass: ok };
  });
  const d = launchesOf(fileOf(V, "v2-tr-01-default"))[0];
  const a = launchesOf(fileOf(V, "v2-tr-01-amended"))[0];
  const bothLoaded = !!d && !!a && loaded(d) && loaded(a);
  validation.v2 = {
    defaultReported: !!d && loaded(d),
    amendedReported: !!a && loaded(a),
    prefsCount: { default: d?.profilePrefs?.count ?? null, amended: a?.profilePrefs?.count ?? null },
    onlyTheAmendmentDiffers: bothLoaded && Array.isArray(d.profilePrefs?.lines) && onlyTheAmendmentDiffers(d.profilePrefs.lines, a.profilePrefs.lines),
    webExtArgsDiffer: bothLoaded ? { default: d.webExtArgs, amended: a.webExtArgs } : null,
    outputsIdentical: bothLoaded && same(outHashes(d), outHashes(a)) && same(boxHashes(d), boxHashes(a)),
    syntheticIdentical: bothLoaded && d.result.inputs.synthetic.outputSha256 === a.result.inputs.synthetic.outputSha256,
  };
  validation.v2.pass = validation.v2.defaultReported && validation.v2.amendedReported && validation.v2.onlyTheAmendmentDiffers && validation.v2.outputsIdentical && validation.v2.syntheticIdentical;
  validation.v3 = CANDIDATES.map((cid) => {
    const c = cid.toLowerCase();
    const t = launchesOf(fileOf(V, `v3-${c}-teardown-amended`))[0];
    const k = launchesOf(fileOf(V, `v3-${c}-coexist-amended`))[0];
    const tRef = launchesOf(join(M82, "results", `${c}-teardown-firefox-linux-wsl2-wasm-headless.json`))[0];
    const kRef = launchesOf(join(M82, "results", `${c}-coexist-firefox-linux-wsl2-wasm-headless.json`))[0];
    const tr = t?.result ?? {};
    const kr = k?.result ?? {};
    const tp = teardownPass(tr.cycles ?? [], null);
    const created = Object.fromEntries(Object.entries(kr.created ?? {}).map(([m, v]) => [m, v === true && kr.recreated?.[m] === true]));
    const kp = coexistencePass({ solo: kr.solo, rounds: kr.rounds, created, errors: kr.errors ?? [] });
    const teardownSameAsM82 = (tr.cycles ?? []).length > 0 && tr.cycles.every((x) => x.outputSha256 === tRef?.result?.cycles?.[0]?.outputSha256);
    const coexistSameAsM82 = same(kr.solo, kRef?.result?.solo);
    return { candidate: cid, teardown: { ...tp, sameOutputAsM82: teardownSameAsM82, grows: (tr.cycles ?? []).map((x) => x.grows) }, coexistence: { ...kp, soloSameAsM82: coexistSameAsM82 }, pass: tp.pass && kp.pass && teardownSameAsM82 && coexistSameAsM82 };
  });
  validation.pass = validation.v1.every((x) => x.pass) && validation.v2.pass && validation.v3.every((x) => x.pass);
  writeFileSync(join(EXP, "results", "validation-summary.json"), JSON.stringify(validation, null, 1));
}

// ── the re-run cell (protocol §4) ───────────────────────────────────────────────────────────
const summary = { validationPass: validation.pass ?? null, postprocessing, candidates: {} };
const m82verdict = read(join(M82, "results", "qg03-verdict.json"));
for (const cid of CANDIDATES) {
  const c = cid.toLowerCase();
  const modes = {};
  const all = [];
  for (const m of ["headful", "headless"]) {
    const ls = launchesOf(join(EXP, "results", `${c}-cell-firefox-linux-wsl2-wasm-${m}.json`));
    all.push(...ls);
    modes[m] = ls.length
      ? {
          ...modeVerdict(ls.map((l) => ({ loaded: loaded(l), correct: correct(l) }))),
          timedOut: ls.filter((l) => l.timedOut).length,
          amendmentApplied: ls.every((l) => (l.extraPrefs ?? []).length === 1 && l.extraPrefs[0] === AMENDMENT.arg),
          firefox: [...new Set(ls.map((l) => l.browserVersion))],
          userAgentRv: [...new Set(ls.map((l) => (l.result?.userAgent?.match(/rv:[\d.]+/) ?? [null])[0]))],
          warm: summarise(ls.flatMap((l) => l.result?.warmMs ?? [])),
          coldLoadMs: summarise(ls.map((l) => l.result?.coldLoadMs)),
          coldInferenceMs: summarise(ls.map((l) => l.result?.coldInferenceMs)),
          probeRuntimeMs: summarise(ls.map((l) => lastAt(l.result))),
          wallMs: summarise(ls.map((l) => l.wallMs)),
          heapWasmMb: Math.max(0, ...ls.flatMap((l) => (l.result?.memory ?? []).map((s) => s.wasm.mb))),
        }
      : null;
  }
  const done = all.filter(loaded);
  const ref81 = { out: REALISTIC.map((n) => m81[cid].inputs[n].wasm.outputSha256), box: REALISTIC.map((n) => m81[cid].inputs[n].boxesSha256) };
  const ref82 = m82Linux(cid);
  const relErr = Object.fromEntries([...REALISTIC, "synthetic"].map((n) => [n, [...new Set(done.map((l) => l.result.inputs[n].judge.relErrSumAbs))]]));
  const comparisons = {
    launchesCompared: done.length,
    outputShapes: [...new Set(done.flatMap((l) => REALISTIC.map((n) => l.result.inputs[n].dims.join("x"))))],
    outputCountEqual: done.every((l) => REALISTIC.every((n) => l.result.inputs[n].outputCountEqual === true)),
    exactElementCount: done.every((l) => REALISTIC.every((n) => l.result.inputs[n].judge.countOk === true)),
    relErrSumAbsVsNative: relErr,
    worstRealisticRelErr: Math.max(...done.flatMap((l) => REALISTIC.map((n) => l.result.inputs[n].judge.relErrSumAbs))),
    everyRealisticWithinBound: done.every((l) => REALISTIC.every((n) => l.result.inputs[n].judge.pass === true)),
    outputsEqualM81Wasm: done.every((l) => same(outHashes(l), ref81.out)),
    boxesEqualM81: done.every((l) => same(boxHashes(l), ref81.box)),
    outputsEqualM82Linux: ref82.length > 0 && done.every((l) => ref82.every((r) => same(outHashes(l), outHashes(r)))),
    boxesEqualM82Linux: ref82.length > 0 && done.every((l) => ref82.every((r) => same(boxHashes(l), boxHashes(r)))),
    m82LinuxReferenceLaunches: ref82.length,
    maxAbsVsNative: "equal, by byte identity with M8.1's WASM outputs, to M8.1's recorded maxAbsDiffWasmVsNative per input",
    maxAbsVsNativePerInput: Object.fromEntries(REALISTIC.map((n) => [n, m81[cid].inputs[n].maxAbsDiffWasmVsNative])),
  };
  const deterministic = done.length === all.length && done.every((l) => l.result.determinism?.identical === true) && done.every((l) => same(outHashes(l), outHashes(done[0])) && same(boxHashes(l), boxHashes(done[0])));
  let re1 = null;
  if (done.length) {
    const boxes = done[0].result.boxes;
    const perImage = frozen.images.map((img) => ({ image: img.image, ...scoreImage({ boxes: boxes[img.image] }, img) }));
    const g6 = plaintextCheck(conv[cid].graph, done.flatMap((l) => Object.values(l.result.inputs).flatMap((v) => v.types ?? [])), done.flatMap((l) => Object.values(l.result.boxes).flat()));
    const set = scoreSet(perImage, { wasmPassedOnEveryInput: comparisons.everyRealisticWithinBound && done.length === all.length, deterministic, noPlaintextOutput: g6.pass });
    const dev = scoreImage({ boxes: boxes.dev }, devTruth);
    re1 = {
      G1_exposedSensitiveGlyphs: perImage.reduce((n, p) => n + p.exposedSensitiveGlyphs, 0),
      G2_worstOverMask: Math.max(...perImage.map((p) => p.overMaskRatio)),
      G3_largestSingleBoxShare: Math.max(...perImage.map((p) => p.largestSingleBoxRegionShare)),
      G4_deterministic: deterministic,
      G5_wasmValidEveryRealisticInput: set.gates.wasmValidOnEveryInput,
      G6_noPlaintext: g6.pass,
      setFloor: set.gates.heldOutLargeEnough,
      gates: set.gates,
      pass: set.pass,
      perImage: perImage.map((p) => ({ image: p.image, exposed: p.exposedSensitiveGlyphs, overMask: p.overMaskRatio, largest: p.largestSingleBoxRegionShare })),
      devScreen: { exposed: dev.exposedSensitiveGlyphs, overMask: dev.overMaskRatio, largest: dev.largestSingleBoxRegionShare, gates: dev.gates },
    };
  }
  const cell = cellVerdict(modes.headful, modes.headless);
  const cells = { ...m82verdict[cid].cells, "Firefox WASM (Linux)": cell };
  const interpreted = qg03Verdict({
    pinned: m82verdict[cid].checklist["1 revision pinned in the registry"],
    licence: m82verdict[cid].checklist["2 licence read at the pinned revision"],
    cells,
    coexistence: m82verdict[cid].checklist["6a coexistence verified"],
    teardown: m82verdict[cid].checklist["6b teardown reclaims memory"],
    benchmarkArtifact: m82verdict[cid].checklist["7 benchmark artifact under artifacts/benchmarks/"],
  });
  summary.candidates[cid] = {
    m82Cell: m82verdict[cid].cells["Firefox WASM (Linux)"],
    m82aCell: cell,
    modes,
    comparisons,
    deterministic,
    re1,
    qg03: { m82: m82verdict[cid].verdict, m82aInterpreted: interpreted.verdict, cellsUsed: cells, failures: interpreted.failures, note: "only the Firefox WASM (Linux) cell is replaced; every other input is M8.2's recorded value" },
  };
}
writeFileSync(join(EXP, "results", "m82a-summary.json"), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ validation: validation.pass ?? "not run", postprocessing, cells: Object.fromEntries(CANDIDATES.map((c) => [c, { m82: summary.candidates[c].m82Cell, m82a: summary.candidates[c].m82aCell, qg03: summary.candidates[c].qg03.m82aInterpreted }])) }, null, 1));
