/**
 * The core realm's half of the transport: the two bridges `guardedAct` drives. D-E6-4 TR-1, TR-2.
 *
 * WHAT A BINDING IS, AND WHY EVERYTHING HANGS OFF IT.
 *
 * A `TransportBinding` is the answer to "which page is this plan about?", fixed once, from the
 * **browser-attested** identity of the document that produced the observation: tab, frame, document
 * and origin, plus the service-worker boot that relayed it and the observation `FrameId` the graph
 * was built with. Every later message names that binding, and every reply is compared against it. A
 * reply from another document, another tab, another origin or another boot is a refusal — not a
 * re-bind, not a retarget, not a warning.
 *
 * That is the whole mechanism behind "a stale document must refuse". The page cannot be trusted to
 * say which document it is, so nothing here asks it: the browser says so, through `port.sender`, and
 * the service worker copies that word into the envelope.
 *
 * TWO BRIDGES, ONE CYCLE.
 *
 * `HitTestBridge` looks and `PageActionBridge` acts, and they are separate interfaces in the core for
 * a reason (ADR-0007). They share a **cycle** here because the page must be able to refuse a dispatch
 * whose point nobody hit tested (TR-5): the permit never crosses the message boundary — it is a
 * same-realm object — so the cycle id is what ties "the point that was agreed" to "the point that is
 * being dispatched".
 *
 * NOT AUTHORITY. Nothing in this file mints, widens, renews or re-issues anything. The single-use,
 * expiring permit that authorised the click was minted by the execution gate from an attested ALLOW
 * and an attested MATCH; these bridges are handed a point and either carry it exactly or refuse. The
 * refusals here are **additional**, and they can only subtract from what the permit already allows.
 *
 * WHAT A REFUSAL BECOMES UPSTREAM. A throw from the hit-test bridge is `UNKNOWN` (never MISMATCH,
 * never MATCH); a throw from the action bridge is `EXECUTION_ERROR` and then `UNKNOWN`. Both are
 * conservative in the right direction: a bridge cannot prove a dispatch did not happen, so the core
 * is never told that it did not.
 */
import {
  type CssPoint,
  type HitTestBridge,
  type PageActionBridge,
  type TopmostElement,
} from "@pratibimb/agent";
import { cssBox, type FrameId } from "@pratibimb/perception";

import {
  TRANSPORT_CHANNEL,
  parseRelayEnvelope,
  sameAttestedDocument,
  type AttestedDocument,
  type ElementDescription,
  type PageOp,
  type PageReply,
  type PageRequest,
  type RelayEnvelope,
  type TransportRefusalCode,
} from "./contracts.js";
import { TransportRefusal } from "./errors.js";

/** The one channel out of the core realm. An implementation may only carry bytes and answer. */
export interface TransportRelay {
  request(request: {
    readonly channel: typeof TRANSPORT_CHANNEL;
    readonly kind: "RELAY";
    readonly target: { readonly tabId: number; readonly frameId: number; readonly documentId: string | null };
    readonly expectSwBootId: string | null;
    readonly body: PageRequest;
  }): Promise<RelayEnvelope | unknown>;
}

/** Which document a plan is about, as the browser attested it. Fixed at observation, never widened. */
export interface TransportBinding {
  /** The perception frame the graph was built with. Also what the bridges report as their frame. */
  readonly observationFrameId: FrameId;
  readonly document: AttestedDocument;
  readonly swBootId: string;
}

export interface TransportDeps {
  /** Cycle and delivery ids. Injected so tests are deterministic. */
  readonly newId: () => string;
}

const defaultNewId = (): string => globalThis.crypto.randomUUID();

export const transportDeps = (deps?: Partial<TransportDeps>): TransportDeps => ({ newId: deps?.newId ?? defaultNewId });

const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => a.x === b.x && a.y === b.y;

/**
 * Send one request and read the answer, or refuse.
 *
 * Order matters: a channel failure, a router refusal, the wrong document, the wrong boot, an answer
 * to another request, the page's own refusal, then the wrong kind of answer. Each is a distinct code
 * and none of them is recoverable here.
 */
export interface PageAsk {
  readonly target: { readonly tabId: number; readonly frameId: number; readonly documentId: string | null };
  /** The document the answer must come from, or `null` for the observation that establishes one. */
  readonly expectDocument: AttestedDocument | null;
  readonly expectSwBootId: string | null;
  readonly body: PageRequest;
  readonly expectedOp: PageOp;
}

export interface PageAnswer {
  readonly reply: PageReply;
  readonly attested: AttestedDocument;
  readonly swBootId: string;
}

export async function askPage(relay: TransportRelay, ask: PageAsk): Promise<PageAnswer> {
  let raw: unknown;
  try {
    raw = await relay.request({
      channel: TRANSPORT_CHANNEL,
      kind: "RELAY",
      target: ask.target,
      expectSwBootId: ask.expectSwBootId,
      body: ask.body,
    });
  } catch {
    // The message never left, or the answer never came back. Whether the page acted is unknown.
    throw new TransportRefusal("RELAY_UNAVAILABLE");
  }

  const envelope = parseRelayEnvelope(raw);
  if (!envelope) throw new TransportRefusal("MALFORMED_ENVELOPE");
  if (envelope.kind === "RELAY_REFUSED") throw new TransportRefusal(envelope.refused);
  if (ask.expectDocument !== null && !sameAttestedDocument(envelope.attested, ask.expectDocument)) {
    throw new TransportRefusal("ATTESTATION_MISMATCH");
  }
  if (ask.expectSwBootId !== null && envelope.swBootId !== ask.expectSwBootId) {
    throw new TransportRefusal("SW_BOOT_MISMATCH");
  }

  const reply = envelope.reply;
  if (reply.requestId !== ask.body.requestId) throw new TransportRefusal("REPLY_MISMATCH");
  if (reply.op === "REFUSED") throw new TransportRefusal(reply.refused);
  if (reply.op !== ask.expectedOp) throw new TransportRefusal("REPLY_MISMATCH");
  return { reply, attested: envelope.attested, swBootId: envelope.swBootId };
}

