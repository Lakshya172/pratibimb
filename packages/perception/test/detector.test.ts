/**
 * The detector abstraction — capability-aware selection and untrusted-output validation.
 *
 * Nearly every test here asserts a REFUSAL, for the same reason the ORT pin suite does:
 * the value of this layer is in what it declines to run and what it declines to believe.
 * A registry that always returns something is a registry that will eventually return an
 * excluded model.
 */
import { describe, it, expect } from "vitest";
import {
  type CaptureFrame,
  type Detector,
  DetectorRegistry,
  validateDetections,
  toVisualDetections,
  frameId,
} from "@pratibimb/perception";

const frame: CaptureFrame = {
  id: frameId("f1"),
  capturedAt: 1000,
  pixels: new Uint8Array([1, 2, 3]),
  format: "png",
  geometry: {
    dpr: 2.0,
    zoom: 1.0,
    viewportCss: { w: 1024, h: 640 },
    captureSize: { w: 2048, h: 1280 },
    scroll: { x: 0, y: 0 },
    origin: "https://seva.gov.in",
  },
};

/** YuNet is the one model with a full ACCEPT on both backends in the registry. */
const yunet: Detector = {
  role: "FaceDetector",
  modelId: "face_detection_yunet_2023mar",
  revision: "47534e27",
  acceptedBackends: ["wasm", "webgpu"],
  detect: async () => ({ ok: true, value: [] }),
};

/** PP-OCRv5 det: passes on WebGPU, FAILS the S-04a-1 correctness criterion on wasm. */
const ppocrDet: Detector = {
  role: "OCRProvider",
  modelId: "PP-OCRv5_mobile_det",
  revision: "0d63e78e",
  acceptedBackends: ["webgpu"],
  detect: async () => ({ ok: true, value: [] }),
};

describe("capability-aware selection", () => {
  it("resolves a detector that is accepted on the requested backend", () => {
    const r = new DetectorRegistry().register("FaceDetector", {
      status: "ADMISSIBLE",
      detector: yunet,
    });
    const got = r.resolve("FaceDetector", "wasm");
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.value.modelId).toBe("face_detection_yunet_2023mar");
  });

  it("REFUSES a model on a backend where it failed the correctness criterion", () => {
    // QG-03: "The WASM columns pass. A model that fails them is not shipped whatever it
    // does on WebGPU." Running it anyway would produce boxes that are measurably wrong.
    const r = new DetectorRegistry().register("OCRProvider", {
      status: "ADMISSIBLE",
      detector: ppocrDet,
    });
    const got = r.resolve("OCRProvider", "wasm");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.code).toBe("DETECTOR_BACKEND_UNSUPPORTED");
      expect(got.detail).toMatch(/webgpu/);
    }
  });

  it("still resolves that same model on the backend it passed on", () => {
    const r = new DetectorRegistry().register("OCRProvider", {
      status: "ADMISSIBLE",
      detector: ppocrDet,
    });
    expect(r.resolve("OCRProvider", "webgpu").ok).toBe(true);
  });

  it("REFUSES a role with no registered implementation", () => {
    // The current state of UIElementDetector: option A is licence-excluded, option B is
    // week 3, option C is the DOM-only floor. Returning an empty detection list instead
    // would be indistinguishable from a page with no controls.
    const got = new DetectorRegistry().resolve("UIElementDetector", "wasm");
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.code).toBe("DETECTOR_UNAVAILABLE");
  });

  it("keeps EXCLUDED distinct from UNAVAILABLE, and never substitutes for it", () => {
    // "Not installed" invites someone to install it. "Licence-excluded" must not be
    // resolved that way, and the reason has to survive in the refusal text.
    const r = new DetectorRegistry().register("UIElementDetector", {
      status: "EXCLUDED",
      reason: "OmniParser icon_detect is AGPL-3.0; section 13 has network-service implications",
    });
    const got = r.resolve("UIElementDetector", "wasm");
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.detail).toMatch(/EXCLUDED/);
      expect(got.detail).toMatch(/AGPL/);
    }
    expect(r.has("UIElementDetector")).toBe(false);
  });

  it("has() reports only admissible roles", () => {
    const r = new DetectorRegistry()
      .register("FaceDetector", { status: "ADMISSIBLE", detector: yunet })
      .register("PIIDetector", { status: "UNAVAILABLE", reason: "asset not packaged" });
    expect(r.has("FaceDetector")).toBe(true);
    expect(r.has("PIIDetector")).toBe(false);
  });
});

describe("model output is untrusted input", () => {
  const good = [{ x: 10, y: 20, w: 100, h: 40, score: 0.9, label: "face" }];

  it("accepts a well-formed detection", () => {
    const r = validateDetections(good, frame);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
  });

  it.each([
    ["not an array", { x: 1 }],
    ["a null entry", [null]],
    ["NaN coordinates", [{ x: Number.NaN, y: 0, w: 10, h: 10, score: 0.5, label: "a" }]],
    ["Infinite extent", [{ x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 10, score: 0.5, label: "a" }]],
    ["negative extent", [{ x: 0, y: 0, w: -5, h: 10, score: 0.5, label: "a" }]],
    ["zero extent", [{ x: 0, y: 0, w: 0, h: 10, score: 0.5, label: "a" }]],
    ["score above 1", [{ x: 0, y: 0, w: 10, h: 10, score: 1.5, label: "a" }]],
    ["score below 0", [{ x: 0, y: 0, w: 10, h: 10, score: -0.1, label: "a" }]],
    ["missing label", [{ x: 0, y: 0, w: 10, h: 10, score: 0.5 }]],
    ["a box outside the frame", [{ x: 2040, y: 0, w: 100, h: 10, score: 0.5, label: "a" }]],
  ])("REFUSES %s", (_label, raw) => {
    const r = validateDetections(raw, frame);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MODEL_OUTPUT_MALFORMED");
  });

  it("refuses a box the detector could not have seen", () => {
    // A detector cannot see outside the frame it was handed. A box claiming otherwise is
    // malformed output, not a discovery — and unchecked it becomes a click off-screen.
    const r = validateDetections(
      [{ x: 0, y: 1270, w: 100, h: 100, score: 0.9, label: "face" }],
      frame
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/outside the 2048x1280 frame/);
  });
});

describe("promotion into canonical space", () => {
  it("converts capture pixels to CSS pixels and tags the frame", () => {
    const validated = validateDetections(
      [{ x: 200, y: 100, w: 400, h: 80, score: 0.9, label: "face" }],
      frame
    );
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const promoted = toVisualDetections(validated.value, frame, "FaceDetector");
    // scale_to_css = 1024/2048 = 0.5
    expect(promoted[0]!.box.x).toBeCloseTo(100, 9);
    expect(promoted[0]!.box.w).toBeCloseTo(200, 9);
    // Every visual claim carries the frame that justifies it.
    expect(promoted[0]!.frameId).toBe(frame.id);
    expect(promoted[0]!.role).toBe("FaceDetector");
  });
});
