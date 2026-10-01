#!/usr/bin/env node
/**
 * M7.1 — can the PINNED PP-OCRv5_mobile_det be validated under the frozen WASM rule and a
 * realistic text-bearing input?
 *
 * TWO QUESTIONS, ANSWERED SEPARATELY, and never merged into one verdict:
 *
 *   1. WASM CORRECTNESS — W1-S04a-1's frozen criterion, copied verbatim from its probe:
 *        per output, count equal AND |sumAbs_web - sumAbs_ref| / |sumAbs_ref| <= 2e-2
 *      reference = native onnxruntime 1.29.0 CPU; web = ORT Web 1.29.0, `wasm` EP, one thread, on
 *      the PINNED wasm binary (sha256 db816fad…a44dea — the product's). Run on BOTH inputs:
 *        synthetic  S-04a-1's own input, to show this is the same measurement (expect ~4.12e-02)
 *        realistic  the M7 fixture screenshot — S-04a-1a, never previously done
 *
 *   2. TEXT-REGION QUALITY — the criteria pre-registered in
 *      docs/perception/text-region-acceptance.md, scored by the SAME code that scored the floor
 *      (tests/browser/support/text-region-metrics.mjs), on boxes the WASM output produced.
 *
 * A model can pass one and fail the other. The record reports both and the verdict needs both.
 *
 * NOTHING IS TUNED. The criterion, the fixture, its ground truth and the model's own declared
 * post-processing parameters (inference.yml: thresh 0.3, box_thresh 0.6, max_candidates 1000,
 * unclip_ratio 1.5) are used as found.
 *
 * NO PLAINTEXT EXISTS ON THIS PATH. The detector's only output is a [1,1,H,W] probability map;
 * boxes are derived from it by geometry. There is no recognition model anywhere in this harness.
 *
 * Usage:
 *   CHROME_PATH=<chrome for testing> REF_PYTHON=<measurement venv python> \
 *     node artifacts/experiments/M7-visual-text/harness/run-det-validation.mjs
 * Exit 0 = the measurement completed (the verdict is in the record, pass or not). Exit 1 = it did not.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CRITERIA, area, intersect, round, screen } from "../../../../tests/browser/support/text-region-metrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const MODELS = join(EXP, "models");
const MODEL = join(MODELS, "ppocrv5_mobile_det.onnx");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const FIXTURE = join(ROOT, "tests", "browser", "extension", "fixture", "visual.html");
const PINNED_WASM = "db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea";

/** W1-S04a-1's criterion, verbatim from harness/s04a1-probe.js. Not a parameter. */
const RTOL_SUMABS = 2e-2;
/** The model's own post-processing, verbatim from the pinned inference.yml. */
const DB = Object.freeze({ thresh: 0.3, boxThresh: 0.6, maxCandidates: 1000, unclipRatio: 1.5, minSize: 3 });
const RUNS = 5;
const VIEWPORT = { width: 1280, height: 720 };

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(1);
};
const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
const refPython = process.env.REF_PYTHON;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!refPython || !existsSync(refPython)) refuse("set REF_PYTHON to the isolated measurement venv's python");
if (!existsSync(MODEL)) refuse(`no reconstructed model at ${MODEL} (run harness/convert-det.py)`);

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Statistics with probe.js's exact definitions, so web and native are summarised identically. */
function stats(f32) {
  let mn = Infinity, mx = -Infinity, sum = 0, sumAbs = 0, sumSq = 0;
  for (let i = 0; i < f32.length; i += 1) {
    const v = f32[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    sumAbs += v < 0 ? -v : v;
    sumSq += v * v;
  }
  const n = f32.length;
  const idx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return { count: n, min: mn, max: mx, sum, sumAbs, sumSq, sampleIdx: idx, sampleVals: idx.map((i) => f32[i]) };
}

/** W1-S04a-1's correctness judgement, verbatim. */
function judge(web, ref) {
  const countOk = web.count === ref.count;
  const relErrSumAbs = Math.abs(web.sumAbs - ref.sumAbs) / Math.max(1e-30, Math.abs(ref.sumAbs));
  return { countOk, relErrSumAbs, criterion: RTOL_SUMABS, pass: countOk && relErrSumAbs <= RTOL_SUMABS };
}

/**
 * DBPostProcess, with the pinned inference.yml parameters.
 *
 * Deviation, stated: PaddleOCR takes contours with OpenCV and fits a rotated minimum-area rectangle;
 * this takes 8-connected components and their axis-aligned bounding box. For the fixture's
 * horizontal text the two coincide up to a pixel. Scoring (mean probability inside the unexpanded
 * box), the box threshold, and the unclip distance (area * ratio / perimeter, applied outward on
 * every side) follow DB's definitions.
 */
function dbPostprocess(prob, H, W, ratioH, ratioW, srcH, srcW, convention = "edges") {
  const seen = new Uint8Array(H * W);
  const boxes = [];
  let candidates = 0;
  const stack = new Int32Array(H * W);
  for (let start = 0; start < H * W; start += 1) {
    if (seen[start] || prob[start] <= DB.thresh) continue;
    if (candidates >= DB.maxCandidates) break;
    candidates += 1;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (top > 0) {
      const p = stack[--top];
      const y = (p / W) | 0;
      const x = p - y * W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!seen[q] && prob[q] > DB.thresh) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    // `edges`: the component's pixel extent (the reading this harness was first run with).
    // `centres`: PaddleOCR's convention — minAreaRect over contour points at pixel centres, so the
    // rectangle spans x0..x1 rather than x0..x1+1. Reported as a sensitivity reading.
    const e = convention === "centres" ? 0 : 1;
    const w = x1 - x0 + e;
    const h = y1 - y0 + e;
    if (Math.min(w, h) < DB.minSize) continue;
    let s = 0;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) s += prob[y * W + x];
    const score = s / (w * h);
    if (score < DB.boxThresh) continue;
    const d = (w * h * DB.unclipRatio) / (2 * (w + h));
    if (Math.min(w + 2 * d, h + 2 * d) < DB.minSize + 2) continue;
    // back to source-image (= CSS, at DPR 1) coordinates, clipped to the image
    const bx0 = Math.max(0, (x0 - d) / ratioW);
    const by0 = Math.max(0, (y0 - d) / ratioH);
    const bx1 = Math.min(srcW, (x1 + e + d) / ratioW);
    const by1 = Math.min(srcH, (y1 + e + d) / ratioH);
    boxes.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, score: round(score, 4) });
  }
  return { boxes, candidates };
}

