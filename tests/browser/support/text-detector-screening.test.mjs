/**
 * The M8.1 screening rules, on hand-computed cases — committed before any candidate is run.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REDACTION_CRITERIA } from "./redaction-metrics.mjs";
import {
  BOX_FIELDS,
  DB_POSTPROCESS,
  STATUS,
  dbPostprocess,
  judgeWasm,
  plaintextCheck,
  screeningVerdict,
  tensorStats,
} from "./text-detector-screening.mjs";

/** A probability map with filled rectangles: [x0, y0, x1, y1, value] inclusive. */
function map(W, H, fills) {
  const p = new Float32Array(W * H);
  for (const [x0, y0, x1, y1, v] of fills) for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) p[y * W + x] = v;
  return p;
}

describe("DB post-processing", () => {
  it("uses the parameters both pinned inference.yml files declare", () => {
    expect(DB_POSTPROCESS).toEqual({ thresh: 0.3, boxThresh: 0.6, maxCandidates: 1000, unclipRatio: 1.5, minSize: 3 });
    expect(Object.isFrozen(DB_POSTPROCESS)).toBe(true);
  });

  it("is the M7.1 post-processing, unchanged", () => {
    // The body of M7.1's function, with its sensitivity-only "centres" switch removed, is this one.
    const m71 = readFileSync(new URL("../../../artifacts/experiments/M7-visual-text/harness/run-det-validation.mjs", import.meta.url), "utf8");
    expect(m71).toContain("const d = (w * h * DB.unclipRatio) / (2 * (w + h));");
    expect(m71).toContain("const bx1 = Math.min(srcW, (x1 + e + d) / ratioW);");
  });

  it("expands a component by the unclip distance and maps it back to source pixels", () => {
    // 10x4 block at (3..12, 2..5), p = 0.9. d = 40 * 1.5 / (2 * 14) = 2.142857…
    const { boxes, candidates } = dbPostprocess(map(20, 10, [[3, 2, 12, 5, 0.9]]), 10, 20, 1, 1, 10, 20);
    expect(candidates).toBe(1);
    expect(boxes).toHaveLength(1);
    const d = 60 / 28;
    expect(boxes[0].x).toBeCloseTo(3 - d, 12);
    expect(boxes[0].y).toBe(0); // clipped at the top edge
    expect(boxes[0].x + boxes[0].w).toBeCloseTo(13 + d, 12);
    expect(boxes[0].y + boxes[0].h).toBeCloseTo(6 + d, 12);
    expect(boxes[0].score).toBeCloseTo(0.9, 6);
  });

  it("divides by the resize ratios to return to source coordinates", () => {
    const { boxes } = dbPostprocess(map(40, 20, [[6, 4, 25, 11, 0.9]]), 20, 40, 2, 2, 10, 20);
    const d = (20 * 8 * 1.5) / (2 * 28);
    expect(boxes[0].x).toBeCloseTo((6 - d) / 2, 12);
    expect(boxes[0].w).toBeCloseTo((26 + d) / 2 - (6 - d) / 2, 12);
  });

  it("drops a component whose mean probability is below box_thresh, and one thinner than min_size", () => {
    const p = map(30, 10, [[2, 2, 10, 6, 0.5], [15, 2, 25, 3, 0.9]]);
    const { boxes, candidates } = dbPostprocess(p, 10, 30, 1, 1, 10, 30);
    expect(candidates).toBe(2);
    expect(boxes).toEqual([]);
  });

  it("emits only numeric box fields", () => {
    const { boxes } = dbPostprocess(map(20, 10, [[3, 2, 12, 5, 0.9]]), 10, 20, 1, 1, 10, 20);
    expect(Object.keys(boxes[0]).every((k) => BOX_FIELDS.includes(k))).toBe(true);
  });
});

