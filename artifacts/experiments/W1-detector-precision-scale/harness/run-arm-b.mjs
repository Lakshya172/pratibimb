/**
 * W-1 arm B — is the C4 collapse driven by object scale in model space?
 *
 *   node artifacts/experiments/W1-detector-precision-scale/harness/run-arm-b.mjs [--cell=s300]
 *
 * Ten cells, 20 shared seeds each, the SHIPPED path end to end: the exact artifact, ORT Web
 * 1.29.0 on WASM in Node, the shipped preprocessing, the shipped decode, the shipped
 * continuous inverse, the frozen evaluator, the frozen operating point 0.55.
 *
 * What makes this a scale experiment rather than another capture-size experiment: the
 * annotation set is IDENTICAL across the eight scale cells (417 annotations per seed set),
 * so only the objects' size in model space changes. t300/t400 are the emptiness control.
 *
 * The statistics are the ones C3 lacked: the full matched-IoU distribution rather than its
 * minimum, which the matcher pins at 0.5 by construction; displacement normalised by target
 * size rather than raw CSS px, which large elements dominate; and recall bucketed by
 * MODEL-space object size, which is the direct test of the stride-8 hypothesis.
 *
 * Nothing here may define a production capture limit, justify a retrain, or close item 11.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hostname } from "node:os";
import {
  CELLS, EXPERIMENT, INPUT_DIMS, MODEL, OPERATING_POINT, OUTPUT_DIMS, SAMPLES_PER_CELL,
  assertCellDataset, assertDevOnly, assertModelIdentity, assertOrtVersion,
  assertShippedConstants, assertTensor, assertWritablePath, captureSizeFor, clippingCeiling,
  cssPerModelOf, quantiles, sha256Hex, taxonomy,
} from "./w1-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const LOGS = join(EXP, "logs");
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const num = (f) => (typeof f === "number" ? f : f && typeof f.value === "number" ? f.value : Number.NaN);
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
const qr = (q) => (q ? Object.fromEntries(Object.entries(q).map(([k, v]) => [k, r6(v)])) : null);
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
};

for (const p of ["packages/perception/dist/src/index.js", "packages/evaluation/dist/src/index.js"]) {
  if (!existsSync(join(ROOT, p))) refuse(`missing ${p} (run: npm run typecheck)`);
}
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const E = await import(pathToFileURL(join(ROOT, "packages/evaluation/dist/src/index.js")).href);
let shipped;
try { shipped = assertShippedConstants(P); } catch (e) { refuse(e.message); }

const modelBytes = readFileSync(join(ROOT, MODEL.path));
try { assertModelIdentity(modelBytes); } catch (e) { refuse(e.message); }

const ortMod = await import("onnxruntime-web");
const ort = ortMod.default ?? ortMod;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.logLevel = "error";
try { assertOrtVersion(ort.env.versions && ort.env.versions.web, "onnxruntime-web in Node"); } catch (e) { refuse(e.message); }
const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });

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
  if (!existsSync(mPath)) refuse(`${cell.id}: no manifest (run render-arm-b.mjs)`);
  if (!existsSync(dPath)) refuse(`${cell.id}: no decode.json (run decode-w1-png.py)`);
  const ds = JSON.parse(readFileSync(mPath, "utf8"));
  E.validateDataset(ds);
  let dev;
  try { dev = assertCellDataset(ds, cell); } catch (e) { refuse(e.message); }
  try { assertDevOnly(dev, `arm B ${cell.id}`); } catch (e) { refuse(e.message); }
  const decode = JSON.parse(readFileSync(dPath, "utf8"));
  if (decode.datasetHash !== ds.hash) refuse(`${cell.id}: decode.json is for ${decode.datasetHash}, manifest is ${ds.hash}`);

  const ratio = cssPerModelOf(cell);
  if (Math.abs(ratio - cell.cssPerModel) > 1e-9) refuse(`${cell.id}: ratio ${ratio} is not the pre-registered ${cell.cssPerModel}`);
  const cap = captureSizeFor(cell);
  const lb = P.computeLetterbox(cap, P.HEAD_CONTRACT.inputSize);
  const cssScale = cell.viewport.w / cap.w;

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
      evaluatable: s.annotations.filter((a) => a.visibility !== "OFFSCREEN").length,
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
  // cssPerModel travels with the sample so the size buckets are in MODEL space
  const tx = taxonomy(dev.map((s) => ({ ...s, cssPerModel: cell.cssPerModel })), predsBySample);

  /**
   * Per-annotation hit record, so the stride-8 test can be read PAIRED.
   *
   * `recallByModelSize` buckets objects by their size in model space, which is the
   * pre-registered statistic — but the population inside a bucket is not the same set of
   * objects from cell to cell, because raising the scale moves every object into a smaller
   * bucket. This record carries each annotation's identity, so the same physical control can
   * be followed across cells and the population confound disappears.
   */
  const annotationHits = [];
  for (const s of dev) {
    const gts = s.annotations.filter((a) => a.visibility !== "OFFSCREEN");
    const mine = (predsBySample.get(s.id) || []).slice().sort((a, b) => b.confidence - a.confidence);
    const claimed = new Set();
    const hitOf = new Map();
    for (const p of mine) {
      let bestJ = -1;
      let bestV = 0.5;
      for (let j = 0; j < gts.length; j += 1) {
        if (claimed.has(j) || gts[j].cls !== p.cls) continue;
        const v = iou(p.box, gts[j].box);
        if (v >= bestV) { bestV = v; bestJ = j; }
      }
      if (bestJ >= 0) { claimed.add(bestJ); hitOf.set(bestJ, bestV); }
    }
    for (let j = 0; j < gts.length; j += 1) {
      const g = gts[j];
      annotationHits.push({
        sampleId: s.id,
        seed: s.provenance.seed,
        index: j,
        cls: g.cls,
        cssShortSide: r6(Math.min(g.box.w, g.box.h)),
        modelShortSide: r6(Math.min(g.box.w, g.box.h) / cell.cssPerModel),
        hit: hitOf.has(j),
        iou: hitOf.has(j) ? r6(hitOf.get(j)) : null,
      });
    }
  }
  const ceiling = clippingCeiling(dev);
  const fpTotal = tx.fp.duplicate + tx.fp.classConfusion + tx.fp.localization + tx.fp.spurious;

  cellResults.push({
    cell: cell.id,
    viewport: cell.viewport,
    captureSize: cap,
    dpr: 1,
    tiled: cell.tiled,
    cssPerModelPx: cell.cssPerModel,
    datasetHash: ds.hash,
    samples: dev.length,
    groundTruth: tx.totalGt,
    clippingCeiling: { ...ceiling, ceiling: r6(ceiling.ceiling) },
    mAP50: r6(num(ev.mAP50)),
    elementRecall: r6(num(ev.elementRecall)),
    groundingAccuracy: r6(num(ev.groundingAccuracy)),
    predictions: preds.length,
    predictionsPerScreen: r6(preds.length / dev.length),
    matched: tx.matchedGt,
    falsePositives: fpTotal,
    falsePositiveTaxonomy: tx.fp,
    falsePositiveShare: fpTotal ? Object.fromEntries(Object.entries(tx.fp).map(([k, v]) => [k, r6(v / fpTotal)])) : null,
    falseNegativeTaxonomy: tx.fn,
    matchedIou: qr(quantiles(tx.matchedIou)),
    normalisedDisplacement: qr(quantiles(tx.normDisp)),
    recallByModelSize: Object.fromEntries(Object.entries(tx.bySize).map(([k, [hit, n]]) => [k, { hit, n, recall: r6(hit / n) }])),
    perClassRecall: Object.fromEntries(ev.perClass.filter((c) => c.groundTruth > 0).map((c) => [c.cls, r6(num(c.recall))])),
    annotationHits,
    rows,
  });
  const r = cellResults[cellResults.length - 1];
  console.log(`${cell.id}  ${cell.cssPerModel.toFixed(2)} css/model  mAP ${r.mAP50.toFixed(4)}  recall ${r.elementRecall.toFixed(4)}  grounding ${r.groundingAccuracy.toFixed(4)}  preds/screen ${r.predictionsPerScreen.toFixed(2)}  medIoU ${r.matchedIou ? r.matchedIou.median.toFixed(4) : "n/a"}  normDisp(med) ${r.normalisedDisplacement ? r.normalisedDisplacement.median.toFixed(4) : "n/a"}`);
}

