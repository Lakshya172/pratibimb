/**
 * QG-03a-C3b — re-invert C3's retained raw outputs two ways. NO INFERENCE.
 *
 *   node artifacts/experiments/W1-QG03a-C3b-letterbox-inverse-attribution/harness/reinvert-c3b.mjs
 *
 * This file deliberately contains NO ONNX Runtime import and creates no session. It reads the raw
 * `.f32` outputs C3 already produced, verifies each against the digest C3 recorded, decodes each
 * ONCE with the shipped decode, and then projects the SAME detections to CSS two ways:
 *
 *   path A  continuous  clipToContent + modelToCapture with computeLetterbox   (production today)
 *   path B  raster      integer pads and per-axis scales from rasterLetterbox  (contract §6)
 *
 * Everything else is held byte-identical: same raw tensor, same decode and NMS, same detection set,
 * same score floor, same 0.55 operating point, same capture->CSS scale, same sealed datasets, same
 * DOM ground truth, same frozen evaluator.
 *
 * Refuses on: a missing or digest-mismatched raw output, a model hash or ORT record that differs
 * from C3's, an incomplete cell, a wrong tensor length, a non-finite value, a decode refusal, or any
 * write under artifacts/datasets/ or artifacts/gates/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CELLS, MODEL, OPERATING_POINT, ORT_VERSION, OUTPUT_DIMS, VIEWS,
  assertCellDataset, assertTensor, assertWritablePath, captureSizeFor, clippingCeiling,
  devSamples, matchQuality, sha256Hex,
} from "../../W1-QG03a-C3-label-raster-generalisation/harness/c3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const C3 = join(ROOT, "artifacts/experiments/W1-QG03a-C3-label-raster-generalisation");
const LOGS = join(EXP, "logs");
const EXPERIMENT = "W1-QG03a-C3b-letterbox-inverse-attribution";
const refuse = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };
const num = (f) => (typeof f === "number" ? f : f && typeof f.value === "number" ? f.value : Number.NaN);
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
const quant = (a, p) => { if (!a.length) return Number.NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

for (const p of ["packages/perception/dist/src/index.js", "packages/evaluation/dist/src/index.js"]) {
  if (!existsSync(join(ROOT, p))) refuse(`missing ${p} (run: npm run typecheck)`);
}
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const E = await import(pathToFileURL(join(ROOT, "packages/evaluation/dist/src/index.js")).href);

/**
 * Path B. The transform that matches where the pixels actually landed: integer pads and a per-axis
 * scale, composed from rasterLetterbox's own outputs so this cannot drift from the shipped
 * rasteriser. Mirrors clipToContent's clipping against the raster content box.
 */
function rasterInverse(box, r, capture) {
  const x1 = Math.max(box.x, r.padLeft);
  const y1 = Math.max(box.y, r.padTop);
  const x2 = Math.min(box.x + box.w, r.padLeft + r.resizedW);
  const y2 = Math.min(box.y + box.h, r.padTop + r.resizedH);
  if (x2 <= x1 || y2 <= y1) return null; // entirely in the padding, exactly as path A decides
  const sx = capture.w / r.resizedW;
  const sy = capture.h / r.resizedH;
  return { x: (x1 - r.padLeft) * sx, y: (y1 - r.padTop) * sy, w: (x2 - x1) * sx, h: (y2 - y1) * sy };
}

assertWritablePath(ROOT, LOGS);
mkdirSync(LOGS, { recursive: true });

