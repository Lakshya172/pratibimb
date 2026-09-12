/**
 * Track B cell definitions and guards.
 *
 * Everything that decides a NUMBER — the decode, NMS, the taxonomy, the quantiles, the model
 * and ORT identity checks — is imported from the merged W-1 harness and is NOT redefined
 * here. This file adds only the three capture families and the checks specific to them. If it
 * ever grows its own metric, the two experiments stop being comparable and the reason Track B
 * waited for PR #52 evaporates.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE k GRID IS ARM B's, AND THE PRE-REGISTRATION SAID OTHERWISE
 *
 * design.md pre-registered k in {1.00, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00}. The content
 * block is 960 CSS px wide, so any viewport narrower than 960 — every k below 1.5 — clips it.
 * Clipped content breaks pre-registered sanity check 5 (the CLIPPED ceiling must be 1.0) and
 * would silently penalise the low-k cells, which are the healthy baseline the whole comparison
 * leans on. Those two cells are not hard to measure; they are impossible to measure.
 *
 * So the grid is arm B's own eight values. This was decided from the geometry, BEFORE any cell
 * was rendered or scored, and it is recorded here rather than quietly applied:
 *
 *   - still 24 cells, still 8 points, still brackets arm B's peak (1.75) and collapse (4.00);
 *   - NAT becomes arm B's existing non-tiled cells EXACTLY, so the W1 NAT curve is directly
 *     comparable to the W2 arm-B curve instead of merely similar.
 */
import {
  CELLS as W1_CELLS, CONTENT_BLOCK, INPUT_DIMS, SAMPLES_PER_CELL,
} from "../../W1-detector-precision-scale/harness/w1-guards.mjs";

export const EXPERIMENT = "W1-TrackB-geometry-appearance";

/** Arm B's non-tiled cells, in order. The tiled emptiness controls are not part of Track B. */
const BASE = W1_CELLS.filter((c) => !c.tiled);
export const K_VALUES = Object.freeze(BASE.map((c) => c.cssPerModel));

/** The healthy end of the grid. APPR holds its geometry here and varies only detail. */
export const APPR_BASE = BASE[0];

export const FAMILIES = Object.freeze(["NAT", "GEOM", "APPR"]);

/**
 * NAT  — arm B unchanged: big viewport at DPR 1, downsampled to 640 by the preprocessing.
 *        Extent shrinks AND detail degrades.
 * GEOM — same viewport and content at DPR 1/k, so Chromium LAYS OUT at k*640 CSS px and
 *        RASTERISES at 640 device px. Same model-space extent as NAT(k), reached without a
 *        resample. MEASURED, not assumed: the DPR capture differs from every downsample of the
 *        DPR-1 capture (26-46% of pixels, maxAbs > 100) — see probe-dpr.mjs. It is the best
 *        appearance obtainable at that extent, which is the correct upper bound; "full detail
 *        at reduced extent" is not a thing that exists.
 * APPR — the healthy geometry, detail destroyed deterministically in image space by a
 *        downsample to round(base/k) and back, BILINEAR both ways, the production resampler.
 *        Extent is constant across k, so its annotations are identical across k by construction.
 */
export function cellsFor() {
  const out = [];
  for (const b of BASE) {
    const k = b.cssPerModel;
    const kid = String(Math.round(k * 100)).padStart(3, "0");
    out.push(Object.freeze({
      id: `nat${kid}`, family: "NAT", k, viewport: { ...b.viewport }, dpr: 1,
      capture: { w: b.viewport.w, h: b.viewport.h }, appearance: null, armBCellId: b.id,
    }));
    out.push(Object.freeze({
      id: `geo${kid}`, family: "GEOM", k, viewport: { ...b.viewport }, dpr: 1 / k,
      capture: { w: Math.round(b.viewport.w / k), h: Math.round(b.viewport.h / k) },
      appearance: null, armBCellId: b.id,
    }));
    out.push(Object.freeze({
      id: `app${kid}`, family: "APPR", k, viewport: { ...APPR_BASE.viewport }, dpr: 1,
      capture: { w: APPR_BASE.viewport.w, h: APPR_BASE.viewport.h },
      appearance: Object.freeze({
        kernel: "BILINEAR",
        down: { w: Math.round(APPR_BASE.viewport.w / k), h: Math.round(APPR_BASE.viewport.h / k) },
        up: { w: APPR_BASE.viewport.w, h: APPR_BASE.viewport.h },
      }),
      armBCellId: APPR_BASE.id,
    }));
  }
  return Object.freeze(out);
}

export const CELLS = cellsFor();

/** CSS px per model px, recomputed from the capture rather than trusted. */
export function cssPerModelOf(cell, modelSize = INPUT_DIMS[3]) {
  const s = Math.min(modelSize / cell.capture.w, modelSize / cell.capture.h);
  const cssPerCapture = cell.viewport.w / cell.capture.w; // 1 at DPR 1, k at DPR 1/k
  return cssPerCapture / s;
}

/**
 * The extent a CONTENT_BLOCK-sized object occupies in model px. NAT(k) and GEOM(k) must agree
 * exactly — that identity is what makes the pair isolate appearance — and APPR must not move.
 */
export function modelExtentUnit(cell, modelSize = INPUT_DIMS[3]) {
  const s = Math.min(modelSize / cell.capture.w, modelSize / cell.capture.h);
  return (cell.capture.w / cell.viewport.w) * s;
}

export function assertCellGeometry(cell) {
  const fail = [];
  if (cell.capture.w < 1 || cell.capture.h < 1) fail.push(`${cell.id}: degenerate capture`);
  if (cell.family !== "APPR" && cell.viewport.w < CONTENT_BLOCK.w) {
    fail.push(`${cell.id}: viewport ${cell.viewport.w} is narrower than the ${CONTENT_BLOCK.w} content block — it would clip`);
  }
  if (cell.family === "APPR" && cell.appearance === null) fail.push(`${cell.id}: APPR without an appearance transform`);
  if (cell.family !== "APPR" && cell.appearance !== null) fail.push(`${cell.id}: ${cell.family} must not carry an appearance transform`);
  return fail;
}

/** Pre-registered sanity checks 3 and 4, as a function so the run can refuse itself. */
export function assertFamilyContract(cells) {
  const fail = [];
  const by = (f, k) => cells.find((c) => c.family === f && Math.abs(c.k - k) < 1e-9);
  for (const k of K_VALUES) {
    const nat = by("NAT", k);
    const geo = by("GEOM", k);
    const app = by("APPR", k);
    if (!nat || !geo || !app) { fail.push(`k=${k}: missing a family`); continue; }
    const en = modelExtentUnit(nat);
    const eg = modelExtentUnit(geo);
    if (Math.abs(en - eg) > 2e-3) {
      fail.push(`k=${k}: GEOM model extent ${eg.toFixed(6)} != NAT ${en.toFixed(6)} — the pair no longer isolates appearance`);
    }
    const ea = modelExtentUnit(app);
    const e0 = modelExtentUnit(by("APPR", K_VALUES[0]));
    if (Math.abs(ea - e0) > 1e-9) fail.push(`k=${k}: APPR model extent moved (${ea} vs ${e0}) — it must be constant`);
    if (geo.dpr !== 1 / k) fail.push(`k=${k}: GEOM dpr ${geo.dpr} != 1/k`);
    if (nat.dpr !== 1 || app.dpr !== 1) fail.push(`k=${k}: NAT/APPR dpr must be 1`);
  }
  return fail;
}

export { CONTENT_BLOCK, SAMPLES_PER_CELL, INPUT_DIMS };
