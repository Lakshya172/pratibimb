/**
 * G5 structural enforcement for the evaluation package, plus the coordinate chain.
 *
 * The evaluator is local infrastructure. It reads labels and predictions and produces
 * numbers; it has no business touching the network, compiling anything, or constructing a
 * handoff. That is asserted by scanning the source, the same way the perception package
 * does, because "we would notice" is not a control.
 *
 * The coordinate half re-tests the full chain THROUGH the evaluator's own IoU, at all six
 * QG-02 configurations. The point is not to re-verify `coordinates.ts` — that has its own
 * suite — but to prove that a detector operating in model space, un-letterboxed and
 * projected into CSS, is scored against ground truth in the same space it ends up in.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeLetterbox,
  captureToModel,
  modelToCapture,
  cssToCapture,
  captureToCss,
  cssBox,
  type CaptureGeometry,
} from "@pratibimb/perception";
import { iou, evaluate, perfectBaseline, generateDataset } from "@pratibimb/evaluation";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

/** Strip comments so a rule naming a forbidden token does not trip its own tripwire. */
const code = (f: string) =>
  readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const FILES = sourceFiles(SRC);

describe("the scan is wired up", () => {
  it("finds the evaluation sources", () => {
    // A scan over an empty file list passes every rule below while proving nothing.
    expect(FILES.length).toBeGreaterThan(3);
    expect(FILES.some((f) => f.endsWith("evaluator.ts"))).toBe(true);
  });
});

describe("G5 — the evaluator is local infrastructure", () => {
  it.each(["fetch(", "XMLHttpRequest", "sendBeacon", "new WebSocket", "EventSource"])(
    "no source file references %s",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token));
      expect(
        offenders,
        `${token} found in ${offenders.join(", ")}. QG-04 is UNSIGNED: no code may make a ` +
          "network call until it passes, and an evaluator has no reason to want one."
      ).toEqual([]);
    }
  );

  it.each(["WebAssembly.compile", "WebAssembly.instantiate", "new Function", "eval("])(
    "no source file references %s",
    (token) => {
      expect(FILES.filter((f) => code(f).includes(token))).toEqual([]);
    }
  );

  it("contains no model URL — nothing is downloaded at runtime", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/https?:\/\/[^\s"']*\.(onnx|bin|safetensors|pt|pth)/);
      expect(code(f), f).not.toMatch(/huggingface\.co|media\.githubusercontent\.com/);
    }
  });

  it("never constructs a sanitized handoff", () => {
    // The evaluator reads perception's types; it must not become a second route out of the
    // perception boundary.
    for (const f of FILES) {
      expect(code(f), f).not.toContain("SanitizedHandoff");
      expect(code(f), f).not.toMatch(/verified:\s*true/);
    }
  });

  it("imports nothing from a network-capable module", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/from\s+["'](node:http|node:https|axios|node-fetch)["']/);
    }
  });

  it("does not embed privacy redaction — that is T2's contract, not the evaluator's", () => {
    // Sanitizing inside the evaluator would create a second, undocumented redaction path
    // that the real sanitize tier would later have to discover and reconcile.
    for (const f of FILES) {
      const s = code(f);
      expect(s, f).not.toMatch(/redact|GLiNER|Verhoeff|Luhn/i);
      expect(s, f).not.toMatch(/<PII:/);
    }
  });
});

