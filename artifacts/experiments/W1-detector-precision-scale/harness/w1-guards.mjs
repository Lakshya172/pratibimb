/**
 * W-1 guards and pre-registered constants — detector precision (arm A) and scale (arm B).
 *
 * Every number in this file is from design.md, which was committed before the first
 * inference ran. The guards refuse rather than guess: a wrong dataset, a wrong model, a
 * wrong ORT version, a test-split sample, a malformed tensor, or a write into frozen
 * evidence all exit non-zero.
 *
 * This module imports NO ONNX Runtime and loads no weights. It is pure arithmetic and
 * assertion, so the unit tests can cover it without a session.
 */
import { createHash } from "node:crypto";
import { resolve, sep } from "node:path";

export const EXPERIMENT = "W1-detector-precision-scale";

/** The artifact under test. Never modified, never committed. */
export const MODEL = Object.freeze({
  modelId: "pratibimb-t1-ui-head",
  revision: "ba6d9e93695b",
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
  bytes: 302960,
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
});

export const ORT_VERSION = "1.29.0";
export const INPUT_DIMS = Object.freeze([1, 3, 640, 640]);
export const OUTPUT_DIMS = Object.freeze([1, 12, 6400]);

/** The frozen evaluation operating point. W-1 does not sweep, on any split. */
export const OPERATING_POINT = 0.55;

/** The shipped decode constants. The harness asserts these, never changes them. */
export const SHIPPED = Object.freeze({ score: 0.25, nmsIou: 0.5, maxDetections: 300 });

/* ───────────────────────────── arm A ───────────────────────────── */

/** The dataset arm A regenerates, and the hash that proves it is that dataset. */
export const DEVSET = Object.freeze({
  name: "t1-ui-rendered",
  version: "1.0.0",
  hash: "4bbc57de",
  seed: 20260910,
  counts: "120,40,40",
  devSamples: 40,
});

/**
 * The four pre-registered decode variants. Exactly four: no sweep, no extra values.
 *
 * `kind` is what the replica does differently; everything else matches the shipped decode.
 */
export const VARIANTS = Object.freeze([
  Object.freeze({ id: "V0", label: "shipped baseline — per-class NMS IoU 0.50", kind: "per-class", nmsIou: 0.5 }),
  Object.freeze({ id: "V1", label: "tighter per-class NMS — IoU 0.30", kind: "per-class", nmsIou: 0.3 }),
  Object.freeze({ id: "V2", label: "cross-class NMS — IoU 0.50, label ignored", kind: "cross-class", nmsIou: 0.5 }),
  Object.freeze({ id: "V3", label: "per-class NMS 0.50 + containment suppression IoS > 0.80", kind: "containment", nmsIou: 0.5, ios: 0.8 }),
]);

/* ───────────────────────────── arm B ───────────────────────────── */

/** The fixed content block. Identical at every scale level, so annotations are identical. */
export const CONTENT_BLOCK = Object.freeze({ w: 960, h: 640 });

export const SCALE_SEED_BASE = 20260913;
export const SAMPLES_PER_CELL = 20;

/**
 * Scale cells. CSS px per model px = viewport width / 640 exactly, because every cell is
 * width-dominant and DPR cancels out of the ratio. `tiles` cells are the emptiness control.
 */
export const CELLS = Object.freeze([
  Object.freeze({ id: "s150", viewport: { w: 960, h: 640 }, cssPerModel: 1.5, tiled: false }),
  Object.freeze({ id: "s175", viewport: { w: 1120, h: 747 }, cssPerModel: 1.75, tiled: false }),
  Object.freeze({ id: "s200", viewport: { w: 1280, h: 853 }, cssPerModel: 2.0, tiled: false }),
  Object.freeze({ id: "s225", viewport: { w: 1440, h: 960 }, cssPerModel: 2.25, tiled: false }),
  Object.freeze({ id: "s250", viewport: { w: 1600, h: 1067 }, cssPerModel: 2.5, tiled: false }),
  Object.freeze({ id: "s300", viewport: { w: 1920, h: 1280 }, cssPerModel: 3.0, tiled: false }),
  Object.freeze({ id: "s350", viewport: { w: 2240, h: 1493 }, cssPerModel: 3.5, tiled: false }),
  Object.freeze({ id: "s400", viewport: { w: 2560, h: 1707 }, cssPerModel: 4.0, tiled: false }),
  Object.freeze({ id: "t300", viewport: { w: 1920, h: 1280 }, cssPerModel: 3.0, tiled: true }),
  Object.freeze({ id: "t400", viewport: { w: 2560, h: 1707 }, cssPerModel: 4.0, tiled: true }),
]);