const perCell = {};
for (const cell of CELLS) {
  const c3log = join(C3, "logs", `c3-${cell.id}.json`);
  const manifest = join(C3, "harness", "generated", cell.id, "manifest.json");
  if (!existsSync(c3log)) refuse(`${cell.id}: no C3 log at ${c3log}`);
  if (!existsSync(manifest)) refuse(`${cell.id}: no C3 manifest (the retained evidence is incomplete)`);
  const c3 = JSON.parse(readFileSync(c3log, "utf8"));
  const ds = JSON.parse(readFileSync(manifest, "utf8"));
  E.validateDataset(ds);
  assertCellDataset(ds, cell);
  if (c3.model.sha256 !== MODEL.sha256) refuse(`${cell.id}: C3 log records a different model`);
  if (c3.runtime.ortVersions.web !== ORT_VERSION) refuse(`${cell.id}: C3 log records ORT ${c3.runtime.ortVersions.web}`);
  if (c3.operatingPoint !== OPERATING_POINT) refuse(`${cell.id}: C3 log records operating point ${c3.operatingPoint}`);
  if (c3.dataset.hash !== ds.hash) refuse(`${cell.id}: C3 log dataset ${c3.dataset.hash} is not manifest ${ds.hash}`);

  const dev = devSamples(ds);
  const cap = captureSizeFor(cell);
  const cont = P.computeLetterbox(cap, P.HEAD_CONTRACT.inputSize);
  const rast = P.rasterLetterbox(cap, P.HEAD_CONTRACT.inputSize, P.HEAD_CONTRACT.padValue);
  const cssScale = cell.viewport.w / cap.w;

  const predsA = [];
  const predsB = [];
  const deltas = [];
  const rows = [];
  for (const s of dev) {
    const recorded = c3.rows.find((r) => r.id === s.id);
    if (!recorded) refuse(`${s.id}: not in the C3 log`);
    const rawPath = join(C3, "harness", "generated", cell.id, "raw", `${s.id}.f32`);
    if (!existsSync(rawPath)) refuse(`${s.id}: retained raw output missing — C3b may not re-run inference to replace it`);
    const buf = readFileSync(rawPath);
    if (sha256Hex(buf) !== recorded.outputSha256) refuse(`${s.id}: retained raw output does not match the digest C3 recorded`);
    const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    assertTensor(recorded.outputDims, data, OUTPUT_DIMS, `${s.id} retained output`);

    // Decoded ONCE. Both paths project the very same detections.
    const dec = P.decodeHeadOutput({ data, dims: recorded.outputDims });
    if (!dec.ok) refuse(`${s.id}: the shipped decode refused with ${dec.code}`);
    if (dec.value.length !== recorded.decoded) {
      refuse(`${s.id}: decode reproduced ${dec.value.length} detections, C3 recorded ${recorded.decoded}`);
    }

    const mk = (box, d) => ({ sampleId: s.id, cls: d.label, box: { x: box.x * cssScale, y: box.y * cssScale, w: box.w * cssScale, h: box.h * cssScale }, confidence: d.score, frameId: s.id, modelId: MODEL.modelId, revision: MODEL.revision });
    let nA = 0, nB = 0, worstDelta = 0;
    const sampleDeltas = [];
    for (const d of dec.value) {
      const clippedA = P.clipToContent(d.box, cont);
      const a = clippedA ? P.modelToCapture(clippedA, cont) : null;
      const b = rasterInverse(d.box, rast, cap);
      if (a) { predsA.push(mk(a, d)); nA += 1; }
      if (b) { predsB.push(mk(b, d)); nB += 1; }
      if (a && b) {
        const delta = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)) * cssScale;
        sampleDeltas.push(delta);
        deltas.push(delta);
        if (delta > worstDelta) worstDelta = delta;
      }
    }
    rows.push({
      id: s.id,
      seed: s.provenance.seed,
      outputSha256: recorded.outputSha256,
      decoded: dec.value.length,
      emittedContinuous: nA,
      emittedRaster: nB,
      worstInversionDeltaCssPx: r6(worstDelta),
      medianInversionDeltaCssPx: r6(quant(sampleDeltas, 0.5)),
    });
  }

  const views = {};
  for (const view of VIEWS) {
    const pick = (preds) => (view === "op055" ? preds.filter((p) => p.confidence >= OPERATING_POINT) : preds);
    const score = (preds, label) => {
      const chosen = pick(preds);
      const context = {
        modelId: MODEL.modelId,
        modelRevision: MODEL.revision,
        backend: "none",
        browser: `none (node ${process.version}; C3b re-inversion of retained outputs, no inference)`,
        preprocessing: `C3 retained raw outputs; inverse = ${label}`,
        evaluatedAt: new Date().toISOString(),
      };
      const result = E.evaluate(ds, chosen, "dev", context);
      const bySample = new Map();
      for (const p of chosen) {
        if (!bySample.has(p.sampleId)) bySample.set(p.sampleId, []);
        bySample.get(p.sampleId).push(p);
      }
      const q = matchQuality(dev, bySample);
      return {
        predictions: chosen.length,
        mAP50: r6(num(result.mAP50)),
        elementRecall: r6(num(result.elementRecall)),
        groundingAccuracy: r6(num(result.groundingAccuracy)),
        matched: q.matched,
        labels: q.labels,
        minMatchedIou: r6(q.minMatchedIou),
        worstMatchedDispCss: r6(q.worstMatchedDispCss),
      };
    };
    const A = score(predsA, "continuous (computeLetterbox, production)");
    const B = score(predsB, "raster-consistent (rasterLetterbox integers, per-axis)");
    views[view] = {
      continuous: A,
      raster: B,
      delta: {
        mAP50: r6(B.mAP50 - A.mAP50),
        elementRecall: r6(B.elementRecall - A.elementRecall),
        groundingAccuracy: r6(B.groundingAccuracy - A.groundingAccuracy),
        matched: B.matched - A.matched,
        minMatchedIou: r6(B.minMatchedIou - A.minMatchedIou),
      },
    };
  }

  const ceiling = clippingCeiling(dev);
  const log = {
    experiment: EXPERIMENT,
    cell: cell.id,
    kind: cell.kind,
    inference: "NONE — C3's retained raw outputs, digest-verified, decoded once",
    source: { c3Log: `logs/c3-${cell.id}.json`, datasetHash: ds.hash, samples: dev.length },
    model: { sha256: MODEL.sha256, revision: MODEL.revision, weightsLoaded: false },
    viewport: cell.viewport,
    dpr: cell.dpr,
    captureSize: cap,
    cssPxPerModelPx: r6(cssScale / cont.scale),
    continuousTransform: { scale: cont.scale, padX: cont.padX, padY: cont.padY, contentSize: cont.contentSize },
    rasterTransform: { scale: rast.scale, resizedW: rast.resizedW, resizedH: rast.resizedH, padLeft: rast.padLeft, padTop: rast.padTop, scaleX: r6(cap.w / rast.resizedW), scaleY: r6(cap.h / rast.resizedH) },
    clippingCeiling: ceiling,
    inversionDeltaCssPx: { detections: deltas.length, max: r6(Math.max(...deltas, 0)), p50: r6(quant(deltas, 0.5)), p95: r6(quant(deltas, 0.95)) },
    views,
    rows,
  };
  writeFileSync(join(LOGS, `c3b-${cell.id}.json`), JSON.stringify(log, null, 1));
  perCell[cell.id] = log;
  const v = views.op055;
  console.log(`${cell.id} [${cell.kind}] cap ${cap.w}x${cap.h} cssPerModel ${log.cssPxPerModelPx} | inversion delta max ${log.inversionDeltaCssPx.max} p50 ${log.inversionDeltaCssPx.p50} CSS px`);
  console.log(`    continuous: mAP ${v.continuous.mAP50} recall ${v.continuous.elementRecall} grounding ${v.continuous.groundingAccuracy} matched ${v.continuous.matched}/${v.continuous.labels}`);
  console.log(`    raster    : mAP ${v.raster.mAP50} recall ${v.raster.elementRecall} grounding ${v.raster.groundingAccuracy} matched ${v.raster.matched}/${v.raster.labels}`);
  console.log(`    delta     : mAP ${v.delta.mAP50} recall ${v.delta.elementRecall} grounding ${v.delta.groundingAccuracy}`);
}

