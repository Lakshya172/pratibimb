/**
 * The QG-03 browser/backend matrix, guarded as data.
 *
 * The measurements themselves run in real browsers and cannot run in CI — the model weights
 * are gitignored and there is no GPU on a runner. What CI *can* enforce is that the
 * committed evidence stays internally consistent and that no cell can be promoted to ACCEPT
 * on weaker grounds than the ones this gate claims.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE CLAIM THESE TESTS PROTECT
 *
 * A matrix is only worth having if a cell's verdict means the same thing every time. The
 * dossier's four required fields per cell are LOAD, p50 latency, peak heap and CORRECT —
 * and the traps around them are specific:
 *
 *   * "webgpu" in a config is not WebGPU executing. A cell may only claim the GPU ran if
 *     GPU command submissions were COUNTED during inference.
 *   * "no model download" is a claim about arrivals. A cell may not assert it without a
 *     network log showing zero.
 *   * a cell measured against a different artifact than the published one describes a
 *     model the project has no other evidence for.
 *
 * Each of those is a test below rather than a sentence in a README.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UI_CLASSES, HEAD_CONTRACT } from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const EXP = join(REPO, "artifacts/experiments/W1-QG03-t1-detector-runtime");
const METRICS = join(EXP, "metrics.json");
const REF = join(EXP, "reference-summary.json");

interface Cell {
  browser: string;
  backend: string;
  display: string;
  verdict: string;
  correct: boolean;
  sessionLoads: boolean;
  modelSha256?: string;
  outputDims?: number[];
  correctness?: Record<string, unknown>;
  determinism?: { bitwiseIdenticalEveryRun: boolean };
  latency?: Record<string, unknown>;
  memory?: { wasmHeapMB: { steadyState: number }; modelFileBytes: number };
  backendIdentity?: { gpuSubmitsDuringInference: number | null; verdict: string | null };
  network?: { foreignArrivals: number; modelFetchedAtRuntime: boolean; urls: string[] };
}

const metrics = existsSync(METRICS) ? JSON.parse(readFileSync(METRICS, "utf8")) : null;
const reference = existsSync(REF) ? JSON.parse(readFileSync(REF, "utf8")) : null;
const cells: Cell[] = metrics?.cells ?? [];

describe("QG-03 matrix evidence", () => {
  it("the matrix is committed", () => {
    expect(metrics, `${METRICS} missing — run the harness, then aggregate-qg03.mjs`).toBeTruthy();
    expect(cells.length, "an empty matrix is not a matrix").toBeGreaterThan(0);
  });

  it("every cell names the browser, backend and display mode it describes", () => {
    // Not cosmetic. "Firefox supports the detector" is exactly the claim this project has
    // already committed to never making from one cell — and the Firefox WebGPU cells
    // DISAGREE between headful and headless, so display mode is load-bearing here.
    for (const c of cells) {
      expect(c.browser).toBeTruthy();
      expect(c.backend).toBeTruthy();
      expect(["headful", "headless"]).toContain(c.display);
    }
  });

  it("every cell was measured against the artifact the reference describes", () => {
    for (const c of cells) {
      if (!c.modelSha256) continue; // a cell that never created a session has no artifact to report
      expect(c.modelSha256, `${c.browser}/${c.backend}/${c.display} ran a different .onnx`).toBe(
        reference.artifact.sha256
      );
    }
  });

  it("every successful cell emitted the contract's output shape", () => {
    for (const c of cells) {
      if (!c.outputDims) continue;
      expect(c.outputDims[0]).toBe(1);
      expect(c.outputDims[1]).toBe(4 + UI_CLASSES.length);
      expect(Number.isInteger(c.outputDims[2]) && c.outputDims[2]! > 0).toBe(true);
    }
  });

  it("no cell observed a foreign-origin network arrival", () => {
    for (const c of cells) {
      if (!c.network) continue;
      expect(
        c.network.foreignArrivals,
        `${c.browser}/${c.backend}/${c.display} reached a foreign origin: ${c.network.urls.join(", ")}`
      ).toBe(0);
    }
  });

  it("no cell downloaded the model at runtime", () => {
    for (const c of cells) {
      if (!c.network) continue;
      expect(c.network.modelFetchedAtRuntime).toBe(false);
      // The ONLY arrival any cell should show is ADR-0001's own pinned artifact fetch.
      for (const url of c.network.urls) {
        expect(url, `unexpected arrival in ${c.browser}/${c.backend}: ${url}`).toMatch(
          /ort-wasm-simd-threaded\.jsep\.wasm$/
        );
      }
    }
  });

  it("ADR-0001's pin was installed in every cell that created a session", () => {
    for (const c of cells) {
      if (!c.sessionLoads) continue;
      const pin = (c as unknown as { ortPin?: { installed: boolean; artifact: string } }).ortPin;
      expect(pin?.installed, `${c.browser}/${c.backend}/${c.display} created a session without a verified pin`).toBe(
        true
      );
      expect(pin?.artifact).toBe("ort-wasm-simd-threaded.jsep.wasm");
    }
  });
});

describe("a cell cannot reach ACCEPT on weak grounds", () => {
  const accepted = cells.filter((c) => c.verdict === "ACCEPT");

  it("ACCEPT requires the session to load on every run", () => {
    for (const c of accepted) expect(c.sessionLoads).toBe(true);
  });

  it("ACCEPT requires correctness within the PRE-REGISTERED criterion, worst case", () => {
    for (const c of accepted) {
      const k = c.correctness as {
        allCorrect: boolean;
        worstBoxChannelAbs: number;
        worstClassChannelAbs: number;
        nonFinite: number;
        inputsMatchedReference: boolean;
      };
      expect(k.inputsMatchedReference, "a cell that built a different input compared a different question").toBe(true);
      expect(k.allCorrect).toBe(true);
      expect(k.nonFinite).toBe(0);
      expect(k.worstClassChannelAbs).toBeLessThanOrEqual(reference.criterion.classChannelsMaxAbs);
      expect(k.worstBoxChannelAbs).toBeLessThanOrEqual(reference.criterion.boxChannelsMaxAbs);
    }
  });

  it("ACCEPT requires the SHIPPED postprocessing to agree and provenance to survive", () => {
    for (const c of accepted) {
      const k = c.correctness as {
        postprocessingAgrees: boolean;
        labelMismatches: number;
        typedContractOk: boolean;
        detectionsValid: boolean;
        boundsValid: boolean;
        provenanceComplete: boolean;
      };
      expect(k.postprocessingAgrees).toBe(true);
      expect(k.labelMismatches).toBe(0);
      // The typed contract, not just the arithmetic: a Detection that fails validation
      // never becomes a box, and provenance has to survive into VisualDetection.
      expect(k.typedContractOk).toBe(true);
      expect(k.detectionsValid).toBe(true);
      expect(k.boundsValid).toBe(true);
      expect(k.provenanceComplete).toBe(true);
    }
  });

  it("ACCEPT requires bitwise-identical repeated inference", () => {
    for (const c of accepted) {
      expect(
        c.determinism?.bitwiseIdenticalEveryRun,
        `${c.browser}/${c.backend}/${c.display}: output moved between identical calls`
      ).toBe(true);
    }
  });

  it("a WebGPU cell may only be ACCEPT if GPU submissions were OBSERVED during inference", () => {
    // Configuration is not execution. ORT reporting "webgpu" while silently running on
    // WASM would produce a cell that is correct, fast-ish, and completely misdescribed.
    for (const c of accepted.filter((x) => x.backend === "webgpu")) {
      expect(
        c.backendIdentity?.gpuSubmitsDuringInference,
        `${c.browser} webgpu ${c.display} claimed ACCEPT without observed GPU work`
      ).toBeGreaterThan(0);
      expect(c.backendIdentity?.verdict).toMatch(/^CONFIRMED/);
    }
  });

  it("a WASM cell that submitted GPU work is flagged rather than accepted quietly", () => {
    for (const c of cells.filter((x) => x.backend === "wasm")) {
      if (c.backendIdentity?.gpuSubmitsDuringInference == null) continue;
      expect(c.backendIdentity.gpuSubmitsDuringInference).toBe(0);
    }
  });

  it("ACCEPT requires all four dossier fields to be present, not merely LOAD and CORRECT", () => {
    // Benchmark contract Rule 3: does the session load, p50 latency, peak heap, output
    // correctness. A cell missing any of the four is incomplete, whatever it proved.
    for (const c of accepted) {
      expect(typeof c.latency?.warmP50Ms).toBe("number");
      expect(typeof c.memory?.wasmHeapMB.steadyState).toBe("number");
    }
  });

  it("cold and warm latency are reported separately", () => {
    // Rule 1: "Cold start and warm start reported as separate figures." One aggregate
    // number hides a 700 ms first inference behind a 12 ms median.
    for (const c of accepted) {
      const l = c.latency as { sessionCreateMs: { p50: number }; firstInferenceMs: { p50: number }; warmP50Ms: number };
      expect(typeof l.sessionCreateMs.p50).toBe("number");
      expect(typeof l.firstInferenceMs.p50).toBe("number");
      expect(typeof l.warmP50Ms).toBe("number");
    }
  });

  it("model file size, WASM heap and JS heap are never conflated", () => {
    for (const c of accepted) {
      const m = c.memory as { modelFileBytes: number; wasmHeapMB: { steadyState: number }; caution: string };
      expect(m.modelFileBytes).toBe(reference.artifact.bytes);
      expect(m.caution).toMatch(/three different quantities/i);
      // The 0.30 MB artifact cannot account for the arena; asserting otherwise would be
      // the exact conflation the caution warns about.
      expect(m.wasmHeapMB.steadyState * 1048576).toBeGreaterThan(m.modelFileBytes);
    }
  });
});

describe("the input contract the browsers were fed", () => {
  it("matches the shipped head contract", () => {
    for (const c of cells) {
      const dims = (c as unknown as { inputDims?: number[] }).inputDims;
      if (!dims) continue;
      expect(dims).toEqual([1, 3, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.inputSize]);
    }
  });
});
