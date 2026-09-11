/**
 * QG-03a-B — inference-noise / NMS ordering stability, on the SHIPPED decode.
 *
 *   node .../harness/run-b-nms.mjs
 *
 * No model is used. The T1 artifact is gitignored and absent on workstation 2, and QG-03a
 * forbids regenerating it. Every case is a constructed [1, 12, A] head output, fed to
 * decodeHeadOutput() from packages/perception/dist, which is the code that ships.
 *
 * Three parts:
 *   B1  a minimal pair: the smallest input that reproduces a survivor swap
 *   B2  each candidate mechanism isolated in its own minimal construction
 *   B3  a realistic dense synthetic scene under iid output noise, 1e-9 .. 1e-4, measured
 *       both by the historical QG-03b-2a matcher and by grounding-relevant properties
 *
 * Plus one clearly labelled DIAGNOSTIC-ONLY variant of the post-processing, which is not
 * shipped and not proposed for adoption here.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(HERE, "..", "logs");
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);

const C = P.UI_CLASSES.length;
const T = P.PROVISIONAL_THRESHOLDS;
// A 1280x800 capture at DPR 1 letterboxes at scale 0.5, so 1 model px = 2 CSS px. Every CSS
// figure in this file uses that conversion, and says so.
const CSS_PER_MODEL = 2;
const EPS = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4];
const OBSERVED_BACKEND_SCORE_DELTA = 2.563e-6; // W1-QG03b-2a saturation-control.json, observed

// ── helpers ──────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rnd) {
  const u = Math.max(rnd(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}
function tensor(anchors) {
  const A = anchors.length;
  const data = new Float64Array((4 + C) * A);
  anchors.forEach((a, i) => {
    data[i] = a.cx;
    data[A + i] = a.cy;
    data[2 * A + i] = a.w;
    data[3 * A + i] = a.h;
    for (let c = 0; c < C; c += 1) data[(4 + c) * A + i] = a.scores[c] ?? 0.01;
  });
  return { data, dims: [1, 4 + C, A] };
}
const toF32 = (t) => ({ data: Float32Array.from(t.data), dims: t.dims });
function decode(t) {
  const r = P.decodeHeadOutput(t);
  if (!r.ok) throw new Error(`${r.code}: ${r.detail}`);
  return r.value;
}
function scores(pairs) {
  const s = new Array(C).fill(0.01);
  for (const [c, v] of pairs) s[c] = v;
  return s;
}
function iou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
}
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const inside = (p, b) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const disp = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
const key = (d) => `${d.label}|${d.box.x}|${d.box.y}|${d.box.w}|${d.box.h}`;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** The QG-03b-2a matcher, reproduced exactly (greedy per reference, IoU >= 0.5, same label, last-best wins). */
function historicalMatch(ref, got) {
  const used = new Set();
  let worst = 0;
  let matched = 0;
  for (const rb of ref) {
    let bestJ = -1;
    let bestI = 0.5;
    got.forEach((g, j) => {
      if (used.has(j) || g.label !== rb.label) return;
      const v = iou(rb.box, g.box);
      if (v >= bestI) {
        bestI = v;
        bestJ = j;
      }
    });
    if (bestJ >= 0) {
      used.add(bestJ);
      matched += 1;
      worst = Math.max(worst, disp(rb.box, got[bestJ].box));
    }
  }
  return { matched, worstModelPx: worst, worstCssPx: worst * CSS_PER_MODEL };
}

