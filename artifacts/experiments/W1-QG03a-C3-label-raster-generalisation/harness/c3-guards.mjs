/**
 * QG-03a-C3 — the pre-registered constants, and every fail-closed guard.
 *
 * Everything a later stage could get wrong lives here once, so the render, decode, run and
 * analyse stages cannot drift apart, and so the guards are testable without a browser.
 *
 * PRE-REGISTERED (design.md). Changing any constant in this file after a run invalidates the
 * run: the whole point of C3 is that nothing was chosen after seeing a number.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const EXPERIMENT = "W1-QG03a-C3-label-raster-generalisation";

export const MODEL = Object.freeze({
  path: "artifacts/models/t1-ui-head/t1-ui-head.onnx",
  bytes: 302960,
  sha256: "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0",
  modelId: "pratibimb-t1-ui-head",
  revision: "ba6d9e93695b",
});
export const ORT_VERSION = "1.29.0";
export const INPUT_DIMS = Object.freeze([1, 3, 640, 640]);
export const OUTPUT_DIMS = Object.freeze([1, 12, 6400]);

/** The shipped decode floor. Verified against the shipped module, never set by this harness. */
export const SHIPPED_SCORE_FLOOR = 0.25;
/** The frozen evaluation operating point. Not re-chosen here, and not swept. */
export const OPERATING_POINT = 0.55;
export const VIEWS = Object.freeze(["op055", "shipped"]);

export const BASE_SEED = 20260912;
export const SAMPLES_PER_CELL = 20;
export const DATASET_VERSION = "1.0.0";
/** Fixed: a live timestamp would change the dataset hash. */
export const DATASET_CREATED_AT = "2026-09-12T00:00:00.000Z";

/** The frozen training dataset. C3 must never carry this name, and never read its files. */
export const FROZEN_DATASET_NAME = "t1-ui-rendered";
export const FORBIDDEN_PREFIXES = Object.freeze(["artifacts/datasets", "artifacts/gates"]);

/**
 * The six cells. A = off the training grid, B = on it.
 * The training grid is widths {960,1024,1152,1280} x heights {600,640,720,800} at DPR 1.
 */
export const CELLS = Object.freeze([
  { id: "a1", kind: "A", viewport: { w: 1264, h: 800 }, dpr: 1, note: "production capture size of the QG-03b-2a fixtures" },
  { id: "a2", kind: "A", viewport: { w: 1920, h: 962 }, dpr: 1.5, note: "worst recorded label/raster offset; only DPR other than 1" },
  { id: "a3", kind: "A", viewport: { w: 1920, h: 1080 }, dpr: 1, note: "common desktop size" },
  { id: "a4", kind: "A", viewport: { w: 2560, h: 1600 }, dpr: 1, note: "largest size QG-03a costed" },
  { id: "b1", kind: "B", viewport: { w: 960, h: 640 }, dpr: 1, note: "control: worst training offset, 0.667 model px" },
  { id: "b2", kind: "B", viewport: { w: 1024, h: 640 }, dpr: 1, note: "control: zero-offset training geometry" },
]);
export const TRAINING_WIDTHS = Object.freeze([960, 1024, 1152, 1280]);
export const TRAINING_HEIGHTS = Object.freeze([600, 640, 720, 800]);

export class C3GuardError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "C3GuardError";
    this.code = code;
  }
}

export const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");
const sameDims = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

export const cellById = (id) => CELLS.find((c) => c.id === id);
export const datasetNameFor = (cellId) => `t1-ui-c3-${cellId}`;
export const sampleIdFor = (cellId, i) => `c3-${cellId}-${String(i).padStart(4, "0")}`;
export const seedFor = (i) => BASE_SEED + i;
export const captureSizeFor = (cell) => ({ w: Math.round(cell.viewport.w * cell.dpr), h: Math.round(cell.viewport.h * cell.dpr) });
export const isTrainingGeometry = (cell) =>
  cell.dpr === 1 && TRAINING_WIDTHS.includes(cell.viewport.w) && TRAINING_HEIGHTS.includes(cell.viewport.h);

/** `expected` exists so the guard itself is testable without the gitignored artifact. */
export function assertModelIdentity(bytes, expected = MODEL) {
  if (!bytes || bytes.length !== expected.bytes) {
    throw new C3GuardError("MODEL_MISMATCH", `${bytes ? bytes.length : "no"} bytes, expected ${expected.bytes}`);
  }
  const s = sha256Hex(bytes);
  if (s !== expected.sha256) throw new C3GuardError("MODEL_MISMATCH", `sha256 ${s}, expected ${expected.sha256}`);
  return s;
}

