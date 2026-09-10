/**
 * Label validation — fail closed on anything a metric could quietly absorb.
 *
 * A bad label is worse than a missing one. A missing label is visibly missing; a box with
 * negative width, or two annotations for the same element, or a box outside the viewport,
 * flows straight into an IoU computation and produces a plausible number that is silently
 * wrong. Every check here exists because the failure it prevents is invisible downstream.
 */
import type { Annotation, Dataset, EvalClass, Sample, Split } from "./dataset.js";
import { datasetHash } from "./dataset.js";

export const EVAL_CLASSES: readonly EvalClass[] = [
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "select",
  "tab",
  "icon",
];

export class LabelError extends Error {
  override readonly name = "LabelError";
  constructor(
    message: string,
    readonly code:
      | "INVALID_CLASS"
      | "INVALID_GEOMETRY"
      | "OUT_OF_VIEWPORT"
      | "DUPLICATE_ANNOTATION"
      | "AMBIGUOUS_ANNOTATION"
      | "SPLIT_LEAKAGE"
      | "HASH_MISMATCH"
      | "EMPTY_SPLIT"
  ) {
    super(message);
  }
}

/**
 * Validate one sample's annotations.
 *
 * `OFFSCREEN` annotations are exempted from the viewport bound on purpose: they are known
 * from the DOM and are legitimately outside the captured frame. Applying the bound to them
 * would reject exactly the case the perception contract requires the dataset to represent.
 */
export function validateSample(sample: Sample): void {
  const seen = new Set<string>();

  for (const a of sample.annotations) {
    if (!EVAL_CLASSES.includes(a.cls)) {
      throw new LabelError(
        `Sample ${sample.id} annotation ${a.id}: class "${a.cls}" is not one of ` +
          `${EVAL_CLASSES.join(", ")}.`,
        "INVALID_CLASS"
      );
    }

    if (seen.has(a.id)) {
      throw new LabelError(
        `Sample ${sample.id} has two annotations with id ${a.id}. Duplicate ids make a ` +
          "match ambiguous, and the ambiguity would be resolved silently by iteration order.",
        "DUPLICATE_ANNOTATION"
      );
    }
    seen.add(a.id);

    const { x, y, w, h } = a.box;
    if (![x, y, w, h].every(Number.isFinite)) {
      throw new LabelError(
        `Sample ${sample.id} annotation ${a.id}: box [${x}, ${y}, ${w}, ${h}] is not finite.`,
        "INVALID_GEOMETRY"
      );
    }
    if (w <= 0 || h <= 0) {
      throw new LabelError(
        `Sample ${sample.id} annotation ${a.id}: non-positive extent ${w}x${h}. A ` +
          "zero-area box has an undefined IoU with everything.",
        "INVALID_GEOMETRY"
      );
    }

    if (a.visibility !== "OFFSCREEN") {
      const { w: vw, h: vh } = sample.viewportCss;
      // A VISIBLE or CLIPPED annotation must actually intersect the frame; otherwise the
      // visibility field and the geometry disagree, and one of them is wrong.
      if (x >= vw || y >= vh || x + w <= 0 || y + h <= 0) {
        throw new LabelError(
          `Sample ${sample.id} annotation ${a.id}: marked ${a.visibility} but its box ` +
            `[${x}, ${y}, ${w}, ${h}] does not intersect the ${vw}x${vh} viewport.`,
          "OUT_OF_VIEWPORT"
        );
      }
      const fullyInside = x >= 0 && y >= 0 && x + w <= vw && y + h <= vh;
      if (a.visibility === "VISIBLE" && !fullyInside) {
        throw new LabelError(
          `Sample ${sample.id} annotation ${a.id}: marked VISIBLE but extends outside the ` +
            "viewport. It should be CLIPPED.",
          "AMBIGUOUS_ANNOTATION"
        );
      }
      if (a.visibility === "CLIPPED" && fullyInside) {
        throw new LabelError(
          `Sample ${sample.id} annotation ${a.id}: marked CLIPPED but lies entirely inside ` +
            "the viewport. It should be VISIBLE.",
          "AMBIGUOUS_ANNOTATION"
        );
      }
    }
  }

  const finite = (v: number) => Number.isFinite(v) && v > 0;
  if (!finite(sample.viewportCss.w) || !finite(sample.viewportCss.h)) {
    throw new LabelError(`Sample ${sample.id}: viewport must be positive and finite.`, "INVALID_GEOMETRY");
  }
  if (!finite(sample.dpr) || !finite(sample.zoom)) {
    throw new LabelError(`Sample ${sample.id}: dpr and zoom must be positive and finite.`, "INVALID_GEOMETRY");
  }
}

/**
 * Split integrity.
 *
 * The rule this enforces is the one that makes a benchmark mean anything: **the samples
 * used to choose a threshold are never the samples used to claim performance.** Without
 * it, a sweep picks whatever value flatters the data it was chosen on, and the resulting
 * number is a description of the tuning run rather than a prediction about new pages.
 *
 * Detection is by sample id AND by content: an id can be changed while the underlying
 * sample is copied verbatim, which is the form leakage usually takes in practice.
 */
export function assertNoLeakage(dataset: Dataset): void {
  const byId = new Map<string, Split>();
  const byContent = new Map<string, { id: string; split: Split }>();

  for (const s of dataset.samples) {
    const prior = byId.get(s.id);
    if (prior !== undefined && prior !== s.split) {
      throw new LabelError(
        `Sample ${s.id} appears in both the ${prior} and ${s.split} splits.`,
        "SPLIT_LEAKAGE"
      );
    }
    byId.set(s.id, s.split);

    // Content fingerprint: geometry plus annotations, ignoring the id.
    const fp = JSON.stringify({
      v: s.viewportCss,
      d: s.dpr,
      z: s.zoom,
      c: s.captureSize,
      s: s.scroll,
      a: [...s.annotations]
        .map((a) => [a.cls, a.box.x, a.box.y, a.box.w, a.box.h, a.visibility])
        .sort(),
    });
    const seen = byContent.get(fp);
    if (seen && seen.split !== s.split) {
      throw new LabelError(
        `Samples ${seen.id} (${seen.split}) and ${s.id} (${s.split}) are byte-identical in ` +
          "content but sit in different splits. Renaming a sample does not make it new data.",
        "SPLIT_LEAKAGE"
      );
    }
    if (!seen) byContent.set(fp, { id: s.id, split: s.split });
  }

  for (const split of ["train", "dev", "test"] as const) {
    if (!dataset.samples.some((s) => s.split === split)) {
      throw new LabelError(
        `Split "${split}" is empty. A missing held-out split turns every reported number ` +
          "into a tuning artefact.",
        "EMPTY_SPLIT"
      );
    }
  }
}

/** Verify the dataset has not drifted since it was sealed. */
export function assertIntegrity(dataset: Dataset): void {
  const { hash, ...rest } = dataset;
  const actual = datasetHash(rest);
  if (actual !== hash) {
    throw new LabelError(
      `Dataset ${dataset.name}@${dataset.version} hash mismatch: sealed ${hash}, ` +
        `recomputed ${actual}. The dataset changed after it was sealed, so any metric ` +
        "recorded against the sealed hash no longer describes this data.",
      "HASH_MISMATCH"
    );
  }
}

/** Full validation. Everything, in one call, fail-closed. */
export function validateDataset(dataset: Dataset): void {
  assertIntegrity(dataset);
  for (const s of dataset.samples) validateSample(s);
  assertNoLeakage(dataset);
}
