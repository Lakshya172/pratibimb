/**
 * QG-03a-B2 — the real-model evidence claims no more than it shows.
 *
 * Evidence: artifacts/experiments/W1-QG03a-B2-real-model-nms/
 *
 * These tests guard the evidence file against itself. A B2 PASS must rest on real, verified
 * backend cells with zero true failures; the margin finding must stay recorded; and nothing
 * may be promoted. They do not re-run browsers. The raw dumps are gitignored and
 * reproducible from the harness.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const m = JSON.parse(
  readFileSync(join(REPO, "artifacts/experiments/W1-QG03a-B2-real-model-nms/metrics.json"), "utf8")
);
const MODEL_SHA = "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0";

describe("QG-03a-B2 evidence", () => {
  it("names the exact artifact, which is not committed", () => {
    expect(m.model.sha256).toBe(MODEL_SHA);
    expect(m.model.bytes).toBe(302960);
    expect(m.model.committed).toBe(false);
    for (const c of Object.values(m.cells) as { modelSha256: string }[]) expect(c.modelSha256).toBe(MODEL_SHA);
  });

  it("every cell ran, verified its backend by observation, and was deterministic", () => {
    expect(Object.keys(m.cellsUnavailable)).toHaveLength(0);
    for (const [name, c] of Object.entries(m.cells) as [string, Record<string, unknown>][]) {
      expect(c.backendLabelVerified, name).toBe(true);
      expect(c.errors, name).toBe(0);
      expect(c.deterministic, name).toBe(20);
      expect(c.dumpsVerified, name).toBe(20);
      if (name.endsWith("webgpu")) expect(c.gpuSubmitsDuringInference as number, name).toBeGreaterThan(0);
      if (name.endsWith("wasm")) expect(c.gpuSubmitsDuringInference, name).toBe(0);
    }
    expect(m.fixtures.inputTensorsIdenticalAcrossCells).toBe(m.fixtures.count);
  });

  it("WASM is bitwise identical across browsers (same pinned bytes)", () => {
    const p = m.backendPairs.find((x: { pair: string }) => x.pair === "chrome-wasm vs firefox-wasm");
    expect(p.bitwiseIdenticalFixtures).toBe(20);
  });

  it("B2 PASS rests on zero swaps and zero true failures in EVERY pair and view", () => {
    for (const p of m.backendPairs) {
      for (const v of ["shipped", "op055"]) {
        expect(p[v].survivorSwap, `${p.pair} ${v}`).toBe(0);
        expect(p[v].trueFailures, `${p.pair} ${v}`).toBe(0);
        expect(p[v].preRegisteredPass, `${p.pair} ${v}`).toBe(20);
      }
    }
    expect(m.status.B2_realBackend).toMatch(/^PASS/);
  });

  it("the margin finding stays recorded: failures from 2x the real delta, which is why B is CONDITIONAL", () => {
    const at = (a: number) => m.scaledRealDelta.find((s: { alphaTimesRealDelta: number }) => s.alphaTimesRealDelta === a);
    expect(at(1).alphaOneReproducesWebgpu).toBe(true);
    expect(at(1).shipped.trueFailures).toBe(0);
    expect(at(2).shipped.trueFailures).toBeGreaterThan(0);
    expect(m.status.B_inferenceNoise).toBe("CONDITIONAL");
    expect(m.status.B_conditions.join(" ")).toMatch(/ARCHITECT APPROVAL REQUIRED/);
  });

  it("float32 absorption is reported, not mistaken for stability", () => {
    for (const eps of [1e-9, 1e-8]) {
      const r = m.iidPerturbation.find((x: { relativeEpsilon: number }) => x.relativeEpsilon === eps);
      expect(r.trialsPerturbationRoundedAway).toBe(r.trials);
    }
  });

  it("nothing is promoted or changed", () => {
    expect(m.status.nmsChanged).toBe(false);
    expect(m.status.QG03a).toBe("OPEN");
    expect(m.status.QG03).toBe("CONDITIONAL");
    expect(m.status.detector).toBe("UNADOPTED");
    expect(m.status.frozenThreshold).toBe(0.55);
    expect(m.status.modelRegistry).toBe("UNCHANGED");
    expect(m.status.C_labelRaster).toBe("CONDITIONAL");
  });
});
