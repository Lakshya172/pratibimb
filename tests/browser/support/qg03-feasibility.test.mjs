/**
 * The M8.2 QG-03 feasibility rules, on hand-computed cases — committed before any cell runs.
 */
import { describe, expect, it } from "vitest";

import {
  CELL,
  QG03,
  REQUIRED_CELLS,
  WASM_COLUMNS,
  cellVerdict,
  coexistencePass,
  modeVerdict,
  percentile,
  qg03Verdict,
  slowModeLabels,
  summarise,
  teardownPass,
} from "./qg03-feasibility.mjs";

describe("summarise — nearest-rank", () => {
  it("computes median, p90, min, max and n", () => {
    const s = summarise([5, 1, 4, 2, 3, 10, 9, 8, 7, 6]);
    expect(s).toEqual({ n: 10, median: 5, p90: 9, min: 1, max: 10 });
  });

  it("ignores non-finite values rather than letting them poison the summary", () => {
    expect(summarise([1, NaN, 3, Infinity, null]).n).toBe(2);
  });

  it("returns nulls on no data", () => {
    expect(summarise([])).toEqual({ n: 0, median: null, p90: null, min: null, max: null });
    expect(percentile([], 50)).toBeNull();
  });
});

describe("cell verdicts", () => {
  const ok = { loaded: true, correct: true };

  it("accepts a mode only on 3/3 loads and 3/3 correct", () => {
    expect(modeVerdict([ok, ok, ok]).verdict).toBe(CELL.accept);
    expect(modeVerdict([ok, ok, { loaded: true, correct: false }]).verdict).toBe(CELL.reject);
    expect(modeVerdict([ok, ok, { loaded: false }]).verdict).toBe(CELL.reject);
  });

  it("does not shrink the denominator when a launch never reported", () => {
    const m = modeVerdict([ok, ok]);
    expect(m.verdict).toBe(CELL.reject);
    expect(m.loaded).toBe("2/3");
  });

  it("combines modes: ACCEPT, CONDITIONAL, REJECT, BLOCKED", () => {
    const A = { verdict: CELL.accept };
    const R = { verdict: CELL.reject };
    expect(cellVerdict(A, A)).toBe(CELL.accept);
    expect(cellVerdict(A, R)).toBe(CELL.conditional);
    expect(cellVerdict(R, A)).toBe(CELL.conditional);
    expect(cellVerdict(R, R)).toBe(CELL.reject);
    expect(cellVerdict(null, null)).toBe(CELL.blocked);
    expect(cellVerdict(A, null)).toBe(CELL.conditional);
  });
});

describe("teardown — plateau, exact outputs, fresh context", () => {
  const c = (grows, sha = "a") => ({ ok: true, outputSha256: sha, grows });

  it("passes when later cycles add no growth and outputs are identical", () => {
    expect(teardownPass([c(3), c(0), c(0), c(0), c(0)]).pass).toBe(true);
    expect(teardownPass([c(3), c(0)], { ok: true, freshHeap: true, outputSha256: "a" }).pass).toBe(true);
  });

  it("fails on growth after cycle 1 — the leak signal", () => {
    const r = teardownPass([c(3), c(0), c(1), c(0)]);
    expect(r.pass).toBe(false);
    expect(r.reasons).toContain("memory grew after cycle 1 (1)");
  });

  it("fails on differing outputs or a failed cycle", () => {
    expect(teardownPass([c(3), c(0, "b")]).pass).toBe(false);
    expect(teardownPass([c(3), { ok: false, outputSha256: "a", grows: 0 }]).pass).toBe(false);
  });

  it("fails when the recreated context is not fresh or disagrees", () => {
    expect(teardownPass([c(3), c(0)], { ok: true, freshHeap: false, outputSha256: "a" }).pass).toBe(false);
    expect(teardownPass([c(3), c(0)], { ok: true, freshHeap: true, outputSha256: "z" }).pass).toBe(false);
    expect(teardownPass([c(3), c(0)], { ok: false }).pass).toBe(false);
  });

  it("treats an unknown growth count as growth", () => {
    expect(teardownPass([c(3), { ok: true, outputSha256: "a", grows: undefined }]).pass).toBe(false);
  });
});

