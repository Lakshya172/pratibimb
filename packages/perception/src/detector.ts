/**
 * The detector abstraction.
 *
 * The frozen constitution §8 lists detector roles as REPLACEABLE *behind frozen
 * interfaces, on benchmark evidence only*. This file is that interface. Model selection
 * stays behind it: orchestration asks for a role and gets whatever the registry says is
 * currently admissible, or a typed refusal. No vendor name appears in the perception
 * pipeline.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY SELECTION IS CAPABILITY-AWARE RATHER THAN A CONSTANT
 *
 * The registry's measured state today is uncomfortable, and encoding it honestly is the
 * point of this module:
 *
 *   FaceDetector      YuNet @47534e27, Apache-2.0 verified     ACCEPT, wasm + webgpu
 *   OCRProvider(det)  PP-OCRv5_mobile_det @0d63e78e            **FAILS the S-04a-1
 *                                                              correctness criterion on
 *                                                              wasm** (4.12e-02 vs 2e-02)
 *   OCRProvider(rec)  PP-OCRv5_mobile_rec @682f2053            ACCEPT
 *   LocalVLM          SmolVLM-256M vision encoder int8         wasm ACCEPT, **WebGPU REJECT**
 *   UIElementDetector OmniParser icon_detect                   **AGPL-3.0 — EXCLUDED**
 *
 * QG-03 is explicit: *"The WASM columns pass. A model that fails them is not shipped
 * whatever it does on WebGPU."* So PP-OCRv5 det is admissible on WebGPU only, and asking
 * for it on wasm must fail rather than quietly run a model that is measurably wrong.
 *
 * The `UIElementDetector` slot — the T1 tier the brief requires — has NO admissible
 * implementation. Option A is licence-excluded, option B (our own head) starts week 3, and
 * option C is the DOM-only floor. That is a real gap, and this module reports it as
 * `DETECTOR_UNAVAILABLE` rather than papering over it, because a detector that silently
 * returns zero boxes is indistinguishable from a page with no controls.
 */
import type { CaptureFrame } from "./capture.js";
import { type CaptureBox, type CssBox, captureBox } from "./space.js";
import { captureToCss } from "./coordinates.js";
import { type Perceived, refuse, ok } from "./failure.js";

/** Execution backends, as measured per-cell in the feasibility matrix. */
export type Backend = "wasm" | "webgpu";

/** Roles from the frozen constitution §8. */
export type DetectorRole = "UIElementDetector" | "FaceDetector" | "OCRProvider" | "PIIDetector";

/** One raw detection, in the frame's own pixel space. */
export interface Detection {
  /** Box in CAPTURE pixels — the space the detector actually saw. */
  readonly box: CaptureBox;
  /** Detector-specific label. */
  readonly label: string;
  /** Detector's own score, 0..1. Kept separate from provenance; see `fusion.ts`. */
  readonly score: number;
}

/** A detection promoted into canonical space, with the frame that justifies it. */
export interface VisualDetection {
  readonly box: CssBox;
  readonly label: string;
  readonly score: number;
  readonly role: DetectorRole;
  readonly frameId: CaptureFrame["id"];
  /**
   * WHICH MODEL SAID SO, pinned identity and revision.
   *
   * Provenance has to survive fusion, and "a detector said this" is not provenance - two
   * different heads disagree in different ways, and a box from an untrained head must be
   * distinguishable from one produced by a benchmarked model. Without this, swapping
   * weights silently rewrites the meaning of every stored observation.
   */
  readonly modelId: string;
  readonly revision: string;
}

/**
 * The detector contract.
 *
 * `detect` returns `Perceived` rather than throwing: a detector being unavailable on this
 * browser is an ordinary, expected outcome the caller must handle, not a bug.
 */
export interface Detector {
  readonly role: DetectorRole;
  /** Model identity as pinned in `agentos/registry/model-registry.md`. */
  readonly modelId: string;
  readonly revision: string;
  /** Backends this implementation is MEASURED to be correct on. Not documented — measured. */
  readonly acceptedBackends: readonly Backend[];
  detect(frame: CaptureFrame, backend: Backend): Promise<Perceived<readonly Detection[]>>;
}

/**
 * Registry admissibility for one role.
 *
 * `EXCLUDED` is separate from `UNAVAILABLE` on purpose. "No implementation is installed"
 * invites someone to install one; "this implementation is licence-excluded" must not be
 * resolved that way, and the distinction has to survive in the type or it will be lost the
 * first time somebody is in a hurry.
 */
export type Admissibility =
  | { readonly status: "ADMISSIBLE"; readonly detector: Detector }
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | { readonly status: "EXCLUDED"; readonly reason: string };

