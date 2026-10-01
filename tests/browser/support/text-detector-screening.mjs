/**
 * M8.1 — THE SCREENING RULES FOR A TEXT-REGION CANDIDATE, fixed before any candidate is run.
 *
 * Everything that turns a detector's raw output into a screening verdict lives here, so it is
 * committed, tested, and identical for every candidate:
 *
 *   dbPostprocess     probability map -> boxes in CSS px. Moved from M7.1's run-det-validation.mjs
 *                     with the same convention ("edges"), so no candidate is post-processed
 *                     differently from the historical record.
 *   tensorStats /     W1-S04a-1's frozen WASM rule: exact output count AND relative sumAbs error
 *   judgeWasm         <= 2e-2 vs native onnxruntime of the same version. The bound is RE-1's
 *                     `wasmRtolSumAbs`, not a new constant.
 *   plaintextCheck    RE-1 G6, structurally: the graph emits only float tensors, and every box is
 *                     numbers in a fixed set of fields. Nothing here can hold a character sequence.
 *   screeningVerdict  the owner's acceptance list for M8.1 (Part P), applied mechanically.
 *
 * Geometry and numbers only. No detector here, no model, no character anywhere.
 */
import { REDACTION_CRITERIA } from "./redaction-metrics.mjs";

/**
 * DBPostProcess, with the parameters BOTH candidates' pinned inference.yml declare (identical for
 * PP-OCRv4_mobile_det and PP-OCRv3_mobile_det): thresh 0.3, box_thresh 0.6, max_candidates 1000,
 * unclip_ratio 1.5. `minSize` 3 is PaddleOCR's DBPostProcess constant.
 */
export const DB_POSTPROCESS = Object.freeze({ thresh: 0.3, boxThresh: 0.6, maxCandidates: 1000, unclipRatio: 1.5, minSize: 3 });

/** The only fields a box may carry. G6 checks every box against this list. */
export const BOX_FIELDS = Object.freeze(["x", "y", "w", "h", "score"]);

/**
 * Probability map -> boxes, in source-image (= CSS at DPR 1) pixels.
 *
 * Deviation from PaddleOCR, stated exactly as M7.1 stated it: 8-connected components and their
 * axis-aligned bounding box instead of OpenCV contours and a rotated minimum-area rectangle. For
 * horizontal text the two coincide up to a pixel, and the redaction path axis-aligns every box
 * anyway. Scoring (mean probability inside the unexpanded box), the box threshold and the unclip
 * distance (area * ratio / perimeter, applied outward on every side) follow DB's definitions.
 */
export function dbPostprocess(prob, H, W, ratioH, ratioW, srcH, srcW, db = DB_POSTPROCESS) {
  const seen = new Uint8Array(H * W);
  const stack = new Int32Array(H * W);
  const boxes = [];
  let candidates = 0;
  for (let start = 0; start < H * W; start += 1) {
    if (seen[start] || prob[start] <= db.thresh) continue;
    if (candidates >= db.maxCandidates) break;
    candidates += 1;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (top > 0) {
      const p = stack[--top];
      const y = (p / W) | 0;
      const x = p - y * W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!seen[q] && prob[q] > db.thresh) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (Math.min(w, h) < db.minSize) continue;
    let s = 0;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) s += prob[y * W + x];
    const score = s / (w * h);
    if (score < db.boxThresh) continue;
    const d = (w * h * db.unclipRatio) / (2 * (w + h));
    if (Math.min(w + 2 * d, h + 2 * d) < db.minSize + 2) continue;
    const bx0 = Math.max(0, (x0 - d) / ratioW);
    const by0 = Math.max(0, (y0 - d) / ratioH);
    const bx1 = Math.min(srcW, (x1 + 1 + d) / ratioW);
    const by1 = Math.min(srcH, (y1 + 1 + d) / ratioH);
    boxes.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, score });
  }
  return { boxes, candidates };
}

