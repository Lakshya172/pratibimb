/**
 * Track B — score the 24 cells against the shipped decode.
 *
 *   node artifacts/experiments/W1-TrackB-geometry-appearance/harness/run-trackb.mjs [--cell=geo200]
 *
 * The inference path, the decode, the NMS, the taxonomy and the quantiles are all the merged
 * W-1 harness's. This file supplies the cells and nothing that decides a number.
 *
 * V0 is used deliberately: per-class NMS at IoU 0.50, the production decode. Track B asks what
 * scale does to the detector AS IT SHIPS. Running it under V1 would answer a question about V1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname } from "node:os";
import { CELLS, SAMPLES_PER_CELL, cssPerModelOf, modelExtentUnit } from "./trackb-guards.mjs";
import {
  INPUT_DIMS, MODEL, OPERATING_POINT, OUTPUT_DIMS, VARIANTS,
  assertDevOnly, assertModelIdentity, assertOrtVersion, assertShippedConstants, assertTensor,
  assertWritablePath, clippingCeiling, quantiles, sha256Hex, taxonomy,
} from "../../W1-detector-precision-scale/harness/w1-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const LOGS = join(EXP, "logs");
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
const num = (f) => (typeof f === "number" ? f : f && typeof f.value === "number" ? f.value : Number.NaN);
const qr = (q) => (q ? Object.fromEntries(Object.entries(q).map(([k, v]) => [k, r6(v)])) : null);

const EVAL_DIST = join(ROOT, "packages/evaluation/dist/src/index.js");
const PERC_DIST = join(ROOT, "packages/perception/dist/src/index.js");
for (const p of [EVAL_DIST, PERC_DIST]) if (!existsSync(p)) refuse(`compiled package missing at ${p} (run: npm run typecheck)`);
const E = await import(pathToFileURL(EVAL_DIST).href);
const P = await import(pathToFileURL(PERC_DIST).href);
try { assertShippedConstants(P); } catch (e) { refuse(e.message); }

const modelPath = join(ROOT, "artifacts/models/t1-ui-head/t1-ui-head.onnx");
if (!existsSync(modelPath)) refuse(`the detector artifact is missing at ${modelPath}`);
const modelBytes = new Uint8Array(readFileSync(modelPath));
try { assertModelIdentity(modelBytes); } catch (e) { refuse(e.message); }

const ortMod = await import("onnxruntime-web");
const ort = ortMod.default ?? ortMod;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = "error";
try { assertOrtVersion(ort.env.versions && ort.env.versions.web, "onnxruntime-web in Node"); } catch (e) { refuse(e.message); }
const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

// V0 — the shipped decode. Asserted, not assumed.
const V0 = VARIANTS[0];
if (V0.id !== "V0" || V0.kind !== "per-class" || V0.nmsIou !== 0.5) {
  refuse(`the shipped variant is not what Track B pre-registered: ${JSON.stringify(V0)}`);
}

assertWritablePath(ROOT, LOGS);
mkdirSync(LOGS, { recursive: true });
const only = (process.argv.find((a) => a.startsWith("--cell=")) || "").slice(7) || null;
const cells = only ? CELLS.filter((c) => c.id === only) : CELLS;
if (!cells.length) refuse(`unknown cell ${only}`);

const cellResults = [];
for (const cell of cells) {
  const dir = join(GEN, cell.id);
  const mPath = join(dir, "manifest.json");
  const dPath = join(dir, "decode.json");
  const cPath = join(dir, "cell.json");
  if (!existsSync(mPath)) refuse(`${cell.id}: no manifest (run render-trackb.mjs)`);
  if (!existsSync(dPath)) refuse(`${cell.id}: no decode.json (run decode-trackb.py)`);
  const meta = JSON.parse(readFileSync(cPath, "utf8"));
  if (cell.family === "APPR" && !meta.appearanceApplied) {
    refuse(`${cell.id}: APPR cell has not had its appearance transform applied (run apply-appearance.py)`);
  }
  if (cell.family !== "APPR" && meta.appearanceApplied) {
    refuse(`${cell.id}: a ${cell.family} cell must not carry an appearance transform`);
  }

  const ds = JSON.parse(readFileSync(mPath, "utf8"));
  E.validateDataset(ds);
  const dev = ds.samples.filter((s) => s.split === "dev");
  if (dev.length !== SAMPLES_PER_CELL) refuse(`${cell.id}: ${dev.length} dev samples, expected ${SAMPLES_PER_CELL}`);
  try { assertDevOnly(dev, `track B ${cell.id}`); } catch (e) { refuse(e.message); }
  const decode = JSON.parse(readFileSync(dPath, "utf8"));
  if (decode.datasetHash !== ds.hash) refuse(`${cell.id}: decode.json is for ${decode.datasetHash}, manifest is ${ds.hash}`);

  const cap = cell.capture;
  const lb = P.computeLetterbox(cap, P.HEAD_CONTRACT.inputSize);
  const cssScale = cell.viewport.w / cap.w; // 1 for NAT/APPR, k for GEOM
  const cssPerModel = cssPerModelOf(cell);

  const preds = [];
  const rows = [];
  for (const s of dev) {
    const d = decode.samples.find((x) => x.id === s.id);
    if (!d) refuse(`${s.id}: no decode record`);
    const rgba = readFileSync(join(dir, "rgba", `${s.id}.rgba`));
    if (sha256Hex(rgba) !== d.rgbaSha256) refuse(`${s.id}: RGBA digest mismatch`);
    if (rgba.length !== s.captureSize.w * s.captureSize.h * 4) refuse(`${s.id}: RGBA length mismatch`);

    const pre = P.preprocessToTensor({ width: s.captureSize.w, height: s.captureSize.h, rgba: new Uint8Array(rgba) }, P.HEAD_CONTRACT);
    try { assertTensor(INPUT_DIMS, pre.tensor, INPUT_DIMS, `${s.id} input`); } catch (e) { refuse(e.message); }
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", pre.tensor, INPUT_DIMS) });
    const o = res[session.outputNames[0]];
    const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
    try { assertTensor(Array.from(o.dims), data, OUTPUT_DIMS, `${s.id} output`); } catch (e) { refuse(e.message); }

    const dec = P.decodeHeadOutput({ data, dims: Array.from(o.dims) });
    if (!dec.ok) refuse(`${s.id}: the shipped decode refused with ${dec.code}`);
    const dets = P.projectToCapture(dec.value, lb);
    const mine = dets
      .map((x) => ({
        sampleId: s.id,
        cls: x.label,
        box: { x: x.box.x * cssScale, y: x.box.y * cssScale, w: x.box.w * cssScale, h: x.box.h * cssScale },
        confidence: x.score,
        frameId: s.id,
        modelId: MODEL.modelId,
        revision: MODEL.revision,
      }))
      .filter((p) => p.confidence >= OPERATING_POINT);
    preds.push(...mine);
    rows.push({
      id: s.id,
      seed: s.provenance.seed,
      annotations: s.annotations.length,
      predictionsAtOperatingPoint: mine.length,
      rgbaSha256: d.rgbaSha256,
      tensorSha256: sha256Hex(Buffer.from(pre.tensor.buffer, pre.tensor.byteOffset, pre.tensor.byteLength)),
      outputSha256: sha256Hex(Buffer.from(data.buffer, data.byteOffset, data.byteLength)),
    });
  }

  const ev = E.evaluate(ds, preds, "dev", {
    datasetName: ds.name,
    datasetVersion: ds.version,
    datasetHash: ds.hash,
    split: "dev",
    modelId: MODEL.modelId,
    modelRevision: MODEL.revision,
    backend: "wasm",
    browser: `node ${process.version}`,
    preprocessing: "shipped preprocessToTensor: rasterLetterbox to 640 square, BILINEAR, centred pad 114/255, RGB, /255",
    evaluatedAt: new Date().toISOString(),
  });

  const predsBySample = new Map();
  for (const p of preds) {
    if (!predsBySample.has(p.sampleId)) predsBySample.set(p.sampleId, []);
    predsBySample.get(p.sampleId).push(p);
  }
  const tx = taxonomy(dev.map((s) => ({ ...s, cssPerModel })), predsBySample);

  const fpTotal = tx.fp.duplicate + tx.fp.classConfusion + tx.fp.localization + tx.fp.spurious;

  cellResults.push({
    cell: cell.id,
    family: cell.family,
    k: cell.k,
    viewport: cell.viewport,
    dpr: cell.dpr,
    captureSize: cap,
    appearance: cell.appearance,
    cssPerModelPx: r6(cssPerModel),
    modelExtentUnit: r6(modelExtentUnit(cell)),
    datasetHash: ds.hash,
    samples: dev.length,
    groundTruth: dev.reduce((a, s) => a + s.annotations.length, 0),
    clippingCeiling: r6(clippingCeiling(dev)),
    mAP50: r6(num(ev.mAP50)),
    elementRecall: r6(num(ev.elementRecall)),
    groundingAccuracy: r6(num(ev.groundingAccuracy)),
    predictionsPerScreen: r6(preds.length / dev.length),
    // Both distributions come from the governed taxonomy(), exactly as arm B reports them.
    matchedIou: qr(quantiles(tx.matchedIou)),
    normalisedDisplacement: qr(quantiles(tx.normDisp)),
    falsePositives: fpTotal,
    falsePositiveTaxonomy: tx.fp,
    falseNegativeTaxonomy: tx.fn,
    rows,
  });

  const c = cellResults[cellResults.length - 1];
  console.log(
    `${cell.id.padEnd(7)} ${cell.family.padEnd(5)} k=${String(cell.k).padEnd(5)} ` +
    `mAP ${c.mAP50.toFixed(4)} rec ${c.elementRecall.toFixed(4)} gnd ${c.groundingAccuracy.toFixed(4)} ` +
    `IoU p10 ${String(c.matchedIou ? c.matchedIou.p10 : "-").padEnd(8)} med ${String(c.matchedIou ? c.matchedIou.median : "-").padEnd(8)} ` +
    `p/s ${String(c.predictionsPerScreen).padEnd(7)} FP ${c.falsePositives}`
  );
}

const out = {
  experiment: "W1-TrackB-geometry-appearance",
  runAt: new Date().toISOString(),
  machine: { hostname: hostname(), node: process.version },
  model: MODEL,
  ort: { version: ort.env.versions && ort.env.versions.web, backend: "wasm", numThreads: 1, proxy: false },
  decode: { variant: V0, operatingPoint: OPERATING_POINT, note: "the SHIPPED decode; V1 is not used anywhere in Track B" },
  samplesPerCell: SAMPLES_PER_CELL,
  cells: cellResults,
};
writeFileSync(join(LOGS, "trackb-cells.json"), `${JSON.stringify(out, null, 1)}\n`);
console.log(`\nwrote ${join(LOGS, "trackb-cells.json")} (${cellResults.length} cells)`);
