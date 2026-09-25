#!/usr/bin/env node
/**
 * M8.1 — screen ONE text-region candidate, end to end, in the order the owner fixed:
 *
 *   provenance (acquire-convert.py, already run)  ->  native baseline  ->  realistic WASM
 *   ->  RE-1 development screen  ->  RE-1 held-out set  ->  performance
 *
 * WHAT IS FIXED BEFORE ANY RESULT, AND NOT A PARAMETER
 * - the model: the reproducible conversion recorded in logs/<id>-conversion.json, hash-checked here
 * - preprocessing: each candidate's own inference.yml (prep-native.py)
 * - post-processing: DB_POSTPROCESS, the values both inference.yml files declare
 * - the inputs: the development fixture (visual.html, which is also QG-03's fixed realistic
 *   text-bearing fixture), the six frozen held-out pages, and S-04a-1's synthetic tensor
 * - the scorer: RE-1's, as committed, through the canonical product geometry
 * - the verdict rules: tests/browser/support/text-detector-screening.mjs
 *
 * WHAT IS NEVER DONE: re-thresholding, a second resolution, a second post-processing, choosing
 * anything after seeing the held-out set, loading any recognition model. The detector's only
 * output is a float map; boxes are derived from it by geometry.
 *
 * Determinism (G4) needs two COMPLETE runs: run this twice (--run run1, --run run2), then
 * compare-runs.mjs. --run run3 is a timing repeat that decides nothing.
 *
 * Usage:
 *   CHROME_PATH=<chrome for testing> REF_PYTHON=<measurement venv python> \
 *     node artifacts/experiments/M8.1-visual-text-screening/harness/run-screening.mjs --candidate TR-01 --run run1
 * Exit 0 = the measurement completed (the verdict is in the record, pass or fail). Exit 1 = it did not.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startDemoServer } from "../../../../tests/browser/demo/server.mjs";
import { REDACTION_CRITERIA, scoreImage, scoreSet } from "../../../../tests/browser/support/redaction-metrics.mjs";
import {
  DB_POSTPROCESS,
  dbPostprocess,
  judgeWasm,
  plaintextCheck,
  tensorStats,
} from "../../../../tests/browser/support/text-detector-screening.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const MODELS = join(EXP, "models");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const HELDOUT = join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json");
const PINNED_WASM = "db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea";
/** M7.1's screenshot of the same fixture — recorded to show the development input did not move. */
const M71_FIXTURE_PNG = "7fb4bb0af21fc39487de7e24f08f25710e9ce91dfcc8e3cc19edacee3ec897f8";
const STEMS = { "TR-01": "tr01_ppocrv4_mobile_det", "TR-02": "tr02_ppocrv3_mobile_det" };
const RUNS = 5;
const VIEWPORT = { width: 1280, height: 720 };

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(1);
};
const cid = arg("candidate");
const run = arg("run");
if (!STEMS[cid]) refuse("--candidate TR-01|TR-02");
// run1 and run2 decide G4 (compare-runs.mjs). run3 is a timing repeat only, added after run2 of
// TR-01 measured ~4x slower than run1 with identical outputs; it decides nothing.
if (!/^run[123]$/.test(run ?? "")) refuse("--run run1|run2|run3");
const executablePath = process.env.CHROME_PATH;
const refPython = process.env.REF_PYTHON;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!refPython || !existsSync(refPython)) refuse("set REF_PYTHON to the isolated measurement venv's python");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const conversion = JSON.parse(readFileSync(join(EXP, "logs", `${cid.toLowerCase()}-conversion.json`), "utf8"));
const MODEL = join(MODELS, `${STEMS[cid]}.onnx`);
if (!conversion.reproducible) refuse(`${cid} has no reproducible conversion — it is BLOCKED, not screened`);
if (!existsSync(MODEL) || sha256(readFileSync(MODEL)) !== conversion.output.sha256) refuse("the model on disk is not the recorded conversion");
const WORK = join(MODELS, `${STEMS[cid]}-${run}`);
mkdirSync(WORK, { recursive: true });
const frozen = JSON.parse(readFileSync(HELDOUT, "utf8"));

const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");

