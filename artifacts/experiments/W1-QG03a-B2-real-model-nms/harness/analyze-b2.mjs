/**
 * QG-03a-B2 — real backend outputs through the SHIPPED decode and NMS, and real-output
 * perturbation.
 *
 *   node .../harness/analyze-b2.mjs
 *
 * Inputs are harness/generated/<cell>/<fixture>.f32, the raw ORT outputs, each checked
 * against the digest in logs/b2-<cell>.json before use. Decoding is decodeHeadOutput +
 * projectToCapture from packages/perception/dist, i.e. the shipped code: score floor 0.25,
 * greedy per-class NMS at IoU 0.5, cap 300. Nothing in it is re-implemented here.
 *
 * TWO VIEWS, NEITHER A CHANGE
 *   shipped  everything decodeHeadOutput emits
 *   op055    the same output filtered at confidence >= 0.55, the FROZEN evaluation
 *            operating point, applied AFTER the decode exactly as the evaluation tooling
 *            does. This is a view, not a new threshold.
 *
 * WHAT COUNTS AS WHAT
 *
 * "Same element" is judged against the REFERENCE cell's own detections. The capture pages
 * have no recoverable DOM geometry on this machine, and that limitation is recorded. For
 * each reference detection r, taking the best unused same-class match at IoU >= 0.5
 * (QG-03b-2a's matcher):
 *   identical        displacement 0
 *   same anchor      displacement <= tau, where tau is 3x the largest raw box-channel
 *                    difference between the two tensors, scaled to CSS px. The SAME anchor
 *                    survived, and only its numbers moved.
 *   survivor swap    displacement > tau, but the match's centre (the click point) lies
 *                    inside r: a different anchor of the same element.
 * TRUE FAILURES:
 *   off target       the match's centre lies outside r, and inside no other reference box
 *   wrong element    the match's centre lies outside r, but inside ANOTHER reference box
 *   class change     no same-class match, but a different-class box at IoU >= 0.5
 *   element lost     no match at all
 *   material count   |count delta| > 2 (the pre-registered bound, reused, not invented)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(EXP, "logs");
const GEN = join(HERE, "generated");
const P = await import(pathToFileURL(join(ROOT, "packages/perception/dist/src/index.js")).href);

const CELLS = ["chrome-wasm", "chrome-webgpu", "firefox-wasm", "firefox-webgpu", "native-cpu"];
const REF = "chrome-wasm";
const PAIRS = [
  ["chrome-wasm", "chrome-webgpu"],
  ["chrome-wasm", "firefox-wasm"],
  ["chrome-wasm", "firefox-webgpu"],
  ["chrome-webgpu", "firefox-webgpu"],
  ["chrome-wasm", "native-cpu"],
];
const EPS = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4];
const TRIALS = 20;
const ALPHAS = [0.5, 1, 2, 5, 10, 50, 100];
const OP = 0.55;
const A = 6400;
const CH = 12;

const sha = (b) => createHash("sha256").update(b).digest("hex");
const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);
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

// ── load cells ──────────────────────────────────────────────────────────────────────────
const logs = {};
const unavailable = {};
for (const c of CELLS) {
  const p = join(LOGS, `b2-${c}.json`);
  if (!existsSync(p)) { unavailable[c] = "no log: cell not run"; continue; }
  const l = JSON.parse(readFileSync(p, "utf8"));
  if (l.error) { unavailable[c] = `cell error: ${String(l.error).slice(0, 160)}`; continue; }
  if (!l.backendLabelVerified) { unavailable[c] = `backend label NOT verified (observed ${l.backendObserved})`; continue; }
  logs[c] = l;
}
if (!logs[REF]) throw new Error(`reference cell ${REF} unavailable: ${unavailable[REF]}`);
const fixtures = logs[REF].fixtures;
const outputs = {};
for (const c of Object.keys(logs)) {
  outputs[c] = {};
  for (const r of logs[c].rows) {
    if (r.error) continue;
    const buf = readFileSync(join(GEN, c, `${r.name}.f32`));
    if (sha(buf) !== r.outputSha256) throw new Error(`${c}/${r.name}: dump does not match logged digest`);
    outputs[c][r.name] = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  }
}
// The same input tensor must have gone into every cell, or nothing below is comparable.
const inputAgreement = fixtures.map((f) => {
  const shas = Object.fromEntries(Object.keys(logs).map((c) => [c, logs[c].rows.find((r) => r.name === f.name)?.tensorSha256]));
  return { name: f.name, identical: new Set(Object.values(shas)).size === 1, tensorSha256: shas[REF] };
});

// ── helpers over the shipped decode ─────────────────────────────────────────────────────
const geom = Object.fromEntries(fixtures.map((f) => {
  const lb = P.computeLetterbox(f.captureSize, 640);
  const s = f.viewportCss.w / f.captureSize.w;
  return [f.name, { lb, s, cssPerModel: s / lb.scale }];
}));
function detect(out, name) {
  const d = P.decodeHeadOutput({ data: out, dims: [1, CH, A] });
  if (!d.ok) return { error: d.code };
  const { lb, s } = geom[name];
  return P.projectToCapture(d.value, lb).map((x) => ({ label: x.label, score: x.score, box: { x: x.box.x * s, y: x.box.y * s, w: x.box.w * s, h: x.box.h * s } }));
}
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const inside = (p, b) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;
const disp = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));

function rawDiff(a, b) {
  const all = new Float64Array(a.length);
  let max = 0, sum = 0, n = 0, boxMax = 0, clsMax = 0, clsMaxLive = 0, relMax = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    all[i] = d;
    sum += d;
    if (d > 0) n += 1;
    if (d > max) max = d;
    const ch = Math.floor(i / A);
    if (ch < 4) { if (d > boxMax) boxMax = d; } else {
      if (d > clsMax) clsMax = d;
      if ((a[i] >= 0.2 || b[i] >= 0.2) && d > clsMaxLive) clsMaxLive = d;
    }
    const rel = d / Math.max(Math.abs(a[i]), 1e-6);
    if (d > 0 && rel > relMax) relMax = rel;
  }
  all.sort();
  const pct = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))];
  return { maxAbs: max, meanAbs: sum / a.length, p50: pct(0.5), p99: pct(0.99), p999: pct(0.999), elementsDiffering: n, fractionDiffering: n / a.length, boxChannelMaxAbs: boxMax, classChannelMaxAbs: clsMax, classChannelMaxAbsNearFloor: clsMaxLive, maxRelative: relMax };
}

function classify(ref, got, tauCss) {
  const o = { ref: ref.length, got: got.length, countDelta: got.length - ref.length, identical: 0, sameAnchor: 0, survivorSwap: 0, offTarget: 0, wrongElement: 0, classChange: 0, elementLost: 0, worstMatchedDispCss: 0, worstSwapDispCss: 0, minMatchedIou: 1 };
  const used = new Set();
  for (const r of ref) {
    let bj = -1, bi = 0.5;
    got.forEach((g, j) => { if (used.has(j) || g.label !== r.label) return; const v = iou(r.box, g.box); if (v >= bi) { bi = v; bj = j; } });
    if (bj >= 0) {
      used.add(bj);
      const g = got[bj];
      const d = disp(r.box, g.box);
      o.worstMatchedDispCss = Math.max(o.worstMatchedDispCss, d);
      o.minMatchedIou = Math.min(o.minMatchedIou, bi);
      if (d === 0) o.identical += 1;
      else if (d <= tauCss) o.sameAnchor += 1;
      else {
        const c = centre(g.box);
        if (inside(c, r.box)) { o.survivorSwap += 1; o.worstSwapDispCss = Math.max(o.worstSwapDispCss, d); }
        else if (ref.some((r2) => r2 !== r && inside(c, r2.box))) o.wrongElement += 1;
        else o.offTarget += 1;
      }
    } else if (got.some((g) => g.label !== r.label && iou(r.box, g.box) >= 0.5)) o.classChange += 1;
    else o.elementLost += 1;
  }
  o.materialCountChange = Math.abs(o.countDelta) > 2;
  o.trueFailures = o.offTarget + o.wrongElement + o.classChange + o.elementLost + (o.materialCountChange ? 1 : 0);
  o.preRegisteredPass = (ref.length === 0 || (ref.length - o.elementLost - o.classChange) / ref.length >= 0.95) && Math.abs(o.countDelta) <= 2 && o.worstMatchedDispCss <= 2.0;
  return o;
}
const view = (dets, v) => (v === "op055" ? dets.filter((d) => d.score >= OP) : dets);
function compare(aOut, bOut, name) {
  const rd = rawDiff(aOut, bOut);
  const tauCss = 3 * rd.boxChannelMaxAbs * geom[name].cssPerModel + 1e-9;
  const da = detect(aOut, name), db = detect(bOut, name);
  if (da.error || db.error) return { error: da.error || db.error, raw: rd };
  return { raw: rd, tauCss, shipped: classify(da, db, tauCss), op055: classify(view(da, "op055"), view(db, "op055"), tauCss) };
}
const sumRows = (rows, key) => {
  const acc = { fixtures: rows.length, identical: 0, sameAnchor: 0, survivorSwap: 0, offTarget: 0, wrongElement: 0, classChange: 0, elementLost: 0, materialCountChanges: 0, fixturesWithAnyChange: 0, preRegisteredPass: 0, worstMatchedDispCss: 0, worstSwapDispCss: 0, minMatchedIou: 1, trueFailures: 0, refDetections: 0 };
  for (const r of rows) {
    const c = r[key];
    if (!c) continue;
    for (const k of ["identical", "sameAnchor", "survivorSwap", "offTarget", "wrongElement", "classChange", "elementLost", "trueFailures"]) acc[k] += c[k];
    acc.refDetections += c.ref;
    if (c.materialCountChange) acc.materialCountChanges += 1;
    if (c.identical !== c.ref || c.countDelta !== 0) acc.fixturesWithAnyChange += 1;
    if (c.preRegisteredPass) acc.preRegisteredPass += 1;
    acc.worstMatchedDispCss = Math.max(acc.worstMatchedDispCss, c.worstMatchedDispCss);
    acc.worstSwapDispCss = Math.max(acc.worstSwapDispCss, c.worstSwapDispCss);
    acc.minMatchedIou = Math.min(acc.minMatchedIou, c.minMatchedIou);
  }
  acc.worstMatchedDispCss = r6(acc.worstMatchedDispCss);
  acc.worstSwapDispCss = r6(acc.worstSwapDispCss);
  acc.minMatchedIou = r6(acc.minMatchedIou);
  return acc;
};

// ── 1+2. backend-to-backend ─────────────────────────────────────────────────────────────
const backend = [];
for (const [a, b] of PAIRS) {
  if (!outputs[a] || !outputs[b]) { backend.push({ pair: `${a} vs ${b}`, unavailable: unavailable[a] || unavailable[b] }); continue; }
  const rows = fixtures.map((f) => ({ name: f.name, ...compare(outputs[a][f.name], outputs[b][f.name], f.name) }));
  const raw = rows.map((r) => r.raw);
  backend.push({
    pair: `${a} vs ${b}`,
    bitwiseIdenticalFixtures: rows.filter((r) => r.raw.elementsDiffering === 0).length,
    raw: {
      maxAbs: Math.max(...raw.map((x) => x.maxAbs)),
      meanAbsMax: Math.max(...raw.map((x) => x.meanAbs)),
      p99Max: Math.max(...raw.map((x) => x.p99)),
      boxChannelMaxAbs: Math.max(...raw.map((x) => x.boxChannelMaxAbs)),
      classChannelMaxAbs: Math.max(...raw.map((x) => x.classChannelMaxAbs)),
      classChannelMaxAbsNearFloor: Math.max(...raw.map((x) => x.classChannelMaxAbsNearFloor)),
      maxRelative: Math.max(...raw.map((x) => x.maxRelative)),
      elementsDifferingMax: Math.max(...raw.map((x) => x.elementsDiffering)),
    },
    shipped: sumRows(rows, "shipped"),
    op055: sumRows(rows, "op055"),
    perFixture: rows.map((r) => ({ name: r.name, raw: { maxAbs: r.raw.maxAbs, meanAbs: r.raw.meanAbs, elementsDiffering: r.raw.elementsDiffering, boxMax: r.raw.boxChannelMaxAbs, clsMax: r.raw.classChannelMaxAbs }, tauCss: r6(r.tauCss), shipped: r.shipped, op055: r.op055 })),
  });
}

// ── 3. decode detail per cell (count, classes, ordering digest) ─────────────────────────
const decodedDetail = {};
for (const c of Object.keys(outputs)) {
  decodedDetail[c] = fixtures.map((f) => {
    const d = detect(outputs[c][f.name], f.name);
    return { name: f.name, count: d.length, op055Count: d.filter((x) => x.score >= OP).length, orderedDigest: sha(JSON.stringify(d.map((x) => [x.label, x.score, x.box.x, x.box.y, x.box.w, x.box.h]))).slice(0, 16), classes: Object.fromEntries(P.UI_CLASSES.map((k) => [k, d.filter((x) => x.label === k).length]).filter(([, v]) => v > 0)) };
  });
}

// ── 4. float32 spacing of the real values ───────────────────────────────────────────────
function ulp(v) {
  const f = new Float32Array([v]);
  const i = new Int32Array(f.buffer);
  i[0] += 1;
  return Math.abs(f[0] - v);
}
const R0 = outputs[REF];
const spacing = (() => {
  const box = [], cls = [];
  for (const f of fixtures) {
    const o = R0[f.name];
    for (let a = 0; a < A; a += 1) {
      let best = 0;
      for (let c = 4; c < CH; c += 1) best = Math.max(best, o[c * A + a]);
      if (best < 0.25) continue;
      for (let c = 0; c < 4; c += 1) box.push(ulp(o[c * A + a]) / Math.abs(o[c * A + a]));
      cls.push(ulp(best) / best);
    }
  }
  const q = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return { liveAnchors: cls.length, relativeUlpScore: { min: q(cls, 0), p50: q(cls, 0.5), max: q(cls, 1) }, relativeUlpBox: { min: q(box, 0), p50: q(box, 0.5), max: q(box, 1) } };
})();

// ── 5. perturbation of the REAL output ──────────────────────────────────────────────────
function perturbRel(o, eps, rnd) {
  const p = new Float32Array(o.length);
  let changed = 0;
  for (let i = 0; i < o.length; i += 1) {
    p[i] = Math.fround(o[i] * (1 + (rnd() * 2 - 1) * eps));
    if (i >= 4 * A) p[i] = Math.min(1, Math.max(0, p[i]));
    if (p[i] !== o[i]) changed += 1;
  }
  return { p, changed };
}
const perturbation = [];
for (const eps of EPS) {
  const rows = [];
  let changedElements = 0, totalElements = 0, bitIdenticalTrials = 0;
  for (const f of fixtures) {
    for (let t = 0; t < TRIALS; t += 1) {
      const { p, changed } = perturbRel(R0[f.name], eps, mulberry32(Math.floor(eps * 1e12) + t * 7919 + f.name.length * 131));
      changedElements += changed;
      totalElements += p.length;
      if (changed === 0) { bitIdenticalTrials += 1; rows.push({ name: f.name, shipped: { ref: 0, got: 0, countDelta: 0, identical: 0, sameAnchor: 0, survivorSwap: 0, offTarget: 0, wrongElement: 0, classChange: 0, elementLost: 0, worstMatchedDispCss: 0, worstSwapDispCss: 0, minMatchedIou: 1, materialCountChange: false, trueFailures: 0, preRegisteredPass: true }, op055: null, unchanged: true }); continue; }
      rows.push({ name: f.name, ...compare(R0[f.name], p, f.name) });
    }
  }
  const real = rows.filter((r) => !r.unchanged);
  const byFixture = {};
  for (const r of real) {
    if (!r.shipped || !r.shipped.trueFailures) continue;
    byFixture[r.name] = (byFixture[r.name] ?? 0) + r.shipped.trueFailures;
  }
  perturbation.push({ relativeEpsilon: eps, trials: rows.length, trialsPerturbationRoundedAway: bitIdenticalTrials, fractionOfElementsActuallyChanged: r6(changedElements / totalElements), shipped: sumRows(real, "shipped"), op055: sumRows(real, "op055"), trueFailuresByFixture: byFixture });
}
// Scale the ACTUAL backend difference: how far is real backend noise from any failure?
const scaled = [];
const DELTA_CELL = outputs["chrome-webgpu"] ? "chrome-webgpu" : null;
if (DELTA_CELL) {
  for (const alpha of ALPHAS) {
    const rows = fixtures.map((f) => {
      const r = R0[f.name], w = outputs[DELTA_CELL][f.name];
      const p = new Float32Array(r.length);
      for (let i = 0; i < r.length; i += 1) {
        p[i] = Math.fround(r[i] + alpha * (w[i] - r[i]));
        if (i >= 4 * A) p[i] = Math.min(1, Math.max(0, p[i]));
      }
      return { name: f.name, ...compare(r, p, f.name), equalsWebgpuExactly: alpha === 1 ? p.every((v, i) => v === w[i]) : undefined };
    });
    const pick = (c) => c && { ref: c.ref, countDelta: c.countDelta, survivorSwap: c.survivorSwap, trueFailures: c.trueFailures, elementLost: c.elementLost, classChange: c.classChange, wrongElement: c.wrongElement, offTarget: c.offTarget, materialCountChange: c.materialCountChange, worstSwapDispCss: r6(c.worstSwapDispCss), preRegisteredPass: c.preRegisteredPass };
    scaled.push({
      alphaTimesRealDelta: alpha,
      deltaCell: DELTA_CELL,
      alphaOneReproducesWebgpu: alpha === 1 ? rows.every((r) => r.equalsWebgpuExactly) : undefined,
      shipped: sumRows(rows, "shipped"),
      op055: sumRows(rows, "op055"),
      affectedFixtures: rows.filter((r) => r.shipped && (r.shipped.survivorSwap || r.shipped.trueFailures)).map((r) => ({ name: r.name, shipped: pick(r.shipped), op055: pick(r.op055) })),
    });
  }
}

// ── 5b. tie census: where can hard NMS be discontinuous in the REAL output? ─────────────
// Candidates as the shipped decode sees them: best class by STRICTLY greater, score >= floor,
// positive box. The census counts pairs of overlapping (IoU > 0.5) same-class candidates
// whose scores are EXACTLY equal (resolved by anchor index, so deterministic, and
// reproduced by any backend that produces the same tie), and pairs within 1e-5 or 1e-6.
function tieCensus(out) {
  const cands = [];
  for (let a = 0; a < A; a += 1) {
    let best = -1, bs = 0;
    for (let c = 0; c < CH - 4; c += 1) { const s = out[(4 + c) * A + a]; if (s > bs) { bs = s; best = c; } }
    const w = out[2 * A + a], h = out[3 * A + a];
    if (best < 0 || bs < 0.25 || w <= 0 || h <= 0) continue;
    cands.push({ a, cls: best, score: bs, box: { x: out[a] - w / 2, y: out[A + a] - h / 2, w, h } });
  }
  let exact = 0, near5 = 0, near6 = 0;
  const byCls = new Map();
  for (const c of cands) (byCls.get(c.cls) ?? byCls.set(c.cls, []).get(c.cls)).push(c);
  for (const g of byCls.values()) {
    g.sort((p, q) => p.score - q.score);
    for (let i = 0; i < g.length; i += 1) {
      for (let j = i + 1; j < g.length && g[j].score - g[i].score <= 1e-5; j += 1) {
        if (iou(g[i].box, g[j].box) <= 0.5) continue;
        const d = g[j].score - g[i].score;
        if (d === 0) exact += 1;
        if (d <= 1e-6) near6 += 1;
        near5 += 1;
      }
    }
  }
  return { candidates: cands.length, scoresExactlyOne: cands.filter((c) => c.score === 1).length, exactTieOverlappingPairs: exact, nearTieOverlappingPairsWithin1e6: near6, nearTieOverlappingPairsWithin1e5: near5 };
}
const ties = {};
for (const c of ["chrome-wasm", "chrome-webgpu"].filter((x) => outputs[x])) {
  const rows = fixtures.map((f) => ({ name: f.name, ...tieCensus(outputs[c][f.name]) }));
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  ties[c] = { candidates: tot("candidates"), scoresExactlyOne: tot("scoresExactlyOne"), exactTieOverlappingPairs: tot("exactTieOverlappingPairs"), nearTieOverlappingPairsWithin1e6: tot("nearTieOverlappingPairsWithin1e6"), nearTieOverlappingPairsWithin1e5: tot("nearTieOverlappingPairsWithin1e5"), perFixture: rows };
}

// ── 6. cost of the shipped decode + NMS, in Node ────────────────────────────────────────
const decodeNodeMs = (() => {
  const t = [];
  for (const f of fixtures) for (let k = 0; k < 5; k += 1) { const t0 = performance.now(); P.decodeHeadOutput({ data: R0[f.name], dims: [1, CH, A] }); t.push(performance.now() - t0); }
  t.sort((x, y) => x - y);
  return { medianMs: r6(t[Math.floor(t.length / 2)]), p95Ms: r6(t[Math.floor(t.length * 0.95)]), samples: t.length, runtime: `node ${process.version}` };
})();
const perf = Object.fromEntries(Object.keys(logs).map((c) => {
  const rows = logs[c].rows.filter((r) => !r.error);
  const warm = rows.flatMap((r) => r.inferMs.slice(1)).sort((x, y) => x - y);
  const dec = rows.map((r) => r.decodeNmsMs).filter((x) => x !== undefined).sort((x, y) => x - y);
  return [c, {
    sessionCreateMs: logs[c].sessionCreateMs ?? null,
    firstInferenceMs: rows[0]?.inferMs?.[0] ?? null,
    warmInferenceMedianMs: warm.length ? warm[Math.floor(warm.length / 2)] : null,
    warmInferenceP95Ms: warm.length ? warm[Math.floor(warm.length * 0.95)] : null,
    decodeNmsMedianMs: dec.length ? dec[Math.floor(dec.length / 2)] : null,
    deterministicFixtures: rows.filter((r) => r.deterministic).length,
    fixtures: rows.length,
  }];
}));

const out = {
  experiment: "W1-QG03a-B2-real-model-nms",
  runAt: new Date().toISOString(),
  reference: REF,
  cellsAvailable: Object.keys(logs),
  cellsUnavailable: unavailable,
  cellIdentity: Object.fromEntries(Object.keys(logs).map((c) => [c, { userAgent: logs[c].userAgent, ortVersion: logs[c].ortVersion, backendObserved: logs[c].backendObserved, gpu: logs[c].gpu ?? null, ortAdapter: logs[c].ortAdapter ?? null, modelSha256: logs[c].model?.sha256, pinArtifact: logs[c].pin?.artifact ?? logs[c].pin ?? null }])),
  inputAgreement: { fixtures: inputAgreement.length, identicalAcrossCells: inputAgreement.filter((x) => x.identical).length, rows: inputAgreement },
  backend,
  decodedDetail,
  float32Spacing: spacing,
  perturbation: { trialsPerFixture: TRIALS, fixtures: fixtures.length, rows: perturbation },
  scaledRealDelta: scaled,
  tieCensus: ties,
  performance: { perCell: perf, decodeNmsNode: decodeNodeMs },
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "b2-analysis.json"), JSON.stringify(out, null, 1));

console.log("cells available:", out.cellsAvailable.join(", "), "| unavailable:", JSON.stringify(unavailable));
console.log(`input tensors identical across cells: ${out.inputAgreement.identicalAcrossCells}/${out.inputAgreement.fixtures}`);
for (const b of backend) {
  if (b.unavailable) { console.log(`PAIR ${b.pair}: UNAVAILABLE (${b.unavailable})`); continue; }
  console.log(`PAIR ${b.pair}: bitwise ${b.bitwiseIdenticalFixtures}/${fixtures.length}; raw max ${b.raw.maxAbs.toExponential(3)} meanMax ${b.raw.meanAbsMax.toExponential(3)} box ${b.raw.boxChannelMaxAbs.toExponential(3)} cls ${b.raw.classChannelMaxAbs.toExponential(3)} clsNearFloor ${b.raw.classChannelMaxAbsNearFloor.toExponential(3)} rel ${b.raw.maxRelative.toExponential(3)}`);
  for (const v of ["shipped", "op055"]) {
    const s = b[v];
    console.log(`   ${v.padEnd(7)} refDet ${s.refDetections} identical ${s.identical} sameAnchor ${s.sameAnchor} swap ${s.survivorSwap} | TRUE: offTarget ${s.offTarget} wrongEl ${s.wrongElement} classChg ${s.classChange} lost ${s.elementLost} materialCount ${s.materialCountChanges} | worstDisp ${s.worstMatchedDispCss} worstSwap ${s.worstSwapDispCss} minIoU ${s.minMatchedIou} preRegPass ${s.preRegisteredPass}/${s.fixtures}`);
  }
}
console.log("float32 spacing (relative):", JSON.stringify(spacing));
for (const p of perturbation) {
  const s = p.shipped, o = p.op055;
  console.log(`EPS ${p.relativeEpsilon.toExponential(0)} trials ${p.trials} roundedAway ${p.trialsPerturbationRoundedAway} elemChanged ${p.fractionOfElementsActuallyChanged} | shipped swap ${s.survivorSwap} TRUE ${s.trueFailures} (lost ${s.elementLost} cls ${s.classChange} wrong ${s.wrongElement} off ${s.offTarget} count ${s.materialCountChanges}) worstSwap ${s.worstSwapDispCss} preReg ${s.preRegisteredPass}/${s.fixtures} | op055 swap ${o.survivorSwap} TRUE ${o.trueFailures} worst ${o.worstMatchedDispCss}`);
}
for (const s of scaled) console.log(`ALPHA ${s.alphaTimesRealDelta}x ${s.deltaCell}${s.alphaOneReproducesWebgpu !== undefined ? " (reproduces webgpu: " + s.alphaOneReproducesWebgpu + ")" : ""} | shipped swap ${s.shipped.survivorSwap} TRUE ${s.shipped.trueFailures} worstSwap ${s.shipped.worstSwapDispCss} preReg ${s.shipped.preRegisteredPass}/${s.shipped.fixtures} | op055 swap ${s.op055.survivorSwap} TRUE ${s.op055.trueFailures}`);
for (const s of scaled) for (const a of s.affectedFixtures) console.log(`   ${s.alphaTimesRealDelta}x ${a.name}: ${JSON.stringify(a.shipped)}`);
for (const p of perturbation) console.log(`   eps ${p.relativeEpsilon.toExponential(0)} true failures by fixture: ${JSON.stringify(p.trueFailuresByFixture)}`);
for (const [c, t] of Object.entries(ties)) console.log(`TIES ${c}: candidates ${t.candidates}, scores == 1.0: ${t.scoresExactlyOne}, exact-tie overlapping pairs ${t.exactTieOverlappingPairs}, within 1e-6 ${t.nearTieOverlappingPairsWithin1e6}, within 1e-5 ${t.nearTieOverlappingPairsWithin1e5}`);
console.log("perf:", JSON.stringify(out.performance));
console.log(`wrote ${join(LOGS, "b2-analysis.json")}`);