// ── B1: the minimal pair ─────────────────────────────────────────────────────────────────
const A0 = { cx: 200, cy: 200, w: 140, h: 40 };
const B0 = { cx: 240, cy: 200, w: 140, h: 40 };
const boxOf = (a) => ({ x: a.cx - a.w / 2, y: a.cy - a.h / 2, w: a.w, h: a.h });
const pairIou = iou(boxOf(A0), boxOf(B0));
const DELTAS = [-1e-4, -1e-5, -1e-6, -1e-7, -1e-8, -1e-9, 0, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4];
const b1 = [];
for (const arm of ["float64", "float32"]) {
  for (const delta of DELTAS) {
    let t = tensor([
      { ...A0, scores: scores([[0, 0.9]]) },
      { ...B0, scores: scores([[0, 0.9 + delta]]) },
    ]);
    if (arm === "float32") t = toF32(t);
    const out = decode(t);
    const survivor = out[0];
    const cx = survivor.box.x + survivor.box.w / 2;
    const representable = arm === "float64" || Math.fround(0.9 + delta) !== Math.fround(0.9);
    b1.push({
      arm,
      delta,
      deltaRepresentable: representable,
      kept: out.length,
      survivor: cx === A0.cx ? "A (index 0)" : "B (index 1)",
      displacementFromTieSurvivorModelPx: Math.abs(cx - A0.cx),
      displacementFromTieSurvivorCssPx: Math.abs(cx - A0.cx) * CSS_PER_MODEL,
      survivorCentreInsideOther: inside(centre(survivor.box), boxOf(cx === A0.cx ? B0 : A0)),
    });
  }
}
// Float32 spacing at 0.9 (the ULP), found by bisection rather than assumed.
let lo = 0;
let hi = 1e-6;
for (let i = 0; i < 200; i += 1) {
  const mid = (lo + hi) / 2;
  if (Math.fround(0.9 + mid) !== Math.fround(0.9)) hi = mid;
  else lo = mid;
}
const float32SmallestVisibleIncrementAt09 = hi;

// Swap geometry: when two same-class boxes overlap at IoU > 0.5, how far apart can their
// centres be, and does the survivor's centre always stay inside the other box?
const rndG = mulberry32(20260911);
let pairsTested = 0;
let centreOutside = 0;
let maxRelCentreOffset = 0;
let maxDispOverMinSide = 0;
for (let i = 0; i < 400000; i += 1) {
  const aw = 4 + rndG() * 296;
  const ah = 4 + rndG() * 296;
  const a = { x: 0, y: 0, w: aw, h: ah };
  const b = {
    w: aw * (0.6 + rndG() * 0.8),
    h: ah * (0.6 + rndG() * 0.8),
    x: (rndG() - 0.5) * aw,
    y: (rndG() - 0.5) * ah,
  };
  if (iou(a, b) <= 0.5) continue;
  pairsTested += 1;
  const cb = centre(b);
  const ca = centre(a);
  if (!inside(cb, a) || !inside(ca, b)) centreOutside += 1;
  maxRelCentreOffset = Math.max(maxRelCentreOffset, Math.abs(cb[0] - ca[0]) / aw, Math.abs(cb[1] - ca[1]) / ah);
  maxDispOverMinSide = Math.max(maxDispOverMinSide, disp(a, b) / Math.min(aw, ah));
}

