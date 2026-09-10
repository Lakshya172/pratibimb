/**
 * G5 standing rules — enforced by scanning the source, not by asserting in prose.
 *
 * ADR-0001 §12.1 recorded G5 as PASS on three structural arguments plus two STANDING RULES
 * for the workstreams that follow, because G5 is a property future code can break. This is
 * the first workstream that follows, so this file is where those rules stop being a
 * promise.
 *
 * The rules, restated as executable checks over `packages/perception/src`:
 *
 *   1. Model outputs cannot reach a WebAssembly compilation path.
 *   2. Perception cannot create outbound network requests.
 *   3. Network access stays behind the egress architecture (which does not exist yet, so
 *      the correct amount of it here is none).
 *   4. Raw observations do not silently become reasoning payloads.
 *   5. Capability failures do not trigger an insecure fallback.
 *
 * A source scan is a blunt instrument and is not claimed to be a proof. It is a tripwire
 * on the specific, greppable ways each rule gets broken in practice — which is the failure
 * mode that actually occurs, someone adding a `fetch` for convenience during development.
 * QG-04 additionally requires a build-failing lint rule over the whole repository; that
 * gate is UNSIGNED and this test is not it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

/** Strip comments so a rule NAMING a forbidden token does not trip its own tripwire. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const FILES = sourceFiles(SRC);

describe("the scan itself is wired up", () => {
  it("finds the perception sources", () => {
    // A scan over an empty file list passes every rule below while proving nothing. This
    // is the control that keeps the rest of the file honest.
    expect(FILES.length).toBeGreaterThan(5);
    expect(FILES.some((f) => f.endsWith("fusion.ts"))).toBe(true);
  });

  it("strips comments before scanning", () => {
    const withComment = "/* fetch( */ const x = 1;";
    expect(withComment.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/fetch\(/);
  });
});

describe("G5 rule 2 and 3 — perception makes no network calls", () => {
  it.each(["fetch(", "XMLHttpRequest", "sendBeacon", "new WebSocket", "EventSource"])(
    "no source file references %s",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token));
      expect(
        offenders,
        `${token} found in ${offenders.join(", ")}. Network access belongs behind the ` +
          "egress module, and QG-04 is UNSIGNED: no code may make a network call until it passes."
      ).toEqual([]);
    }
  );

  it("imports nothing from a network-capable module", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/from\s+["'](node:http|node:https|axios|node-fetch)["']/);
    }
  });
});

describe("G5 rule 1 — model output cannot reach a compilation path", () => {
  it.each(["WebAssembly.compile", "WebAssembly.instantiate", "new Function", "eval("])(
    "no source file references %s",
    (token) => {
      const offenders = FILES.filter((f) => code(f).includes(token));
      expect(offenders, `${token} found in ${offenders.join(", ")}`).toEqual([]);
    }
  );

  it("the only thing detector output can become is a bounded rectangle", () => {
    // validateDetections is the single entry point for model output. It reads exactly
    // five numeric fields and one string, and everything else is refused, so there is no
    // route from a detector's bytes into code.
    const detector = code(join(SRC, "detector.ts"));
    expect(detector).toContain("MODEL_OUTPUT_MALFORMED");
    expect(detector).not.toMatch(/import\s*\(/); // no dynamic import
    expect(detector).not.toContain("Function(");
  });
});

describe("G5 rule 4 — raw observations do not silently become payloads", () => {
  it("the sanitized handoff type cannot carry a frame", () => {
    // Structural, not conventional: SanitizedHandoff has no field of any pixel-bearing
    // type, so the convenient "just send the frame for debugging" shortcut does not
    // compile and cannot quietly become permanent.
    const state = code(join(SRC, "perceptionState.ts"));
    const handoff = state.slice(state.indexOf("interface SanitizedHandoff"));
    const body = handoff.slice(0, handoff.indexOf("\n}"));

    expect(body).not.toContain("CaptureFrame");
    expect(body).not.toContain("pixels");
    expect(body).not.toContain("frame:");
  });

  it("provides no function that constructs a complete handoff", () => {
    // The tier allowed to produce one is T2 sanitize, which does not exist. Writing a
    // constructor here would mean inventing the redaction contract ahead of its owner.
    const state = code(join(SRC, "perceptionState.ts"));
    expect(state).not.toMatch(/function\s+toHandoff/);
    expect(state).not.toMatch(/:\s*SanitizedHandoff\s*\{/);
  });

  it("types `verified` so the only constructible value is the un-sendable one", () => {
    // The egress guard refuses to transmit unless verified === true. Typed as literal
    // `false`, so fail-closed is a property of the type rather than a default.
    expect(code(join(SRC, "perceptionState.ts"))).toMatch(/readonly verified:\s*false/);
  });
});

describe("G5 rule 5 — capability failure does not fall back insecurely", () => {
  it("the detector registry has no fallback chain", () => {
    // A fallback chain is how an excluded model gets run: something fails, the chain moves
    // on, and what it moved on to was excluded for a reason nobody re-reads at 2 a.m.
    const detector = code(join(SRC, "detector.ts"));
    expect(detector).not.toMatch(/fallback/i);
    expect(detector).not.toMatch(/\|\|\s*this\.entries\.get/);
  });

  it("keeps EXCLUDED representable so it can never be treated as merely missing", () => {
    expect(code(join(SRC, "detector.ts"))).toContain('"EXCLUDED"');
  });

  it("every failure path produces a typed code rather than a default value", () => {
    const failure = code(join(SRC, "failure.ts"));
    for (const c of [
      "CAPTURE_FAILED",
      "CAPTURE_DIMENSION_MISMATCH",
      "COORDINATE_TRANSFORM_AMBIGUOUS",
      "STALE_FRAME",
      "ELEMENT_OUTSIDE_CAPTURE",
      "DETECTOR_UNAVAILABLE",
      "DETECTOR_BACKEND_UNSUPPORTED",
      "MODEL_OUTPUT_MALFORMED",
      "MODEL_ASSET_UNAVAILABLE",
      "PROVENANCE_UNAVAILABLE",
    ]) {
      expect(failure, `${c} must remain a representable state`).toContain(c);
    }
  });
});

describe("G5 — no runtime model downloads", () => {
  it("no source file contains a model URL", () => {
    // Model assets are packaged and pinned per the model registry. A URL here would be a
    // runtime download by another name.
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/https?:\/\/[^\s"']*\.(onnx|bin|safetensors)/);
      expect(code(f), f).not.toMatch(/huggingface\.co|media\.githubusercontent\.com/);
    }
  });
});