export function assertOrtVersion(found, where) {
  if (found !== ORT_VERSION) throw new C3GuardError("ORT_VERSION_MISMATCH", `${where} reports ${found}, required ${ORT_VERSION}`);
}

export function assertTensor(dims, data, expected, what) {
  if (!sameDims(dims, expected)) {
    throw new C3GuardError("TENSOR_SHAPE_MISMATCH", `${what}: ${JSON.stringify(dims)}, required ${JSON.stringify(expected)}`);
  }
  const n = expected.reduce((a, b) => a * b, 1);
  if (!data || data.length !== n) {
    throw new C3GuardError("TENSOR_LENGTH_MISMATCH", `${what}: ${data ? data.length : "no"} values, required ${n}`);
  }
  let bad = 0;
  for (let i = 0; i < data.length; i += 1) if (!Number.isFinite(data[i])) bad += 1;
  if (bad) throw new C3GuardError("TENSOR_NON_FINITE", `${what}: ${bad} non-finite values`);
}

/** Refuse to write anywhere the frozen evidence lives. */
export function assertWritablePath(root, target) {
  const rel = resolve(target).slice(resolve(root).length + 1).replace(/\\/g, "/");
  for (const p of FORBIDDEN_PREFIXES) {
    if (rel === p || rel.startsWith(`${p}/`)) {
      throw new C3GuardError("FROZEN_PATH", `refusing to write ${rel}: frozen evidence lives under ${p}/`);
    }
  }
  return rel;
}

/** The shipped decode constants must be what the pre-registration says they are. */
export function assertShippedConstants(perception) {
  const t = perception.PROVISIONAL_THRESHOLDS;
  if (!t) throw new C3GuardError("SHIPPED_CONSTANTS", "PROVISIONAL_THRESHOLDS missing from the perception dist");
  if (t.score !== SHIPPED_SCORE_FLOOR) {
    throw new C3GuardError("SHIPPED_CONSTANTS", `shipped score floor is ${t.score}, pre-registered ${SHIPPED_SCORE_FLOOR}`);
  }
  return { score: t.score, iou: t.iou ?? null, maxDetections: t.maxDetections ?? null };
}

export function assertSampleMetadata(s, cell) {
  const need = (c, m) => { if (!c) throw new C3GuardError("SAMPLE_METADATA", `${s && s.id ? s.id : "?"}: ${m}`); };
  need(s && typeof s === "object", "not an object");
  for (const k of ["id", "split", "provenance", "viewportCss", "dpr", "captureSize", "annotations", "framePath"]) {
    need(s[k] !== undefined && s[k] !== null, `missing ${k}`);
  }
  need(s.split === "dev", `split is ${s.split}; every C3 sample is "dev" of its own dataset`);
  need(s.provenance.kind === "SYNTHETIC", "provenance is not SYNTHETIC");
  need(Number.isFinite(s.provenance.seed), "no generator seed recorded");
  const cap = captureSizeFor(cell);
  need(s.viewportCss.w === cell.viewport.w && s.viewportCss.h === cell.viewport.h, "viewport does not match its cell");
  need(s.dpr === cell.dpr, `dpr ${s.dpr} does not match cell ${cell.dpr}`);
  need(s.captureSize.w === cap.w && s.captureSize.h === cap.h, `captureSize ${s.captureSize.w}x${s.captureSize.h} does not match ${cap.w}x${cap.h}`);
  need(Array.isArray(s.annotations) && s.annotations.length > 0, "no annotations");
  for (const a of s.annotations) {
    need(a.id && a.cls && a.box && a.visibility, `annotation ${a && a.id}: incomplete`);
    need(["VISIBLE", "CLIPPED", "OFFSCREEN"].includes(a.visibility), `annotation ${a.id}: bad visibility ${a.visibility}`);
  }
}

/**
 * The frozen validator refuses an empty split, so each cell carries one unrendered placeholder in
 * `train` and one in `test`. They are never rendered, decoded, inferred or evaluated — every stage
 * iterates `dev` only — and this guard pins that arrangement so a placeholder can never quietly
 * become evidence.
 */
export const PLACEHOLDER_FRAME = "UNRENDERED-PLACEHOLDER-NEVER-EVALUATED";
export const PLACEHOLDER_SEED_BASE = 990000000;
export const devSamples = (ds) => ds.samples.filter((s) => s.split === "dev");

