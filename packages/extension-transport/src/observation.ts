/**
 * Observation over the transport: the reading that establishes a binding, and the reading VERIFY
 * RESULT is given afterwards. D-E6-4 property TR-8.
 *
 * THE OBSERVATION IS WHERE A BINDING COMES FROM. The first reading of a document returns, alongside
 * the measurements, the browser-attested identity of whoever answered. That identity — not a claim
 * in a message — becomes the `TransportBinding` every later message names. A graph therefore always
 * belongs to exactly one attested document, which is what makes "a stale document must refuse"
 * enforceable at all.
 *
 * EVERY OBSERVATION IS A NEW FRAME. `buildElementGraph` is the unchanged perception builder and the
 * `FrameId` is minted here, per reading. VERIFY RESULT refuses an observation whose frame equals the
 * one the action was dispatched against (`OBSERVATION_STALE`), and that check is only meaningful if
 * a fresh reading really is a fresh frame.
 *
 * THE POST-ACTION OBSERVER NEVER THROWS, ON PURPOSE. `guardedAct` awaits `verify.observe()` without a
 * try, so a throwing observer would discard the whole outcome — including the fact that a dispatch
 * happened. Instead a refused reading returns an **empty graph with no focus property**, from which
 * VERIFY RESULT can only answer `UNKNOWN` (the target is absent, focus is unestablished). It can
 * never answer CONFIRMED, and it never converts a navigation into evidence that the requested effect
 * occurred. The refusal itself is recorded in the observer's report rather than swallowed.
 *
 * NOTHING HERE IS AUTHORITY: an observation cannot authorise anything, and a refused observation
 * degrades a verdict to UNKNOWN rather than upgrading anything to success.
 */
import { type PostActionObservation } from "@pratibimb/agent";
import {
  buildElementGraph,
  frameId as toFrameId,
  type CaptureGeometry,
  type ElementGraph,
  type FrameId,
} from "@pratibimb/perception";

import { isLoopbackOrigin, type AttestedDocument, type FocusReading, type ViewportReading } from "./contracts.js";
import { askPage, transportDeps, type TransportBinding, type TransportDeps, type TransportRelay } from "./coreTransport.js";
import { TransportRefusal } from "./errors.js";

export interface ObservationDeps extends TransportDeps {
  /** A NEW perception frame for every reading. See the class comment. */
  readonly newFrameId: () => FrameId;
}

export const observationDeps = (deps?: Partial<ObservationDeps>): ObservationDeps => {
  const base = transportDeps(deps);
  return { newId: base.newId, newFrameId: deps?.newFrameId ?? (() => toFrameId(`transport-${base.newId()}`)) };
};

export interface PageObservation {
  readonly binding: TransportBinding;
  readonly graph: ElementGraph;
  readonly focus: FocusReading;
  readonly viewport: ViewportReading;
}

/**
 * The coordinate contract for a reading with no capture in it.
 *
 * `captureSize` is the CSS viewport because **no frame was captured on this path** — no screenshot,
 * no detector, no pixels. Setting it equal to the viewport makes `scale_to_css` exactly 1 and keeps
 * the geometry internally consistent; no capture-pixel conversion is performed anywhere here. `dpr`
 * is the page's own value, recorded rather than assumed. `zoom` is recorded as 1 because a content
 * script cannot read the browser's zoom factor — and the contract forbids using it as a multiplier
 * in any case, so nothing is derived from it.
 */
const geometryOf = (viewport: ViewportReading, origin: string): CaptureGeometry => ({
  dpr: viewport.dpr,
  zoom: 1,
  viewportCss: { w: viewport.w, h: viewport.h },
  captureSize: { w: viewport.w, h: viewport.h },
  scroll: { x: viewport.scrollX, y: viewport.scrollY },
  origin,
});

/** A graph the observer could not build. Nodeless, so VERIFY RESULT can only answer UNKNOWN. */
export const emptyGraph = (frame: FrameId): ElementGraph => ({ frameId: frame, nodes: [], byId: new Map() });

/** Map the page's three-valued focus onto the three-valued field VERIFY RESULT reads. */
export function toPostActionObservation(graph: ElementGraph, focus: FocusReading): PostActionObservation {
  if (focus.state === "UNESTABLISHED") return { graph }; // property ABSENT: unknown, not "nothing"
  if (focus.state === "NONE") return { graph, focusedSelector: null };
  return focus.nth === undefined
    ? { graph, focusedSelector: focus.selector }
    : { graph, focusedSelector: focus.selector, focusedNth: focus.nth };
}

