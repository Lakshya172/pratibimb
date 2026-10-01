/**
 * QG-03 — THE TEXT-REGION WASM CORRECTNESS INPUT, AS THE OWNER DECIDED IT.
 *
 * `docs/testing/qg03-wasm-correctness-decision.md` records the owner's approval of Option A on
 * 2026-09-25: for a text-region model, the fixed realistic text-bearing fixture decides QG-03's WASM
 * correctness cell, with S-04a-1's statistic and bound unchanged. This file requires:
 *
 *   1. the record to state that decision, its scope, statistic, threshold, owner and date;
 *   2. the threshold it states to be the one RE-1's scorer already uses — nothing moved;
 *   3. both PP-OCRv5 WASM results to be quoted as measured, and to agree with the M7.1 log;
 *   4. the M7.1 evidence and the pre-registered RE-1 body to be byte-for-byte what they were;
 *   5. PP-OCRv5 to remain REJECTED FOR V1, and nothing to claim QG-03 passed or a model adopted.
 *
 * Documents and logs only. No model, no runtime, no pixels.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { REDACTION_CRITERIA } from "./redaction-metrics.mjs";

const ROOT = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, ROOT), "utf8").replace(/\r\n/g, "\n");
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");

const RECORD = read("docs/testing/qg03-wasm-correctness-decision.md");
const DECISION = RECORD.slice(RECORD.indexOf("## 0. Owner decision"), RECORD.indexOf("*The record below is the question"));
const M71_LOG = JSON.parse(read("artifacts/experiments/M7-visual-text/logs/m7.1-det-validation.json"));

/** The frozen S-04a-1 bound, as the owner restated it. */
const BOUND = 2e-2;

describe("the decision record", () => {
  it("is APPROVED, Option A, by the owner, dated", () => {
    expect(RECORD).toMatch(/^> \*\*Status: APPROVED — OPTION A\.\*\*/m);
    expect(DECISION.length).toBeGreaterThan(0);
    expect(DECISION).toMatch(/\| \*\*Decision\*\* \| \*\*APPROVED\*\* \|/);
    expect(DECISION).toMatch(/\| \*\*Option\*\* \| \*\*A\*\* —/);
    expect(DECISION).toMatch(/\| \*\*Approved by\*\* \| \*\*Ronit Saha\*\* \(`ronitsaha11`\)/);
    expect(DECISION).toMatch(/\| \*\*Date\*\* \| \*\*2026-09-25\*\* \|/);
  });

  it("states the governing input exactly, for the text-region cell", () => {
    expect(RECORD).toContain(
      "**For the text-region model adoption cell, the realistic fixed text-bearing fixture governs the\n> WASM correctness check.**",
    );
    expect(DECISION).toMatch(/\| \*\*Deciding input\*\* \| the \*\*realistic, fixed, text-bearing fixture\*\*/);
  });

  it("is scoped to text-region models and generalises nowhere else", () => {
    expect(DECISION).toMatch(/\| \*\*Scope\*\* \| \*\*The QG-03 WASM correctness cell for a text-region model\*\*/);
    expect(DECISION).toContain("Not generalised to any other model class");
  });

  it("keeps the statistic and threshold, and the threshold is the one RE-1 already uses", () => {
    expect(DECISION).toMatch(/\| \*\*Statistic\*\* \| \*\*relative `sumAbs` error\*\*.*\*\*unchanged\*\*/);
    expect(DECISION).toMatch(/\| \*\*Threshold\*\* \| \*\*≤ 2e-2\*\* — unchanged \|/);
    expect(REDACTION_CRITERIA.wasmRtolSumAbs).toBe(BOUND);
  });

  it("does not leave the question's decision fields blank", () => {
    expect(RECORD).not.toContain("_pending_");
    expect(RECORD).toContain("| **Decision** | ☒ A ☐ B ☐ C");
    expect(RECORD).toContain("| **Statistic** | ☒ sumAbs ≤ 2e-2 ☐ element-wise");
  });
});

describe("both PP-OCRv5 results survive, as measured", () => {
  const synthetic = M71_LOG.results.synthetic.s04a1;
  const realistic = M71_LOG.results.realistic.s04a1;

  it("the M7.1 log still holds the two measurements, and the bound still sorts them", () => {
    expect(synthetic).toEqual({ countOk: true, criterion: BOUND, relErrSumAbs: 0.04117685237288805, pass: false });
    expect(realistic).toEqual({ countOk: true, criterion: BOUND, relErrSumAbs: 0.0000042328616360789425, pass: true });
    expect(synthetic.countOk && synthetic.relErrSumAbs <= BOUND).toBe(synthetic.pass);
    expect(realistic.countOk && realistic.relErrSumAbs <= BOUND).toBe(realistic.pass);
  });

  it("the record quotes both, with the synthetic one kept as reference, regression and diagnostic evidence", () => {
    expect(synthetic.relErrSumAbs.toExponential(2)).toBe("4.12e-2");
    expect(realistic.relErrSumAbs.toExponential(2)).toBe("4.23e-6");
    expect(DECISION).toContain("**4.12e-02, over the bound**");
    expect(DECISION).toContain("**4.23e-06, within it**");
    expect(DECISION).toContain("Its role from here is **reference, regression and diagnostic evidence**");
    expect(DECISION).toContain("It is **not** the deciding QG-03 correctness cell for a text-region adoption decision.");
    expect(DECISION).toContain("The synthetic measurement is not\n*wrong*");
  });

  it("the historical M7.1 evidence is byte-for-byte what it was (line endings normalised)", () => {
    expect(sha256(read("artifacts/experiments/M7-visual-text/M7.1-decision.md"))).toBe(
      "8fe0ef98e30bf53627b07f4ec0c1fcd35c5ea2530973909decfaa5421ac320ee",
    );
    expect(sha256(read("artifacts/experiments/M7-visual-text/M7.1-ppocrv5-det-validation.md"))).toBe(
      "9d726ea83de30c0c07249130aee6a1ff0f4bb8af83c20fbd53c9cc6a0d8a7492",
    );
    expect(sha256(read("artifacts/experiments/M7-visual-text/logs/m7.1-det-validation.json"))).toBe(
      "2c058e03c0e253daa035c21236fc9edc55fa375779b86754202b7168717890e0",
    );
  });
});

describe("nothing else moved", () => {
  it("RE-1's pre-registered body is unchanged — only status notes sit above it", () => {
    const re1 = read("docs/perception/redaction-evaluation.md");
    const body = re1.slice(re1.indexOf("> **Status: PRE-REGISTERED"));
    expect(sha256(body)).toBe("6b69ae492b73048547a4dead6de033410bcf09276931fab57454f1374da99f29");
  });

  it("PP-OCRv5_mobile_det stays REJECTED FOR V1 and is not re-submitted", () => {
    expect(read("agentos/registry/model-registry.md")).toMatch(/PP-OCRv5_mobile_det via `paddle2onnx 2\.1\.0`.*\*\*`REJECTED FOR V1`\*\*/);
    expect(RECORD).toContain("`PP-OCRv5_mobile_det` remains **`REJECTED FOR V1`**");
    expect(DECISION).toContain("it\nis not re-submitted under RE-1");
  });

  it("passing the WASM cell is not adoption, and QG-03 is not marked passed for any model", () => {
    expect(DECISION).toContain("The adoption gate remains separate.");
    expect(RECORD).toContain("QG-03 is **not** marked passed for\n> any model");
    expect(RECORD).not.toMatch(/\bADOPTED\b/);
  });
});