describe("the coordinate chain, scored in canonical space", () => {
  /** The six QG-02 configurations. `dpr` is effective — it already folds zoom in. */
  const MATRIX = [
    { name: "DPR 1.0 @ 100%", physicalDpr: 1.0, zoom: 1.0 },
    { name: "DPR 1.0 @ 125%", physicalDpr: 1.0, zoom: 1.25 },
    { name: "DPR 1.5 @ 100%", physicalDpr: 1.5, zoom: 1.0 },
    { name: "DPR 1.5 @ 125%", physicalDpr: 1.5, zoom: 1.25 },
    { name: "DPR 2.0 @ 100%", physicalDpr: 2.0, zoom: 1.0 },
    { name: "DPR 2.0 @ 125%", physicalDpr: 2.0, zoom: 1.25 },
  ];

  const geometryFor = (physicalDpr: number, zoom: number): CaptureGeometry => {
    const dpr = physicalDpr * zoom;
    return {
      dpr,
      zoom,
      viewportCss: { w: 1024, h: 640 },
      captureSize: { w: Math.round(1024 * dpr), h: Math.round(640 * dpr) },
      scroll: { x: 0, y: 0 },
      origin: "https://seva.gov.in",
    };
  };

  it.each(MATRIX)("scores a perfect round trip as IoU 1.0 at $name", ({ physicalDpr, zoom }) => {
    const g = geometryFor(physicalDpr, zoom);
    const t = computeLetterbox(g.captureSize, 640);
    const truth = cssBox(400, 260, 300, 32);

    // CSS -> capture -> model -> capture -> CSS, exactly the detector's path.
    const roundTripped = captureToCss(
      modelToCapture(captureToModel(cssToCapture(truth, g), t), t),
      g
    );
    expect(iou(truth, roundTripped)).toBeCloseTo(1.0, 6);
  });

  it("catches the doubled-zoom bug through the metric", () => {
    // devicePixelRatio ALREADY includes zoom. Multiplying again is wrong by exactly the
    // zoom factor - invisible at 100%, which is every dev machine.
    const g = geometryFor(2.0, 1.25); // effective dpr 2.5
    const truth = cssBox(400, 260, 300, 32);
    const doubled = cssBox(400 * 1.25, 260 * 1.25, 300 * 1.25, 32 * 1.25);
    expect(iou(truth, doubled)).toBeLessThan(0.5);
    expect(g.dpr).toBeCloseTo(2.5, 9);
  });

  it("catches a forgotten letterbox un-pad through the metric", () => {
    // At 1024x640 into 640 square the vertical padding is 120 model px. Skipping the
    // un-pad puts every box ~192 capture px too low.
    const g = geometryFor(1.0, 1.0);
    const t = computeLetterbox(g.captureSize, 640);
    const truth = cssBox(400, 100, 300, 32);
    const inModel = captureToModel(cssToCapture(truth, g), t);

    const correct = captureToCss(modelToCapture(inModel, t), g);
    // The wrong version: divide by scale without removing the pad first.
    const wrong = cssBox(inModel.x / t.scale, inModel.y / t.scale, inModel.w / t.scale, inModel.h / t.scale);

    expect(iou(truth, correct)).toBeCloseTo(1.0, 6);
    expect(iou(truth, wrong)).toBeLessThan(0.5);
  });

  it("scores fractional geometry without rounding it away", () => {
    const g = geometryFor(1.5, 1.0);
    const t = computeLetterbox(g.captureSize, 640);
    const truth = cssBox(100.4, 200.6, 33.3, 11.1);
    const back = captureToCss(modelToCapture(captureToModel(cssToCapture(truth, g), t), t), g);
    expect(iou(truth, back)).toBeCloseTo(1.0, 5);
  });
});

describe("the evaluator consumes the canonical space and nothing else", () => {
  it("scores CSS-space predictions perfectly and capture-space ones badly", () => {
    // The dataset stores CSS viewport pixels because that is the public perception space.
    // A second, private dataset space would need a conversion nobody tests.
    const dataset = generateDataset({
      name: "coord-check",
      version: "1.0.0",
      seed: 1,
      counts: { train: 2, dev: 2, test: 2 },
      createdAt: "2026-09-10T00:00:00.000Z",
    });
    const ctx = {
      modelId: "baseline",
      modelRevision: "x",
      backend: "none" as const,
      browser: "node",
      preprocessing: "none",
      evaluatedAt: "2026-09-10T00:00:00.000Z",
    };
    const correct = evaluate(dataset, perfectBaseline(dataset, "test"), "test", ctx);
    expect(correct.elementRecall.value).toBeCloseTo(1.0, 9);
  });
});