/**
 * Read a document for the first time and bind to whoever answered.
 *
 * Throws a `TransportRefusal` rather than returning a partial observation: a plan built on a document
 * this transport could not identify would have nothing to be stale against.
 */
export async function observePage(
  relay: TransportRelay,
  target: { readonly tabId: number; readonly frameId: number },
  deps?: Partial<ObservationDeps>
): Promise<PageObservation> {
  const { newId, newFrameId } = observationDeps(deps);
  const { reply, attested, swBootId } = await askPage(relay, {
    target: { tabId: target.tabId, frameId: target.frameId, documentId: null },
    expectDocument: null,
    expectSwBootId: null,
    body: { op: "OBSERVE", requestId: newId() },
    expectedOp: "OBSERVE",
  });
  if (attested.tabId !== target.tabId || attested.frameId !== target.frameId) {
    throw new TransportRefusal("ATTESTATION_MISMATCH");
  }
  if (!isLoopbackOrigin(attested.origin)) throw new TransportRefusal("NOT_LOOPBACK_ORIGIN");
  if (reply.op !== "OBSERVE") throw new TransportRefusal("REPLY_MISMATCH");

  const observationFrameId = newFrameId();
  const graph = buildGraph(reply.measurements, reply.viewport, attested, observationFrameId);
  return {
    binding: { observationFrameId, document: attested, swBootId },
    graph,
    focus: reply.focus,
    viewport: reply.viewport,
  };
}

/**
 * Read the document a binding names, and only that document.
 *
 * The service-worker boot is deliberately NOT required here: reading a page carries no authority, and
 * a worker restart does not make an observation wrong. The document identity is what must match.
 */
export async function observeBoundDocument(
  relay: TransportRelay,
  binding: TransportBinding,
  deps?: Partial<ObservationDeps>
): Promise<{ readonly graph: ElementGraph; readonly focus: FocusReading; readonly viewport: ViewportReading }> {
  const { newId, newFrameId } = observationDeps(deps);
  const { reply, attested } = await askPage(relay, {
    target: {
      tabId: binding.document.tabId,
      frameId: binding.document.frameId,
      documentId: binding.document.documentId,
    },
    expectDocument: binding.document,
    expectSwBootId: null,
    body: { op: "OBSERVE", requestId: newId() },
    expectedOp: "OBSERVE",
  });
  if (reply.op !== "OBSERVE") throw new TransportRefusal("REPLY_MISMATCH");
  return {
    graph: buildGraph(reply.measurements, reply.viewport, attested, newFrameId()),
    focus: reply.focus,
    viewport: reply.viewport,
  };
}

function buildGraph(
  measurements: Parameters<typeof buildElementGraph>[0],
  viewport: ViewportReading,
  attested: AttestedDocument,
  frame: FrameId
): ElementGraph {
  try {
    return buildElementGraph(measurements, geometryOf(viewport, attested.origin), frame);
  } catch {
    // A geometry the coordinate contract refuses is not a graph. Perception's own message is dropped
    // (INV-21) and the refusal carries a code, like every other refusal on this path.
    throw new TransportRefusal("MALFORMED_OBSERVATION");
  }
}

export interface ObservationReport {
  /** Every reading attempted by this observer, and the refusal for each one that failed. */
  observations: number;
  readonly refusals: string[];
}

export interface PostActionObserver {
  /** Never throws. A refused reading becomes an empty graph, which VERIFY RESULT can only call UNKNOWN. */
  readonly observe: () => Promise<PostActionObservation>;
  readonly report: ObservationReport;
}

export function createPostActionObserver(
  relay: TransportRelay,
  binding: TransportBinding,
  deps?: Partial<ObservationDeps>
): PostActionObserver {
  const resolved = observationDeps(deps);
  const report: ObservationReport = { observations: 0, refusals: [] };
  return {
    report,
    observe: async (): Promise<PostActionObservation> => {
      report.observations += 1;
      try {
        const { graph, focus } = await observeBoundDocument(relay, binding, resolved);
        return toPostActionObservation(graph, focus);
      } catch (error) {
        report.refusals.push(error instanceof TransportRefusal ? error.code : "MALFORMED_OBSERVATION");
        return { graph: emptyGraph(resolved.newFrameId()) };
      }
    },
  };
}
