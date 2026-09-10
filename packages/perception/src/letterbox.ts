/**
 * Letterboxing — the bridge between the detector's square tensor and the real frame.
 *
 * A YOLO-family head takes a fixed square input (640×640 for the reference architecture).
 * A browser viewport is not square. Something must reconcile them, and WHICH something is
 * chosen changes every coordinate the detector emits:
 *
 *   stretch      distorts aspect ratio. A circular icon becomes an ellipse and the head
 *                sees geometry it was never trained on.
 *   crop         discards page content, so elements outside the crop cannot be detected
 *                at all — silently, with no error anywhere.
 *   LETTERBOX    uniform scale, then pad to square. Aspect ratio preserved, nothing lost.
 *
 * Letterbox is the standard choice for this family and it is what this module implements.
 * Its cost is that a detection's coordinates are offset by the padding, and forgetting to
 * remove that offset is the single commonest grounding bug in YOLO integrations. It is
 * also nearly invisible: at 1024×640 the vertical padding is 120 model px, so every box
 * lands about 190 CSS px too low — a plausible-looking wrong answer, not a crash.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE FULL CHAIN, ALL EXPLICIT
 *
 *   model-input px  --(this module: unpad, unscale)-->  capture px
 *   capture px      --(coordinates.ts: scale_to_css)-->  CSS viewport px   CANONICAL
 *
 * Nothing here reimplements the second hop. `coordinates.ts` owns capture→CSS and remains
 * the only place it happens.
 */
import {
  type CaptureBox,
  type ModelBox,
  captureBox,
  modelBox,
} from "./space.js";
import type { Size } from "./coordinates.js";
import { PerceptionError } from "./failure.js";

/**
 * How one frame was fitted into the model's square input.
 *
 * Produced at preprocessing time and carried alongside the detections, because it is the
 * ONLY thing that can undo the fit. A detection without its transform is a set of numbers
 * in a space nobody can leave.
 */
export interface LetterboxTransform {
  /** Edge length of the square model input, e.g. 640. */
  readonly modelSize: number;
  /** The frame this was computed for, in capture pixels. */
  readonly source: Size;
  /** Uniform scale applied to the source before padding. */
  readonly scale: number;
  /** Left padding in model pixels. */
  readonly padX: number;
  /** Top padding in model pixels. */
  readonly padY: number;
  /** Size of the scaled content inside the square, excluding padding. */
  readonly contentSize: Size;
}

/**
 * Fit a frame into a square model input, centred, preserving aspect ratio.
 *
 * The scale is `min(modelSize/w, modelSize/h)` so the whole frame fits. Padding is split
 * evenly, which is the convention the reference architecture uses; centring rather than
 * top-left padding matters because a head trained with centred letterboxing sees a
 * different distribution if inference pads differently.
 */
export function computeLetterbox(source: Size, modelSize: number): LetterboxTransform {
  if (!Number.isFinite(modelSize) || modelSize <= 0) {
    throw new PerceptionError(
      `Letterbox model size must be a positive number, got ${String(modelSize)}.`,
      "COORDINATE_TRANSFORM_AMBIGUOUS"
    );
  }
  if (!Number.isFinite(source.w) || !Number.isFinite(source.h) || source.w <= 0 || source.h <= 0) {
    throw new PerceptionError(
      `Letterbox source must have positive finite dimensions, got ${source.w}x${source.h}.`,
      "COORDINATE_TRANSFORM_AMBIGUOUS"
    );
  }

  const scale = Math.min(modelSize / source.w, modelSize / source.h);
  const contentW = source.w * scale;
  const contentH = source.h * scale;

  return {
    modelSize,
    source: { w: source.w, h: source.h },
    scale,
    padX: (modelSize - contentW) / 2,
    padY: (modelSize - contentH) / 2,
    contentSize: { w: contentW, h: contentH },
  };
}

/**
 * Model-input pixels → capture pixels. Removes the padding, then undoes the scale.
 *
 * ORDER MATTERS AND IS NOT COMMUTATIVE. Dividing before subtracting the pad produces a
 * box that is wrong by `pad/scale` — small, plausible, and consistently in one direction,
 * which is exactly the kind of error that survives a visual spot-check.
 */
export function modelToCapture(b: ModelBox, t: LetterboxTransform): CaptureBox {
  return captureBox(
    (b.x - t.padX) / t.scale,
    (b.y - t.padY) / t.scale,
    b.w / t.scale,
    b.h / t.scale
  );
}

/** Capture pixels → model-input pixels. The inverse; scale first, then add the pad. */
export function captureToModel(b: CaptureBox, t: LetterboxTransform): ModelBox {
  return modelBox(
    b.x * t.scale + t.padX,
    b.y * t.scale + t.padY,
    b.w * t.scale,
    b.h * t.scale
  );
}

/**
 * Is a model-space box inside the real content, or is it in the padding?
 *
 * The padding is not page content — it is grey bars this code invented. A detection that
 * lands entirely there is describing something that does not exist on the page, and after
 * `modelToCapture` it becomes a negative or out-of-frame coordinate that still looks like
 * a number. Detections in the padding are rejected rather than clipped: there is nothing
 * to clip them TO.
 */
export function isInsideContent(b: ModelBox, t: LetterboxTransform): boolean {
  const right = t.padX + t.contentSize.w;
  const bottom = t.padY + t.contentSize.h;
  // Any overlap with real content counts; fully-in-padding boxes do not.
  return b.x < right && b.y < bottom && b.x + b.w > t.padX && b.y + b.h > t.padY;
}

/**
 * Clip a model-space box to the content region.
 *
 * A detection may legitimately straddle the content edge — a control flush against the
 * viewport edge, with the head's box spilling a few pixels into the padding. That is a
 * real element and clipping is correct. A box entirely in the padding returns `null` and
 * must be dropped, never clamped to a zero-width sliver at the boundary.
 */
export function clipToContent(b: ModelBox, t: LetterboxTransform): ModelBox | null {
  const x1 = Math.max(b.x, t.padX);
  const y1 = Math.max(b.y, t.padY);
  const x2 = Math.min(b.x + b.w, t.padX + t.contentSize.w);
  const y2 = Math.min(b.y + b.h, t.padY + t.contentSize.h);
  if (x2 <= x1 || y2 <= y1) return null;
  return modelBox(x1, y1, x2 - x1, y2 - y1);
}