/** Score boxes against the fixture: the pre-registered screen, plus the Part D quantities. */
function geometry(boxes, groundTruth) {
  const canvas = groundTruth.visualOnly[0];
  const verdict = screen("PP-OCRv5_mobile_det", boxes, groundTruth.textRegions, canvas);
  const inside = boxes.filter((b) => intersect(b, canvas) > 0);
  const onTruth = inside.reduce(
    (sum, b) => sum + groundTruth.textRegions.reduce((s, r) => s + intersect(b, r), 0),
    0
  );
  const inCanvas = inside.reduce((sum, b) => sum + intersect(b, canvas), 0);
  const perRegionAll = groundTruth.textRegions.map((r) => {
    const best = boxes.reduce((acc, b) => Math.max(acc, intersect(b, r) / (area(b) + area(r) - intersect(b, r) || 1)), 0);
    return { id: r.id, sensitive: r.sensitive, bestIou: round(best) };
  });
  return {
    ...verdict,
    allRegions: perRegionAll,
    totalPredictions: boxes.length,
    predictionsOutsideCanvas: boxes.length - inside.length,
    falsePositiveAreaInCanvasPx: Math.round(Math.max(0, inCanvas - onTruth)),
    canvasOvercoverage: round(inCanvas / area(canvas)),
  };
}

