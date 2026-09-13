/**
 * `@pratibimb/extension-transport` — the page transport for experiment D-E6-4.
 *
 * It carries an action the execution gate has **already authorised** to the document that action was
 * validated against, dispatches exactly that action, and reports what happened. It is not an
 * authority: it cannot mint a permit, widen one, choose a target, substitute a point or a selector,
 * retry, or turn an unknown into a success. Every check it performs can only refuse.
 *
 * Pre-registration: `artifacts/experiments/E6-extension-dispatch-revalidation/README.md` §3.3
 * (properties TR-1…TR-10). This package is chrome-free and DOM-free by construction — the browser
 * glue lives in `apps/extension/host*` and supplies the surfaces these modules abstract over — so the
 * refusals can be tested deterministically without a browser.
 */
export {
  MAX_ID_LENGTH,
  MAX_MEASUREMENTS,
  PAGE_REFUSAL_CODES,
  RELAY_REFUSAL_CODES,
  CORE_REFUSAL_CODES,
  TRANSPORT_CHANNEL,
  TRANSPORT_PORT_NAME,
  isLoopbackOrigin,
  pageRefused,
  parseAttachedNotice,
  parseAttestedDocument,
  parseElementDescription,
  parseFocusReading,
  parsePagePoint,
  parsePageReply,
  parsePageRequest,
  parseRelayEnvelope,
  parseRelayRequest,
  relayRefused,
  requestIdOf,
  sameAttestedDocument,
  type AttachedNotice,
  type AttestedDocument,
  type CoreRefusalCode,
  type DocumentAddress,
  type ElementDescription,
  type FocusReading,
  type PageOp,
  type PagePoint,
  type PageRefusalCode,
  type PageReply,
  type PageRequest,
  type RelayEnvelope,
  type RelayRefusalCode,
  type RelayRequest,
  type TransportRefusalCode,
  type ViewportReading,
} from "./contracts.js";

export { TransportRefusal, refuse } from "./errors.js";

export {
  DEFAULT_CYCLE_CAPACITY,
  createPageAgent,
  type PageAgent,
  type PageSurface,
  type PreparedClick,
} from "./pageAgent.js";

export {
  createServiceWorkerRouter,
  type PortLike,
  type ServiceWorkerRouter,
} from "./swRouter.js";
