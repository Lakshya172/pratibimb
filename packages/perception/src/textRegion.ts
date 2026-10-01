/**
 * THE TEXT-REGION DETECTOR — ADR-0011's `TextRegionDetector` role. Boxes and scores out; NO TEXT.
 *
 * The first implementation is TR-01, `PP-OCRv4_mobile_det` @ `3cc09f3a`, chosen by the owner (M10
 * decision D1) after M8.1 screening, M8.2 / M8.2a QG-03 and the M9 adoption review. TR-02 remains a
 * validated alternative and is NOT wired here.
 *
 * WHAT THIS FILE IS, AND IS NOT:
 *
 *   - It owns the arithmetic: TR-01's declared preprocessing and the SCREENED DB post-processing,
 *     both ported verbatim from the code the candidate was screened with, and proven equal to it by
 *     golden tests (`test/textRegion.test.ts`, `tests/browser/support/m10-*.test.mjs`).
 *   - It never touches ORT, WebAssembly or the network (asserted by `test/g5Structural.test.ts`).
 *     The session lives in the extension's detector worker; this package is handed an `infer`.
 *   - Its output type cannot carry a character: a `Detection` is a box, the constant label
 *     `"text-region"` and a score. There is no recognition model anywhere on this path.
 *
 * Every refusal is a refusal, never an empty list: INV-23 makes an error or a timeout a POSITIVE,
 * and the caller masks the visual-only region whole. A clean run that finds nothing is the only way
 * to get an empty list, and that is the documented limitation, not a failure mode.
 */
import type { CaptureFrame } from "./capture.js";
import type { Backend, Detection, Detector, DetectorRole } from "./detector.js";
import { type Perceived, ok, refuse } from "./failure.js";
import type { DecodedImage } from "./preprocess.js";
import { captureBox } from "./space.js";

export const TEXT_REGION_ROLE: DetectorRole = "TextRegionDetector";
/** The only label a text-region detection can have. A constant, so no detection can say more. */
export const TEXT_REGION_LABEL = "text-region" as const;

/** TR-01's pinned identity. The worker refuses bytes whose digest differs. */
export const TR01 = Object.freeze({
  modelId: "PP-OCRv4_mobile_det",
  revision: "3cc09f3a5b424e8e010abc7a4271aea12999c2f7",
  onnxSha256: "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8",
  onnxBytes: 4_766_440,
  asset: "tr01-ppocrv4-mobile-det.onnx",
  /** QG-03: measured correct on wasm (M8.2 / M8.2a). WebGPU is not the product backend. */
  acceptedBackends: Object.freeze(["wasm"]) as readonly Backend[],
});

/**
 * A resize rule, as the candidate's own `inference.yml` declares it.
 *
 * TR-01 declares `DetResizeForTest(resize_long=960)`: long side to 960, each side rounded UP to a
 * multiple of 128 (PaddleOCR's type-2 resize). This is the rule M8.1 screened; no other is used.
 */
export interface LongSideResize {
  readonly type: "long-side";
  readonly resizeLong: number;
  readonly stride: number;
}
export const TR01_RESIZE: LongSideResize = Object.freeze({ type: "long-side", resizeLong: 960, stride: 128 });

/** ImageNet mean / std, applied in BGR channel order as PaddleOCR does. float32, as numpy computes it. */
const MEAN = [0.485, 0.456, 0.406].map(Math.fround);
const STD = [0.229, 0.224, 0.225].map(Math.fround);

/** Target (height, width) for a source of (h, w). Integer arithmetic exactly as PaddleOCR's type 2. */
export function textRegionInputSize(rule: LongSideResize, h: number, w: number): readonly [number, number] {
  const ratio = rule.resizeLong / (h > w ? h : w);
  const rh = Math.trunc(h * ratio);
  const rw = Math.trunc(w * ratio);
  const s = rule.stride;
  return [Math.floor((rh + s - 1) / s) * s, Math.floor((rw + s - 1) / s) * s];
}