const scaleCells = cellResults.filter((c) => !c.tiled);

/**
 * The control, enforced rather than asserted in prose: every scale cell must carry the SAME
 * ground truth. Identical annotation count, identical class histogram, identical CSS boxes.
 * If that ever stops holding, the cells are no longer a scale series and the comparison is
 * void, so this refuses instead of reporting.
 */
if (scaleCells.length > 1) {
  const fingerprint = (c) =>
    JSON.stringify(
      c.annotationHits
        .map((a) => [a.seed, a.index, a.cls, a.cssShortSide])
        .sort((p, q) => p[0] - q[0] || p[1] - q[1])
    );
  const base = scaleCells[0];
  const want = fingerprint(base);
  for (const c of scaleCells.slice(1)) {
    if (c.groundTruth !== base.groundTruth) refuse(`${c.cell}: ${c.groundTruth} ground-truth objects, ${base.cell} has ${base.groundTruth} — the cells are not a scale series`);
    if (fingerprint(c) !== want) refuse(`${c.cell}: the ground-truth set differs from ${base.cell} — only model-space scale may vary`);
  }
  console.log(`
ground truth identical across all ${scaleCells.length} scale cells: ${base.groundTruth} objects, every one VISIBLE`);
}
const ref = scaleCells.find((c) => c.cell === "s150") ?? scaleCells[0];
const vsRef = ref
  ? scaleCells.map((c) => ({
      cell: c.cell,
      cssPerModelPx: c.cssPerModelPx,
      dMAP50: r6(c.mAP50 - ref.mAP50),
      dRecall: r6(c.elementRecall - ref.elementRecall),
      dGrounding: r6(c.groundingAccuracy - ref.groundingAccuracy),
    }))
  : [];