// ── B2: each mechanism isolated ──────────────────────────────────────────────────────────
function sweep(name, build, measure) {
  const rows = [];
  for (const arm of ["float64", "float32"]) {
    for (const sign of [-1, 1]) {
      for (const eps of [0, ...EPS]) {
        if (eps === 0 && sign === 1) continue;
        let t = tensor(build(sign * eps));
        if (arm === "float32") t = toF32(t);
        rows.push({ arm, perturbation: sign * eps, ...measure(decode(t)) });
      }
    }
  }
  const baseline = rows.find((r) => r.arm === "float64" && r.perturbation === 0);
  const flips = rows.filter((r) => JSON.stringify({ ...r, arm: 0, perturbation: 0 }) !== JSON.stringify({ ...baseline, arm: 0, perturbation: 0 }));
  return { mechanism: name, outcomeChangesAt: flips.map((r) => `${r.arm} ${r.perturbation}`), rows };
}
const b2 = [];
// (i) ordering among overlapping same-class boxes — the pair, as a sweep
b2.push(
  sweep(
    "score near-tie between two overlapping same-class boxes (ordering)",
    (d) => [
      { ...A0, scores: scores([[0, 0.9]]) },
      { ...B0, scores: scores([[0, 0.9 + d]]) },
    ],
    (o) => ({ kept: o.length, survivorCx: o[0].box.x + o[0].box.w / 2 })
  )
);
// (ii) the IoU threshold boundary: equal 150x40 boxes 50 px apart have IoU exactly 0.5, and
// NMS suppresses only at > 0.5. A coordinate perturbation decides whether B survives.
b2.push(
  sweep(
    "IoU exactly at the 0.5 NMS threshold (coordinate noise)",
    (d) => [
      { cx: 200, cy: 200, w: 150, h: 40, scores: scores([[0, 0.9]]) },
      { cx: 250 + d * 250, cy: 200, w: 150, h: 40, scores: scores([[0, 0.8]]) },
    ],
    (o) => ({ kept: o.length })
  )
);
// (iii) argmax class flip: two classes near-equal on one anchor. Per-class NMS then stops
// suppressing an overlapping class-0 neighbour.
b2.push(
  sweep(
    "near-equal class scores on one anchor (argmax / label flip)",
    (d) => [
      { cx: 200, cy: 200, w: 120, h: 40, scores: scores([[0, 0.8], [1, 0.8 + d]]) },
      { cx: 215, cy: 200, w: 120, h: 40, scores: scores([[0, 0.7]]) },
    ],
    (o) => ({ kept: o.length, labels: o.map((x) => x.label).join(",") })
  )
);
// (iv) the emit floor (PROVISIONAL_THRESHOLDS.score, shipped value)
b2.push(
  sweep(
    `score at the emit floor (${T.score})`,
    (d) => [{ cx: 200, cy: 200, w: 100, h: 30, scores: scores([[0, T.score + d]]) }],
    (o) => ({ kept: o.length })
  )
);
// (v) the maxDetections cap: 299 fixed boxes, and two candidates near-tied for the last slot
b2.push(
  sweep(
    `rank at the maxDetections cap (${T.maxDetections})`,
    (d) => {
      const out = [];
      for (let i = 0; i < 299; i += 1) {
        out.push({ cx: 12 + (i % 20) * 31, cy: 12 + Math.floor(i / 20) * 31, w: 20, h: 20, scores: scores([[0, 0.9]]) });
      }
      out.push({ cx: 12, cy: 620, w: 20, h: 20, scores: scores([[0, 0.5]]) });
      out.push({ cx: 620, cy: 620, w: 20, h: 20, scores: scores([[0, 0.5 + d]]) });
      return out;
    },
    (o) => ({ kept: o.length, lastSlotCx: o[o.length - 1].box.x + o[o.length - 1].box.w / 2 })
  )
);
// (vi) cascade: A overlaps B, B overlaps C, A barely overlaps C. Which of A/B goes first decides
// whether C survives.
b2.push(
  sweep(
    "suppression cascade through a chain of overlaps",
    (d) => [
      { cx: 200, cy: 200, w: 100, h: 40, scores: scores([[0, 0.9 + d]]) },
      { cx: 230, cy: 200, w: 100, h: 40, scores: scores([[0, 0.9]]) },
      { cx: 260, cy: 200, w: 100, h: 40, scores: scores([[0, 0.8]]) },
    ],
    (o) => ({ kept: o.length, survivorsCx: o.map((x) => x.box.x + x.box.w / 2).join(",") })
  )
);

// ── B3: a realistic dense scene ──────────────────────────────────────────────────────────
// Controls in CSS px on a 1280x800 capture (DPR 1), mapped to model space at scale 0.5 with
// 120 px of vertical padding. The shapes follow the evaluation generator: repeated cards,
// look-alike adjacent buttons, inputs, a nested checkbox, tabs in a tight row, and an icon.
const CLS = Object.fromEntries(P.UI_CLASSES.map((c, i) => [c, i]));
const CONFUSABLE = { button: "link", link: "button", checkbox: "radio", radio: "checkbox", tab: "button", select: "textbox", textbox: "select", icon: "button" };
const CONTROLS_CSS = [];
for (let i = 0; i < 4; i += 1) {
  CONTROLS_CSS.push(["button", 52 + i * 244, 140, 110, 30], ["link", 52 + i * 244, 180, 90, 16]);
}
CONTROLS_CSS.push(["button", 40, 240, 130, 36], ["button", 190, 240, 130, 36]);
for (let i = 0; i < 4; i += 1) CONTROLS_CSS.push(["textbox", 40, 310 + i * 44, 300 + i * 20, 32]);
CONTROLS_CSS.push(["checkbox", 44, 510, 16, 16], ["radio", 140, 510, 16, 16], ["select", 240, 506, 180, 28]);
for (let i = 0; i < 5; i += 1) CONTROLS_CSS.push(["tab", 440 + i * 96, 96, 90, 28]);
CONTROLS_CSS.push(["icon", 1220, 20, 24, 24], ["button", 40, 740, 200, 44]);
const PAD_Y = 120;
const GT = CONTROLS_CSS.map(([cls, x, y, w, h]) => ({ cls, box: { x: x / 2, y: y / 2 + PAD_Y, w: w / 2, h: h / 2 } }));