const toTopmost = (description: ElementDescription, frame: FrameId): TopmostElement => {
  const box = cssBox(description.box.x, description.box.y, description.box.w, description.box.h);
  const base = { frameId: frame, selector: description.selector, role: description.role, name: description.name, box };
  return description.nth === undefined ? base : { ...base, nth: description.nth };
};

/** What one VALIDATE → HIT-TEST → dispatch cycle did. Codes, points and page timestamps only. */
export interface CycleReport {
  readonly cycleId: string;
  hitTest: {
    readonly point: { x: number; y: number };
    readonly topmost: string | null;
    readonly receivedAt: number;
    readonly sampledAt: number;
  } | null;
  dispatch: {
    readonly deliveryId: string;
    readonly point: { x: number; y: number };
    readonly dispatchedTo: string;
    readonly receivedAt: number;
    readonly dispatchedAt: number;
  } | null;
  readonly refusals: TransportRefusalCode[];
}

export interface TransportCycle {
  readonly cycleId: string;
  readonly hitTest: HitTestBridge;
  readonly action: PageActionBridge;
  readonly report: CycleReport;
}

/**
 * Build the pair of bridges for one action, bound to one document.
 *
 * A cycle looks once and acts once. Both bridges refuse a second call: a second look would let a
 * caller choose between answers, and a second act is what a replay is.
 */
export function createTransportCycle(
  relay: TransportRelay,
  binding: TransportBinding,
  deps?: Partial<TransportDeps>
): TransportCycle {
  const { newId } = transportDeps(deps);
  const cycleId = newId();
  const report: CycleReport = { cycleId, hitTest: null, dispatch: null, refusals: [] };

  let looked = false;
  let acted = false;
  let answeredPoint: { x: number; y: number } | null = null;

  // Explicitly typed so the compiler treats a call as never-returning and narrows after it.
  const refuse: (code: TransportRefusalCode) => never = (code) => {
    report.refusals.push(code);
    throw new TransportRefusal(code);
  };

  const askBound = async (body: PageRequest, expectedOp: PageOp): Promise<PageReply> => {
    try {
      const answer = await askPage(relay, {
        target: {
          tabId: binding.document.tabId,
          frameId: binding.document.frameId,
          documentId: binding.document.documentId,
        },
        expectDocument: binding.document,
        expectSwBootId: binding.swBootId,
        body,
        expectedOp,
      });
      return answer.reply;
    } catch (error) {
      if (error instanceof TransportRefusal) report.refusals.push(error.code);
      throw error;
    }
  };

  const hitTest: HitTestBridge = {
    frameId: binding.observationFrameId,
    async topmostAtCssPoint(point: CssPoint): Promise<TopmostElement | null> {
      if (looked) refuse("CYCLE_ALREADY_HIT_TESTED");
      looked = true;
      const reply = await askBound({ op: "HIT_TEST", requestId: newId(), cycleId, point: { x: point.x, y: point.y } }, "HIT_TEST");
      if (reply.op !== "HIT_TEST") refuse("REPLY_MISMATCH");
      if (reply.cycleId !== cycleId || !samePoint(reply.point, point)) refuse("REPLY_MISMATCH");
      answeredPoint = { x: reply.point.x, y: reply.point.y };
      report.hitTest = {
        point: answeredPoint,
        topmost: reply.topmost === null ? null : reply.topmost.selector,
        receivedAt: reply.receivedAt,
        sampledAt: reply.sampledAt,
      };
      // `null` is the page's reliable "nothing is there", which the core reads as MISMATCH. Any
      // inability to answer arrived as a throw above, and becomes UNKNOWN.
      return reply.topmost === null ? null : toTopmost(reply.topmost, binding.observationFrameId);
    },
  };

  const action: PageActionBridge = {
    frameId: binding.observationFrameId,
    async clickAtCssPoint(point: CssPoint): Promise<void> {
      if (answeredPoint === null) refuse("NO_HIT_TEST_FOR_CYCLE");
      if (acted) refuse("CYCLE_ALREADY_DISPATCHED");
      acted = true; // spent on the attempt, exactly as a permit is spent on redemption
      if (!samePoint(point, answeredPoint)) refuse("POINT_NOT_HIT_TESTED");

      const deliveryId = newId();
      const reply = await askBound(
        { op: "DISPATCH", requestId: newId(), cycleId, deliveryId, point: { x: point.x, y: point.y } },
        "DISPATCH"
      );
      if (reply.op !== "DISPATCH") refuse("REPLY_MISMATCH");
      if (reply.cycleId !== cycleId || reply.deliveryId !== deliveryId || !samePoint(reply.point, point)) {
        refuse("REPLY_MISMATCH");
      }
      report.dispatch = {
        deliveryId: reply.deliveryId,
        point: { x: reply.point.x, y: reply.point.y },
        dispatchedTo: reply.dispatchedTo.selector,
        receivedAt: reply.receivedAt,
        dispatchedAt: reply.dispatchedAt,
      };
    },
  };

  return { cycleId, hitTest, action, report };
}
