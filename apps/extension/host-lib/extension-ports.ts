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
 * - `insert()` is the one that could not be ported directly, and the way it is done is the point:
 *   **the value is not sent**. See `value-release.ts`.
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
import {
  type ClientPorts,
  type GrantDecision,
  type GrantRequest,
  type Observation,
} from "@pratibimb/orchestrator";
import { type ObservedField } from "@pratibimb/privacy";
import { type ReasonerClient, type ReasonerKind } from "@pratibimb/reasoner";

import { type ReleaseAuthority, type ReleaseBinding } from "./value-release";

/** What the content script reports back. Booleans and codes — never the value it wrote. */
export interface RehydrationOutcome {
  readonly written: boolean;
  readonly refused?: string;
}

export interface ExtensionPortsOptions {
  readonly relay: TransportRelay;
  readonly binding: TransportBinding;
  /** The origin the run is bound to. `sanitize()` refuses details held for anywhere else. */
  readonly origin: string;
  /** The client's own details. Never read from the page — see `client-held-fields.ts`. */
  readonly fields: readonly ObservedField[];
  readonly release: ReleaseAuthority;
  /**
   * Ask the bound document to come and collect one capability.
   *
   * Carries a nonce and a target and returns booleans. If this ever needs a value parameter,
   * something has gone wrong upstream of it.
   */
  rehydrate(nonce: string, target: string): Promise<RehydrationOutcome>;
  readonly releaseTtlMs: number;
  readonly reasoner: ReasonerClient;
  readonly reasonerKind?: ReasonerKind;
  readonly fallback?: ReasonerClient;
  requestGrant(request: GrantRequest): Promise<GrantDecision>;
}

/** Counts of what the ports were actually asked to do. The refusal run's claim is `clicks === 0`. */
export interface ExtensionPortsReport {
  observations: number;
  inserts: number;
  /** Capabilities armed, and how many of those the page actually collected. */
  armed: number;
  written: number;
  /** Every refusal the rehydration path reported, in order. */
  readonly rehydrationRefusals: string[];
  /** The transport's own account of the one action cycle, or `null` if no action was reached. */
  cycle: CycleReport | null;
}

export interface ExtensionPorts {
  readonly ports: ClientPorts;
  readonly report: ExtensionPortsReport;
}

export function createExtensionPorts(options: ExtensionPortsOptions): ExtensionPorts {
  const report: ExtensionPortsReport = {
    observations: 0,
    inserts: 0,
    armed: 0,
    written: 0,
    rehydrationRefusals: [],
    cycle: null,
  };

  const document: ReleaseBinding = {
    tabId: options.binding.document.tabId,
    frameId: options.binding.document.frameId,
    documentId: options.binding.document.documentId,
  };

  // One cycle for the run, built on first use. `guardedAct` reads both bridges from the same object,
  // and they must belong to the same cycle or the hit test would not be the one the dispatch honours.
  let cycle: ReturnType<typeof createTransportCycle> | null = null;
  const theCycle = (): ReturnType<typeof createTransportCycle> => {
    if (cycle === null) {
      cycle = createTransportCycle(options.relay, options.binding);
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
      fields: options.fields,
      viewport: {
        w: viewport.w,
        h: viewport.h,
        dpr: viewport.dpr,
        zoom: viewport.zoom,
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
   * Restore one value into one target — without sending it.
   *
   * Arm a capability for exactly this document and exactly this target, tell the page that one is
   * waiting, and let it come and ask. Whatever happens, nothing stays armed afterwards: a capability
   * that outlived the insert that created it would be a standing permission, which is the opposite
   * of what this is.
   */
  const insert = async (target: string, value: string): Promise<boolean> => {
    report.inserts += 1;
    const nonce = options.release.arm(document, target, value, options.releaseTtlMs);
    report.armed += 1;
    try {
      const outcome = await options.rehydrate(nonce, target);
      if (outcome.refused !== undefined) report.rehydrationRefusals.push(outcome.refused);
      if (outcome.written) report.written += 1;
      return outcome.written;
    } catch (error) {
      report.rehydrationRefusals.push(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      options.release.revokeAll();
    }
  };

  return {
    report,
    ports: {
      observe,
      insert,
      bridges,
      reasoner: options.reasoner,
      ...(options.reasonerKind ? { reasonerKind: options.reasonerKind } : {}),
      ...(options.fallback ? { fallback: options.fallback } : {}),
      requestGrant: options.requestGrant,
    },
  };
}