export interface TextRegionTensor {
  readonly tensor: Float32Array;
  readonly dims: readonly [1, 3, number, number];
  /** resized / source, per axis — what maps a model-space box back to capture pixels. */
  readonly ratioH: number;
  readonly ratioW: number;
  readonly sourceH: number;
  readonly sourceW: number;
}

/**
 * RGBA → the NCHW float32 tensor TR-01 was screened on.
 *
 * Bilinear with cv2.INTER_LINEAR's convention (half-pixel centres, clamped, no antialiasing), BGR,
 * `/255` then mean/std. This is M8.2's `m82-preprocess.js`, which M8.2 measured EQUAL to the screened
 * Python tensor byte for byte (max difference 0, 20 launches per candidate); the product copy is held
 * to that by a golden test.
 */
export function preprocessTextRegion(image: DecodedImage, rule: LongSideResize = TR01_RESIZE): TextRegionTensor {
  const ih = image.height;
  const iw = image.width;
  const [oh, ow] = textRegionInputSize(rule, ih, iw);
  const rgba = image.rgba;
  const out = new Float32Array(3 * oh * ow);
  const plane = oh * ow;
  const x0s = new Int32Array(ow);
  const x1s = new Int32Array(ow);
  const wx = new Float64Array(ow);
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(Math.max((x + 0.5) * (iw / ow) - 0.5, 0), iw - 1);
    x0s[x] = Math.floor(sx);
    x1s[x] = Math.min((x0s[x] as number) + 1, iw - 1);
    wx[x] = sx - (x0s[x] as number);
  }
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(Math.max((y + 0.5) * (ih / oh) - 0.5, 0), ih - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, ih - 1);
    const wy = sy - y0;
    for (let x = 0; x < ow; x++) {
      const ax = x0s[x] as number;
      const bx = x1s[x] as number;
      const fx = wx[x] as number;
      for (let c = 0; c < 3; c++) {
        const ch = 2 - c; // BGR: model channel 0 is blue
        const a = rgba[(y0 * iw + ax) * 4 + ch] as number;
        const b = rgba[(y0 * iw + bx) * 4 + ch] as number;
        const d = rgba[(y1 * iw + ax) * 4 + ch] as number;
        const e = rgba[(y1 * iw + bx) * 4 + ch] as number;
        const top = a * (1 - fx) + b * fx;
        const bottom = d * (1 - fx) + e * fx;
        const v = Math.fround((top * (1 - wy) + bottom * wy) / 255);
        out[c * plane + y * ow + x] = Math.fround(Math.fround(v - (MEAN[c] as number)) / (STD[c] as number));
      }
    }
  }
  return { tensor: out, dims: [1, 3, oh, ow], ratioH: oh / ih, ratioW: ow / iw, sourceH: ih, sourceW: iw };
}

/**
 * DBPostProcess, with the parameters TR-01's pinned `inference.yml` declares (thresh 0.3,
 * box_thresh 0.6, max_candidates 1000, unclip_ratio 1.5); `minSize` 3 is PaddleOCR's constant.
 */
export const DB_POSTPROCESS = Object.freeze({ thresh: 0.3, boxThresh: 0.6, maxCandidates: 1000, unclipRatio: 1.5, minSize: 3 });
export type DbParameters = typeof DB_POSTPROCESS;

export interface TextRegionBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly score: number;
}

/**
 * Probability map → boxes in SOURCE-IMAGE (capture) pixels.
 *
 * VERBATIM from the screened `tests/browser/support/text-detector-screening.mjs` (M8.1), with types
 * added and nothing else: 8-connected components and their axis-aligned box — NOT PaddleOCR's
 * rotated minAreaRect — mean probability inside the unexpanded box, the box threshold, and the
 * unclip distance area·ratio/perimeter applied outward on every side. A golden test pins this copy
 * to that one, box for box and bit for bit, so the product post-processes exactly as screened.
 */