export const PLACEHOLDER_SPLITS = Object.freeze(["train", "test"]);

/**
 * The frozen validator refuses an empty split (EMPTY_SPLIT), and it also refuses two samples
 * that are byte-identical in content across splits. So each cell carries exactly one
 * never-rendered placeholder per non-dev split, distinguished by extent, exactly as C3
 * recorded. They are never rendered, decoded, inferred or evaluated, and this sentinel path
 * is what proves it.
 */
export const PLACEHOLDER_FRAME = "UNRENDERED-PLACEHOLDER-NEVER-EVALUATED";
export const PLACEHOLDER_SEED_BASE = 990000000;
export const PLACEHOLDER_EXTENT = Object.freeze({ train: 10, test: 12 });

export const seedFor = (i) => SCALE_SEED_BASE + i;
export const specIdFor = (i) => `w1-seed-${String(i).padStart(4, "0")}`;
export const sampleIdFor = (cellId, i) => `w1-${cellId}-${String(i).padStart(4, "0")}`;

/** DPR is 1 for every cell, so the capture is the viewport. */
export const captureSizeFor = (cell) => ({ w: cell.viewport.w, h: cell.viewport.h });

/** How many whole content blocks tile into a viewport, at least one. */
export function tileGrid(cell) {
  if (!cell.tiled) return { cols: 1, rows: 1 };
  return {
    cols: Math.max(1, Math.floor(cell.viewport.w / CONTENT_BLOCK.w)),
    rows: Math.max(1, Math.floor(cell.viewport.h / CONTENT_BLOCK.h)),
  };
}

/** The pre-registered ratio, recomputed rather than trusted. */
export function cssPerModelOf(cell, modelSize = INPUT_DIMS[3]) {
  const cap = captureSizeFor(cell);
  const longest = Math.max(cap.w, cap.h);
  const scale = modelSize / longest;
  return cell.viewport.w / (cap.w * scale);
}

/* ───────────────────────────── guards ───────────────────────────── */

export const sha256Hex = (buf) => createHash("sha256").update(buf).digest("hex");

export function assertModelIdentity(bytes, expected = MODEL) {
  if (bytes.length !== expected.bytes) {
    throw new Error(`model is ${bytes.length} bytes, expected ${expected.bytes}`);
  }
  const got = sha256Hex(bytes);
  if (got !== expected.sha256) throw new Error(`model sha256 ${got} is not ${expected.sha256}`);
  return got;
}

export function assertOrtVersion(version, where) {
  if (version !== ORT_VERSION) {
    throw new Error(`${where}: ORT ${version ?? "unknown"} is not the pinned ${ORT_VERSION}`);
  }
  return version;
}

export function assertShippedConstants(perception) {
  const t = perception.PROVISIONAL_THRESHOLDS;
  if (!t) throw new Error("PROVISIONAL_THRESHOLDS missing from the perception package");
  for (const [k, want] of Object.entries(SHIPPED)) {
    if (t[k] !== want) throw new Error(`PROVISIONAL_THRESHOLDS.${k} is ${t[k]}, expected ${want} — W-1 must not change it`);
  }
  return t;
}

/** The dataset arm A regenerated must BE the pinned dataset, by the project's own rule. */
export function assertDevsetIdentity(ds, expected = DEVSET) {
  if (ds.name !== expected.name) throw new Error(`dataset name ${ds.name} is not ${expected.name}`);
  if (ds.version !== expected.version) throw new Error(`dataset version ${ds.version} is not ${expected.version}`);
  if (ds.hash !== expected.hash) {
    throw new Error(
      `regenerated dataset hash ${ds.hash} is not the pinned ${expected.hash} — this is NOT the dev split, and arm A must stop`
    );
  }
  const dev = ds.samples.filter((s) => s.split === "dev");
  if (dev.length !== expected.devSamples) throw new Error(`dev split has ${dev.length} samples, expected ${expected.devSamples}`);
  return dev;
}

