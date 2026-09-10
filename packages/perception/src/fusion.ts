/**
 * Deterministic DOM/vision fusion.
 *
 * The frozen constitution §7: *"Fused element graph — matched on IoU > 0.5. DOM-matched
 * elements are actioned by selector (robust to reflow); vision-only elements are actioned
 * by coordinate with a synthetic id. Disagreement above threshold flags an overlay."*
 *
 * DOM and vision are fused, not alternatives. The DOM knows role, name, label, input type,
 * exact text and box, visibility and ARIA — free, exact, no inference error. Vision sees
 * scanned cards, text in images, canvas-rendered interfaces, faces, and cross-origin
 * iframes. Neither is a degraded version of the other, so fusion is not a preference
 * order, it is a join.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * PROVENANCE IS NOT A CONFIDENCE NUMBER
 *
 * `source` is a discriminated union, and the detector's `score` rides alongside it rather
 * than being blended into it. Collapsing them would destroy the only question that
 * matters downstream: *is there pixel evidence for this element, or only a DOM claim?*
 *
 * A DOM-only element at "0.9" and a vision-only element at "0.9" warrant completely
 * different treatment — one is exact and unseen, the other is seen and inferred — and
 * after averaging they are indistinguishable. The redaction and verification tiers need
 * that distinction to decide what they are allowed to assert.
 *
 * Determinism: matching sorts candidates by IoU and breaks ties by node order, so the same
 * inputs always produce the same graph. A fusion that reorders under a hash-map iteration
 * would make every downstream test flaky for reasons no one could reproduce.
 */
import type { CssBox } from "./space.js";
import { type CaptureGeometry, cssToDocument } from "./coordinates.js";
import type { ElementGraph, ElementNode, NodeId } from "./elementGraph.js";
import { nodeId } from "./elementGraph.js";
import type { VisualDetection } from "./detector.js";
import { admitsVisualEvidence, type VisualEvidence } from "./observation.js";

/** The frozen threshold. Changing it is a constitution §8 change, not a tweak. */
export const FUSION_IOU_THRESHOLD = 0.5;

/**
 * Where the evidence for a fused element came from.
 *
 * The first three strings match the manifest's `source` enum exactly (`dom`, `vision`,
 * `dom+vision`). `unresolved` is ours: it is not serialized as a source, it is the state
 * that must be handled before serialization is allowed.
 */
export type Provenance =
  | {
      readonly source: "dom";
      /** Present and unmatched: the DOM knows it, no detector confirmed it. */
      readonly domNode: NodeId;
      /** Why no visual confirmation — off-screen is very different from "vision missed it". */
      readonly visualAbsence: "OFFSCREEN" | "NOT_DETECTED" | "NO_DETECTOR";
    }
  | {
      readonly source: "vision";
      readonly detection: VisualDetection;
      /** Vision-only elements are actioned by coordinate under a synthetic id. */
      readonly syntheticId: NodeId;
    }
  | {
      readonly source: "dom+vision";
      readonly domNode: NodeId;
      readonly detection: VisualDetection;
      readonly iou: number;
    }
  | {
      /** Evidence exists but cannot be attributed. Never serialized; must be handled. */
      readonly source: "unresolved";
      readonly detail: string;
    };

export interface FusedElement {
  readonly id: NodeId;
  readonly role: string;
  readonly name: string;
  /** Canonical CSS viewport box, or null for an element with no viewport presence. */
  readonly box: CssBox | null;
  readonly evidence: VisualEvidence;
  readonly provenance: Provenance;
  readonly enabled: boolean;
  /**
   * Overlay suspicion — threat model A2.
   *
   * Set when a DOM element and a detection overlap enough to be related but not enough to
   * be the same thing. That band is exactly what a click-jacking overlay looks like: the
   * DOM says a button is here, the pixels say something else is on top of it.
   */
  readonly overlaySuspected: boolean;
}

export interface FusionResult {
  readonly elements: readonly FusedElement[];
  /** Detections that matched no DOM node, kept as vision-only elements. */
  readonly visionOnlyCount: number;
  /** DOM nodes no detection confirmed. Expected and fine; recorded for the ledger. */
  readonly domOnlyCount: number;
  readonly matchedCount: number;
  readonly overlaySuspectCount: number;
}