const monotone = (key) => {
  const v = scaleCells.slice().sort((a, b) => a.cssPerModelPx - b.cssPerModelPx).map((c) => c[key]);
  let nonIncreasing = true;
  for (let i = 1; i < v.length; i += 1) if (v[i] > v[i - 1] + 1e-9) nonIncreasing = false;
  return { series: v, nonIncreasingInScale: nonIncreasing };
};
const controls = ["t300", "t400"].map((id) => {
  const t = cellResults.find((c) => c.cell === id);
  const twin = cellResults.find((c) => c.cell === id.replace("t", "s"));
  if (!t || !twin) return null;
  return {
    control: id,
    twin: twin.cell,
    cssPerModelPx: t.cssPerModelPx,
    dMAP50: r6(t.mAP50 - twin.mAP50),
    dRecall: r6(t.elementRecall - twin.elementRecall),
    dGrounding: r6(t.groundingAccuracy - twin.groundingAccuracy),
  };
}).filter(Boolean);

/**
 * The paired stride-8 read: follow the annotations that s150 FOUND, and report how that exact
 * set fares at each higher scale, bucketed by the model-space size those same objects have
 * there. Same objects throughout, so nothing is explained by a change of population.
 */
const keyOf = (a) => `${a.seed}#${a.index}#${a.cls}`;
const pairedStrideTest = (() => {
  const base = scaleCells.find((c) => c.cell === "s150");
  if (!base) return null;
  const foundAtBase = new Set(base.annotationHits.filter((a) => a.hit).map(keyOf));
  const bucketOf = (m) => (m < 4 ? "model<4px" : m < 8 ? "model 4-8px" : m < 16 ? "model 8-16px" : "model>=16px");
  return scaleCells.map((c) => {
    const subset = c.annotationHits.filter((a) => foundAtBase.has(keyOf(a)));
    const byBucket = {};
    for (const a of subset) {
      const k = bucketOf(a.modelShortSide);
      byBucket[k] = byBucket[k] || [0, 0];
      byBucket[k][1] += 1;
      if (a.hit) byBucket[k][0] += 1;
    }
    // the same objects, still >= 16 model px here: a pure stride/anchor account predicts
    // these stay findable, because they span two or more stride-8 feature cells
    const big = subset.filter((a) => a.modelShortSide >= 16);
    return {
      cell: c.cell,
      cssPerModelPx: c.cssPerModelPx,
      n: subset.length,
      stillFound: subset.filter((a) => a.hit).length,
      recallOnS150Hits: r6(subset.length ? subset.filter((a) => a.hit).length / subset.length : Number.NaN),
      byModelSizeHere: Object.fromEntries(Object.entries(byBucket).map(([k, [hit, n]]) => [k, { hit, n, recall: r6(hit / n) }])),
      atLeast16ModelPx: { n: big.length, hit: big.filter((a) => a.hit).length, recall: r6(big.length ? big.filter((a) => a.hit).length / big.length : Number.NaN) },
    };
  });
})();