/**
 * The consumed held-out split stays closed. Anything that is not dev is refused here,
 * before it can reach inference, evaluation or a log.
 */
export function assertDevOnly(samples, where) {
  const bad = samples.filter((s) => s.split !== "dev");
  if (bad.length) {
    throw new Error(`${where}: ${bad.length} non-dev sample(s) reached the harness (${bad.slice(0, 3).map((s) => `${s.id}/${s.split}`).join(", ")})`);
  }
  return samples;
}

export function assertTensor(dims, data, expectedDims, where) {
  if (dims.length !== expectedDims.length || dims.some((d, i) => d !== expectedDims[i])) {
    throw new Error(`${where}: dims [${dims.join(", ")}] are not [${expectedDims.join(", ")}]`);
  }
  const want = expectedDims.reduce((a, b) => a * b, 1);
  if (data.length !== want) throw new Error(`${where}: ${data.length} values, expected ${want}`);
  for (let i = 0; i < data.length; i += 1) {
    if (!Number.isFinite(data[i])) throw new Error(`${where}: non-finite value at ${i}`);
  }
  return true;
}

/** Arm B cells must be complete: no sample may be dropped after measurement. */
export function assertCellDataset(ds, cell, perCell = SAMPLES_PER_CELL) {
  const dev = ds.samples.filter((s) => s.split === "dev");
  if (dev.length !== perCell) throw new Error(`${cell.id}: ${dev.length} dev samples, expected ${perCell}`);
  for (const sp of PLACEHOLDER_SPLITS) {
    const ph = ds.samples.filter((s) => s.split === sp);
    if (ph.length !== 1) throw new Error(`${cell.id}: expected exactly 1 ${sp} placeholder, found ${ph.length}`);
    if (ph[0].framePath !== PLACEHOLDER_FRAME) throw new Error(`${cell.id}: the ${sp} placeholder has a real framePath — it must never be rendered`);
    if (ph[0].provenance.seed < PLACEHOLDER_SEED_BASE) throw new Error(`${cell.id}: the ${sp} placeholder seed is not in the placeholder range`);
    if (ph[0].annotations.length !== 1) throw new Error(`${cell.id}: the ${sp} placeholder must carry exactly 1 distinguishing annotation`);
    if (ph[0].annotations[0].box.w !== PLACEHOLDER_EXTENT[sp]) throw new Error(`${cell.id}: the ${sp} placeholder extent is not ${PLACEHOLDER_EXTENT[sp]}`);
  }
  const seeds = dev.map((s) => s.provenance.seed).sort((a, b) => a - b);
  for (let i = 0; i < perCell; i += 1) {
    if (seeds[i] !== seedFor(i)) throw new Error(`${cell.id}: seed ${seeds[i]} at index ${i} is not the pre-registered ${seedFor(i)}`);
  }
  const cap = captureSizeFor(cell);
  for (const s of dev) {
    if (s.viewportCss.w !== cell.viewport.w || s.viewportCss.h !== cell.viewport.h) {
      throw new Error(`${s.id}: viewport ${s.viewportCss.w}x${s.viewportCss.h} is not the cell's ${cell.viewport.w}x${cell.viewport.h}`);
    }
    if (s.captureSize.w !== cap.w || s.captureSize.h !== cap.h) throw new Error(`${s.id}: captureSize is not ${cap.w}x${cap.h}`);
    if (s.dpr !== 1) throw new Error(`${s.id}: dpr ${s.dpr} is not 1`);
  }
  return dev;
}

/** Frozen evidence is not writable by this experiment. */
export function assertWritablePath(root, target) {
  const abs = resolve(target);
  for (const forbidden of ["artifacts/datasets", "artifacts/gates", "artifacts/models"]) {
    const f = resolve(root, forbidden);
    if (abs === f || abs.startsWith(f + sep)) throw new Error(`refusing to write under ${forbidden}: ${abs}`);
  }
  return abs;
}

/* ──────────────────────── decode replica ──────────────────────── */

