/**
 * QG-03a-C and A3 — label/raster geometry, its metric impact, and the coordinate contract.
 *
 *   node .../harness/run-c-labels.mjs
 *
 * No model, no browser, and no held-out data:
 *   C1  the T1 training-set geometry, reproduced from its deterministic render specs
 *       (tools/dataset/build-dataset.mjs: seed 20260910, counts 120/40/40, DPR 1)
 *   C2  the WORST-CASE metric impact of the label convention, i.e. a model that learned the
 *       pixels and not the labels. Scored by the shipped evaluator on TRAIN and DEV only.
 *       The consumed TEST split is never evaluated.
 *   A3  coordinate round trips at DPR {1, 1.5, 2} x zoom {100%, 125%}, plus how common the
 *       exact-half extents that trip the rounding rule are among realistic capture sizes
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(HERE, "..", "logs");
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);
const E = await import(pathToFileURL(join(ROOT, "packages/evaluation/dist/src/index.js")).href);

const S = 640;
const PAD = 114 / 255;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
const disp = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.w - b.x - b.w), Math.abs(a.y + a.h - b.y - b.h));

// ── C1: training-set geometry ────────────────────────────────────────────────────────────
const SEED = 20260910;
const OFFSETS = { train: 0, dev: 1_000_000, test: 2_000_000 };
const COUNTS = { train: 120, dev: 40, test: 40 };
const plan = [];
for (const split of ["train", "dev", "test"]) {
  for (let i = 0; i < COUNTS[split]; i += 1) {
    const id = `${split}-${String(i).padStart(4, "0")}`;
    const seed = SEED + OFFSETS[split] + i;
    const spec = E.makeSpec(id, seed);
    plan.push({ split, id, seed, spec, cap: { w: Math.round(spec.viewport.w * 1), h: Math.round(spec.viewport.h * 1) } });
  }
}
function geometry(cap) {
  const cont = P.computeLetterbox(cap, S);
  const ras = P.rasterLetterbox(cap, S, PAD);
  const sx = ras.resizedW / cap.w;
  const sy = ras.resizedH / cap.h;
  const dPadX = cont.padX - ras.padLeft;
  const dPadY = cont.padY - ras.padTop;
  // Worst label-vs-pixel offset anywhere in the content: the offset is linear in position,
  // so it is extreme at an edge.
  const worstX = Math.max(Math.abs(dPadX), Math.abs(cap.w * (cont.scale - sx) + dPadX));
  const worstY = Math.max(Math.abs(dPadY), Math.abs(cap.h * (cont.scale - sy) + dPadY));
  const affected = worstX > 1e-9 || worstY > 1e-9;
  return { cont, ras, sx, sy, dPadX, dPadY, worstModelPx: Math.max(worstX, worstY), affected };
}
const bySplit = {};
const offsets = new Set();
const sizesSeen = new Set();
for (const p of plan) {
  p.g = geometry(p.cap);
  sizesSeen.add(`${p.cap.w}x${p.cap.h}`);
  bySplit[p.split] ??= { samples: 0, affected: 0 };
  bySplit[p.split].samples += 1;
  if (p.g.affected) {
    bySplit[p.split].affected += 1;
    offsets.add(r4(p.g.worstModelPx));
  }
}
const affectedTotal = plan.filter((p) => p.g.affected).length;

// ── C1 box-level and C2 evaluator impact (TRAIN and DEV only) ─────────────────────────────
// Box layouts come from the evaluation generator at each sample's own viewport. They are
// representative geometry, NOT the rendered DOM labels, which need the gitignored dataset.
const evalPlan = plan.filter((p) => p.split !== "test");
const samples = evalPlan.map((p) =>
  E.generateSample(p.id, p.split, p.seed, { ...E.DEFAULT_CONFIG, viewportCss: p.spec.viewport, dpr: 1, zoom: 1, density: p.spec.density })
);
// The evaluator refuses a dataset with an EMPTY split (labels.ts assertNoLeakage → EMPTY_SPLIT),
// by design. The T1 TEST split is consumed and is NOT used here, not even for its seeds. One
// placeholder test sample is generated from a seed OUTSIDE every T1 plan range, only so that
// validation passes. It is never evaluated: evaluate() below runs on "train" and "dev" only.
const PLACEHOLDER_TEST_SEED = 990_000_000;
const placeholder = E.generateSample("test-placeholder-0000", "test", PLACEHOLDER_TEST_SEED, { ...E.DEFAULT_CONFIG, dpr: 1 });
const dataset = E.sealDataset({ name: "qg03a-label-geometry", version: "1.0.0", createdAt: "2026-09-11T00:00:00.000Z", samples: [...samples, placeholder] });
const boxRows = [];
const worstPreds = [];
const perfectPreds = [];
samples.forEach((s, idx) => {
  const g = evalPlan[idx].g;
  for (const a of s.annotations) {
    if (a.visibility === "OFFSCREEN") continue;
    const b = a.box;
    // What training told the model the box was (continuous), and where its pixels actually were (raster).
    const L = { x: b.x * g.cont.scale + g.cont.padX, y: b.y * g.cont.scale + g.cont.padY, w: b.w * g.cont.scale, h: b.h * g.cont.scale };
    const Pr = { x: b.x * g.sx + g.ras.padLeft, y: b.y * g.sy + g.ras.padTop, w: b.w * g.sx, h: b.h * g.sy };
    boxRows.push({ cls: a.cls, minSideModelPx: Math.min(L.w, L.h), dispModelPx: disp(L, Pr), iou: iou(L, Pr) });
    // Worst case: the model outputs the PIXEL box, and the runtime inverts with the continuous
    // transform, as it does. At DPR 1 capture px are CSS px.
    const cap = P.modelToCapture(Pr, g.cont);
    const common = { sampleId: s.id, cls: a.cls, confidence: 1, frameId: s.id, modelId: "label-geometry-worst-case", revision: "n/a" };
    worstPreds.push({ ...common, box: { x: cap.x, y: cap.y, w: cap.w, h: cap.h } });
    perfectPreds.push({ ...common, box: { x: b.x, y: b.y, w: b.w, h: b.h } });
  }
});
const ctx = { modelId: "label-geometry (no model)", modelRevision: "n/a", backend: "none", browser: "node", preprocessing: "letterbox 640, PIL BILINEAR raster geometry vs continuous labels", evaluatedAt: "2026-09-11T00:00:00.000Z" };
const evalRows = [];
for (const split of ["train", "dev"]) {
  for (const [name, preds] of [["perfect (control)", perfectPreds], ["worst case: model learned pixels, not labels", worstPreds]]) {
    const r = E.evaluate(dataset, preds.filter((p) => p.sampleId.startsWith(split)), split, { ...ctx, modelId: name });
    evalRows.push({ split, predictions: name, mAP50: r4(r.mAP50.value), elementRecall: r4(r.elementRecall.value), groundingAccuracy: r4(r.groundingAccuracy.value), totals: r.totals, rejected: r.rejected });
  }
}
const buckets = [["<8", 0, 8], ["8-16", 8, 16], ["16-32", 16, 32], [">=32", 32, 1e9]];
const byBucket = buckets.map(([name, lo, hi]) => {
  const rows = boxRows.filter((b) => b.minSideModelPx >= lo && b.minSideModelPx < hi);
  if (!rows.length) return { bucket: name, boxes: 0 };
  return {
    bucket: name,
    boxes: rows.length,
    minIou: r4(Math.min(...rows.map((b) => b.iou))),
    maxDispModelPx: r4(Math.max(...rows.map((b) => b.dispModelPx))),
    fractionIouBelow075_DIAGNOSTIC: r4(rows.filter((b) => b.iou < 0.75).length / rows.length),
    fractionIouBelow090_DIAGNOSTIC: r4(rows.filter((b) => b.iou < 0.9).length / rows.length),
  };
});

// ── A3: coordinate round trips at DPR x zoom ─────────────────────────────────────────────
const VIEWPORTS = [[1280, 800], [1024, 640], [1366, 768], [1440, 900], [1280, 641], [1920, 1080]];
const rnd = E.mulberry32(20260911);
const a3 = [];
for (const [vw, vh] of VIEWPORTS) {
  for (const base of [1, 1.5, 2]) {
    for (const zoom of [1, 1.25]) {
      // Chromium semantics, recorded rather than assumed away: zoom is folded into
      // devicePixelRatio and shrinks the CSS viewport. The contract uses dpr verbatim and
      // never multiplies by zoom again.
      const dpr = base * zoom;
      const vCss = { w: Math.round(vw / zoom), h: Math.round(vh / zoom) };
      const cap = { w: Math.round(vCss.w * dpr), h: Math.round(vCss.h * dpr) };
      let consistent = true;
      let refusal = null;
      try {
        P.geometryFrom({ dpr, zoom, viewportCssWidth: vCss.w, viewportCssHeight: vCss.h, scrollX: 0, scrollY: 0, origin: "https://example.invalid" }, cap.w, cap.h);
      } catch (e) {
        consistent = false;
        refusal = e.code ?? String(e);
      }
      const scale = vCss.w / cap.w; // scaleToCss(g), as coordinates.ts computes it
      const lb = P.computeLetterbox(cap, S);
      let maxRoundTrip = 0;
      for (let i = 0; i < 200; i += 1) {
        const css = { x: rnd() * vCss.w * 0.9, y: rnd() * vCss.h * 0.9, w: 4 + rnd() * 200, h: 4 + rnd() * 60 };
        const capBox = { x: css.x / scale, y: css.y / scale, w: css.w / scale, h: css.h / scale };
        const back = P.modelToCapture(P.captureToModel(capBox, lb), lb);
        const cssBack = { x: back.x * scale, y: back.y * scale, w: back.w * scale, h: back.h * scale };
        maxRoundTrip = Math.max(maxRoundTrip, disp(css, cssBack));
      }
      const g = geometry(cap);
      a3.push({
        viewportCss: vCss,
        dpr,
        zoom,
        captureSize: cap,
        geometryAccepted: consistent,
        refusal,
        maxRoundTripErrorCssPx: maxRoundTrip,
        labelRasterWorstCssPx: r4((g.worstModelPx / lb.scale) * scale),
        exactHalfDisagreement: exactHalfDisagrees(cap),
      });
    }
  }
}
function exactHalfDisagrees(cap) {
  const s = Math.min(S / cap.w, S / cap.h);
  return [cap.w * s, cap.h * s].some((v) => v % 1 === 0.5 && Math.floor(v) % 2 === 0);
}
// Prevalence: viewports 1000..2000 x 500..1300 CSS px, at four DPRs.
const prevalence = [];
for (const dpr of [1, 1.25, 1.5, 2]) {
  let n = 0;
  let bad = 0;
  for (let w = 1000; w <= 2000; w += 1) {
    for (let h = 500; h <= 1300; h += 1) {
      n += 1;
      if (exactHalfDisagrees({ w: Math.round(w * dpr), h: Math.round(h * dpr) })) bad += 1;
    }
  }
  prevalence.push({ dpr, captureSizes: n, roundingDisagreement: bad, fraction: r4(bad / n) });
}

const out = {
  experiment: "W1-QG03a / C + A3",
  runAt: new Date().toISOString(),
  runtime: `node ${process.version}`,
  c1: {
    source: "tools/dataset/build-dataset.mjs plan (seed 20260910, counts 120/40/40, DPR 1) via makeSpec",
    samples: plan.length,
    affected: affectedTotal,
    bySplit,
    distinctWorstOffsetsModelPx: [...offsets].sort((a, b) => a - b),
    captureSizes: [...sizesSeen].sort(),
    trainingSizesWithRoundingDisagreement: [...sizesSeen].filter((s) => {
      const [w, h] = s.split("x").map(Number);
      return exactHalfDisagrees({ w, h });
    }),
  },
  c2: {
    note: "WORST CASE: predictions equal the PIXEL-true box, inverted by the continuous runtime transform. TRAIN and DEV only; TEST never evaluated.",
    placeholderTestSample: { seed: PLACEHOLDER_TEST_SEED, purpose: "satisfies the evaluator's non-empty-split rule; never evaluated; outside every T1 seed range" },
    boxes: boxRows.length,
    maxDispModelPx: r4(Math.max(...boxRows.map((b) => b.dispModelPx))),
    minIou: r4(Math.min(...boxRows.map((b) => b.iou))),
    byBucket,
    evaluator: evalRows,
  },
  a3: { rows: a3, prevalence },
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "c-labels-coords.json"), JSON.stringify(out, null, 1));
console.log(`C1 affected ${affectedTotal}/${plan.length}`, JSON.stringify(bySplit), "offsets", JSON.stringify(out.c1.distinctWorstOffsetsModelPx));
console.log("C1 training sizes:", out.c1.captureSizes.join(" "), "| rounding-disagreement sizes in training:", JSON.stringify(out.c1.trainingSizesWithRoundingDisagreement));
console.log(`C2 boxes ${boxRows.length}, max disp ${out.c2.maxDispModelPx} model px, min IoU ${out.c2.minIou}`);
for (const b of byBucket) console.log("   ", JSON.stringify(b));
for (const e of evalRows) console.log(`   ${e.split} ${e.predictions}: mAP50 ${e.mAP50} recall ${e.elementRecall} grounding ${e.groundingAccuracy} rejected ${JSON.stringify(e.rejected)}`);
for (const r of a3) console.log(`A3 ${r.viewportCss.w}x${r.viewportCss.h} dpr ${r.dpr} zoom ${r.zoom} cap ${r.captureSize.w}x${r.captureSize.h} accepted=${r.geometryAccepted} roundTrip ${r.maxRoundTripErrorCssPx.toExponential(2)} labelRasterCss ${r.labelRasterWorstCssPx} tieDisagree=${r.exactHalfDisagreement}`);
for (const p of prevalence) console.log(`prevalence dpr ${p.dpr}: ${p.roundingDisagreement}/${p.captureSizes} = ${p.fraction}`);
console.log(`wrote ${join(LOGS, "c-labels-coords.json")}`);