function sceneTensor(seed) {
  const rnd = mulberry32(seed);
  const peak = GT.map(() => 0.7 + 0.25 * rnd());
  const A = 80 * 80;
  const anchors = new Array(A);
  const owner = new Array(A).fill(-1);
  for (let a = 0; a < A; a += 1) {
    const ax = ((a % 80) + 0.5) * 8;
    const ay = (Math.floor(a / 80) + 0.5) * 8;
    owner[a] = GT.findIndex((g) => inside([ax, ay], g.box));
  }
  // A control too small to contain an anchor centre still gets its nearest anchor.
  GT.forEach((g, gi) => {
    if (owner.includes(gi)) return;
    const [cx, cy] = centre(g.box);
    owner[Math.min(79, Math.floor(cy / 8)) * 80 + Math.min(79, Math.floor(cx / 8))] = gi;
  });
  for (let a = 0; a < A; a += 1) {
    const ax = ((a % 80) + 0.5) * 8;
    const ay = (Math.floor(a / 80) + 0.5) * 8;
    const gi = owner[a];
    if (gi < 0) {
      anchors[a] = { cx: ax, cy: ay, w: 8, h: 8, scores: new Array(C).fill(0).map(() => 0.03 * rnd()) };
      continue;
    }
    const g = GT[gi];
    const [cx, cy] = centre(g.box);
    const r = Math.min(1, Math.max(Math.abs(ax - cx) / (g.box.w / 2), Math.abs(ay - cy) / (g.box.h / 2)));
    const s = Math.min(0.99, peak[gi] * (1 - 0.35 * r) + 0.002 * rnd());
    const sc = new Array(C).fill(0.02);
    sc[CLS[g.cls]] = s;
    sc[CLS[CONFUSABLE[g.cls]]] = 0.35 * s;
    const x1 = g.box.x + 0.8 * gauss(rnd);
    const y1 = g.box.y + 0.8 * gauss(rnd);
    const x2 = g.box.x + g.box.w + 0.8 * gauss(rnd);
    const y2 = g.box.y + g.box.h + 0.8 * gauss(rnd);
    anchors[a] = { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: Math.max(0.5, x2 - x1), h: Math.max(0.5, y2 - y1), scores: sc };
  }
  return tensor(anchors);
}
function perturb(t, eps, seed, arm) {
  const rnd = mulberry32(seed);
  const data = arm === "float32" ? new Float32Array(t.data.length) : new Float64Array(t.data.length);
  for (let i = 0; i < t.data.length; i += 1) data[i] = t.data[i] * (1 + (rnd() * 2 - 1) * eps);
  // Keep class scores inside [0, 1] so the decoder's own sanity check does not fire. That is
  // the check doing its job on the control, not a finding. Box channels are not clipped.
  const A = t.dims[2];
  for (let i = 4 * A; i < data.length; i += 1) data[i] = Math.min(1, Math.max(0, data[i]));
  return { data, dims: t.dims };
}
function grounding(dets) {
  let recalled = 0;
  let clickSafe = 0;
  GT.forEach((g) => {
    const cands = dets.filter((d) => d.label === g.cls && iou(d.box, g.box) >= 0.5);
    if (!cands.length) return;
    recalled += 1;
    const best = cands.reduce((p, q) => (q.score > p.score ? q : p));
    if (inside(centre(best.box), g.box)) clickSafe += 1;
  });
  return { recalled, clickSafe };
}
/** DIAGNOSTIC ONLY — NOT shipped, NOT proposed for adoption: score-weighted merge of each kept box's suppressed cluster. */
function weightedMergeDecode(t) {
  const A = t.dims[2];
  const at = (c, a) => t.data[c * A + a];
  const items = [];
  for (let a = 0; a < A; a += 1) {
    let best = -1;
    let bs = 0;
    for (let c = 0; c < C; c += 1) if (at(4 + c, a) > bs) ((bs = at(4 + c, a)), (best = c));
    if (best < 0 || bs < T.score || at(2, a) <= 0 || at(3, a) <= 0) continue;
    items.push({ label: P.UI_CLASSES[best], score: bs, box: { x: at(0, a) - at(2, a) / 2, y: at(1, a) - at(3, a) / 2, w: at(2, a), h: at(3, a) } });
  }
  const order = items.map((v, i) => ({ v, i })).sort((p, q) => q.v.score - p.v.score || p.i - q.i);
  const sup = new Set();
  const kept = [];
  for (const { v, i } of order) {
    if (sup.has(i)) continue;
    const members = [v];
    for (const { v: o, i: j } of order) {
      if (j === i || sup.has(j) || o.label !== v.label) continue;
      if (iou(v.box, o.box) > T.nmsIou) {
        sup.add(j);
        members.push(o);
      }
    }
    const W = members.reduce((s, m) => s + m.score, 0);
    const avg = (k) => members.reduce((s, m) => s + m.box[k] * m.score, 0) / W;
    kept.push({ label: v.label, score: v.score, box: { x: avg("x"), y: avg("y"), w: avg("w"), h: avg("h") } });
    if (kept.length >= T.maxDetections) break;
  }
  return kept;
}