describe("the frozen WASM rule", () => {
  it("uses RE-1 G5's quoted bound", () => {
    expect(judgeWasm({ count: 1, sumAbs: 1 }, { count: 1, sumAbs: 1 }).criterion).toBe(REDACTION_CRITERIA.wasmRtolSumAbs);
    expect(REDACTION_CRITERIA.wasmRtolSumAbs).toBe(2e-2);
  });

  it("passes at the bound and fails just above it", () => {
    expect(judgeWasm({ count: 4, sumAbs: 102 }, { count: 4, sumAbs: 100 }).pass).toBe(true);
    expect(judgeWasm({ count: 4, sumAbs: 102.01 }, { count: 4, sumAbs: 100 }).pass).toBe(false);
  });

  it("fails on an output-count mismatch whatever the error", () => {
    const j = judgeWasm({ count: 3, sumAbs: 100 }, { count: 4, sumAbs: 100 });
    expect(j.relErrSumAbs).toBe(0);
    expect(j.pass).toBe(false);
  });

  it("summarises a tensor with S-04a-1's fields", () => {
    const s = tensorStats(new Float32Array([-1, 2, -3, 4]));
    expect(s).toMatchObject({ count: 4, min: -3, max: 4, sum: 2, sumAbs: 10, sumSq: 30, sampleIdx: [0, 1, 2, 3] });
  });
});

describe("G6 — no plaintext-capable output", () => {
  const graph = { inputs: [{ name: "x", elemType: 1 }], outputs: [{ name: "y", elemType: 1 }] };

  it("passes a float map and numeric boxes", () => {
    expect(plaintextCheck(graph, [{ name: "y", type: "float32" }], [{ x: 1, y: 2, w: 3, h: 4, score: 0.9 }]).pass).toBe(true);
  });

  it("fails a STRING tensor anywhere in the graph interface", () => {
    const g = { ...graph, outputs: [...graph.outputs, { name: "text", elemType: 8 }] };
    expect(plaintextCheck(g, [], []).pass).toBe(false);
  });

  it("fails a non-float web output", () => {
    expect(plaintextCheck(graph, [{ name: "y", type: "string" }], []).pass).toBe(false);
  });

  it("fails a box that carries any field beyond geometry and score", () => {
    const r = plaintextCheck(graph, [], [{ x: 1, y: 2, w: 3, h: 4, score: 0.9, label: "A" }]);
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("box field label is not permitted");
  });

  it("fails without a graph record", () => {
    expect(plaintextCheck(null, [], []).pass).toBe(false);
  });
});

describe("the screening verdict", () => {
  const all = {
    provenanceVerified: true,
    reproducible: true,
    qg03RealisticPass: true,
    heldOutPass: true,
    deterministic: true,
    noPlaintext: true,
    runtimeCompatible: true,
    noBoundaryConflict: true,
    devScreenPass: true,
  };

  it("is ELIGIBLE only when every item holds", () => {
    expect(screeningVerdict(all).status).toBe(STATUS.eligible);
    expect(STATUS.eligible).toBe("ELIGIBLE FOR QG-03 / ADOPTION REVIEW");
  });

  it("is REJECTED when a measured gate fails", () => {
    for (const k of ["qg03RealisticPass", "heldOutPass", "deterministic", "noPlaintext", "noBoundaryConflict"]) {
      expect(screeningVerdict({ ...all, [k]: false }).status).toBe(STATUS.rejected);
    }
  });

  it("lets the development screen reject but never accept", () => {
    expect(screeningVerdict({ ...all, devScreenPass: false }).status).toBe(STATUS.rejected);
    expect(screeningVerdict({ ...all, heldOutPass: false, devScreenPass: true }).status).toBe(STATUS.rejected);
  });

  it("is BLOCKED when the candidate could not be measured", () => {
    expect(screeningVerdict({ ...all, reproducible: false }).status).toBe(STATUS.blocked);
    expect(screeningVerdict({ ...all, runtimeCompatible: false }).status).toBe(STATUS.blocked);
    expect(screeningVerdict({ ...all, provenanceVerified: false }).status).toBe(STATUS.blocked);
  });

  it("treats a missing value as a failure, never as a pass", () => {
    expect(screeningVerdict({}).status).toBe(STATUS.blocked);
    expect(screeningVerdict({ ...all, heldOutPass: undefined }).status).toBe(STATUS.rejected);
  });
});