export function boxIou(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Intersection over the area of `inner` alone — what detects a nested duplicate. */
export function intersectionOverSelf(inner, outer) {
  const x1 = Math.max(inner.x, outer.x);
  const y1 = Math.max(inner.y, outer.y);
  const x2 = Math.min(inner.x + inner.w, outer.x + outer.w);
  const y2 = Math.min(inner.y + inner.h, outer.y + outer.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const area = inner.w * inner.h;
  if (!(area > 0)) return 0;
  return ((x2 - x1) * (y2 - y1)) / area;
}

/**
 * The candidate set, exactly as the shipped decoder builds it: best class per anchor, the
 * 0.25 floor, centre form to corner form, non-positive boxes skipped. Refuses on malformed
 * output the same way.
 */
export function candidatesFrom(out, classes) {
  const [, channels, anchors] = out.dims;
  if (channels !== 4 + classes.length) throw new Error(`output has ${channels} channels, contract declares ${4 + classes.length}`);
  const at = (c, a) => out.data[c * anchors + a];
  const results = [];
  for (let a = 0; a < anchors; a += 1) {
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < classes.length; c += 1) {
      const s = at(4 + c, a);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    if (best < 0 || bestScore < SHIPPED.score) continue;
    const cx = at(0, a);
    const cy = at(1, a);
    const w = at(2, a);
    const h = at(3, a);
    if (![cx, cy, w, h, bestScore].every(Number.isFinite)) throw new Error(`anchor ${a} produced a non-finite value`);
    if (w <= 0 || h <= 0) continue;
    if (bestScore > 1) throw new Error(`anchor ${a} scored ${bestScore}, above 1`);
    results.push({ box: { x: cx - w / 2, y: cy - h / 2, w, h }, label: classes[best], score: bestScore });
  }
  return results;
}

/**
 * Greedy suppression, pre-registered variants only. V0 reproduces the shipped rule exactly:
 * sorted by score with ties broken by original index, per-class, IoU strictly greater than
 * the threshold, capped at 300 and the cap breaking the loop just as the shipped code does.
 */
export function suppress(items, variant) {
  const indexed = items.map((v, i) => ({ v, i }));
  indexed.sort((p, q) => q.v.score - p.v.score || p.i - q.i);
  const kept = [];
  const suppressed = new Set();
  for (const { v, i } of indexed) {
    if (suppressed.has(i)) continue;
    kept.push(v);
    if (kept.length >= SHIPPED.maxDetections) break;
    for (const { v: other, i: j } of indexed) {
      if (j === i || suppressed.has(j)) continue;
      const sameClass = other.label === v.label;
      if (variant.kind === "cross-class") {
        if (boxIou(v.box, other.box) > variant.nmsIou) suppressed.add(j);
        continue;
      }
      if (!sameClass) continue;
      if (boxIou(v.box, other.box) > variant.nmsIou) { suppressed.add(j); continue; }
      if (variant.kind === "containment" && intersectionOverSelf(other.box, v.box) > variant.ios) suppressed.add(j);
    }
  }
  return kept;
}

export const decodeVariant = (out, classes, variant) => suppress(candidatesFrom(out, classes), variant);

/** Two detection lists are identical in count, class, box and score. */
export function sameDetections(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].label !== b[i].label || a[i].score !== b[i].score) return false;
    for (const k of ["x", "y", "w", "h"]) {
      if (a[i].box[k] !== b[i].box[k]) return false;
    }
  }
  return true;
}

/* ──────────────────────── scoring helpers ──────────────────────── */

/**
 * The false-positive and false-negative taxonomy, and the matched-IoU set, under the same
 * greedy highest-confidence-first discipline the evaluator uses. The four FP families and
 * their cut-offs are taken verbatim from tools/detector/qg03-dev-analysis.mjs so these
 * numbers are comparable with the published ones rather than a new definition.
 */
