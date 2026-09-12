/**
 * QG-03a-C3 — the shipped inference path, per cell, scored by the frozen evaluator.
 *
 *   node artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness/run-c3.mjs [--cell=a1]
 *
 * Per sample, exactly the production chain and nothing substituted for it:
 *
 *   RGBA (Pillow-decoded PNG)
 *     -> preprocessToTensor   shipped; rasterLetterbox inside
 *     -> ORT Web 1.29.0 WASM in Node, numThreads 1
 *     -> decodeHeadOutput     shipped; 0.25 floor, per-class greedy NMS at IoU 0.5, cap 300
 *     -> projectToCapture     shipped; continuous computeLetterbox inverse
 *     -> x (viewportCss.w / captureSize.w) -> CSS
 *
 * Then the FROZEN evaluator scores those CSS boxes against the DOM-derived labels, at the two
 * pre-registered views (primary 0.55, plus the shipped 0.25 floor). No sweeping, no tuning, no
 * evaluator change, and the CLIPPED definition is untouched — its ceiling is reported instead.
 *
 * Refuses on: model identity, ORT version, shipped-constant drift, tensor shape, non-finite
 * outputs, missing or mismatched RGBA digests, incomplete sample metadata, a decode refusal, or a
 * dataset that is not this cell's own sealed dataset.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CELLS, EXPERIMENT, INPUT_DIMS, MODEL, OPERATING_POINT, OUTPUT_DIMS, VIEWS,
  assertCellDataset, assertModelIdentity, assertOrtVersion, assertShippedConstants, assertTensor,
  captureSizeFor, clippingCeiling, devSamples, isTrainingGeometry, matchQuality, sha256Hex,
} from "./c3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const LOGS = join(EXP, "logs");
const only = (process.argv.find((a) => a.startsWith("--cell=")) || "").slice(7) || null;
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const num = (f) => (typeof f === "number" ? f : f && typeof f.value === "number" ? f.value : Number.NaN);
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

for (const p of ["packages/perception/dist/src/index.js", "packages/evaluation/dist/src/index.js"]) {
  if (!existsSync(join(ROOT, p))) refuse(`missing ${p} (run: npm run typecheck)`);
}
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const E = await import(pathToFileURL(join(ROOT, "packages/evaluation/dist/src/index.js")).href);
const shipped = assertShippedConstants(P);

const modelBytes = readFileSync(join(ROOT, MODEL.path));
assertModelIdentity(modelBytes);

const ortMod = await import("onnxruntime-web");
const ort = ortMod.default ?? ortMod;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = "error";
assertOrtVersion(ort.env.versions && ort.env.versions.web, "onnxruntime-web in Node");
const tSession = Date.now();
const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
const sessionCreateMs = Date.now() - tSession;

mkdirSync(LOGS, { recursive: true });
const cells = only ? CELLS.filter((c) => c.id === only) : CELLS;
if (!cells.length) refuse(`unknown cell ${only}`);

for (const cell of cells) {
  const dir = join(GEN, cell.id);
  const mPath = join(dir, "manifest.json");
  const dPath = join(dir, "decode.json");
  if (!existsSync(mPath)) refuse(`${cell.id}: no manifest (run render-c3.mjs)`);
  if (!existsSync(dPath)) refuse(`${cell.id}: no decode.json (run decode-c3-png.py)`);
  const ds = JSON.parse(readFileSync(mPath, "utf8"));
  const decode = JSON.parse(readFileSync(dPath, "utf8"));
  E.validateDataset(ds);
  assertCellDataset(ds, cell);
  if (decode.datasetHash !== ds.hash) refuse(`${cell.id}: decode.json was produced for dataset ${decode.datasetHash}, manifest is ${ds.hash}`);
  const specs = JSON.parse(readFileSync(join(dir, "specs.json"), "utf8"));

  const cap = captureSizeFor(cell);
  const lb = P.computeLetterbox(cap, P.HEAD_CONTRACT.inputSize);
  const cssScale = cell.viewport.w / cap.w;
  const rawDir = join(dir, "raw");
  mkdirSync(rawDir, { recursive: true });

  // dev only: the placeholders exist for the frozen validator and are never evaluated.
  const dev = devSamples(ds);
  const rows = [];
  const predsAll = [];
  for (const s of dev) {
    const d = decode.samples.find((x) => x.id === s.id);
    if (!d) refuse(`${s.id}: no decode record`);
    const rgbaPath = join(dir, "rgba", `${s.id}.rgba`);
    if (!existsSync(rgbaPath)) refuse(`${s.id}: missing RGBA dump`);
    const rgba = readFileSync(rgbaPath);
    if (sha256Hex(rgba) !== d.rgbaSha256) refuse(`${s.id}: RGBA digest does not match decode.json`);
    if (rgba.length !== s.captureSize.w * s.captureSize.h * 4) refuse(`${s.id}: RGBA length does not match captureSize`);

    const t0 = Date.now();
    const pre = P.preprocessToTensor({ width: s.captureSize.w, height: s.captureSize.h, rgba: new Uint8Array(rgba) }, P.HEAD_CONTRACT);
    const preprocessMs = Date.now() - t0;
    assertTensor(INPUT_DIMS, pre.tensor, INPUT_DIMS, `${s.id} input`);
    const tensorSha256 = sha256Hex(Buffer.from(pre.tensor.buffer, pre.tensor.byteOffset, pre.tensor.byteLength));

    const t1 = Date.now();
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pre.tensor, INPUT_DIMS) });
    const inferMs = Date.now() - t1;
    const o = res[session.outputNames[0]];
    const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
    assertTensor(Array.from(o.dims), data, OUTPUT_DIMS, `${s.id} output`);
    const raw = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const outputSha256 = sha256Hex(raw);
    writeFileSync(join(rawDir, `${s.id}.f32`), raw);

    const t2 = Date.now();
    const dec = P.decodeHeadOutput({ data, dims: Array.from(o.dims) });
    if (!dec.ok) refuse(`${s.id}: the shipped decode refused with ${dec.code}`);
    const dets = P.projectToCapture(dec.value, lb);
    const decodeNmsMs = Date.now() - t2;

    const preds = dets.map((x) => ({
      sampleId: s.id,
      cls: x.label,
      box: { x: x.box.x * cssScale, y: x.box.y * cssScale, w: x.box.w * cssScale, h: x.box.h * cssScale },
      confidence: x.score,
      frameId: s.id,
      modelId: MODEL.modelId,
      revision: MODEL.revision,
    }));
    predsAll.push(...preds);

    rows.push({
      id: s.id,
      seed: s.provenance.seed,
      specSha256: (specs.specs.find((x) => x.id === s.id) || {}).specSha256 ?? null,
      viewportCss: s.viewportCss,
      dpr: s.dpr,
      captureSize: s.captureSize,
      pngSha256: d.pngSha256,
      rgbaSha256: d.rgbaSha256,
      tensorSha256,
      outputSha256,
      outputDims: Array.from(o.dims),
      nonFinite: 0,
      annotations: s.annotations.length,
      clipped: s.annotations.filter((a) => a.visibility === "CLIPPED").length,
      offscreen: s.annotations.filter((a) => a.visibility === "OFFSCREEN").length,
      decoded: dets.length,
      atOperatingPoint: preds.filter((p) => p.confidence >= OPERATING_POINT).length,
      preprocessMs,
      inferMs,
      decodeNmsMs,
    });
    process.stdout.write(`  ${s.id}: ${dets.length} decoded, ${rows[rows.length - 1].atOperatingPoint} at ${OPERATING_POINT}\n`);
  }

  const context = {
    modelId: MODEL.modelId,
    modelRevision: MODEL.revision,
    backend: "wasm",
    browser: `none (node ${process.version}, onnxruntime-web ${ort.env.versions.web} wasm EP)`,
    preprocessing: "shipped preprocessToTensor: rasterLetterbox to 640 square, BILINEAR, centred pad 114/255, RGB, /255",
    evaluatedAt: new Date().toISOString(),
  };

  const views = {};
  for (const view of VIEWS) {
    const preds = view === "op055" ? predsAll.filter((p) => p.confidence >= OPERATING_POINT) : predsAll;
    const result = E.evaluate(ds, preds, "dev", context);
    const bySample = new Map();
    for (const p of preds) {
      if (!bySample.has(p.sampleId)) bySample.set(p.sampleId, []);
      bySample.get(p.sampleId).push(p);
    }
    const q = matchQuality(dev, bySample);
    views[view] = {
      predictions: preds.length,
      mAP50: r6(num(result.mAP50 ?? result.elementMap50 ?? result.map50)),
      elementRecall: r6(num(result.elementRecall ?? result.recall)),
      groundingAccuracy: r6(num(result.groundingAccuracy ?? result.grounding)),
      minMatchedIou: r6(q.minMatchedIou),
      worstMatchedDispCss: r6(q.worstMatchedDispCss),
      matched: q.matched,
      labels: q.labels,
      smallestMatchedLabelPx: r6(q.smallestMatchedLabelPx),
      rejections: result.rejections ?? null,
    };
  }

  const log = {
    experiment: EXPERIMENT,
    cell: cell.id,
    kind: cell.kind,
    note: cell.note,
    trainingGeometry: isTrainingGeometry(cell),
    runAt: new Date().toISOString(),
    machine: { hostname: (await import("node:os")).hostname(), node: process.version },
    dataset: { name: ds.name, version: ds.version, hash: ds.hash, samples: dev.length, placeholdersNeverEvaluated: ds.samples.length - dev.length },
    viewport: cell.viewport,
    dpr: cell.dpr,
    captureSize: cap,
    cssScale,
    letterbox: { scale: lb.scale, padX: lb.padX ?? lb.offsetX ?? null, padY: lb.padY ?? lb.offsetY ?? null },
    model: { path: MODEL.path, bytes: MODEL.bytes, sha256: MODEL.sha256, modelId: MODEL.modelId, revision: MODEL.revision },
    runtime: { ortVersions: JSON.parse(JSON.stringify(ort.env.versions)), executionProvider: "wasm", numThreads: 1, sessionCreateMs },
    shippedConstants: shipped,
    operatingPoint: OPERATING_POINT,
    decoder: decode.decoder,
    clippingCeiling: clippingCeiling(dev),
    views,
    rows,
  };
  writeFileSync(join(LOGS, `c3-${cell.id}.json`), JSON.stringify(log, null, 1));
  const v = views.op055;
  console.log(`${cell.id} [${cell.kind}] ${cell.viewport.w}x${cell.viewport.h}@${cell.dpr} -> op055: mAP ${v.mAP50} recall ${v.elementRecall} grounding ${v.groundingAccuracy} | minIoU ${v.minMatchedIou} worstDisp ${v.worstMatchedDispCss} CSS px | ceiling ${r6(log.clippingCeiling.ceiling)}`);
}
console.log(`\nwrote per-cell logs to logs/ (session create ${sessionCreateMs} ms)`);
