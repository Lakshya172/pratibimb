/**
 * The page transport's wire contracts. Experiment D-E6-4 (`artifacts/experiments/E6-extension-dispatch-revalidation/`).
 *
 * THE TRANSPORT IS NOT AN AUTHORITY. Nothing in this file, or in any module that parses it, can
 * authorise a dispatch. Authority is minted by `@pratibimb/agent`'s execution gate from an attested
 * ALLOW and an attested MATCH, and every check here can only **refuse** — which is why each refusal
 * is a code in a closed union rather than a boolean or a free-form string.
 *
 * THREE HOPS, THREE REALMS.
 *
 *     core realm (offscreen document)  ──RelayRequest──►  service worker
 *                                                              │  chrome.runtime.Port
 *                                                              ▼
 *                                                       content script (isolated world)
 *                                      ◄──RelayEnvelope──      │
 *
 * The service worker is a **stateless router**: it holds no permit, no value and no decision. It
 * adds exactly one thing a message cannot carry for itself — the **browser-attested identity of the
 * document that answered** (`AttestedDocument`, from `port.sender`) and the boot it routed under.
 * The core compares that against the binding it was constructed with, and refuses on any difference.
 *
 * WHY THE PARSERS ARE STRICT (exact key sets, closed unions, bounded strings and arrays): a message
 * that is *nearly* right is the shape a replay, a stale document or a confused sender produces. A
 * parser that accepts extra fields is a parser that accepts a message it does not understand.
 *
 * NO PAGE CONTENT CROSSES HERE (TR-10, INV-21). The only page-derived text is the element graph's
 * own vocabulary — selector, role, accessible name — which perception is already entitled to. There
 * is no field for a value, an `href`, inner text or a screenshot, and refusals carry a code, never a
 * message that could quote markup.
 */
import { type DomMeasurement } from "@pratibimb/perception";

/** The port name a content script connects with, and the channel every relay message carries. */
export const TRANSPORT_PORT_NAME = "pratibimb.page-transport.v1";
export const TRANSPORT_CHANNEL = "pratibimb.page-transport.v1";

/** Upper bounds. A message larger than the page it describes is not a message this transport sent. */
export const MAX_ID_LENGTH = 128;
export const MAX_MEASUREMENTS = 5_000;

/** A CSS-viewport point, exactly as the permit fixes it. Never rounded, never clamped. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Core realm → content script
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The four operations the page understands. There is deliberately no "click this selector", no
 * "focus", no "scroll" and no "evaluate": the transport's whole page authority is one click at one
 * point that a permit already fixed.
 */
export type PageRequest =
  | { readonly op: "OBSERVE"; readonly requestId: string }
  | { readonly op: "CLOCK"; readonly requestId: string }
  | { readonly op: "HIT_TEST"; readonly requestId: string; readonly cycleId: string; readonly point: PagePoint }
  | {
      readonly op: "DISPATCH";
      readonly requestId: string;
      readonly cycleId: string;
      /** One-time id. A repeat of it is refused rather than delivered twice (TR-6). */
      readonly deliveryId: string;
      readonly point: PagePoint;
    };