/** The summary S-04a-1's probe records, with its exact definitions. */
export function tensorStats(f32) {
  let mn = Infinity, mx = -Infinity, sum = 0, sumAbs = 0, sumSq = 0;
  for (let i = 0; i < f32.length; i += 1) {
    const v = f32[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    sumAbs += v < 0 ? -v : v;
    sumSq += v * v;
  }
  const n = f32.length;
  const idx = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return { count: n, min: mn, max: mx, sum, sumAbs, sumSq, sampleIdx: idx, sampleVals: idx.map((i) => f32[i]) };
}

/** W1-S04a-1's judgement, verbatim; the bound is RE-1 G5's quoted value. */
export function judgeWasm(web, ref) {
  const rtol = REDACTION_CRITERIA.wasmRtolSumAbs;
  const countOk = web.count === ref.count;
  const relErrSumAbs = Math.abs(web.sumAbs - ref.sumAbs) / Math.max(1e-30, Math.abs(ref.sumAbs));
  return { countOk, relErrSumAbs, criterion: rtol, pass: countOk && relErrSumAbs <= rtol };
}

/** ONNX TensorProto element types: 1 = FLOAT, 8 = STRING. */
const ONNX_FLOAT = 1;
const ONNX_STRING = 8;

/**
 * RE-1 G6, structurally. `graph` is the conversion record's graph summary; `webOutputs` is what
 * ORT Web reported for each output (`{ name, type }`); `boxes` is every box the screen produced.
 */
export function plaintextCheck(graph, webOutputs, boxes) {
  const reasons = [];
  const tensors = [...(graph?.inputs ?? []), ...(graph?.outputs ?? [])];
  if (!graph || graph.outputs.length === 0) reasons.push("no graph record");
  for (const t of tensors) if (t.elemType === ONNX_STRING) reasons.push(`${t.name} is a STRING tensor`);
  for (const o of graph?.outputs ?? []) if (o.elemType !== ONNX_FLOAT) reasons.push(`output ${o.name} is not float`);
  for (const o of webOutputs) if (o.type !== "float32") reasons.push(`ORT Web output ${o.name} is ${o.type}`);
  for (const b of boxes) {
    for (const [k, v] of Object.entries(b)) {
      if (!BOX_FIELDS.includes(k)) reasons.push(`box field ${k} is not permitted`);
      else if (typeof v !== "number" || !Number.isFinite(v)) reasons.push(`box field ${k} is not a finite number`);
    }
  }
  return { pass: reasons.length === 0, reasons: [...new Set(reasons)] };
}

export const STATUS = Object.freeze({
  eligible: "ELIGIBLE FOR QG-03 / ADOPTION REVIEW",
  rejected: "REJECTED FOR V1",
  blocked: "BLOCKED / NOT EVALUABLE",
});

/**
 * The owner's M8.1 acceptance list (Part P), in order. A candidate advances only if every item
 * holds, and the development screen can reject but never accept (RE-1 §7 step 5).
 *
 * BLOCKED is for a candidate that could not be measured (no reproducible artifact, no WASM
 * session). REJECTED is for one that was measured and failed a gate.
 */
export function screeningVerdict(e) {
  const checklist = {
    "1 provenance and licence verified": e.provenanceVerified === true,
    "2 reproducible artifact": e.reproducible === true,
    "3 realistic-input WASM <= 2e-2 (QG-03 text-region cell)": e.qg03RealisticPass === true,
    "4 every RE-1 gate on the held-out set": e.heldOutPass === true,
    "5 deterministic": e.deterministic === true,
    "6 no plaintext-capable output": e.noPlaintext === true,
    "7 runtime compatible": e.runtimeCompatible === true,
    "8 no unresolved security boundary conflict": e.noBoundaryConflict === true,
    "development screen did not reject": e.devScreenPass === true,
  };
  const failed = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
  let status = STATUS.eligible;
  if (!checklist["2 reproducible artifact"] || !checklist["7 runtime compatible"] || !checklist["1 provenance and licence verified"]) {
    status = STATUS.blocked;
  } else if (failed.length > 0) status = STATUS.rejected;
  return { status, checklist, failed };
}