// ── ORT Web page and its files, loopback only ───────────────────────────────────────────────────
const PAGE = `<!doctype html><meta charset="utf-8"><title>m8.1 ort-web</title>
<script>
  // ORT's threaded build creates its Memory in JS and imports it, so the constructor is observed (M7.1).
  window.__wasmMemories = [];
  const Native = WebAssembly.Memory;
  WebAssembly.Memory = function (descriptor) { const m = new Native(descriptor); window.__wasmMemories.push(m); return m; };
  WebAssembly.Memory.prototype = Native.prototype;
</script>
<script src="/ort/ort.all.min.js"></script>`;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".png": "image/png" };
const served = { wasm: null };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let file = null;
  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(PAGE);
    return;
  }
  if (url.pathname === "/model.onnx") file = MODEL;
  else if (/^\/input\/[A-Za-z0-9-]+$/.test(url.pathname)) file = join(WORK, `input-${url.pathname.slice(7)}.f32`);
  else if (/^\/png\/[A-Za-z0-9-]+$/.test(url.pathname)) file = join(WORK, `${url.pathname.slice(5)}.png`);
  else if (url.pathname.startsWith("/ort/")) file = join(ORT_DIST, url.pathname.slice(5));
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const bytes = readFileSync(file);
  if (file.endsWith("ort-wasm-simd-threaded.jsep.wasm")) served.wasm = sha256(bytes);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(bytes);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const ortOrigin = `http://127.0.0.1:${server.address().port}`;
const demo = await startDemoServer(8991);

const record = {
  experiment: "M8.1-visual-text-screening",
  candidate: cid,
  run,
  at: new Date().toISOString(),
  workstation: "W1",
  model: { file: `${STEMS[cid]}.onnx`, sha256: conversion.output.sha256, bytes: conversion.output.bytes, source: conversion.source.repo, revision: conversion.source.revision },
  fixed: { dbPostprocess: DB_POSTPROCESS, re1: REDACTION_CRITERIA, runsPerInput: RUNS, viewport: VIEWPORT, dpr: 1 },
};
let context = null;
let failure = null;