export function taxonomy(samples, predsBySample) {
  const fp = { duplicate: 0, classConfusion: 0, localization: 0, spurious: 0 };
  const fn = { noOverlapAtAll: 0, overlappedWrongClass: 0, overlappedPoorLocalization: 0 };
  const confusion = {};
  const matchedIou = [];
  const normDisp = [];
  const bySize = {};
  let totalGt = 0;
  let matchedGt = 0;
  let predCount = 0;

  const bucketOf = (side) => (side < 4 ? "model<4px" : side < 8 ? "model 4-8px" : side < 16 ? "model 8-16px" : "model>=16px");

  for (const s of samples) {
    const gts = s.annotations.filter((a) => a.visibility !== "OFFSCREEN");
    const mine = (predsBySample.get(s.id) || []).slice().sort((a, b) => b.confidence - a.confidence);
    predCount += mine.length;
    const claimed = new Set();
    const matchOf = new Map();

    for (const p of mine) {
      let bestJ = -1;
      let bestV = 0.5;
      for (let j = 0; j < gts.length; j += 1) {
        if (claimed.has(j) || gts[j].cls !== p.cls) continue;
        const v = boxIou(p.box, gts[j].box);
        if (v >= bestV) { bestV = v; bestJ = j; }
      }
      if (bestJ >= 0) {
        claimed.add(bestJ);
        matchOf.set(p, { j: bestJ, iou: bestV });
        matchedIou.push(bestV);
        const g = gts[bestJ];
        const size = Math.sqrt(Math.max(g.box.w * g.box.h, 1e-9));
        const dx = p.box.x + p.box.w / 2 - (g.box.x + g.box.w / 2);
        const dy = p.box.y + p.box.h / 2 - (g.box.y + g.box.h / 2);
        normDisp.push(Math.hypot(dx, dy) / size);
        continue;
      }
      // unmatched: classify it
      let bestSame = 0;
      let bestAny = 0;
      let bestAnyCls = null;
      for (const g of gts) {
        const v = boxIou(p.box, g.box);
        if (g.cls === p.cls && v > bestSame) bestSame = v;
        if (v > bestAny) { bestAny = v; bestAnyCls = g.cls; }
      }
      if (bestSame >= 0.5) fp.duplicate += 1;
      else if (bestAny >= 0.5 && bestAnyCls !== p.cls) {
        fp.classConfusion += 1;
        const key = `${bestAnyCls}->${p.cls}`;
        confusion[key] = (confusion[key] || 0) + 1;
      } else if (bestSame >= 0.3) fp.localization += 1;
      else fp.spurious += 1;
    }

    for (let j = 0; j < gts.length; j += 1) {
      const g = gts[j];
      totalGt += 1;
      const hit = claimed.has(j);
      if (hit) matchedGt += 1;
      // model-space size of the shorter side, which is what a stride-8 cell has to resolve
      const modelSide = Math.min(g.box.w, g.box.h) / (s.cssPerModel ?? 1);
      const key = bucketOf(modelSide);
      bySize[key] = bySize[key] || [0, 0];
      bySize[key][1] += 1;
      if (hit) bySize[key][0] += 1;
      if (!hit) {
        let bestSame = 0;
        let bestAny = 0;
        let bestAnyCls = null;
        for (const p of mine) {
          const v = boxIou(p.box, g.box);
          if (p.cls === g.cls && v > bestSame) bestSame = v;
          if (v > bestAny) { bestAny = v; bestAnyCls = p.cls; }
        }
        if (bestAny < 0.1) fn.noOverlapAtAll += 1;
        else if (bestSame < 0.3 && bestAnyCls !== g.cls) fn.overlappedWrongClass += 1;
        else fn.overlappedPoorLocalization += 1;
      }
    }
  }

  return { fp, fn, confusion, matchedIou, normDisp, bySize, totalGt, matchedGt, predCount };
}

/** Order statistics of a sample, reported as a distribution rather than one extreme. */
export function quantiles(xs) {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { n: v.length, min: v[0], p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), max: v[v.length - 1] };
}

/** The CLIPPED-aware ceiling, reported beside recall rather than folded into it. */
export function clippingCeiling(samples) {
  let evaluatable = 0;
  let unreachable = 0;
  let clipped = 0;
  for (const s of samples) {
    for (const a of s.annotations) {
      if (a.visibility === "OFFSCREEN") continue;
      evaluatable += 1;
      if (a.visibility !== "CLIPPED") continue;
      clipped += 1;
      const vx1 = Math.max(a.box.x, 0);
      const vy1 = Math.max(a.box.y, 0);
      const vx2 = Math.min(a.box.x + a.box.w, s.viewportCss.w);
      const vy2 = Math.min(a.box.y + a.box.h, s.viewportCss.h);
      const vis = Math.max(0, vx2 - vx1) * Math.max(0, vy2 - vy1);
      const full = a.box.w * a.box.h;
      if (full > 0 && vis / full < 0.5) unreachable += 1;
    }
  }
  return { evaluatable, clipped, unreachable, ceiling: evaluatable ? (evaluatable - unreachable) / evaluatable : Number.NaN };
}
