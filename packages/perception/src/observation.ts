/**
 * What the perception tier is entitled to claim about an element.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE ENFORCES STRUCTURALLY
 *
 * The frozen contract says capture is viewport-only, so on a long form the agent cannot
 * see most of the fields. Elements the DOM knows about but the camera did not see are
 * reported as **known but uncaptured**: role, accessible name and document-space geometry,
 * with **no pixel evidence and no vision cross-check**.
 *
 * That is enforced here by SHAPE, not by discipline. The `OFFSCREEN` variant has no
 * `frameId` and no viewport box — not an optional one, not a nulled one, none. Writing
 * `evidence.viewportBox` against an off-screen element does not compile. There is no
 * correct-looking way to attach pixel evidence to something that was never in the frame,
 * so the rule cannot decay into a comment somebody stops reading.
 *
 * "The DOM knows this element exists" and "the camera saw this element" are different
 * claims, and the second is the one that licenses a visual detector result.
 */
import type { CssBox, DocBox } from "./space.js";
import type { PerceptionErrorCode } from "./failure.js";

/**
 * Identity of one captured frame. Every visual claim carries it, so a claim can always be
 * traced to the frame that justifies it and rejected when that frame is stale.
 */
export type FrameId = string & { readonly __brand: "FrameId" };

export const frameId = (s: string): FrameId => s as FrameId;

/**
 * Visual evidence for a single element.
 *
 * Exhaustive by construction: an element is either in the frame, known-but-not-in-frame,
 * or something went wrong. There is deliberately no fourth "probably fine" case.
 */
export type VisualEvidence =
  | {
      /** The element was inside the captured viewport and has real pixel evidence. */
      readonly kind: "OBSERVED";
      readonly frameId: FrameId;
      /** Full box in canonical CSS viewport space. */
      readonly viewportBox: CssBox;
      /** Also in the frame, so also true here. */
      readonly documentBox: DocBox;
    }
  | {
      /**
       * Partly in frame. The visible part is real; the rest is not observed.
       *
       * Kept distinct from OBSERVED because a detector can only be asked about
       * `visiblePart`, and an action aimed at the centre of `viewportBox` may target a
       * point that is not on screen.
       */
      readonly kind: "CLIPPED";
      readonly frameId: FrameId;
      readonly viewportBox: CssBox;
      readonly visiblePart: CssBox;
      readonly documentBox: DocBox;
    }
  | {
      /**
       * DOM-known, not captured. Document space only.
       *
       * NOTE THE ABSENCE: no `frameId`, no `viewportBox`, no `visiblePart`. There is
       * nothing here that could carry a pixel claim, which is the point.
       */
      readonly kind: "OFFSCREEN";
      readonly documentBox: DocBox;
    }
  | {
      /** Evidence could not be established at all. Carries why, and claims nothing. */
      readonly kind: "UNOBSERVED";
      readonly reason: PerceptionErrorCode;
      readonly detail: string;
    };

/** True only where a visual detector result may legitimately be attached. */
export function admitsVisualEvidence(
  e: VisualEvidence
): e is Extract<VisualEvidence, { kind: "OBSERVED" | "CLIPPED" }> {
  return e.kind === "OBSERVED" || e.kind === "CLIPPED";
}

/**
 * The manifest's `visible` / `offscreen` pair, derived from evidence rather than tracked
 * alongside it.
 *
 * Deriving matters: two fields that can be set independently can disagree, and
 * `visible: true, offscreen: true` is a contradiction that would otherwise be
 * representable. QG-02 requires off-screen elements to report exactly
 * `visible: false, offscreen: true`.
 */
export function manifestVisibility(e: VisualEvidence): {
  readonly visible: boolean;
  readonly offscreen: boolean;
} {
  switch (e.kind) {
    case "OBSERVED":
    case "CLIPPED":
      return { visible: true, offscreen: false };
    case "OFFSCREEN":
      return { visible: false, offscreen: true };
    case "UNOBSERVED":
      // Not seen, and not known to be off-screen either. Reported as not visible, because
      // claiming visibility on absent evidence is the failure this tier exists to avoid.
      return { visible: false, offscreen: false };
  }
}
