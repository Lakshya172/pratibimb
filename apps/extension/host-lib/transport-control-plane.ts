/**
 * The core realm, inside the offscreen document. D-E6-4 property TR-9.
 *
 * WHY HERE. Track G measured that the offscreen document survives a service-worker restart while the
 * worker is terminated when idle and holds no state by design. The execution gate's registry of
 * issued permits is a same-realm `WeakSet`, so it must live somewhere that outlives a worker — and
 * the worker must stay a router that carries messages rather than a place where authority sits.
 *
 * WHAT THIS EXPOSES, AND TO WHOM. A frozen object on the offscreen document's global, holding the
 * unchanged agent stages and the transport's constructors. It is reachable only through the
 * DevTools protocol, which is how the Track G and E6 harnesses already drive this host: there is no
 * `externally_connectable`, no web-accessible resource, and no page-facing channel, so a page cannot
 * reach it. It adds no capability the offscreen document does not already have.
 *
 * IT IS A CONTROL PLANE, NOT AN AGENT. Nothing is started here. No loop, no plan, no observation and
 * no click happens until an evidence run asks for one, and each stage stays exactly as its ADR
 * defines it — the transport is passed in as bridges, never merged into the core.
 */
import {
  act,
  authorisationPreflight,
  establishHitAgreement,
  guardedAct,
  mintDispatchPermit,
  monotonicNow,
  permitState,
  validateActionFreshness,
  verifyActionResult,
} from "@pratibimb/agent";
import {
  createPostActionObserver,
  createTransportCycle,
  observeBoundDocument,
  observePage,
  toPostActionObservation,
  type TransportBinding,
} from "@pratibimb/extension-transport";
import { buildElementGraph, frameId } from "@pratibimb/perception";

import { chromeRelay } from "./transport-chrome";

/** The name an evidence run evaluates against in the offscreen realm. */
export const CONTROL_PLANE_KEY = "__pratibimbTransport";

export function installTransportControlPlane(): void {
  const plane = Object.freeze({
    realm: "offscreen",
    relay: chromeRelay,

    /** Read a document and bind to whoever answered. */
    observePage: (target: { tabId: number; frameId: number }) => observePage(chromeRelay, target),
    observeBoundDocument: (binding: TransportBinding) => observeBoundDocument(chromeRelay, binding),
    /** The two bridges for one action, bound to that document. */
    createTransportCycle: (binding: TransportBinding) => createTransportCycle(chromeRelay, binding),
    createPostActionObserver: (binding: TransportBinding) => createPostActionObserver(chromeRelay, binding),
    toPostActionObservation,

    /** The unchanged stages. Composed by the caller exactly as `guardedAct` composes them. */
    agent: Object.freeze({
      guardedAct,
      validateActionFreshness,
      authorisationPreflight,
      establishHitAgreement,
      mintDispatchPermit,
      permitState,
      act,
      verifyActionResult,
      monotonicNow,
    }),
    perception: Object.freeze({ buildElementGraph, frameId }),
  });

  (globalThis as unknown as Record<string, unknown>)[CONTROL_PLANE_KEY] = plane;
}
