/**
 * The T1 `UIElementDetector` head — tensor contract, decode, and capability-aware state.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHICH IMPLEMENTATION THIS IS, AND WHY
 *
 * The frozen constitution §8 ranks three options for this role:
 *
 *   A  OmniParser icon_detect_v3, ONNX INT8      LICENCE-EXCLUDED. `icon_detect` is
 *                                                AGPL-3.0, and the `icon_detect_v3`
 *                                                re-exports declare NO licence, so they
 *                                                inherit the question rather than escape
 *                                                it. The registry cell is unverified.
 *   B  our own head, trained on the synthetic    "Started in week three regardless of
 *      set                                       whether A is working... it removes the
 *                                                biggest single point of failure."
 *   C  DOM-only degradation                      the floor, currently in force.
 *
 * This module implements **B's inference path**. Deliberately NOT its weights: training is
 * a separate workstream with a separate data pipeline, and the dossier's own metric
 * (element mAP@0.5, element recall, grounding accuracy, over ScreenSpot-v2 plus 300
 * self-labelled screens) belongs to the evaluation harness at QG-05.
 *
 * The tensor contract deliberately MATCHES option A's — YOLO-family, square letterboxed
 * input, anchor-free decode. Two reasons, and the second is the important one:
 *
 *   1. It is the standard for this class of head, so our own weights can target it.
 *   2. It keeps A DROPPABLE-IN. If the `icon_detect_v3` licence question is ever resolved
 *      in writing, it becomes a weights swap rather than a rewrite of perception
 *      orchestration. Building B against a bespoke contract would burn that option for no
 *      benefit.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE REFUSES TO DO
 *
 * With no weights present it reports `MODEL_ASSET_UNAVAILABLE` and the registry keeps the
 * role UNAVAILABLE. It does not return an empty detection list, because an empty list is
 * indistinguishable from a working detector on a page with no controls — and that
 * ambiguity is precisely how a silently dead perception tier ships.
 */
import type { CaptureFrame } from "./capture.js";
import { type ModelBox, modelBox } from "./space.js";
import {
  type LetterboxTransform,
  computeLetterbox,
  modelToCapture,
  clipToContent,
} from "./letterbox.js";
import type { Backend, Detection, Detector, DetectorRole } from "./detector.js";
import { type Perceived, ok, refuse } from "./failure.js";

/**
 * The visual classes this head is defined over.
 *
 * Chosen to be the interactable surface the dossier's grounding metric scores — the things
 * a plan can target. Deliberately NOT a taxonomy of everything on a page: a class the head
 * cannot reliably separate is a class that adds false positives to fusion without adding
 * anything a planner can act on.
 *
 * Text and images are absent on purpose. Those belong to OCR (T2) and to the DOM, both of
 * which already describe them better than a box detector would.
 */
export const UI_CLASSES = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "select",
  "tab",
  "icon",
] as const;

export type UiClass = (typeof UI_CLASSES)[number];

/**
 * The tensor contract. Changing any field here invalidates every trained weight file, so
 * it is recorded explicitly rather than implied by the preprocessing code.
 */
export interface HeadTensorContract {
  /** Square input edge, model pixels. 640 matches the reference architecture. */
  readonly inputSize: number;
  /** `[1, 3, H, W]`, float32. Channels-first, the ONNX convention for this family. */
  readonly inputLayout: "NCHW";
  /** RGB, normalised to 0..1. NOT ImageNet mean/std — this family does not use it. */
  readonly channelOrder: "RGB";
  readonly normalization: "0..1";
  /** Padding colour used when letterboxing. Must match training. */
  readonly padValue: number;
  /**
   * `[1, 4 + numClasses, numAnchors]`. Anchor-free: each anchor emits cx, cy, w, h in
   * MODEL pixels, followed by one score per class. No objectness channel.
   */
  readonly outputLayout: "[1, 4+C, A]";
  readonly classes: readonly UiClass[];
}

export const HEAD_CONTRACT: HeadTensorContract = {
  inputSize: 640,
  inputLayout: "NCHW",
  channelOrder: "RGB",
  normalization: "0..1",
  padValue: 114 / 255, // the conventional grey for this family; must match training
  outputLayout: "[1, 4+C, A]",
  classes: UI_CLASSES,
};

/**
 * Thresholds.
 *
 * BOTH ARE PROVISIONAL AND SAY SO. Neither comes from project evidence, because the
 * evaluation set that would justify them does not exist yet — the dossier prescribes
 * ScreenSpot-v2 plus 300 self-labelled screens, scored on element mAP@0.5 and element
 * recall, and that is the QG-05 harness.
 *
 * They are named exports with this note attached so they are tuned against that harness
 * when it lands, rather than being quietly adjusted until a fixture goes green — which is
 * the failure mode the brief explicitly names.
 *
 * `nmsIou` is set to 0.5 to agree with the FROZEN fusion threshold in constitution §7.
 * That is not a coincidence to be tidied away: if NMS merged more aggressively than fusion
 * matches, the head would suppress a box that fusion would have paired with a real DOM
 * node, and the element would silently become DOM-only.
 */
