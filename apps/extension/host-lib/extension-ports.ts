/**
 * THE PRODUCT LOOP'S PORTS, OVER THE REAL EXTENSION TRANSPORT.
 *
 * `apps/demo/src/pageAdapter.ts` gives the orchestrator a page by holding a `Document` in the same
 * realm. The extension cannot: the core realm is the offscreen document and the page is in a tab,
 * with a service worker between them. This file supplies the same four ports from that distance, and
 * it supplies them by **delegating to the existing transport** rather than by reimplementing any of
 * it. Nothing here measures an element, chooses a point, or decides anything.
 *
 * WHAT CHANGES ACROSS THE DISTANCE, AND WHAT MUST NOT:
 *
 * - `observe()` is `observeBoundDocument`, which reads only the document the binding names and gives
 *   every reading a new frame id — which is what VERIFY RESULT requires and what a same-realm
 *   adapter has to remember to do by hand.
 * - `documentId` is the **browser's** attestation, not a marker this code wrote into the page. That
 *   is strictly better evidence than the demo's: a reload changes it whether or not we are watching.
 * - `bridges` is one `TransportCycle`, created once, which looks once and acts once. A second look
 *   or a second act refuses inside the transport, so replay is not a policy this file enforces.
 * - `insert()` **refuses**. It is the port for writing a literal a reasoner supplied, and this
 *   client has no way to carry one to the page that the service worker would not read — so it does
 *   not carry one at all. A reference-backed restoration does not come through here: it goes to the
 *   privacy boundary, where the value already is. The agent gains no arbitrary write primitive.
 *
 * WHAT IS NOT HERE. No fetch, no classifier, no vault, no planner, no permit, no consent. The
 * reasoner, the grant prompt and the release authority are all handed in.
 */
import { type GuardedBridges } from "@pratibimb/agent";
import {
  createTransportCycle,
  observeBoundDocument,
  type CycleReport,
  type TransportBinding,
  type TransportRelay,
} from "@pratibimb/extension-transport";
import { type ElementGraph, type ViewportMeasurement } from "@pratibimb/perception";
import {
  type ClientPorts,
  type GrantDecision,
  type GrantRequest,
  type Observation,
  type PrivacyBoundary,
} from "@pratibimb/orchestrator";
import { type ReasonerClient, type ReasonerKind } from "@pratibimb/reasoner";

import { type PerceptionSummary } from "./perception-realm";


export interface ExtensionPortsOptions {
  readonly relay: TransportRelay;
  readonly binding: TransportBinding;
  /** The origin the run is bound to. */
  readonly origin: string;
  /** Where the page's values are: the content script's isolated world. */
  readonly privacy: PrivacyBoundary;
  readonly reasoner: ReasonerClient;
  readonly reasonerKind?: ReasonerKind;
  readonly fallback?: ReasonerClient;
  requestGrant(request: GrantRequest): Promise<GrantDecision>;
  /**
   * M3 — look at the page as well as reading it.
   *
   * Optional, and absent means the DOM-only floor, which is the configuration every milestone
   * before this one ran on. A perception pass that refuses is recorded and the reading continues:
   * the DOM substrate is the reliable one and vision is evidence ADDED to it, so a detector that
   * cannot run must not be able to stop the loop.
   */
  perceive?(graph: ElementGraph, measurement: ViewportMeasurement): Promise<PerceptionSummary>;
}

/** Counts of what the ports were actually asked to do. The refusal run's claim is `clicks === 0`. */
export interface ExtensionPortsReport {
  observations: number;
  /** Literal inserts the plan asked for. Every one of them is refused; see `insert` below. */
  inserts: number;
  readonly insertRefusals: string[];
  /** The transport's own account of the one action cycle, or `null` if no action was reached. */
  cycle: CycleReport | null;
  /** M3: what each perception pass produced. Counts, geometry, codes and timings only. */
  readonly perception: PerceptionSummary[];
}

export interface ExtensionPorts {
  readonly ports: ClientPorts;
  readonly report: ExtensionPortsReport;
}

