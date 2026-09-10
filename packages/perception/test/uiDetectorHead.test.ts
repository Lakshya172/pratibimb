/**
 * The T1 detector head — tensor contract, decode, NMS, and capability-aware refusal.
 *
 * The head has no weights. That is the honest current state, and the most important test
 * in this file asserts it is reported as `MODEL_ASSET_UNAVAILABLE` rather than as an empty
 * detection list — an empty list cannot be told apart from a working detector on a page
 * with no controls, which is exactly how a dead perception tier ships unnoticed.
 */
import { describe, it, expect, vi } from "vitest";
import {
  type CaptureFrame,
  type HeadOutput,
  type HeadRuntime,
  HEAD_CONTRACT,
  UI_CLASSES,
  PROVISIONAL_THRESHOLDS,
  FUSION_IOU_THRESHOLD,
  decodeHeadOutput,
  projectToCapture,
  createUiElementDetector,
  computeLetterbox,
  frameId,
} from "@pratibimb/perception";

const frame: CaptureFrame = {
  id: frameId("f1"),
  capturedAt: 1000,
  pixels: new Uint8Array([1]),
  format: "png",
  geometry: {
    dpr: 1.0,
    zoom: 1.0,
    viewportCss: { w: 1024, h: 640 },
    captureSize: { w: 1024, h: 640 },
    scroll: { x: 0, y: 0 },
    origin: "https://seva.gov.in",
  },
};

const C = UI_CLASSES.length;

/**
 * Build a `[1, 4+C, A]` tensor. Anchors are columns, so channel c of anchor a lives at
 * `c * A + a` — the layout the decoder asserts.
 */
function tensor(anchors: { cx: number; cy: number; w: number; h: number; cls: number; score: number }[]): HeadOutput {
  const A = anchors.length;
  const data = new Float32Array((4 + C) * A);
  anchors.forEach((a, i) => {
    data[0 * A + i] = a.cx;
    data[1 * A + i] = a.cy;
    data[2 * A + i] = a.w;
    data[3 * A + i] = a.h;
    data[(4 + a.cls) * A + i] = a.score;
  });
  return { data, dims: [1, 4 + C, A] };
}

describe("the tensor contract is explicit", () => {
  it("declares everything a weight file must agree with", () => {
    // Changing any of these invalidates every trained weight file, so they are recorded
    // rather than implied by whatever the preprocessing code happens to do.
    expect(HEAD_CONTRACT.inputSize).toBe(640);
    expect(HEAD_CONTRACT.inputLayout).toBe("NCHW");
    expect(HEAD_CONTRACT.channelOrder).toBe("RGB");
    expect(HEAD_CONTRACT.normalization).toBe("0..1");
    expect(HEAD_CONTRACT.outputLayout).toBe("[1, 4+C, A]");
    expect(HEAD_CONTRACT.classes).toEqual(UI_CLASSES);
  });

  it("keeps NMS agreeing with the frozen fusion threshold", () => {
    // If NMS merged more aggressively than fusion matches, the head would suppress a box
    // fusion would have paired with a real DOM node, and that element would silently
    // become DOM-only. Not a coincidence to be tidied away.
    expect(PROVISIONAL_THRESHOLDS.nmsIou).toBe(FUSION_IOU_THRESHOLD);
  });

  it("marks its thresholds PROVISIONAL, with the harness that should set them", () => {
    // Guards against a threshold being quietly tuned until a fixture goes green.
    expect(PROVISIONAL_THRESHOLDS.status).toMatch(/PROVISIONAL/);
    expect(PROVISIONAL_THRESHOLDS.status).toMatch(/mAP@0\.5/);
  });
});