export const PROVISIONAL_THRESHOLDS = {
  /** Minimum class score for a detection to survive. PROVISIONAL. */
  score: 0.25,
  /** IoU above which overlapping same-class boxes are merged. Matches fusion's 0.5. */
  nmsIou: 0.5,
  /** Hard cap on detections per frame, so a degenerate head cannot flood fusion. */
  maxDetections: 300,
  status: "PROVISIONAL — not derived from project evidence; tune against the QG-05 " +
    "harness (element mAP@0.5, element recall) over ScreenSpot-v2 plus the 300 " +
    "self-labelled screens, per the dossier's scored metric.",
} as const;

/** Raw model output, before it means anything. */
export interface HeadOutput {
  /** Flat `[1, 4+C, A]` tensor data. */
  readonly data: Float32Array | readonly number[];
  readonly dims: readonly number[];
}

/**
 * Decode raw head output into model-space boxes.
 *
 * Fails closed on any shape it does not recognise. A tensor with the wrong rank or a
 * channel count that disagrees with the class list is not something to interpret
 * generously — it means the weights and this code disagree about what the model is, and
 * every box that followed would be a confident fabrication.
 */
export function decodeHeadOutput(
  out: HeadOutput,
  contract: HeadTensorContract = HEAD_CONTRACT
): Perceived<readonly { box: ModelBox; label: UiClass; score: number }[]> {
  const numClasses = contract.classes.length;

  if (out.dims.length !== 3 || out.dims[0] !== 1) {
    return refuse(
      "MODEL_OUTPUT_MALFORMED",
      `Expected output dims [1, ${4 + numClasses}, A], got [${out.dims.join(", ")}].`
    );
  }
  const channels = out.dims[1]!;
  const anchors = out.dims[2]!;
  if (channels !== 4 + numClasses) {
    return refuse(
      "MODEL_OUTPUT_MALFORMED",
      `Output has ${channels} channels but the contract declares ${4 + numClasses} ` +
        `(4 box + ${numClasses} classes). The weights and this decoder disagree about the model.`
    );
  }
  if (!Number.isInteger(anchors) || anchors <= 0) {
    return refuse("MODEL_OUTPUT_MALFORMED", `Anchor count ${anchors} is not a positive integer.`);
  }
  if (out.data.length !== channels * anchors) {
    return refuse(
      "MODEL_OUTPUT_MALFORMED",
      `Output declares ${channels}x${anchors} = ${channels * anchors} values but carries ${out.data.length}.`
    );
  }

  const at = (c: number, a: number) => out.data[c * anchors + a]!;
  const results: { box: ModelBox; label: UiClass; score: number }[] = [];

  for (let a = 0; a < anchors; a += 1) {
    // Best class for this anchor. Anchor-free heads emit no objectness channel, so the
    // class score IS the confidence.
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < numClasses; c += 1) {
      const s = at(4 + c, a);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best < 0 || bestScore < PROVISIONAL_THRESHOLDS.score) continue;

    const cx = at(0, a);
    const cy = at(1, a);
    const w = at(2, a);
    const h = at(3, a);

    // A non-finite or non-positive box is malformed output, not a low-quality detection.
    // Skipping it silently would let a broken head look like a quiet one.
    if (![cx, cy, w, h, bestScore].every(Number.isFinite)) {
      return refuse("MODEL_OUTPUT_MALFORMED", `Anchor ${a} produced a non-finite value.`);
    }
    if (w <= 0 || h <= 0) continue;
    if (bestScore > 1) {
      return refuse(
        "MODEL_OUTPUT_MALFORMED",
        `Anchor ${a} scored ${bestScore}, above 1. The head is not emitting probabilities.`
      );
    }

    // Centre form -> corner form, still in model pixels.
    results.push({
      box: modelBox(cx - w / 2, cy - h / 2, w, h),
      label: contract.classes[best]!,
      score: bestScore,
    });
  }

  return ok(nms(results));
}