try {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m81-")), {
    headless: false,
    executablePath,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  record.browser = { version: context.browser()?.version() ?? null };

  // 1 — the realistic inputs, as a person sees them, with their self-measured geometry.
  const truth = {};
  const shots = {};
  const dev = await context.newPage();
  await dev.goto(`${demo.origin}/visual/`, { waitUntil: "load" });
  await dev.waitForFunction(() => window.__fixtureReady === true);
  truth.dev = await dev.evaluate(() => {
    const t = window.__groundTruth.redactionTruth;
    return { region: t.region, strings: t.strings.map(({ id, sensitive, glyphCount, glyphs, ink, line }) => ({ id, sensitive, glyphCount, glyphs, ink, line })) };
  });
  writeFileSync(join(WORK, "dev.png"), await dev.screenshot({ type: "png" }));
  await dev.close();
  const integrity = {};
  for (const img of frozen.images) {
    const page = await context.newPage();
    await page.goto(`${demo.origin}/heldout/${img.image.toLowerCase()}.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fixtureReady === true);
    const measured = await page.evaluate(() => window.__groundTruth);
    integrity[img.image] = JSON.stringify(measured) === JSON.stringify(img);
    writeFileSync(join(WORK, `${img.image}.png`), await page.screenshot({ type: "png" }));
    await page.close();
    truth[img.image] = img; // the FROZEN geometry is what is scored
  }
  record.heldOutIntegrity = { perImage: integrity, allMatchFrozen: Object.values(integrity).every(Boolean) };
  if (!record.heldOutIntegrity.allMatchFrozen) throw new Error("a held-out page no longer measures its frozen geometry");
  const names = ["dev", ...frozen.images.map((i) => i.image)];
  for (const n of names) shots[n] = sha256(readFileSync(join(WORK, `${n}.png`)));
  record.screenshots = { sha256: shots, devSameAsM71: shots.dev === M71_FIXTURE_PNG };

  // 2 — native baseline, in the measurement venv, on the candidate's own preprocessing.
  const native = spawnSync(
    refPython,
    [join(HERE, "prep-native.py"), "--candidate", cid, "--model", MODEL, "--out-dir", WORK, "--runs", String(RUNS), ...names.map((n) => `${n}=${join(WORK, `${n}.png`)}`)],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (native.status !== 0) throw new Error(`prep-native.py exited ${native.status}: ${String(native.stderr).slice(-600)}`);
  const reference = JSON.parse(readFileSync(join(WORK, "native-reference.json"), "utf8"));
  record.native = {
    runtime: reference.reference_runtime,
    sessionLoadMs: reference.session_load_ms,
    graphInputs: reference.graph_inputs,
    graphOutputs: reference.graph_outputs,
  };

  // 3 — ORT Web, wasm EP, one thread, the pinned binary. One session; each input run RUNS times.
  const page = await context.newPage();
  await page.goto(`${ortOrigin}/`, { waitUntil: "load" });
  const load = await page.evaluate(async () => {
    const memory = () => window.__wasmMemories.reduce((sum, m) => sum + m.buffer.byteLength, 0);
    const heap = () => (performance.memory ? performance.memory.usedJSHeapSize : null);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/ort/";
    const before = { wasm: memory(), jsHeap: heap() };
    const bytes = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
    const t0 = performance.now();
    window.__session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    const loadMs = performance.now() - t0;
    return {
      ortVersion: ort.env.versions?.common ?? null,
      loadMs,
      inputNames: window.__session.inputNames,
      outputNames: window.__session.outputNames,
      memory: { before, afterLoad: { wasm: memory(), jsHeap: heap() } },
    };
  });
  const web = { inputs: {} };
  for (const name of ["synthetic", ...names]) {
    web.inputs[name] = await page.evaluate(
      async ({ name, shape, runs }) => {
        const hex = async (buf) =>
          Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
        const b64 = (u8) => {
          let s = "";
          for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
          return btoa(s);
        };
        const s = window.__session;
        const x = new Float32Array(await (await fetch(`/input/${name}`)).arrayBuffer());
        const times = [];
        const digests = [];
        let last = null;
        let types = null;
        for (let r = 0; r < runs; r += 1) {
          const t = performance.now();
          const res = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, shape) });
          times.push(performance.now() - t);
          types = s.outputNames.map((o) => ({ name: o, type: res[o].type }));
          const y = res[s.outputNames[0]];
          last = { data: new Float32Array(y.data), dims: y.dims, outputs: s.outputNames.length };
          digests.push(await hex(last.data.buffer));
        }
        return { dims: last.dims, outputs: last.outputs, types, inferMs: times, digests, b64: b64(new Uint8Array(last.data.buffer)) };
      },
      { name, shape: reference.inputs[name].meta.shape, runs: RUNS }
    );
  }
  const afterInference = await page.evaluate(() => ({
    wasm: window.__wasmMemories.reduce((sum, m) => sum + m.buffer.byteLength, 0),
    jsHeap: performance.memory ? performance.memory.usedJSHeapSize : null,
  }));

  // 3b — in-page preprocessing cost for the development frame, with the SAME definition as
  // prep-native.py, compared against the Python tensor (a diagnostic: the fed bytes are Python's).
  const devMeta = reference.inputs.dev.meta;
  const pre = await page.evaluate(
    async ({ hw }) => {
      const MEAN = [0.485, 0.456, 0.406].map(Math.fround);
      const STD = [0.229, 0.224, 0.225].map(Math.fround);
      const t0 = performance.now();
      const bmp = await createImageBitmap(await (await fetch("/png/dev")).blob());
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const cx = cv.getContext("2d");
      cx.drawImage(bmp, 0, 0);
      const rgba = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      const t1 = performance.now();
      const [oh, ow] = hw;
      const ih = bmp.height, iw = bmp.width;
      const out = new Float32Array(3 * oh * ow);
      const plane = oh * ow;
      const xs = new Float64Array(ow), wx = new Float64Array(ow), x0s = new Int32Array(ow), x1s = new Int32Array(ow);
      for (let x = 0; x < ow; x += 1) {
        const sx = Math.min(Math.max((x + 0.5) * (iw / ow) - 0.5, 0), iw - 1);
        x0s[x] = Math.floor(sx);
        x1s[x] = Math.min(x0s[x] + 1, iw - 1);
        wx[x] = sx - x0s[x];
        xs[x] = sx;
      }
      for (let y = 0; y < oh; y += 1) {
        const sy = Math.min(Math.max((y + 0.5) * (ih / oh) - 0.5, 0), ih - 1);
        const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, ih - 1), wy = sy - y0;
        for (let x = 0; x < ow; x += 1) {
          for (let c = 0; c < 3; c += 1) {
            const ch = 2 - c; // BGR: model channel 0 is blue
            const a = rgba[(y0 * iw + x0s[x]) * 4 + ch], b = rgba[(y0 * iw + x1s[x]) * 4 + ch];
            const d = rgba[(y1 * iw + x0s[x]) * 4 + ch], e = rgba[(y1 * iw + x1s[x]) * 4 + ch];
            const top = a * (1 - wx[x]) + b * wx[x];
            const bottom = d * (1 - wx[x]) + e * wx[x];
            const v = Math.fround((top * (1 - wy) + bottom * wy) / 255);
            out[c * plane + y * ow + x] = Math.fround(Math.fround(v - MEAN[c]) / STD[c]);
          }
        }
      }
      const t2 = performance.now();
      const py = new Float32Array(await (await fetch("/input/dev")).arrayBuffer());
      let maxAbs = 0;
      for (let i = 0; i < out.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(out[i] - py[i]));
      return { decodeMs: t1 - t0, resizeNormaliseMs: t2 - t1, maxAbsVsPython: maxAbs, sameLength: out.length === py.length };
    },
    { hw: devMeta.resized_hw }
  );

  record.web = {
    runtime: `onnxruntime-web ${load.ortVersion}`,
    executionProvider: "wasm",
    numThreads: 1,
    wasmSha256: served.wasm,
    wasmIsPinned: served.wasm === PINNED_WASM,
    sessionLoadMs: load.loadMs,
    inputNames: load.inputNames,
    outputNames: load.outputNames,
    memory: { ...load.memory, afterInference },
  };
  if (!record.web.wasmIsPinned) throw new Error(`the served wasm is not the pinned binary: ${served.wasm}`);

  // 4 — per input: native vs WASM, the frozen rule, determinism, and boxes for realistic inputs.
  record.inputs = {};
  const allBoxes = [];
  const boxesFor = {};
  for (const [name, w] of Object.entries(web.inputs)) {
    const ref = reference.inputs[name];
    const webOut = new Float32Array(new Uint8Array(Buffer.from(w.b64, "base64")).buffer);
    const nativeOut = new Float32Array(new Uint8Array(readFileSync(join(WORK, `native-${name}.f32`))).buffer);
    const s = tensorStats(webOut);
    let maxAbs = 0;
    for (let i = 0; i < webOut.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(webOut[i] - nativeOut[i]));
    const sorted = [...w.inferMs].sort((a, b) => a - b);
    const entry = {
      input: ref.meta,
      inputSha256: ref.input_sha256,
      native: { ...ref.native_output, outputSha256: ref.native_output_sha256, outputs: ref.output_count, deterministic: ref.native_deterministic, inferMs: ref.native_infer_ms },
      wasm: {
        dims: w.dims,
        outputs: w.outputs,
        types: w.types,
        ...s,
        deterministic: w.digests.every((d) => d === w.digests[0]),
        outputSha256: w.digests[0],
        inferMs: { first: w.inferMs[0], median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1), all: w.inferMs },
      },
      outputCountEqual: w.outputs === ref.output_count,
      maxAbsDiffWasmVsNative: maxAbs,
      s04a1: judgeWasm(s, ref.native_output),
    };
    if (name !== "synthetic") {
      const [, , H, W] = w.dims;
      const [srcH, srcW] = ref.meta.source_hw;
      const t = performance.now();
      const fromWasm = dbPostprocess(webOut, H, W, ref.meta.ratio_h, ref.meta.ratio_w, srcH, srcW);
      entry.postprocessMs = performance.now() - t;
      const fromNative = dbPostprocess(nativeOut, H, W, ref.meta.ratio_h, ref.meta.ratio_w, srcH, srcW);
      entry.candidates = fromWasm.candidates;
      entry.boxes = fromWasm.boxes;
      entry.boxesSha256 = sha256(JSON.stringify(fromWasm.boxes));
      entry.nativeBoxesSha256 = sha256(JSON.stringify(fromNative.boxes));
      entry.boxesSameAsNative = entry.boxesSha256 === entry.nativeBoxesSha256;
      boxesFor[name] = fromWasm.boxes;
      allBoxes.push(...fromWasm.boxes);
    }
    record.inputs[name] = entry;
  }

  // 5 — G6, structurally, over the graph, the web outputs and every box produced.
  record.g6 = plaintextCheck(conversion.graph, Object.values(web.inputs).flatMap((w) => w.types), allBoxes);

  // 6 — RE-1: the development screen, then the held-out set, with the committed scorer.
  const realistic = names;
  const wasmEvery = realistic.every((n) => record.inputs[n].s04a1.pass);
  const deterministicWithinRun = Object.values(record.inputs).every((e) => e.wasm.deterministic && e.native.deterministic);
  const devScore = scoreImage({ boxes: boxesFor.dev }, truth.dev);
  record.developmentScreen = {
    role: "development screen — can reject, cannot accept (RE-1 §7 step 5)",
    score: devScore,
    wasmValid: record.inputs.dev.s04a1.pass,
    pass: Object.values(devScore.gates).every(Boolean) && record.inputs.dev.s04a1.pass,
  };
  const perImage = frozen.images.map((img) => ({ image: img.image, ...scoreImage({ boxes: boxesFor[img.image] }, truth[img.image]) }));
  record.heldOut = {
    perImage,
    set: scoreSet(perImage, { wasmPassedOnEveryInput: wasmEvery, deterministic: deterministicWithinRun, noPlaintextOutput: record.g6.pass }),
    note: "`deterministic` here is within this run only; G4 is decided across two complete runs by compare-runs.mjs",
  };
  record.qg03RealisticCell = {
    input: "development fixture (visual.html) — the fixed realistic text-bearing fixture",
    ...record.inputs.dev.s04a1,
  };

  // 7 — performance on the development frame, and memory.
  const dv = record.inputs.dev;
  record.performance = {
    workstation: "W1",
    note: "W1 only; Chrome for Testing, ORT Web wasm, one thread. Post-processing timed in Node (V8), the same engine.",
    modelBytes: conversion.output.bytes,
    sessionLoadMs: load.loadMs,
    decodeMs: pre.decodeMs,
    preprocessMs: pre.resizeNormaliseMs,
    preprocessMaxAbsVsPython: pre.maxAbsVsPython,
    inferMedianMs: dv.wasm.inferMs.median,
    inferFirstMs: dv.wasm.inferMs.first,
    postprocessMs: dv.postprocessMs,
    totalMs: pre.decodeMs + pre.resizeNormaliseMs + dv.wasm.inferMs.median + dv.postprocessMs,
    inferMedianMsPerHeldOutImage: Object.fromEntries(frozen.images.map((i) => [i.image, record.inputs[i.image].wasm.inferMs.median])),
    memory: record.web.memory,
  };
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 600)}`;
} finally {
  if (context) await context.close();
  server.close();
  demo.server.close();
}

record.failure = failure;
mkdirSync(join(EXP, "results"), { recursive: true });
const out = join(EXP, "results", `${cid.toLowerCase()}-${run}.json`);
writeFileSync(out, JSON.stringify(record, null, 1));

if (failure) console.log(`ERROR: ${failure}`);
if (record.inputs) {
  for (const [n, e] of Object.entries(record.inputs)) {
    console.log(
      `${n.padEnd(9)} out ${e.wasm.dims.join("x")}  relErr ${e.s04a1.relErrSumAbs.toExponential(3)} ${e.s04a1.pass ? "PASS" : "FAIL"}  ` +
        `maxAbs ${e.maxAbsDiffWasmVsNative.toExponential(2)}  det ${e.wasm.deterministic && e.native.deterministic}` +
        (e.boxes ? `  boxes ${e.boxes.length} sameAsNative ${e.boxesSameAsNative}` : "")
    );
  }
  const d = record.developmentScreen;
  if (d) console.log(`DEV   exposed ${d.score.exposedSensitiveGlyphs}/${d.score.sensitiveGlyphs}  overMask ${d.score.overMaskRatio.toFixed(3)}  largest ${d.score.largestSingleBoxRegionShare.toFixed(3)}  pass ${d.pass}`);
  for (const r of record.heldOut?.perImage ?? []) {
    console.log(`${r.image}    exposed ${r.exposedSensitiveGlyphs}/${r.sensitiveGlyphs}  overMask ${r.overMaskRatio.toFixed(3)}  largest ${r.largestSingleBoxRegionShare.toFixed(3)}  gates ${JSON.stringify(r.gates)}`);
  }
  if (record.heldOut) console.log(`SET   ${JSON.stringify(record.heldOut.set.gates)}  pass ${record.heldOut.set.pass}`);
  if (record.performance) console.log(`PERF  ${JSON.stringify({ ...record.performance, memory: undefined, inferMedianMsPerHeldOutImage: undefined })}`);
  console.log(`G6    ${JSON.stringify(record.g6)}`);
}
console.log(`written: ${out}`);
process.exit(failure ? 1 : 0);