/* ── classification, by the rule fixed in design.md ─────────────────────────────────────── */
const A_CELLS = CELLS.filter((c) => c.kind === "A").map((c) => c.id);
const B_CELLS = CELLS.filter((c) => c.kind === "B").map((c) => c.id);
const ceilRel = (r, c) => (Number.isFinite(r) && c > 0 ? r / c : Number.NaN);

const attribution = {};
for (const view of VIEWS) {
  const controlBand = (path) => ({
    mAP50: Math.min(...B_CELLS.map((id) => perCell[id].views[view][path].mAP50)),
    recallCeilingRelative: Math.min(...B_CELLS.map((id) => ceilRel(perCell[id].views[view][path].elementRecall, perCell[id].clippingCeiling.ceiling))),
    groundingAccuracy: Math.min(...B_CELLS.map((id) => perCell[id].views[view][path].groundingAccuracy)),
  });
  const bandA = controlBand("continuous");
  const bandB = controlBand("raster");
  const cells = {};
  for (const id of A_CELLS) {
    const v = perCell[id].views[view];
    const ceiling = perCell[id].clippingCeiling.ceiling;
    const gapA = { mAP50: r6(v.continuous.mAP50 - bandA.mAP50), recallCeilingRelative: r6(ceilRel(v.continuous.elementRecall, ceiling) - bandA.recallCeilingRelative), groundingAccuracy: r6(v.continuous.groundingAccuracy - bandA.groundingAccuracy) };
    const gapB = { mAP50: r6(v.raster.mAP50 - bandB.mAP50), recallCeilingRelative: r6(ceilRel(v.raster.elementRecall, ceiling) - bandB.recallCeilingRelative), groundingAccuracy: r6(v.raster.groundingAccuracy - bandB.groundingAccuracy) };
    const wasBelow = Object.values(gapA).some((d) => d < 0);
    const stillBelow = Object.values(gapB).some((d) => d < 0);
    cells[id] = { gapUnderContinuous: gapA, gapUnderRaster: gapB, belowControlsBefore: wasBelow, belowControlsAfter: stillBelow, gapClosed: wasBelow && !stillBelow };
  }
  attribution[view] = { controlBandContinuous: bandA, controlBandRaster: bandB, cells };
}