const SCENES = [11, 12, 13, 14, 15];
const TRIALS = 20;
const b3 = [];
const b3diag = [];
for (const arm of ["float64", "float32"]) {
  for (const eps of EPS) {
    const agg = { arm, relativeEpsilon: eps, trials: 0, notBitIdentical: 0, survivorSwap: 0, preRegisteredPass: 0, worstCssPxMax: 0, minMatchedFraction: 1, maxAbsCountDelta: 0, recallLost: 0, clickSafeLost: 0 };
    const dagg = { arm, relativeEpsilon: eps, trials: 0, worstCssPxMax: 0, minMatchedFraction: 1 };
    for (const scene of SCENES) {
      let base = sceneTensor(scene);
      if (arm === "float32") base = toF32(base);
      const ref = decode(base);
      const refG = grounding(ref);
      const refD = weightedMergeDecode(base);
      for (let k = 0; k < TRIALS; k += 1) {
        const pt = perturb(base, eps, scene * 1000 + k, arm);
        const got = decode(pt);
        const m = historicalMatch(ref, got);
        const g = grounding(got);
        const countDelta = got.length - ref.length;
        agg.trials += 1;
        // Coordinate noise alone moves a box edge by at most ~eps * 640 model px. A matched pair
        // displaced beyond 3x that bound, or a changed count, means a DIFFERENT anchor survived
        // NMS: a survivor swap. "Not bit-identical" is reported separately, because in float64
        // any perturbation at all changes the coordinates.
        const noiseBoundModelPx = 3 * eps * 640;
        if (got.map(key).join() !== ref.map(key).join()) agg.notBitIdentical += 1;
        if (m.worstModelPx > noiseBoundModelPx || got.length !== ref.length) agg.survivorSwap += 1;
        const frac = m.matched / ref.length;
        if (frac >= 0.95 && Math.abs(countDelta) <= 2 && m.worstCssPx <= 2.0) agg.preRegisteredPass += 1;
        agg.worstCssPxMax = Math.max(agg.worstCssPxMax, m.worstCssPx);
        agg.minMatchedFraction = Math.min(agg.minMatchedFraction, frac);
        agg.maxAbsCountDelta = Math.max(agg.maxAbsCountDelta, Math.abs(countDelta));
        agg.recallLost += Math.max(0, refG.recalled - g.recalled);
        agg.clickSafeLost += Math.max(0, refG.clickSafe - g.clickSafe);
        const dm = historicalMatch(refD, weightedMergeDecode(pt));
        dagg.trials += 1;
        dagg.worstCssPxMax = Math.max(dagg.worstCssPxMax, dm.worstCssPx);
        dagg.minMatchedFraction = Math.min(dagg.minMatchedFraction, dm.matched / refD.length);
      }
    }
    agg.worstCssPxMax = r4(agg.worstCssPxMax);
    agg.notBitIdenticalRate = r4(agg.notBitIdentical / agg.trials);
    agg.survivorSwapRate = r4(agg.survivorSwap / agg.trials);
    agg.preRegisteredPassRate = r4(agg.preRegisteredPass / agg.trials);
    dagg.worstCssPxMax = r4(dagg.worstCssPxMax);
    b3.push(agg);
    b3diag.push(dagg);
  }
}
const sceneBaseline = SCENES.map((s) => {
  const ref = decode(sceneTensor(s));
  return { scene: s, controls: GT.length, kept: ref.length, ...grounding(ref) };
});