/** Intersection-over-union of two CSS boxes. */
export function iou(a: CssBox, b: CssBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

/**
 * Below this, an overlap is coincidence — adjacent controls in a dense form routinely
 * share a few percent. Between this and the fusion threshold is the suspicious band.
 */
export const OVERLAY_SUSPICION_FLOOR = 0.2;

/**
 * Fuse a DOM element graph with visual detections.
 *
 * `detectorRan` distinguishes "the detector ran and found nothing here" from "no detector
 * ran at all". Without it, the DOM-only floor — currently the only admissible
 * configuration, since `UIElementDetector` has no usable implementation — would be
 * indistinguishable from a working detector reporting an empty page.
 */
export function fuse(
  graph: ElementGraph,
  detections: readonly VisualDetection[],
  detectorRan: boolean,
  geometry: CaptureGeometry
): FusionResult {
  const claimed = new Set<number>();
  const elements: FusedElement[] = [];
  let matched = 0;
  let overlaySuspects = 0;

  for (const node of graph.nodes) {
    const nodeBox = viewportBoxOf(node.evidence);

    // An element with no pixels in this frame cannot be matched to anything seen in it.
    // This is where the off-screen rule pays off: there is no box to match against, so
    // there is no way for a detection to be attributed to an unobserved element.
    if (!nodeBox || !admitsVisualEvidence(node.evidence)) {
      elements.push({
        id: node.id,
        role: node.role,
        name: node.name,
        box: null,
        evidence: node.evidence,
        provenance: {
          source: "dom",
          domNode: node.id,
          visualAbsence: node.evidence.kind === "OFFSCREEN" ? "OFFSCREEN" : "NOT_DETECTED",
        },
        enabled: node.enabled,
        overlaySuspected: false,
      });
      continue;
    }

    // Deterministic: best IoU wins, ties broken by detection order.
    let bestIndex = -1;
    let bestIou = 0;
    let suspicious = false;
    detections.forEach((d, i) => {
      if (claimed.has(i)) return;
      const score = iou(nodeBox, d.box);
      if (score > bestIou) {
        bestIou = score;
        bestIndex = i;
      }
      if (score > OVERLAY_SUSPICION_FLOOR && score <= FUSION_IOU_THRESHOLD) suspicious = true;
    });

    if (bestIndex >= 0 && bestIou > FUSION_IOU_THRESHOLD) {
      claimed.add(bestIndex);
      matched += 1;
      elements.push({
        id: node.id,
        role: node.role,
        name: node.name,
        box: nodeBox,
        evidence: node.evidence,
        provenance: {
          source: "dom+vision",
          domNode: node.id,
          detection: detections[bestIndex]!,
          iou: bestIou,
        },
        enabled: node.enabled,
        overlaySuspected: false,
      });
      continue;
    }

    if (suspicious) overlaySuspects += 1;
    elements.push({
      id: node.id,
      role: node.role,
      name: node.name,
      box: nodeBox,
      evidence: node.evidence,
      provenance: {
        source: "dom",
        domNode: node.id,
        visualAbsence: detectorRan ? "NOT_DETECTED" : "NO_DETECTOR",
      },
      enabled: node.enabled,
      overlaySuspected: suspicious,
    });
  }

  // Detections nothing in the DOM accounts for. These are the ones that matter most —
  // canvas interfaces, cross-origin iframes, scanned documents — so they become real
  // elements with synthetic ids rather than being discarded as noise.
  let visionOnly = 0;
  detections.forEach((d, i) => {
    if (claimed.has(i)) return;
    visionOnly += 1;
    const id = nodeId(`v${i}`);
    elements.push({
      id,
      role: d.label,
      name: "",
      box: d.box,
      evidence: {
        kind: "OBSERVED",
        frameId: d.frameId,
        viewportBox: d.box,
        documentBox: cssToDocument(d.box, geometry),
      },
      provenance: { source: "vision", detection: d, syntheticId: id },
      enabled: true,
      overlaySuspected: false,
    });
  });

  return {
    elements,
    visionOnlyCount: visionOnly,
    domOnlyCount: elements.filter((e) => e.provenance.source === "dom").length,
    matchedCount: matched,
    overlaySuspectCount: overlaySuspects,
  };
}

/** The viewport box an element occupies in this frame, if any. */
function viewportBoxOf(e: VisualEvidence): CssBox | null {
  switch (e.kind) {
    case "OBSERVED":
    case "CLIPPED":
      return e.viewportBox;
    case "OFFSCREEN":
    case "UNOBSERVED":
      return null;
  }
}

/** The manifest `source` string, refusing to serialize an unresolved provenance. */
export function manifestSource(p: Provenance): "dom" | "vision" | "dom+vision" {
  if (p.source === "unresolved") {
    throw new Error(
      "Provenance is unresolved and must not be serialized. " +
        "The manifest's source field admits only dom, vision or dom+vision, and guessing " +
        "one of them would attach evidence that was never established."
    );
  }
  return p.source;
}