export function createExtensionPorts(options: ExtensionPortsOptions): ExtensionPorts {
  const report: ExtensionPortsReport = {
    observations: 0,
    inserts: 0,
    insertRefusals: [],
    cycle: null,
    perception: [],
  };

  /**
   * The frame the most recent reading was taken against.
   *
   * THE BRIDGES MUST SPEAK FOR THE FRESH FRAME, NOT THE FIRST ONE. Freshness is decided against the
   * graph REFRESH produced, and the execution gate then requires the hit-test bridge to be in that
   * same frame — a bridge still naming the binding's original observation frame is refused with
   * `BRIDGE_FRAME_MISMATCH`, correctly: it would be looking at a page reading older than the one the
   * decision was made on. The demo's adapter gets this for free because its bridges read a counter
   * the adapter bumps; over the transport it has to be carried deliberately.
   */
  let latestFrame = options.binding.observationFrameId;

  // One cycle for the run, built on first use — which is after REFRESH, so it inherits that frame.
  // `guardedAct` reads both bridges from the same object, and they must belong to the same cycle or
  // the hit test would not be the one the dispatch honours.
  let cycle: ReturnType<typeof createTransportCycle> | null = null;
  const theCycle = (): ReturnType<typeof createTransportCycle> => {
    if (cycle === null) {
      cycle = createTransportCycle(options.relay, { ...options.binding, observationFrameId: latestFrame });
      report.cycle = cycle.report;
    }
    return cycle;
  };

  const bridges: GuardedBridges = {
    get hitTest() {
      return theCycle().hitTest;
    },
    get action() {
      return theCycle().action;
    },
  };

  const observe = async (): Promise<Observation> => {
    report.observations += 1;
    const { graph, focus, viewport } = await observeBoundDocument(options.relay, options.binding);
    latestFrame = graph.frameId;

    /**
     * M3 — CAPTURE, DETECT AND FUSE, AGAINST THE READING THAT WAS JUST TAKEN.
     *
     * After the DOM reading and against the same frame, so the join is between one moment's DOM and
     * one moment's pixels. `fuse` refuses outright if the detections name a different frame.
     *
     * What comes back is value-free by construction: counts, boxes, class labels drawn from a fixed
     * list of eight, and timings. The pixels stay in the realm that decoded them.
     *
     * A REFUSED PASS IS RECORDED AND THE READING CONTINUES. The DOM is the actionable substrate and
     * always has been; vision is evidence added to it. A detector that cannot run degrades what the
     * client can SAY about the page, never what it can do safely.
     */
    if (options.perceive) {
      const summary = await options.perceive(graph, {
        dpr: viewport.dpr,
        // A content script cannot read the browser's zoom factor, so it is recorded as 1 and
        // nothing is derived from it — the coordinate contract forbids using it as a multiplier.
        zoom: 1,
        viewportCssWidth: viewport.w,
        viewportCssHeight: viewport.h,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
        origin: options.origin,
      });
      report.perception.push(summary);
    }

    // Present, visible and enabled right now. `OFFSCREEN` evidence means the element exists but was
    // not in frame, which is not something to act on.
    const actionable = new Set(
      graph.nodes
        .filter((node) => node.enabled && (node.evidence.kind === "OBSERVED" || node.evidence.kind === "CLIPPED"))
        .map((node) => node.domRef.selector)
    );

    // The fixture's status line, for the record only. ADR: never the result oracle — VERIFY RESULT
    // reads the submit control's own enabled state, not this text.
    const status = graph.nodes.find((node) => node.domRef.selector === "#status");

    const focused =
      focus.state === "UNESTABLISHED" ? {} : { focusedSelector: focus.state === "NONE" ? null : focus.selector };

    return {
      graph,
      // THE READING CARRIES NO VALUES, and nothing above needs it to. The transport has no field for
      // one (TR-10, INV-21), and the privacy boundary reads the page's values where they are. An
      // empty list here is the literal truth about what crossed the worker.
      fields: [],
      viewport: {
        w: viewport.w,
        h: viewport.h,
        dpr: viewport.dpr,
        // A content script cannot read the browser's zoom factor, so the transport does not report
        // one and this records 1 — the same value, and the same reasoning, as the transport's own
        // `geometryOf`. The coordinate contract forbids using zoom as a multiplier, so nothing is
        // derived from it. Reporting `undefined` here is what the manifest verifier refuses.
        zoom: 1,
        scrollX: viewport.scrollX,
        scrollY: viewport.scrollY,
      },
      // The browser's word for which document answered, not a marker this code wrote.
      documentId: options.binding.document.documentId,
      ...focused,
      actionable,
      statusText: status?.name ?? null,
    };
  };

  /**
   * Write a literal a reasoner supplied. **Refused, always.**
   *
   * The orchestrator reaches this port only for a plan step carrying text of the reasoner's own —
   * text that has already passed all three checks on a literal and is provably not a value this
   * client holds. It is still refused here, for a reason about this client rather than about that
   * text: there is no way to carry it to the page that the service worker would not read, and this
   * milestone does not add one. A reference-backed restoration never comes through here.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  const insert = async (target: string): Promise<boolean> => {
    report.inserts += 1;
    report.insertRefusals.push(`LITERAL_INSERT_NOT_CARRIED:${target}`);
    return false;
  };

  return {
    report,
    ports: {
      observe,
      insert,
      bridges,
      privacy: options.privacy,
      reasoner: options.reasoner,
      ...(options.reasonerKind ? { reasonerKind: options.reasonerKind } : {}),
      ...(options.fallback ? { fallback: options.fallback } : {}),
      requestGrant: options.requestGrant,
    },
  };
}