const out = {
  experiment: "W1-QG03a / B / inference-noise and NMS ordering",
  runAt: new Date().toISOString(),
  runtime: `node ${process.version}`,
  shippedDecode: { scoreFloor: T.score, nmsIou: T.nmsIou, maxDetections: T.maxDetections, source: "packages/perception/dist decodeHeadOutput" },
  cssPerModelPx: CSS_PER_MODEL,
  observedBackendScoreDelta: OBSERVED_BACKEND_SCORE_DELTA,
  b1: {
    pair: { A: A0, B: B0, iou: r4(pairIou), label: "button", baseScore: 0.9 },
    float32SmallestVisibleIncrementAt09,
    rows: b1,
    swapGeometry: {
      randomPairsWithIouAbove05: pairsTested,
      centreOutsideTheOtherBox: centreOutside,
      maxCentreOffsetOverSide: r4(maxRelCentreOffset),
      maxCornerDisplacementOverMinSide: r4(maxDispOverMinSide),
      equalSizeAnalyticBound: "for equal boxes offset along one axis, IoU > 0.5 implies offset < side/3",
    },
  },
  b2,
  b3: { scenes: sceneBaseline, trialsPerScenePerEpsilon: TRIALS, rows: b3 },
  diagnosticOnlyWeightedMerge: {
    label: "DIAGNOSTIC ONLY — not shipped, not proposed; adoption would need model re-evaluation",
    rows: b3diag,
  },
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "b-nms.json"), JSON.stringify(out, null, 1));

console.log(`B1 pair IoU ${r4(pairIou)}; float32 smallest visible increment at 0.9: ${float32SmallestVisibleIncrementAt09.toExponential(3)}`);
for (const r of b1) console.log(`  ${r.arm} delta ${String(r.delta).padEnd(7)} representable=${r.deltaRepresentable} survivor=${r.survivor} dispCss=${r.displacementFromTieSurvivorCssPx}`);
console.log(`swap geometry: ${pairsTested} pairs IoU>0.5, centre outside other box: ${centreOutside}, max centre offset/side ${r4(maxRelCentreOffset)}, max corner disp/min side ${r4(maxDispOverMinSide)}`);
for (const m of b2) console.log(`B2 ${m.mechanism}: outcome changes at [${m.outcomeChangesAt.join("; ")}]`);
console.log("B3 scenes:", JSON.stringify(sceneBaseline));
for (const r of b3) console.log(`  ${r.arm} eps ${r.relativeEpsilon.toExponential(0)} notBitIdentical ${r.notBitIdenticalRate} survivorSwap ${r.survivorSwapRate} preRegPass ${r.preRegisteredPassRate} worstCss ${r.worstCssPxMax} minMatched ${r4(r.minMatchedFraction)} maxCountDelta ${r.maxAbsCountDelta} recallLost ${r.recallLost} clickSafeLost ${r.clickSafeLost}`);
for (const r of b3diag) console.log(`  DIAG ${r.arm} eps ${r.relativeEpsilon.toExponential(0)} worstCss ${r.worstCssPxMax} minMatched ${r4(r.minMatchedFraction)}`);
console.log(`wrote ${join(LOGS, "b-nms.json")}`);