const log = {
  experiment: EXPERIMENT,
  arm: "B — scale control: object scale in model space is the only intended varying quantity",
  runAt: new Date().toISOString(),
  machine: { hostname: hostname(), node: process.version },
  model: { ...MODEL, sha256Verified: sha256Hex(modelBytes) },
  ort: { version: ort.env.versions && ort.env.versions.web, backend: "wasm", numThreads: 1, proxy: false },
  shippedConstants: { ...shipped },
  operatingPoint: OPERATING_POINT,
  samplesPerCell: SAMPLES_PER_CELL,
  testSplitOpened: false,
  design: {
    annotationsIdenticalAcrossScaleCells: true,
    note: "One fixed 960x640 CSS content block in an iframe at the viewport origin. Only the surrounding viewport grows, so every CSS box is unchanged and only model-space size varies. Every annotation is VISIBLE, so the clipping ceiling is 1.0.",
  },
  cells: cellResults,
  vsLowestScale: { reference: ref ? ref.cell : null, deltas: vsRef },
  monotonicity: { mAP50: monotone("mAP50"), elementRecall: monotone("elementRecall"), groundingAccuracy: monotone("groundingAccuracy") },
  emptinessControls: controls,
  pairedStrideTest,
  notClaimed: [
    "SYNTHETIC evidence. No production capture limit may be inferred from it.",
    "This cannot close adoption item 11 and cannot justify retraining by itself.",
    "The stride-8 hypothesis is tested, not assumed: see recallByModelSize.",
  ],
};
/**
 * The per-annotation hit records are what the paired read and the cross-cell identity guard
 * consume, and there are about 61,000 of them. The aggregates they produce are kept in the
 * log; the rows themselves go to the gitignored generated/ directory, because committing them
 * would bury a readable record under fifty thousand lines of JSON anybody can reproduce.
 */
for (const c of cellResults) {
  writeFileSync(join(GEN, c.cell, "annotation-hits.json"), JSON.stringify({ cell: c.cell, cssPerModelPx: c.cssPerModelPx, hits: c.annotationHits }, null, 1));
  delete c.annotationHits;
}
writeFileSync(join(LOGS, "arm-b.json"), `${JSON.stringify(log, null, 1)}\n`);
console.log(`\nwrote ${join(LOGS, "arm-b.json")}`);