describe("coexistence", () => {
  const solo = { candidate: "c", uiHead: "u", yunet: "y" };
  const created = { candidate: true, uiHead: true, yunet: true };

  it("passes when every round matches solo exactly", () => {
    expect(coexistencePass({ solo, rounds: [solo, solo], created }).pass).toBe(true);
  });

  it("fails on any interference, failed creation, error or missing model", () => {
    expect(coexistencePass({ solo, rounds: [{ ...solo, yunet: "x" }], created }).pass).toBe(false);
    expect(coexistencePass({ solo, rounds: [solo], created: { ...created, uiHead: false } }).pass).toBe(false);
    expect(coexistencePass({ solo, rounds: [solo], created, errors: ["boom"] }).pass).toBe(false);
    expect(coexistencePass({ solo: { candidate: "c" }, rounds: [{ candidate: "c" }], created }).pass).toBe(false);
    expect(coexistencePass({ solo, rounds: [], created }).pass).toBe(false);
  });
});

describe("slow-mode labels — descriptive only", () => {
  it("labels launches whose median exceeds twice the fastest launch", () => {
    expect(slowModeLabels([500, 510, 1900, 505, 1001])).toEqual({ floor: 500, labels: [false, false, true, false, true], slow: 2 });
  });

  it("does not label exactly 2x", () => {
    expect(slowModeLabels([500, 1000]).slow).toBe(0);
  });
});

describe("the QG-03 verdict", () => {
  const allCells = Object.fromEntries(REQUIRED_CELLS.map((c) => [c, CELL.accept]));
  const base = { pinned: true, licence: true, cells: allCells, coexistence: true, teardown: true, benchmarkArtifact: true };

  it("names the four cells and the two WASM columns exactly as the gate does", () => {
    expect(REQUIRED_CELLS).toEqual(["Chrome WebGPU", "Chrome WASM", "Firefox WebGPU", "Firefox WASM (Linux)"]);
    expect(WASM_COLUMNS).toEqual(["Chrome WASM", "Firefox WASM (Linux)"]);
  });

  it("passes when every item holds", () => {
    expect(qg03Verdict(base).verdict).toBe(QG03.pass);
  });

  it("does not require the WebGPU cells to pass, only to be filled", () => {
    const cells = { ...allCells, "Chrome WebGPU": CELL.reject, "Firefox WebGPU": CELL.conditional };
    expect(qg03Verdict({ ...base, cells }).verdict).toBe(QG03.pass);
  });

  it("fails when a WASM column is not ACCEPT", () => {
    for (const c of WASM_COLUMNS) {
      for (const v of [CELL.reject, CELL.conditional]) {
        expect(qg03Verdict({ ...base, cells: { ...allCells, [c]: v } }).verdict).toBe(QG03.fail);
      }
    }
  });

  it("fails on coexistence or teardown failure", () => {
    expect(qg03Verdict({ ...base, coexistence: false }).verdict).toBe(QG03.fail);
    expect(qg03Verdict({ ...base, teardown: false }).verdict).toBe(QG03.fail);
  });

  it("is BLOCKED when a required cell could not be run, and never PASS", () => {
    const r = qg03Verdict({ ...base, cells: { ...allCells, "Firefox WASM (Linux)": CELL.blocked } });
    expect(r.verdict).toBe(QG03.blocked);
    expect(r.blockedCells).toEqual(["Firefox WASM (Linux)"]);
    expect(qg03Verdict({ ...base, cells: { ...allCells, "Firefox WebGPU": undefined } }).verdict).toBe(QG03.blocked);
  });

  it("reports a measured failure even when another cell is blocked", () => {
    const cells = { ...allCells, "Chrome WASM": CELL.reject, "Firefox WebGPU": CELL.blocked };
    expect(qg03Verdict({ ...base, cells }).verdict).toBe(QG03.fail);
  });

  it("treats a missing benchmark artifact or an unmeasured item as BLOCKED, never PASS", () => {
    expect(qg03Verdict({ ...base, benchmarkArtifact: false }).verdict).toBe(QG03.blocked);
    expect(qg03Verdict({ ...base, coexistence: undefined }).verdict).toBe(QG03.blocked);
  });
});