export function assertCellDataset(ds, cell) {
  const need = (c, m) => { if (!c) throw new C3GuardError("DATASET", `${cell.id}: ${m}`); };
  need(ds && typeof ds === "object", "missing dataset");
  need(ds.name === datasetNameFor(cell.id), `name is ${ds.name}, expected ${datasetNameFor(cell.id)}`);
  need(ds.name !== FROZEN_DATASET_NAME, `name collides with the frozen training dataset ${FROZEN_DATASET_NAME}`);
  need(ds.version === DATASET_VERSION, `version is ${ds.version}`);
  need(/^[0-9a-f]{8}$/.test(ds.hash || ""), "no sealed hash");

  const dev = devSamples(ds);
  const placeholders = ds.samples.filter((s) => s.split !== "dev");
  need(dev.length === SAMPLES_PER_CELL, `${dev.length} dev samples, required ${SAMPLES_PER_CELL}`);
  need(placeholders.length === 2, `${placeholders.length} placeholder samples, required exactly 2`);
  need(placeholders.some((s) => s.split === "train") && placeholders.some((s) => s.split === "test"), "placeholders must be one train and one test");
  for (const s of placeholders) {
    need(s.framePath === PLACEHOLDER_FRAME, `placeholder ${s.id} has a real framePath: it must never be rendered`);
    need(s.provenance.seed >= PLACEHOLDER_SEED_BASE, `placeholder ${s.id} seed ${s.provenance.seed} is not in the placeholder range`);
  }

  const seeds = new Set();
  for (let i = 0; i < dev.length; i += 1) {
    const s = dev[i];
    assertSampleMetadata(s, cell);
    need(s.id === sampleIdFor(cell.id, i), `dev sample ${i} id is ${s.id}, expected ${sampleIdFor(cell.id, i)}`);
    need(s.provenance.seed === seedFor(i), `sample ${s.id} seed ${s.provenance.seed}, expected ${seedFor(i)} (cells are paired by seed)`);
    need(s.framePath === `frames/${s.id}.png`, `sample ${s.id} framePath is ${s.framePath}`);
    seeds.add(s.provenance.seed);
  }
  need(seeds.size === SAMPLES_PER_CELL, "duplicate seeds inside a cell");
}

/* ── geometry helpers, shared by run and analyse ─────────────────────────────────────────── */

export const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const i = (x2 - x1) * (y2 - y1);
  return i / (a.w * a.h + b.w * b.h - i);
};
export const disp = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));

/** How much of a label box the viewport actually shows. The evaluator scores the FULL box. */
export function visibleFraction(box, viewport) {
  const x1 = Math.max(box.x, 0), y1 = Math.max(box.y, 0);
  const x2 = Math.min(box.x + box.w, viewport.w), y2 = Math.min(box.y + box.h, viewport.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return ((x2 - x1) * (y2 - y1)) / (box.w * box.h);
}

/**
 * The arithmetic recall ceiling this dataset imposes under the FROZEN CLIPPED definition: an
 * annotation showing less than half its own area cannot reach IoU 0.5 against its own label.
 * Reported, never "fixed" here.
 */
export function clippingCeiling(samples) {
  let evaluatable = 0, reachable = 0, clipped = 0, offscreen = 0;
  for (const s of samples) {
    for (const a of s.annotations) {
      if (a.visibility === "OFFSCREEN") { offscreen += 1; continue; }
      if (a.visibility === "CLIPPED") clipped += 1;
      evaluatable += 1;
      if (visibleFraction(a.box, s.viewportCss) >= 0.5) reachable += 1;
    }
  }
  return { evaluatable, reachable, clipped, offscreen, ceiling: evaluatable ? reachable / evaluatable : Number.NaN };
}

/**
 * Match predictions to labels the way B2/B3-1 did: best unused same-class match at IoU >= 0.5.
 * Returns the worst displacement and the minimum matched IoU, plus the smallest matched label.
 */
export function matchQuality(samples, predsBySample) {
  let minIou = 1, worstDisp = 0, matched = 0, labels = 0, smallestMatchedPx = Infinity;
  for (const s of samples) {
    const preds = (predsBySample.get(s.id) ?? []).slice();
    const used = new Set();
    for (const a of s.annotations) {
      if (a.visibility === "OFFSCREEN") continue;
      labels += 1;
      let bj = -1, bi = 0.5;
      preds.forEach((p, j) => {
        if (used.has(j) || p.cls !== a.cls) return;
        const v = iou(a.box, p.box);
        if (v >= bi) { bi = v; bj = j; }
      });
      if (bj < 0) continue;
      used.add(bj);
      matched += 1;
      minIou = Math.min(minIou, bi);
      worstDisp = Math.max(worstDisp, disp(a.box, preds[bj].box));
      smallestMatchedPx = Math.min(smallestMatchedPx, Math.min(a.box.w, a.box.h));
    }
  }
  return {
    labels,
    matched,
    minMatchedIou: matched ? minIou : Number.NaN,
    worstMatchedDispCss: worstDisp,
    smallestMatchedLabelPx: Number.isFinite(smallestMatchedPx) ? smallestMatchedPx : null,
  };
}