/**
 * Selects detectors by role and backend, from measured evidence only.
 *
 * Deliberately has no default, no "best effort" and no fallback chain. A fallback chain is
 * how an excluded model gets run: something fails, the chain moves on, and the thing it
 * moved on to was excluded for a reason nobody re-reads at 2 a.m.
 */
export class DetectorRegistry {
  private readonly entries = new Map<DetectorRole, Admissibility>();

  register(role: DetectorRole, entry: Admissibility): this {
    this.entries.set(role, entry);
    return this;
  }

  /**
   * Resolve a detector for a role on a backend.
   *
   * Two distinct refusals, because they demand different responses: the role has no
   * implementation at all, or it has one that is not correct on THIS backend.
   */
  resolve(role: DetectorRole, backend: Backend): Perceived<Detector> {
    const entry = this.entries.get(role);

    if (!entry) {
      return refuse(
        "DETECTOR_UNAVAILABLE",
        `No implementation is registered for role ${role}.`
      );
    }
    if (entry.status === "EXCLUDED") {
      return refuse(
        "DETECTOR_UNAVAILABLE",
        `Role ${role} is EXCLUDED and must not be substituted: ${entry.reason}`
      );
    }
    if (entry.status === "UNAVAILABLE") {
      return refuse("DETECTOR_UNAVAILABLE", `Role ${role} is unavailable: ${entry.reason}`);
    }
    if (!entry.detector.acceptedBackends.includes(backend)) {
      return refuse(
        "DETECTOR_BACKEND_UNSUPPORTED",
        `${entry.detector.modelId} is not accepted on ${backend}. ` +
          `Accepted: ${entry.detector.acceptedBackends.join(", ") || "none"}. ` +
          "QG-03: a model that fails the wasm column is not shipped whatever it does on WebGPU."
      );
    }
    return ok(entry.detector);
  }

  has(role: DetectorRole): boolean {
    return this.entries.get(role)?.status === "ADMISSIBLE";
  }
}

/**
 * Validate raw detector output before it is allowed to become a coordinate.
 *
 * A model is an untrusted input. Its output arrives as numbers, and numbers are exactly
 * what this system converts into places to click. NaN, Infinity, negative extents and
 * boxes outside the frame all round-trip through arithmetic without complaint and emerge
 * as a confident, wrong target.
 *
 * This is also where G5 is enforced in practice: the only thing a model output can become
 * here is a bounded rectangle. There is no path from a detector's output into code,
 * compilation, or a network call.
 */
export function validateDetections(
  raw: unknown,
  frame: CaptureFrame
): Perceived<readonly Detection[]> {
  if (!Array.isArray(raw)) {
    return refuse("MODEL_OUTPUT_MALFORMED", `Expected an array of detections, got ${typeof raw}.`);
  }

  const out: Detection[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== "object" || item === null) {
      return refuse("MODEL_OUTPUT_MALFORMED", `Detection ${i} is not an object.`);
    }
    const d = item as Record<string, unknown>;
    const nums = [d["x"], d["y"], d["w"], d["h"], d["score"]];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return refuse(
        "MODEL_OUTPUT_MALFORMED",
        `Detection ${i} has a non-finite or non-numeric field: ${JSON.stringify(d)}`
      );
    }
    const [x, y, w, h, score] = nums as [number, number, number, number, number];

    if (w <= 0 || h <= 0) {
      return refuse("MODEL_OUTPUT_MALFORMED", `Detection ${i} has non-positive extent ${w}x${h}.`);
    }
    if (score < 0 || score > 1) {
      return refuse("MODEL_OUTPUT_MALFORMED", `Detection ${i} score ${score} is outside 0..1.`);
    }
    // A detector cannot see outside the frame it was given. A box claiming otherwise is
    // malformed output, not a discovery.
    const { w: fw, h: fh } = frame.geometry.captureSize;
    if (x < 0 || y < 0 || x + w > fw || y + h > fh) {
      return refuse(
        "MODEL_OUTPUT_MALFORMED",
        `Detection ${i} box [${x}, ${y}, ${w}, ${h}] falls outside the ${fw}x${fh} frame.`
      );
    }
    if (typeof d["label"] !== "string") {
      return refuse("MODEL_OUTPUT_MALFORMED", `Detection ${i} has no string label.`);
    }

    out.push({ box: captureBox(x, y, w, h), label: d["label"], score });
  }
  return ok(out);
}

/** Promote validated detections into canonical CSS space, tagged with their frame. */
export function toVisualDetections(
  detections: readonly Detection[],
  frame: CaptureFrame,
  detector: Pick<Detector, "role" | "modelId" | "revision">
): readonly VisualDetection[] {
  return detections.map((d) => ({
    box: captureToCss(d.box, frame.geometry),
    label: d.label,
    score: d.score,
    role: detector.role,
    frameId: frame.id,
    modelId: detector.modelId,
    revision: detector.revision,
  }));
}