/** IoU over model-space boxes. Local to decode; fusion has its own over CSS boxes. */
function boxIou(a: ModelBox, b: ModelBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Greedy per-class non-maximum suppression.
 *
 * Deterministic: sorted by score, ties broken by original index, so identical input always
 * yields identical output. A non-deterministic NMS would make every downstream fusion test
 * flaky for reasons nobody could reproduce.
 *
 * Per-class rather than class-agnostic, because a checkbox sitting inside its label's
 * clickable region is two genuinely different targets at high overlap, and suppressing one
 * would remove a control a plan needs.
 */
function nms<T extends { box: ModelBox; label: UiClass; score: number }>(items: T[]): T[] {
  const indexed = items.map((v, i) => ({ v, i }));
  indexed.sort((p, q) => q.v.score - p.v.score || p.i - q.i);

  const kept: T[] = [];
  const suppressed = new Set<number>();

  for (const { v, i } of indexed) {
    if (suppressed.has(i)) continue;
    kept.push(v);
    if (kept.length >= PROVISIONAL_THRESHOLDS.maxDetections) break;
    for (const { v: other, i: j } of indexed) {
      if (j === i || suppressed.has(j)) continue;
      if (other.label !== v.label) continue;
      if (boxIou(v.box, other.box) > PROVISIONAL_THRESHOLDS.nmsIou) suppressed.add(j);
    }
  }
  return kept;
}

/**
 * Project decoded model-space boxes into capture space, dropping anything that lives in
 * the letterbox padding.
 *
 * The padding is grey bars this code invented, not page content. A detection entirely
 * inside it describes nothing real, and after the transform it becomes a negative or
 * out-of-frame coordinate that still looks like a number.
 */
export function projectToCapture(
  decoded: readonly { box: ModelBox; label: UiClass; score: number }[],
  transform: LetterboxTransform
): readonly Detection[] {
  const out: Detection[] = [];
  for (const d of decoded) {
    const clipped = clipToContent(d.box, transform);
    if (!clipped) continue; // entirely in the padding
    out.push({ box: modelToCapture(clipped, transform), label: d.label, score: d.score });
  }
  return out;
}

/** Everything needed to run the head, injected so the module stays runtime-agnostic. */
export interface HeadRuntime {
  /**
   * Run inference on a preprocessed tensor.
   *
   * Supplied by the extension layer, which owns the ORT session created through
   * ADR-0001's pinned runtime. This package never imports ORT, never compiles WebAssembly
   * and never fetches anything — see `test/g5Structural.test.ts`.
   */
  readonly infer: (input: Float32Array, size: number) => Promise<HeadOutput>;
  /** Rasterise a frame into the letterboxed NCHW tensor. Needs a canvas; injected. */
  readonly preprocess: (
    frame: CaptureFrame,
    transform: LetterboxTransform,
    contract: HeadTensorContract
  ) => Promise<Float32Array>;
  /** Pinned identity of the weights actually loaded. */
  readonly modelId: string;
  readonly revision: string;
  /** Backends this weight file is MEASURED correct on. Empty until measured. */
  readonly acceptedBackends: readonly Backend[];
}

export const UI_DETECTOR_ROLE: DetectorRole = "UIElementDetector";

/**
 * Build the detector.
 *
 * `runtime` is nullable, and null is the honest current state: no weights exist, so the
 * detector reports `MODEL_ASSET_UNAVAILABLE` on every call. That is deliberately NOT an
 * empty detection list — an empty list cannot be told apart from a working detector on a
 * page with no controls, which is how a dead perception tier ships unnoticed.
 */
export function createUiElementDetector(runtime: HeadRuntime | null): Detector {
  return {
    role: UI_DETECTOR_ROLE,
    modelId: runtime?.modelId ?? "pratibimb-ui-head (NO WEIGHTS)",
    revision: runtime?.revision ?? "unbuilt",
    acceptedBackends: runtime?.acceptedBackends ?? [],

    async detect(frame: CaptureFrame, backend: Backend): Promise<Perceived<readonly Detection[]>> {
      if (!runtime) {
        return refuse(
          "MODEL_ASSET_UNAVAILABLE",
          "The UIElementDetector head has no weights. Option A (OmniParser icon_detect_v3) " +
            "is licence-excluded and option B is untrained, so the admissible configuration " +
            "is option C, the DOM-only floor. This is reported rather than returned as an " +
            "empty detection list, which would be indistinguishable from a page with no controls."
        );
      }
      if (!runtime.acceptedBackends.includes(backend)) {
        return refuse(
          "DETECTOR_BACKEND_UNSUPPORTED",
          `${runtime.modelId} is not measured correct on ${backend}. ` +
            `Measured: ${runtime.acceptedBackends.join(", ") || "none"}. ` +
            "QG-03: a model that fails the wasm column is not shipped whatever it does on WebGPU."
        );
      }

      const transform = computeLetterbox(frame.geometry.captureSize, HEAD_CONTRACT.inputSize);

      let raw: HeadOutput;
      try {
        const input = await runtime.preprocess(frame, transform, HEAD_CONTRACT);
        const expected = 3 * HEAD_CONTRACT.inputSize * HEAD_CONTRACT.inputSize;
        if (input.length !== expected) {
          return refuse(
            "MODEL_OUTPUT_MALFORMED",
            `Preprocessing produced ${input.length} values, expected ${expected} for ` +
              `${HEAD_CONTRACT.inputLayout} at ${HEAD_CONTRACT.inputSize}.`
          );
        }
        raw = await runtime.infer(input, HEAD_CONTRACT.inputSize);
      } catch (cause) {
        // An inference failure is never a quiet zero-detection result.
        return refuse(
          "DETECTOR_UNAVAILABLE",
          `Inference failed: ${String((cause as Error)?.message ?? cause)}`
        );
      }

      const decoded = decodeHeadOutput(raw);
      if (!decoded.ok) return decoded;

      return ok(projectToCapture(decoded.value, transform));
    },
  };
}
