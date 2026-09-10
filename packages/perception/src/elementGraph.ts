/**
 * The derived element graph.
 *
 * DERIVED AND DISPOSABLE. The page DOM is the source of truth; this is a snapshot taken
 * against one frame and thrown away with it. It deliberately does not cache across frames
 * and holds no authority of its own — a second, competing model of the page that outlives
 * the page is how a UI agent ends up confidently acting on a layout that changed.
 *
 * Node shape follows the frozen manifest schema's `elements[]` entry — `id`, `role`,
 * `name`, `bbox`, `source`, `visible`, `enabled`, `offscreen` — so serialization is a
 * projection and not a translation.
 *
 * What the DOM knows, per the frozen constitution: role, accessible name, label, input
 * type, exact text and its box, visibility, enabled state, ARIA. Free, exact, no inference
 * error. That is why the DOM half of fusion is not a fallback for vision — it is the
 * better source for everything in that list.
 */
import { type CssBox, cssBox } from "./space.js";
import { type CaptureGeometry, classifyContainment, cssToDocument, clipToViewport } from "./coordinates.js";
import { type VisualEvidence, type FrameId } from "./observation.js";

/** Stable-within-a-snapshot node id. Matches the manifest's `e12` style. */
export type NodeId = string & { readonly __brand: "NodeId" };

export const nodeId = (s: string): NodeId => s as NodeId;

/**
 * A handle back to the live DOM element.
 *
 * Kept opaque so this package never depends on `lib.dom`, and so a node can be carried
 * across a message boundary (where the element itself cannot go) without silently losing
 * the ability to say which element it meant. `selector` is what survives that crossing and
 * is what a DOM-matched element is actioned by — robust to reflow, per the contract.
 */
export interface DomRef {
  /** A selector that resolves to this element in its document. */
  readonly selector: string;
  /** Index among identical siblings, where a selector alone is not unique. */
  readonly nth?: number;
}

/**
 * Raw DOM measurement of one element, as taken in the page context.
 *
 * This is the input to graph construction, not part of the graph. It is CSS-space already
 * because `getBoundingClientRect()` returns CSS pixels — which is also why the QG-02
 * invariant holds at all: a 200 px-wide element measures 200 at every DPR and every zoom.
 */
export interface DomMeasurement {
  readonly selector: string;
  readonly nth?: number;
  /** ARIA or implicit role: `button`, `textbox`, `link`, `heading`, ... */
  readonly role: string;
  /** Accessible name. Subject to the text policy below. */
  readonly name: string;
  /** `getBoundingClientRect()`, CSS viewport pixels. */
  readonly rect: { x: number; y: number; w: number; h: number };
  /** `disabled` / `aria-disabled`, where the element has the concept. */
  readonly enabled?: boolean;
  /** CSS-level visibility: `display:none`, `visibility:hidden`, zero size, `hidden`. */
  readonly cssHidden: boolean;
  /** Index of the parent in the same measurement array, or -1 for a root. */
  readonly parentIndex: number;
}

/** One node of the derived graph. */
export interface ElementNode {
  readonly id: NodeId;
  readonly role: string;
  /**
   * Accessible name.
   *
   * Text metadata only where policy allows. The accessible name is structural UI text —
   * a control's label — and is what the server must reason about to plan "fill the phone
   * field". It is NOT page content, and nothing here reads value attributes or inner text
   * of arbitrary nodes. Anything that could carry a secret belongs to the T2 sanitize tier
   * and its detectors, not to the element graph.
   */
  readonly name: string;
  readonly domRef: DomRef;
  /** What perception is entitled to claim visually. See `observation.ts`. */
  readonly evidence: VisualEvidence;
  readonly enabled: boolean;
  readonly parent: NodeId | null;
  readonly children: readonly NodeId[];
}

export interface ElementGraph {
  /** The frame this graph was derived against. A graph outlives no frame. */
  readonly frameId: FrameId;
  readonly nodes: readonly ElementNode[];
  readonly byId: ReadonlyMap<NodeId, ElementNode>;
}

/**
 * Build the graph from DOM measurements taken against one frame.
 *
 * Every node's evidence is classified here, once, from the geometry — rather than each
 * consumer deciding for itself whether something was on screen. That centralisation is the
 * whole reason `OFFSCREEN` cannot leak pixel evidence: there is one place that could
 * attach it, and it does not.
 */
export function buildElementGraph(
  measurements: readonly DomMeasurement[],
  geometry: CaptureGeometry,
  frame: FrameId
): ElementGraph {
  const nodes: ElementNode[] = [];
  const ids: NodeId[] = measurements.map((_, i) => nodeId(`e${i}`));
  const childrenOf = new Map<number, NodeId[]>();

  measurements.forEach((m, i) => {
    if (m.parentIndex >= 0 && m.parentIndex < measurements.length) {
      const list = childrenOf.get(m.parentIndex) ?? [];
      list.push(ids[i]!);
      childrenOf.set(m.parentIndex, list);
    }
  });

  measurements.forEach((m, i) => {
    const box = cssBox(m.rect.x, m.rect.y, m.rect.w, m.rect.h);
    nodes.push({
      id: ids[i]!,
      role: m.role,
      name: m.name,
      domRef: m.nth === undefined ? { selector: m.selector } : { selector: m.selector, nth: m.nth },
      evidence: classifyEvidence(box, m.cssHidden, geometry, frame),
      enabled: m.enabled ?? true,
      parent: m.parentIndex >= 0 ? ids[m.parentIndex] ?? null : null,
      children: childrenOf.get(i) ?? [],
    });
  });

  return {
    frameId: frame,
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
  };
}

/**
 * Decide what may be claimed about one box.
 *
 * Order matters. A CSS-hidden element is not off-screen — it is not rendered at all, so it
 * has no pixels anywhere and scrolling will not reveal it. Conflating the two would let a
 * `display:none` element be scheduled for a scroll that can never make it visible.
 */
export function classifyEvidence(
  box: CssBox,
  cssHidden: boolean,
  geometry: CaptureGeometry,
  frame: FrameId
): VisualEvidence {
  const documentBox = cssToDocument(box, geometry);

  if (cssHidden) {
    return {
      kind: "UNOBSERVED",
      reason: "ELEMENT_OUTSIDE_CAPTURE",
      detail:
        "Element is not rendered (display:none, visibility:hidden or zero size). It has no " +
        "pixels in any frame, and no scroll can reveal it.",
    };
  }

  switch (classifyContainment(box, geometry)) {
    case "INSIDE":
      return { kind: "OBSERVED", frameId: frame, viewportBox: box, documentBox };
    case "CLIPPED": {
      const visiblePart = clipToViewport(box, geometry);
      // classifyContainment said CLIPPED, so an intersection exists. If it somehow does
      // not, claim nothing rather than reconcile the two by guessing.
      if (!visiblePart) {
        return {
          kind: "UNOBSERVED",
          reason: "ELEMENT_OUTSIDE_CAPTURE",
          detail: "Classified as clipped but no intersection with the viewport was found.",
        };
      }
      return { kind: "CLIPPED", frameId: frame, viewportBox: box, visiblePart, documentBox };
    }
    case "OUTSIDE":
      // Known from the DOM, never in the frame. Document space only — and structurally
      // incapable of carrying a viewport box.
      return { kind: "OFFSCREEN", documentBox };
  }
}