export function dbPostprocess(
  prob: ArrayLike<number>,
  H: number,
  W: number,
  ratioH: number,
  ratioW: number,
  srcH: number,
  srcW: number,
  db: DbParameters = DB_POSTPROCESS
): { boxes: TextRegionBox[]; candidates: number } {
  const seen = new Uint8Array(H * W);
  const stack = new Int32Array(H * W);
  const boxes: TextRegionBox[] = [];
  let candidates = 0;
  for (let start = 0; start < H * W; start += 1) {
    if (seen[start] || (prob[start] as number) <= db.thresh) continue;
    if (candidates >= db.maxCandidates) break;
    candidates += 1;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    while (top > 0) {
      const p = stack[--top] as number;
      const y = (p / W) | 0;
      const x = p - y * W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const q = ny * W + nx;
          if (!seen[q] && (prob[q] as number) > db.thresh) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    if (Math.min(w, h) < db.minSize) continue;
    let s = 0;
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) s += prob[y * W + x] as number;
    const score = s / (w * h);
    if (score < db.boxThresh) continue;
    const d = (w * h * db.unclipRatio) / (2 * (w + h));
    if (Math.min(w + 2 * d, h + 2 * d) < db.minSize + 2) continue;
    const bx0 = Math.max(0, (x0 - d) / ratioW);
    const by0 = Math.max(0, (y0 - d) / ratioH);
    const bx1 = Math.min(srcW, (x1 + 1 + d) / ratioW);
    const by1 = Math.min(srcH, (y1 + 1 + d) / ratioH);
    boxes.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, score });
  }
  return { boxes, candidates };
}

/** What the session returned. Validated here before a single box is derived from it. */
export interface TextRegionOutput {
  readonly data: Float32Array;
  readonly dims: readonly number[];
}

/**
 * The model output is untrusted input. A probability map must be `[1, 1, H, W]` at the input's own
 * spatial size, with every value finite and inside [0, 1]. Anything else is MALFORMED — and a
 * malformed output masks the region whole; it is never "use the parts that looked fine".
 */
export function validateTextRegionOutput(out: TextRegionOutput, inputDims: readonly [1, 3, number, number]): Perceived<{ H: number; W: number }> {
  const d = out.dims;
  if (!d || typeof d.length !== "number") return refuse("MODEL_OUTPUT_MALFORMED", "output has no dims");
  if (d.length !== 4 || d[0] !== 1 || d[1] !== 1) return refuse("MODEL_OUTPUT_MALFORMED", `output dims ${JSON.stringify(d)} are not [1, 1, H, W]`);
  const H = d[2] as number;
  const W = d[3] as number;
  if (H !== inputDims[2] || W !== inputDims[3]) {
    return refuse("MODEL_OUTPUT_MALFORMED", `output ${H}x${W} does not match the input ${inputDims[2]}x${inputDims[3]}`);
  }
  if (!(out.data instanceof Float32Array) || out.data.length !== H * W) {
    return refuse("MODEL_OUTPUT_MALFORMED", `output carries ${out.data?.length ?? "no"} values, expected ${H * W}`);
  }
  for (let i = 0; i < out.data.length; i++) {
    const v = out.data[i] as number;
    if (!(v >= 0 && v <= 1)) return refuse("MODEL_OUTPUT_MALFORMED", "output contains a value that is not a probability");
  }
  return ok({ H, W });
}

/** Timings a caller may want, per stage. Optional; the detector never depends on it. */
export type TextRegionStage = "preprocess" | "infer" | "postprocess";