export type PageOp = PageRequest["op"];

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Content script → core realm
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** How the page describes one element: the element graph's vocabulary, and nothing else. */
export interface ElementDescription {
  readonly selector: string;
  readonly nth?: number;
  readonly role: string;
  readonly name: string;
  readonly box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

/**
 * Focus, three-valued because the distinction is load-bearing (ADR-0007 §5): an element has it,
 * reliably nothing has it, or the observer could not establish it. An unreported focus is never an
 * absent focus.
 */
export type FocusReading =
  | { readonly state: "ELEMENT"; readonly selector: string; readonly nth?: number }
  | { readonly state: "NONE" }
  | { readonly state: "UNESTABLISHED" };

/** What the page says about its own viewport. `zoom` is not here: a content script cannot read it. */
export interface ViewportReading {
  readonly w: number;
  readonly h: number;
  readonly dpr: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** Every way the page refuses. Each is a refusal to act, never a partial action. */
export const PAGE_REFUSAL_CODES = [
  "MALFORMED_REQUEST",
  "POINT_OUTSIDE_VIEWPORT",
  "CYCLE_ALREADY_HIT_TESTED",
  "NO_HIT_TEST_FOR_CYCLE",
  "CYCLE_ALREADY_DISPATCHED",
  "POINT_NOT_HIT_TESTED",
  "DUPLICATE_DELIVERY",
  "NOTHING_AT_POINT",
  "POINT_NOT_REPRESENTABLE",
  "STATE_CAPACITY_EXHAUSTED",
] as const;
export type PageRefusalCode = (typeof PAGE_REFUSAL_CODES)[number];

export type PageReply =
  | {
      readonly op: "OBSERVE";
      readonly requestId: string;
      readonly measurements: readonly DomMeasurement[];
      readonly focus: FocusReading;
      readonly viewport: ViewportReading;
    }
  | { readonly op: "CLOCK"; readonly requestId: string; readonly now: number }
  | {
      readonly op: "HIT_TEST";
      readonly requestId: string;
      readonly cycleId: string;
      readonly point: PagePoint;
      /** `null` means the page reliably reports nothing at the point — a MISMATCH, not an unknown. */
      readonly topmost: ElementDescription | null;
      readonly receivedAt: number;
      /** When `elementFromPoint` sampled the page: the instant D-E6-4 §7 calls T2s. */
      readonly sampledAt: number;
    }
  | {
      readonly op: "DISPATCH";
      readonly requestId: string;
      readonly cycleId: string;
      readonly deliveryId: string;
      readonly point: PagePoint;
      /** What was topmost at the authorised point when the events were dispatched. */
      readonly dispatchedTo: ElementDescription;
      readonly receivedAt: number;
      /** When the first event was dispatched: D-E6-4 §7's T4d. */
      readonly dispatchedAt: number;
    }
  | { readonly op: "REFUSED"; readonly requestId: string; readonly refused: PageRefusalCode };

/** The service worker's only unsolicited message: "your port is registered, under this boot". */
export interface AttachedNotice {
  readonly op: "ATTACHED";
  readonly swBootId: string;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Core realm ↔ service worker
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Where a request is addressed. `documentId` is `null` only for the observation that binds it. */
export interface DocumentAddress {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string | null;
}

/** Who actually answered, as the browser reports it. Not claimed by any message. */
export interface AttestedDocument {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string;
  readonly origin: string;
}

export const RELAY_REFUSAL_CODES = [
  "MALFORMED_RELAY_REQUEST",
  "SENDER_NOT_ACCEPTED",
  "SW_BOOT_MISMATCH",
  "UNBOUND_REQUEST",
  "NO_DOCUMENT_CONNECTION",
  "AMBIGUOUS_DOCUMENT_CONNECTION",
  "DUPLICATE_REQUEST_ID",
  "PORT_DISCONNECTED",
  "REPLY_MISMATCH",
] as const;
export type RelayRefusalCode = (typeof RELAY_REFUSAL_CODES)[number];

export interface RelayRequest {
  readonly channel: typeof TRANSPORT_CHANNEL;
  readonly kind: "RELAY";
  readonly target: DocumentAddress;
  /**
   * The service-worker boot this request is bound to (TR-7). A different boot refuses, so an attempt
   * interrupted by a restart cannot be completed by the worker that replaces it.
   */
  readonly expectSwBootId: string | null;
  readonly body: PageRequest;
}

export type RelayEnvelope =
  | {
      readonly channel: typeof TRANSPORT_CHANNEL;
      readonly kind: "RELAYED";
      readonly swBootId: string;
      readonly attested: AttestedDocument;
      readonly reply: PageReply;
    }
  | {
      readonly channel: typeof TRANSPORT_CHANNEL;
      readonly kind: "RELAY_REFUSED";
      readonly swBootId: string | null;
      readonly refused: RelayRefusalCode;
    };

/** Everything a transport call can refuse with: the page's codes, the router's, and the core side's. */
export const CORE_REFUSAL_CODES = [
  "RELAY_UNAVAILABLE",
  "MALFORMED_ENVELOPE",
  "MALFORMED_OBSERVATION",
  "ATTESTATION_MISMATCH",
  "NOT_LOOPBACK_ORIGIN",
  "CYCLE_ALREADY_HIT_TESTED",
  "NO_HIT_TEST_FOR_CYCLE",
  "CYCLE_ALREADY_DISPATCHED",
  "POINT_NOT_HIT_TESTED",
] as const;
export type CoreRefusalCode = (typeof CORE_REFUSAL_CODES)[number];

export type TransportRefusalCode = PageRefusalCode | RelayRefusalCode | CoreRefusalCode;

/**
 * The origin rule, identical to the host's own `isFromContentScript`: loopback test pages only.
 * A changed origin is a different page, and a different page is not the one that was validated.
 */
export const isLoopbackOrigin = (origin: unknown): origin is string =>
  typeof origin === "string" && /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

/** Two addresses name the same document only if every browser-attested field agrees. */
export const sameAttestedDocument = (a: AttestedDocument, b: AttestedDocument): boolean =>
  a.tabId === b.tabId && a.frameId === b.frameId && a.documentId === b.documentId && a.origin === b.origin;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Parsers. Strict by construction: exact key sets, closed unions, bounded sizes.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const keysExactly = (o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean =>
  required.every((k) => Object.hasOwn(o, k)) && Object.keys(o).every((k) => required.includes(k) || optional.includes(k));

const isId = (u: unknown): u is string => typeof u === "string" && u.length > 0 && u.length <= MAX_ID_LENGTH;
const isFinite_ = (u: unknown): u is number => typeof u === "number" && Number.isFinite(u);
const isNth = (u: unknown): u is number => isFinite_(u) && Number.isInteger(u) && u >= 0;

export function parsePagePoint(u: unknown): PagePoint | null {
  if (!isRecord(u) || !keysExactly(u, ["x", "y"])) return null;
  if (!isFinite_(u.x) || !isFinite_(u.y)) return null;
  return { x: u.x, y: u.y };
}

function parseBox(u: unknown): ElementDescription["box"] | null {
  if (!isRecord(u) || !keysExactly(u, ["x", "y", "w", "h"])) return null;
  if (!isFinite_(u.x) || !isFinite_(u.y) || !isFinite_(u.w) || !isFinite_(u.h)) return null;
  return { x: u.x, y: u.y, w: u.w, h: u.h };
}

export function parseElementDescription(u: unknown): ElementDescription | null {
  if (!isRecord(u) || !keysExactly(u, ["selector", "role", "name", "box"], ["nth"])) return null;
  if (typeof u.selector !== "string" || u.selector.length === 0) return null;
  if (typeof u.role !== "string" || typeof u.name !== "string") return null;
  const box = parseBox(u.box);
  if (!box) return null;
  if (u.nth !== undefined && !isNth(u.nth)) return null;
  return u.nth === undefined
    ? { selector: u.selector, role: u.role, name: u.name, box }
    : { selector: u.selector, nth: u.nth as number, role: u.role, name: u.name, box };
}

export function parseFocusReading(u: unknown): FocusReading | null {
  if (!isRecord(u)) return null;
  if (u.state === "NONE" || u.state === "UNESTABLISHED") {
    return keysExactly(u, ["state"]) ? ({ state: u.state } as FocusReading) : null;
  }
  if (u.state !== "ELEMENT" || !keysExactly(u, ["state", "selector"], ["nth"])) return null;
  if (typeof u.selector !== "string" || u.selector.length === 0) return null;
  if (u.nth !== undefined && !isNth(u.nth)) return null;
  return u.nth === undefined
    ? { state: "ELEMENT", selector: u.selector }
    : { state: "ELEMENT", selector: u.selector, nth: u.nth as number };
}

function parseMeasurement(u: unknown): DomMeasurement | null {
  if (!isRecord(u) || !keysExactly(u, ["selector", "role", "name", "rect", "enabled", "cssHidden", "parentIndex"], ["nth"])) {
    return null;
  }
  if (typeof u.selector !== "string" || u.selector.length === 0) return null;
  if (typeof u.role !== "string" || typeof u.name !== "string") return null;
  if (typeof u.enabled !== "boolean" || typeof u.cssHidden !== "boolean") return null;
  if (!isFinite_(u.parentIndex) || !Number.isInteger(u.parentIndex) || u.parentIndex < -1) return null;
  const rect = parseBox(u.rect);
  if (!rect) return null;
  if (u.nth !== undefined && !isNth(u.nth)) return null;
  const base = {
    selector: u.selector,
    role: u.role,
    name: u.name,
    rect,
    enabled: u.enabled,
    cssHidden: u.cssHidden,
    parentIndex: u.parentIndex,
  };
  return u.nth === undefined ? base : { ...base, nth: u.nth as number };
}

function parseViewport(u: unknown): ViewportReading | null {
  if (!isRecord(u) || !keysExactly(u, ["w", "h", "dpr", "scrollX", "scrollY"])) return null;
  if (!isFinite_(u.w) || !isFinite_(u.h) || !isFinite_(u.dpr)) return null;
  if (!isFinite_(u.scrollX) || !isFinite_(u.scrollY)) return null;
  if (u.w <= 0 || u.h <= 0 || u.dpr <= 0) return null;
  return { w: u.w, h: u.h, dpr: u.dpr, scrollX: u.scrollX, scrollY: u.scrollY };
}

export function parsePageRequest(u: unknown): PageRequest | null {
  if (!isRecord(u) || !isId(u.requestId)) return null;
  const requestId = u.requestId;
  switch (u.op) {
    case "OBSERVE":
    case "CLOCK":
      return keysExactly(u, ["op", "requestId"]) ? { op: u.op, requestId } : null;
    case "HIT_TEST": {
      if (!keysExactly(u, ["op", "requestId", "cycleId", "point"]) || !isId(u.cycleId)) return null;
      const point = parsePagePoint(u.point);
      return point ? { op: "HIT_TEST", requestId, cycleId: u.cycleId, point } : null;
    }
    case "DISPATCH": {
      if (!keysExactly(u, ["op", "requestId", "cycleId", "deliveryId", "point"])) return null;
      if (!isId(u.cycleId) || !isId(u.deliveryId)) return null;
      const point = parsePagePoint(u.point);
      return point ? { op: "DISPATCH", requestId, cycleId: u.cycleId, deliveryId: u.deliveryId, point } : null;
    }
    default:
      return null;
  }
}

/** The `requestId` of a message this transport cannot otherwise parse, so a refusal can correlate. */
export function requestIdOf(u: unknown): string | null {
  return isRecord(u) && isId(u.requestId) ? u.requestId : null;
}

export function parsePageReply(u: unknown): PageReply | null {
  if (!isRecord(u) || !isId(u.requestId)) return null;
  const requestId = u.requestId;
  switch (u.op) {
    case "OBSERVE": {
      if (!keysExactly(u, ["op", "requestId", "measurements", "focus", "viewport"])) return null;
      if (!Array.isArray(u.measurements) || u.measurements.length > MAX_MEASUREMENTS) return null;
      const measurements: DomMeasurement[] = [];
      for (const raw of u.measurements) {
        const m = parseMeasurement(raw);
        if (!m) return null;
        measurements.push(m);
      }
      const focus = parseFocusReading(u.focus);
      const viewport = parseViewport(u.viewport);
      return focus && viewport ? { op: "OBSERVE", requestId, measurements, focus, viewport } : null;
    }
    case "CLOCK":
      return keysExactly(u, ["op", "requestId", "now"]) && isFinite_(u.now) ? { op: "CLOCK", requestId, now: u.now } : null;
    case "HIT_TEST": {
      if (!keysExactly(u, ["op", "requestId", "cycleId", "point", "topmost", "receivedAt", "sampledAt"])) return null;
      if (!isId(u.cycleId) || !isFinite_(u.receivedAt) || !isFinite_(u.sampledAt)) return null;
      const point = parsePagePoint(u.point);
      if (!point) return null;
      if (u.topmost === null) {
        return { op: "HIT_TEST", requestId, cycleId: u.cycleId, point, topmost: null, receivedAt: u.receivedAt, sampledAt: u.sampledAt };
      }
      const topmost = parseElementDescription(u.topmost);
      return topmost
        ? { op: "HIT_TEST", requestId, cycleId: u.cycleId, point, topmost, receivedAt: u.receivedAt, sampledAt: u.sampledAt }
        : null;
    }
    case "DISPATCH": {
      if (!keysExactly(u, ["op", "requestId", "cycleId", "deliveryId", "point", "dispatchedTo", "receivedAt", "dispatchedAt"])) {
        return null;
      }
      if (!isId(u.cycleId) || !isId(u.deliveryId) || !isFinite_(u.receivedAt) || !isFinite_(u.dispatchedAt)) return null;
      const point = parsePagePoint(u.point);
      const dispatchedTo = parseElementDescription(u.dispatchedTo);
      return point && dispatchedTo
        ? {
            op: "DISPATCH",
            requestId,
            cycleId: u.cycleId,
            deliveryId: u.deliveryId,
            point,
            dispatchedTo,
            receivedAt: u.receivedAt,
            dispatchedAt: u.dispatchedAt,
          }
        : null;
    }
    case "REFUSED": {
      if (!keysExactly(u, ["op", "requestId", "refused"])) return null;
      return (PAGE_REFUSAL_CODES as readonly unknown[]).includes(u.refused)
        ? { op: "REFUSED", requestId, refused: u.refused as PageRefusalCode }
        : null;
    }
    default:
      return null;
  }
}

export function parseAttachedNotice(u: unknown): AttachedNotice | null {
  if (!isRecord(u) || u.op !== "ATTACHED" || !keysExactly(u, ["op", "swBootId"])) return null;
  return isId(u.swBootId) ? { op: "ATTACHED", swBootId: u.swBootId } : null;
}

function parseDocumentAddress(u: unknown): DocumentAddress | null {
  if (!isRecord(u) || !keysExactly(u, ["tabId", "frameId", "documentId"])) return null;
  if (!isFinite_(u.tabId) || !Number.isInteger(u.tabId)) return null;
  if (!isFinite_(u.frameId) || !Number.isInteger(u.frameId) || u.frameId < 0) return null;
  if (u.documentId !== null && !isId(u.documentId)) return null;
  return { tabId: u.tabId, frameId: u.frameId, documentId: u.documentId as string | null };
}

export function parseAttestedDocument(u: unknown): AttestedDocument | null {
  if (!isRecord(u) || !keysExactly(u, ["tabId", "frameId", "documentId", "origin"])) return null;
  if (!isFinite_(u.tabId) || !Number.isInteger(u.tabId)) return null;
  if (!isFinite_(u.frameId) || !Number.isInteger(u.frameId) || u.frameId < 0) return null;
  if (!isId(u.documentId) || typeof u.origin !== "string" || u.origin.length === 0) return null;
  return { tabId: u.tabId, frameId: u.frameId, documentId: u.documentId, origin: u.origin };
}

export function parseRelayRequest(u: unknown): RelayRequest | null {
  if (!isRecord(u) || u.channel !== TRANSPORT_CHANNEL || u.kind !== "RELAY") return null;
  if (!keysExactly(u, ["channel", "kind", "target", "expectSwBootId", "body"])) return null;
  if (u.expectSwBootId !== null && !isId(u.expectSwBootId)) return null;
  const target = parseDocumentAddress(u.target);
  const body = parsePageRequest(u.body);
  return target && body
    ? { channel: TRANSPORT_CHANNEL, kind: "RELAY", target, expectSwBootId: u.expectSwBootId as string | null, body }
    : null;
}

export function parseRelayEnvelope(u: unknown): RelayEnvelope | null {
  if (!isRecord(u) || u.channel !== TRANSPORT_CHANNEL) return null;
  if (u.kind === "RELAYED") {
    if (!keysExactly(u, ["channel", "kind", "swBootId", "attested", "reply"]) || !isId(u.swBootId)) return null;
    const attested = parseAttestedDocument(u.attested);
    const reply = parsePageReply(u.reply);
    return attested && reply ? { channel: TRANSPORT_CHANNEL, kind: "RELAYED", swBootId: u.swBootId, attested, reply } : null;
  }
  if (u.kind === "RELAY_REFUSED") {
    if (!keysExactly(u, ["channel", "kind", "swBootId", "refused"])) return null;
    if (u.swBootId !== null && !isId(u.swBootId)) return null;
    return (RELAY_REFUSAL_CODES as readonly unknown[]).includes(u.refused)
      ? { channel: TRANSPORT_CHANNEL, kind: "RELAY_REFUSED", swBootId: u.swBootId as string | null, refused: u.refused as RelayRefusalCode }
      : null;
  }
  return null;
}

/** Build a refusal envelope. The only envelope a router produces without asking a page. */
export const relayRefused = (refused: RelayRefusalCode, swBootId: string | null): RelayEnvelope => ({
  channel: TRANSPORT_CHANNEL,
  kind: "RELAY_REFUSED",
  swBootId,
  refused,
});

/** Build a page refusal. Carries a code and the request it answers — never a reason in prose. */
export const pageRefused = (requestId: string, refused: PageRefusalCode): PageReply => ({
  op: "REFUSED",
  requestId,
  refused,
});