const closedAny = VIEWS.some((v) => Object.values(attribution[v].cells).some((c) => c.gapClosed));
const closedAll = VIEWS.every((v) => Object.values(attribution[v].cells).every((c) => !c.belowControlsBefore || c.gapClosed));
const maxDelta = Math.max(...CELLS.map((c) => perCell[c.id].inversionDeltaCssPx.max));
const verdict = closedAll ? "ATTRIBUTED TO LETTERBOX CONVENTION" : closedAny ? "INCONCLUSIVE" : "NOT ATTRIBUTED TO LETTERBOX CONVENTION";

const scalePattern = CELLS.map((c) => ({ cell: c.id, cssPxPerModelPx: perCell[c.id].cssPxPerModelPx, mAP50continuous: perCell[c.id].views.op055.continuous.mAP50, mAP50raster: perCell[c.id].views.op055.raster.mAP50 }))
  .sort((x, y) => x.cssPxPerModelPx - y.cssPxPerModelPx);

const out = {
  experiment: EXPERIMENT,
  runAt: new Date().toISOString(),
  inference: "NONE — re-inversion of C3's retained raw outputs only",
  question: "does the label/raster inverse convention explain C3's degradation?",
  classificationRule: "design.md: ATTRIBUTED if switching to the raster inverse closes the A-versus-control gaps; NOT ATTRIBUTED if the gaps survive and the per-detection inversion delta bounds the effect; INCONCLUSIVE otherwise",
  heldIdentical: ["retained raw outputs (digest-verified)", "decodeHeadOutput + NMS (run once, shared)", "detection set", "score floor 0.25", "operating point 0.55", "capture->CSS scale", "sealed datasets and DOM ground truth", "frozen evaluator incl. CLIPPED"],
  onlyChanged: "the inverse letterbox: continuous computeLetterbox vs raster-consistent rasterLetterbox integers with per-axis scales",
  maxInversionDeltaCssPx: r6(maxDelta),
  cells: Object.fromEntries(Object.entries(perCell).map(([id, l]) => [id, { kind: l.kind, captureSize: l.captureSize, dpr: l.dpr, cssPxPerModelPx: l.cssPxPerModelPx, inversionDeltaCssPx: l.inversionDeltaCssPx, clippingCeiling: l.clippingCeiling, views: l.views, rasterTransform: l.rasterTransform }])),
  attribution,
  scalePattern,
  verdict,
  closesQg03aC: false,
  retrainingJustified: false,
  note: "C3b attributes a cause; it cannot produce a C3 PASS and does not restate C3's criterion. QG-03a-C stays CONDITIONAL.",
};
writeFileSync(join(LOGS, "metrics.json"), JSON.stringify(out, null, 1));

console.log(`\nmax inversion delta across all cells: ${out.maxInversionDeltaCssPx} CSS px`);
console.log("scale pattern (ascending CSS px per model px):");
for (const s of scalePattern) console.log(`  ${s.cell}: ${s.cssPxPerModelPx} -> mAP continuous ${s.mAP50continuous}, raster ${s.mAP50raster}`);
for (const view of VIEWS) {
  console.log(`\nview ${view}:`);
  for (const [id, c] of Object.entries(attribution[view].cells)) {
    console.log(`  ${id}: belowControls before=${c.belowControlsBefore} after=${c.belowControlsAfter} closed=${c.gapClosed} | gapContinuous ${JSON.stringify(c.gapUnderContinuous)} gapRaster ${JSON.stringify(c.gapUnderRaster)}`);
  }
}
console.log(`\nC3b VERDICT: ${verdict}`);
console.log(`retraining justified by this: ${out.retrainingJustified} | closes QG-03a-C: ${out.closesQg03aC}`);
process.exit(verdict === "INCONCLUSIVE" ? 5 : 0);