describe("decode", () => {
  it("decodes centre-form boxes into corner form", () => {
    const r = decodeHeadOutput(tensor([{ cx: 100, cy: 200, w: 40, h: 20, cls: 0, score: 0.9 }]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(1);
    expect(r.value[0]!.box.x).toBeCloseTo(80, 6); // 100 - 40/2
    expect(r.value[0]!.box.y).toBeCloseTo(190, 6); // 200 - 20/2
    expect(r.value[0]!.label).toBe("button");
    expect(r.value[0]!.score).toBeCloseTo(0.9, 6);
  });

  it("drops anchors below the score threshold", () => {
    const r = decodeHeadOutput(tensor([{ cx: 10, cy: 10, w: 4, h: 4, cls: 0, score: 0.05 }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(0);
  });

  it("picks the highest-scoring class per anchor", () => {
    const A = 1;
    const data = new Float32Array((4 + C) * A);
    data[0] = 100; data[1] = 100; data[2] = 20; data[3] = 20;
    data[(4 + 0) * A] = 0.3; // button
    data[(4 + 2) * A] = 0.8; // textbox
    const r = decodeHeadOutput({ data, dims: [1, 4 + C, A] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]!.label).toBe("textbox");
  });

  it.each([
    ["wrong rank", { data: new Float32Array(10), dims: [4 + C, 1] }],
    ["batch != 1", { data: new Float32Array((4 + C) * 2), dims: [2, 4 + C, 1] }],
    ["channel count disagreeing with the class list", { data: new Float32Array(5), dims: [1, 5, 1] }],
    ["zero anchors", { data: new Float32Array(0), dims: [1, 4 + C, 0] }],
    ["data shorter than dims declare", { data: new Float32Array(3), dims: [1, 4 + C, 4] }],
  ])("REFUSES %s", (_label, out) => {
    const r = decodeHeadOutput(out as HeadOutput);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MODEL_OUTPUT_MALFORMED");
  });

  it("REFUSES a non-finite value rather than skipping the anchor", () => {
    // Skipping silently would let a broken head look like a quiet one.
    const r = decodeHeadOutput(
      tensor([{ cx: Number.NaN, cy: 10, w: 10, h: 10, cls: 0, score: 0.9 }])
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/non-finite/);
  });

  it("REFUSES a score above 1 — the head is not emitting probabilities", () => {
    const r = decodeHeadOutput(tensor([{ cx: 10, cy: 10, w: 10, h: 10, cls: 0, score: 1.4 }]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/not emitting probabilities/);
  });

  it("drops non-positive extents without failing the whole frame", () => {
    // A degenerate box is a bad detection, not a broken model.
    const r = decodeHeadOutput(tensor([{ cx: 10, cy: 10, w: 0, h: 10, cls: 0, score: 0.9 }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(0);
  });
});

describe("NMS", () => {
  it("suppresses a heavily overlapping same-class box", () => {
    const r = decodeHeadOutput(
      tensor([
        { cx: 100, cy: 100, w: 50, h: 50, cls: 0, score: 0.9 },
        { cx: 102, cy: 102, w: 50, h: 50, cls: 0, score: 0.7 },
      ])
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(1);
      expect(r.value[0]!.score).toBeCloseTo(0.9, 6); // the stronger one survives
    }
  });

  it("keeps overlapping boxes of DIFFERENT classes", () => {
    // A checkbox inside its label's clickable region is two genuinely different targets.
    // Class-agnostic NMS would delete one of them.
    const r = decodeHeadOutput(
      tensor([
        { cx: 100, cy: 100, w: 50, h: 50, cls: 0, score: 0.9 }, // button
        { cx: 102, cy: 102, w: 50, h: 50, cls: 3, score: 0.7 }, // checkbox
      ])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it("keeps distant same-class boxes", () => {
    const r = decodeHeadOutput(
      tensor([
        { cx: 100, cy: 100, w: 40, h: 40, cls: 0, score: 0.9 },
        { cx: 400, cy: 400, w: 40, h: 40, cls: 0, score: 0.8 },
      ])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });

  it("is DETERMINISTIC — identical input, identical output", () => {
    const build = () =>
      tensor([
        { cx: 100, cy: 100, w: 50, h: 50, cls: 0, score: 0.5 },
        { cx: 300, cy: 300, w: 50, h: 50, cls: 1, score: 0.5 },
        { cx: 500, cy: 100, w: 50, h: 50, cls: 2, score: 0.5 },
      ]);
    const a = decodeHeadOutput(build());
    const b = decodeHeadOutput(build());
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
    }
  });

  it("breaks score ties by original index, not by hash order", () => {
    // Equal scores must not reorder run to run, or every downstream fusion test becomes
    // flaky for reasons nobody can reproduce.
    const r = decodeHeadOutput(
      tensor([
        { cx: 100, cy: 100, w: 40, h: 40, cls: 0, score: 0.6 },
        { cx: 400, cy: 400, w: 40, h: 40, cls: 0, score: 0.6 },
      ])
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[0]!.box.x).toBeCloseTo(80, 6); // the first anchor
  });
});

describe("projection into capture space", () => {
  const transform = computeLetterbox({ w: 1024, h: 640 }, 640); // padY = 120

  it("un-letterboxes into capture pixels", () => {
    const decoded = decodeHeadOutput(
      tensor([{ cx: 320, cy: 320, w: 100, h: 40, cls: 0, score: 0.9 }])
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    const projected = projectToCapture(decoded.value, transform);
    expect(projected).toHaveLength(1);
    // Model centre (320, 320) -> content-relative (320, 200) -> capture (512, 320).
    const b = projected[0]!.box;
    expect(b.x + b.w / 2).toBeCloseTo(512, 4);
    expect(b.y + b.h / 2).toBeCloseTo(320, 4);
  });

  it("DROPS a detection that lives entirely in the padding", () => {
    // The padding is grey bars this code invented; a box there describes nothing real.
    const decoded = decodeHeadOutput(
      tensor([{ cx: 320, cy: 50, w: 100, h: 40, cls: 0, score: 0.9 }])
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(projectToCapture(decoded.value, transform)).toHaveLength(0);
  });
});

describe("capability-aware state — there are no weights", () => {
  it("REPORTS MODEL_ASSET_UNAVAILABLE rather than returning an empty list", async () => {
    // The load-bearing test of this file. An empty detection list is indistinguishable
    // from a working detector on a page with no controls.
    const detector = createUiElementDetector(null);
    const r = await detector.detect(frame, "wasm");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("MODEL_ASSET_UNAVAILABLE");
      expect(r.detail).toMatch(/licence-excluded/);
      expect(r.detail).toMatch(/DOM-only floor/);
    }
  });

  it("advertises no accepted backends while unbuilt", () => {
    const detector = createUiElementDetector(null);
    expect(detector.acceptedBackends).toEqual([]);
    expect(detector.revision).toBe("unbuilt");
  });

  it("REFUSES a backend the weights were never measured on", async () => {
    const runtime: HeadRuntime = {
      modelId: "pratibimb-ui-head",
      revision: "v0",
      acceptedBackends: ["wasm"], // measured on wasm only
      preprocess: async () => new Float32Array(3 * 640 * 640),
      infer: async () => tensor([]),
    };
    const r = await createUiElementDetector(runtime).detect(frame, "webgpu");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DETECTOR_BACKEND_UNSUPPORTED");
  });

  it("REFUSES a preprocessing result of the wrong size", async () => {
    const runtime: HeadRuntime = {
      modelId: "m",
      revision: "v0",
      acceptedBackends: ["wasm"],
      preprocess: async () => new Float32Array(10), // wrong
      infer: async () => tensor([]),
    };
    const r = await createUiElementDetector(runtime).detect(frame, "wasm");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MODEL_OUTPUT_MALFORMED");
  });

  it("REPORTS an inference failure rather than a quiet zero-detection result", async () => {
    const runtime: HeadRuntime = {
      modelId: "m",
      revision: "v0",
      acceptedBackends: ["wasm"],
      preprocess: async () => new Float32Array(3 * 640 * 640),
      infer: async () => {
        throw new Error("session disposed");
      },
    };
    const r = await createUiElementDetector(runtime).detect(frame, "wasm");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("DETECTOR_UNAVAILABLE");
      expect(r.detail).toMatch(/session disposed/);
    }
  });

  it("runs the full path when weights and backend are both present", async () => {
    const infer = vi.fn(async () =>
      tensor([{ cx: 320, cy: 320, w: 100, h: 40, cls: 0, score: 0.9 }])
    );
    const runtime: HeadRuntime = {
      modelId: "pratibimb-ui-head",
      revision: "v0",
      acceptedBackends: ["wasm"],
      preprocess: async () => new Float32Array(3 * 640 * 640),
      infer,
    };
    const r = await createUiElementDetector(runtime).detect(frame, "wasm");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(1);
    expect(infer).toHaveBeenCalledOnce();
  });
});