// ── a loopback-only static server for the fixture, ORT Web, the model and the input tensors ────
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const servedWasm = { sha256: null };
/**
 * Memory is the WASM instance's own linear memory — the quantity S-04a-1 reported as "heap" and
 * "solo peak" — captured by observing the Memory objects ORT instantiates, before ORT loads.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>m7.1 ort-web</title>
<script>
  // ORT's threaded build CREATES its Memory in JS and imports it, rather than exporting one, so the
  // constructor is what is observed. (A first version hooked instantiate() and read 0 bytes.)
  window.__wasmMemories = [];
  const Native = WebAssembly.Memory;
  WebAssembly.Memory = function (descriptor) { const m = new Native(descriptor); window.__wasmMemories.push(m); return m; };
  WebAssembly.Memory.prototype = Native.prototype;
</script>
<script src="/ort/ort.all.min.js"></script>`;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  let file = null;
  let body = null;
  if (url.pathname === "/") body = PAGE;
  else if (url.pathname === "/fixture/") file = FIXTURE;
  else if (url.pathname === "/model.onnx") file = MODEL;
  else if (url.pathname.startsWith("/input/")) file = join(MODELS, `m7.1-input-${url.pathname.slice(7)}.f32`);
  else if (url.pathname.startsWith("/ort/")) file = join(ORT_DIST, url.pathname.slice(5));
  // Not cross-origin isolated, as S-04a-1's offscreen document was not. The first run of this harness
  // used COOP/COEP plus `--enable-blink-features=ForceEagerMeasureMemory` to reach
  // measureUserAgentSpecificMemory, and its latencies came out ~5x inflated; diag-latency.mjs showed
  // isolation alone does not matter, so the memory method was replaced instead (see PAGE).
  if (body !== null) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
    return;
  }
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const bytes = readFileSync(file);
  if (file.endsWith("ort-wasm-simd-threaded.jsep.wasm")) servedWasm.sha256 = sha256(bytes);
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(bytes);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const origin = `http://127.0.0.1:${server.address().port}`;

let context = null;
let failure = null;
const record = {
  experiment: "M7.1-ppocrv5-det-validation",
  question:
    "Can the pinned PP-OCRv5_mobile_det be validated under the repository's frozen WASM rule and " +
    "realistic text-bearing input?",
  at: new Date().toISOString(),
  workstation: "W1",
  model: { file: "ppocrv5_mobile_det.onnx", sha256: sha256(readFileSync(MODEL)), bytes: readFileSync(MODEL).length },
  criterion: { source: "W1-S04a-1 harness/s04a1-probe.js", statistic: "exact count + relErr(sumAbs)", rtol: RTOL_SUMABS },
  dbPostprocess: DB,
  textCriteria: { source: "docs/perception/text-region-acceptance.md", ...CRITERIA },
};

try {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m71-")), {
    headless: false,
    executablePath,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  record.browser = { executablePath, version: context.browser()?.version() ?? null, viewport: VIEWPORT, dpr: 1 };

  // 1 — the realistic input: the M7 fixture exactly as a person sees it, and its self-measured truth.
  const fixture = await context.newPage();
  await fixture.goto(`${origin}/fixture/`, { waitUntil: "load" });
  await fixture.waitForFunction(() => window.__fixtureReady === true);
  const groundTruth = await fixture.evaluate(() => window.__groundTruth);
  const png = join(MODELS, "m7.1-fixture.png");
  writeFileSync(png, await fixture.screenshot({ type: "png" }));
  record.groundTruth = { canvas: groundTruth.visualOnly[0], textRegions: groundTruth.textRegions };
  record.screenshot = { sha256: sha256(readFileSync(png)), viewport: VIEWPORT, dpr: 1 };
  await fixture.close();

  // 2 — preprocessing and the NATIVE reference, in the isolated measurement venv.
  const native = spawnSync(refPython, [join(HERE, "prep-det.py"), "--png", png, "--out-dir", MODELS, "--runs", String(RUNS)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (native.status !== 0) throw new Error(`prep-det.py exited ${native.status}: ${String(native.stderr).slice(-600)}`);
  const reference = JSON.parse(readFileSync(join(MODELS, "m7.1-native-reference.json"), "utf8"));
  record.reference = reference;

  // 3 — ORT Web, wasm EP, one thread, the pinned binary.
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "load" });
  const inputs = {};
  for (const [name, meta] of Object.entries(reference.inputs)) inputs[name] = meta.meta.shape;
  const web = await page.evaluate(
    async ({ inputs, runs }) => {
      const memory = async () => window.__wasmMemories.reduce((sum, m) => sum + m.buffer.byteLength, 0);
      const hex = async (buf) =>
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const b64 = (u8) => {
        let s = "";
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = "/ort/";
      const memBefore = await memory();
      const modelBytes = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
      const t0 = performance.now();
      const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"] });
      const loadMs = performance.now() - t0;
      const memAfterLoad = await memory();
      const out = { ortVersion: ort.env.versions?.common ?? null, loadMs, memory: { before: memBefore, afterLoad: memAfterLoad }, inputs: {} };
      for (const [name, shape] of Object.entries(inputs)) {
        const x = new Float32Array(await (await fetch(`/input/${name}`)).arrayBuffer());
        const times = [];
        const digests = [];
        let last = null;
        for (let r = 0; r < runs; r += 1) {
          const tensor = new ort.Tensor("float32", x, shape);
          const t = performance.now();
          const res = await session.run({ [session.inputNames[0]]: tensor });
          times.push(performance.now() - t);
          const y = res[session.outputNames[0]];
          last = { data: new Float32Array(y.data), dims: y.dims };
          digests.push(await hex(last.data.buffer));
        }
        out.inputs[name] = { dims: last.dims, inferMs: times, digests, b64: b64(new Uint8Array(last.data.buffer)) };
      }
      out.memory.afterInference = await memory();
      return out;
    },
    { inputs, runs: RUNS }
  );
  record.web = {
    runtime: `onnxruntime-web ${web.ortVersion}`,
    executionProvider: "wasm",
    numThreads: 1,
    wasmSha256: servedWasm.sha256,
    wasmIsPinned: servedWasm.sha256 === PINNED_WASM,
    sessionLoadMs: round(web.loadMs, 1),
    memoryBytes: web.memory,
  };
  if (!record.web.wasmIsPinned) throw new Error(`the served wasm is not the pinned binary: ${servedWasm.sha256}`);

  // 4 — the two questions, per input.
  record.results = {};
  for (const [name, w] of Object.entries(web.inputs)) {
    const ref = reference.inputs[name];
    const webOut = new Float32Array(new Uint8Array(Buffer.from(w.b64, "base64")).buffer);
    const nativeOut = new Float32Array(new Uint8Array(readFileSync(join(MODELS, `m7.1-native-${name}.f32`))).buffer);
    const s = stats(webOut);
    let maxAbs = 0;
    for (let i = 0; i < webOut.length; i += 1) maxAbs = Math.max(maxAbs, Math.abs(webOut[i] - nativeOut[i]));
    const sorted = [...w.inferMs].sort((a, b) => a - b);
    const result = {
      input: ref.meta,
      inputSha256: ref.input_sha256,
      wasm: {
        dims: w.dims,
        ...s,
        runs: RUNS,
        deterministic: w.digests.every((d) => d === w.digests[0]),
        outputSha256: w.digests[0],
        inferMs: { median: round(sorted[Math.floor(sorted.length / 2)], 1), min: round(sorted[0], 1), max: round(sorted.at(-1), 1) },
      },
      native: { ...ref.native_output, deterministic: ref.native_deterministic, inferMs: ref.native_infer_ms },
      maxAbsDiffWasmVsNative: maxAbs,
      s04a1: judge(s, ref.native_output),
    };
    if (name === "realistic") {
      const [, , H, W] = w.dims;
      const [srcH, srcW] = ref.meta.source_hw;
      const t = performance.now();
      const fromWasm = dbPostprocess(webOut, H, W, ref.meta.ratio_h, ref.meta.ratio_w, srcH, srcW);
      const postMs = performance.now() - t;
      const fromNative = dbPostprocess(nativeOut, H, W, ref.meta.ratio_h, ref.meta.ratio_w, srcH, srcW);
      result.postprocessMs = round(postMs, 1);
      const centres = dbPostprocess(webOut, H, W, ref.meta.ratio_h, ref.meta.ratio_w, srcH, srcW, "centres");
      result.geometry = {
        wasm: geometry(fromWasm.boxes, groundTruth),
        native: geometry(fromNative.boxes, groundTruth),
        sensitivityCentresConvention: geometry(centres.boxes, groundTruth),
      };
      result.boxes = { wasm: fromWasm.boxes.map((b) => ({ ...b, x: round(b.x, 1), y: round(b.y, 1), w: round(b.w, 1), h: round(b.h, 1) })), candidates: fromWasm.candidates };
    }
    record.results[name] = result;
  }

  const real = record.results.realistic;
  const wasmPass = real.s04a1.pass;
  const geo = real.geometry.wasm.criteria;
  const geometryPass = geo.localisation && geo.secretCoverage && geo.noFlood;
  const deterministic = Object.values(record.results).every((r) => r.wasm.deterministic && r.native.deterministic);
  record.verdict = {
    wasmCorrectnessRealistic: wasmPass ? "PASS" : "FAIL",
    wasmCorrectnessSynthetic: record.results.synthetic.s04a1.pass ? "PASS" : "FAIL",
    textRegionQuality: geometryPass ? "PASS" : "FAIL",
    deterministic,
    candidate:
      wasmPass && geometryPass && deterministic
        ? "ELIGIBLE FOR QG-03 / MODEL ADOPTION REVIEW"
        : "REJECTED FOR V1 (see the failing dimension above)",
  };
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 600)}`;
} finally {
  if (context) await context.close();
  server.close();
}

record.failure = failure;
const out = join(EXP, "logs", "m7.1-det-validation.json");
writeFileSync(out, JSON.stringify(record, null, 2));

if (failure) console.log(`ERROR: ${failure}`);
if (record.results) {
  for (const [name, r] of Object.entries(record.results)) {
    console.log(
      `${name.padEnd(9)} count ${r.wasm.count}/${r.native.count}  sumAbs web ${r.wasm.sumAbs} ref ${r.native.sumAbs}  ` +
        `relErr ${r.s04a1.relErrSumAbs.toExponential(3)} (<= 2e-2?) ${r.s04a1.pass ? "PASS" : "FAIL"}  ` +
        `maxAbsDiff ${r.maxAbsDiffWasmVsNative.toExponential(3)}  deterministic ${r.wasm.deterministic}`
    );
  }
  const g = record.results.realistic?.geometry?.wasm;
  if (g) {
    for (const p of g.allRegions) console.log(`  region ${p.id.padEnd(12)} sensitive=${p.sensitive}  bestIoU ${p.bestIou}`);
    for (const p of g.perRegion) console.log(`  secret ${p.id.padEnd(12)} coverage ${p.containment}`);
    console.log(
      `  predictions ${g.totalPredictions} (outside canvas ${g.predictionsOutsideCanvas})  flood ${g.flood.ratio}x  ` +
        `widest ${g.flood.widestShareOfCanvas}  FP area in canvas ${g.falsePositiveAreaInCanvasPx}px2  overcoverage ${g.canvasOvercoverage}`
    );
    console.log(`  criteria ${JSON.stringify(g.criteria)}`);
    const c = record.results.realistic.geometry.sensitivityCentresConvention;
    console.log(
      `  sensitivity (PaddleOCR centres convention): ` +
        c.allRegions.map((p) => `${p.id} ${p.bestIou}`).join("  ") +
        `  criteria ${JSON.stringify(c.criteria)}`
    );
    console.log(`  wasm linear memory bytes ${JSON.stringify(record.web.memoryBytes)}  load ${record.web.sessionLoadMs} ms`);
  }
  console.log(`VERDICT ${JSON.stringify(record.verdict)}`);
}
console.log(`written: ${out}`);
process.exit(failure ? 1 : 0);