export interface TextRegionRuntime {
  readonly modelId: string;
  readonly revision: string;
  /** Backends this weight file is MEASURED correct on. */
  readonly acceptedBackends: readonly Backend[];
  /** The frame's pixels, from the realm that owns them. Never carried by `CaptureFrame` on the stream route. */
  readonly pixels: (frame: CaptureFrame) => DecodedImage;
  /**
   * Run the session. Rejects with an error whose `code` is `"DETECTOR_TIMEOUT"` when the deadline
   * passed, and with anything else for an inference error. Supplied by the extension's detector host.
   */
  readonly infer: (tensor: Float32Array, dims: readonly [1, 3, number, number]) => Promise<TextRegionOutput>;
  readonly onStage?: (stage: TextRegionStage, ms: number) => void;
  readonly now?: () => number;
}

/**
 * The detector. `null` runtime → it refuses on every call (the tier is absent, and says so).
 *
 * Boxes come back in CAPTURE pixels, validated (finite, positive, inside the frame). Converting to
 * CSS and to visual-only regions is the caller's, at the edge (INV-24).
 */
export function createTextRegionDetector(runtime: TextRegionRuntime | null): Detector {
  return {
    role: TEXT_REGION_ROLE,
    modelId: runtime?.modelId ?? "text-region detector (NO RUNTIME)",
    revision: runtime?.revision ?? "unavailable",
    acceptedBackends: runtime?.acceptedBackends ?? [],
    async detect(frame: CaptureFrame, backend: Backend): Promise<Perceived<readonly Detection[]>> {
      if (!runtime) {
        return refuse("DETECTOR_UNAVAILABLE", "No text-region runtime is available in this realm.");
      }
      if (!runtime.acceptedBackends.includes(backend)) {
        return refuse(
          "DETECTOR_BACKEND_UNSUPPORTED",
          `${runtime.modelId} is not measured correct on ${backend}. Measured: ${runtime.acceptedBackends.join(", ") || "none"}.`
        );
      }
      const now = runtime.now ?? (() => Date.now());
      let prepared: TextRegionTensor;
      let t = now();
      try {
        prepared = preprocessTextRegion(runtime.pixels(frame));
      } catch (cause) {
        return refuse("DETECTOR_UNAVAILABLE", `Preprocessing failed: ${String((cause as Error)?.message ?? cause)}`);
      }
      runtime.onStage?.("preprocess", now() - t);
      let out: TextRegionOutput;
      t = now();
      try {
        out = await runtime.infer(prepared.tensor, prepared.dims);
      } catch (cause) {
        runtime.onStage?.("infer", now() - t);
        const code = (cause as { code?: unknown })?.code;
        if (code === "DETECTOR_TIMEOUT") return refuse("DETECTOR_TIMEOUT", String((cause as Error)?.message ?? cause));
        return refuse("DETECTOR_UNAVAILABLE", `Inference failed: ${String((cause as Error)?.message ?? cause)}`);
      }
      runtime.onStage?.("infer", now() - t);
      const valid = validateTextRegionOutput(out, prepared.dims);
      if (!valid.ok) return valid;
      t = now();
      const { boxes } = dbPostprocess(out.data, valid.value.H, valid.value.W, prepared.ratioH, prepared.ratioW, prepared.sourceH, prepared.sourceW);
      runtime.onStage?.("postprocess", now() - t);
      const detections: Detection[] = [];
      for (const b of boxes) {
        if (![b.x, b.y, b.w, b.h, b.score].every(Number.isFinite) || b.w <= 0 || b.h <= 0) {
          return refuse("MODEL_OUTPUT_MALFORMED", "post-processing produced a non-finite or empty box");
        }
        if (b.x < 0 || b.y < 0 || b.x + b.w > prepared.sourceW + 1e-9 || b.y + b.h > prepared.sourceH + 1e-9) {
          return refuse("MODEL_OUTPUT_MALFORMED", "post-processing produced a box outside the frame");
        }
        detections.push({ box: captureBox(b.x, b.y, b.w, b.h), label: TEXT_REGION_LABEL, score: b.score });
      }
      return ok(detections);
    },
  };
}
