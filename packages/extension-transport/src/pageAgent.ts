/**
 * The content-script half of the transport: the only code in this repository that dispatches a
 * click at a page. D-E6-4 properties TR-3, TR-4, TR-5, TR-6.
 *
 * WHAT IT WILL NOT DO, and why each one matters:
 *
 * - **It has no selector to click.** `DISPATCH` carries a point, and the element that receives the
 *   events is whatever `elementFromPoint` reports **at dispatch time**. E6 measured why: `el.click()`
 *   went straight through a transparent overlay while a point dispatch landed on the overlay, so an
 *   element-bound dispatch would make HIT-TEST agreement meaningless — the check would be about the
 *   point and the click would not be. There is no nearest-element search and no `querySelector` on
 *   this path.
 * - **It will not move the point.** Not rounded, not clamped to the viewport, not nudged onto the
 *   target. If the exact authorised point cannot be honoured — outside the viewport, or the browser
 *   will not carry those coordinates on an event — it refuses and dispatches nothing.
 * - **It will not dispatch a point nobody hit tested.** Each cycle records the point the hit test was
 *   answered for; a `DISPATCH` naming that cycle with a different point is refused (TR-5). This is
 *   what makes a point altered in transit a refusal rather than a click somewhere else.
 * - **It will not deliver anything twice.** A delivery id is single-use and a cycle dispatches once,
 *   and both are consumed by any attempt that names them — successful or not (TR-6), the same rule
 *   the permit itself uses for redemption.
 * - **It does not focus, scroll, retry or wait.**
 *
 * IT IS NOT AN AUTHORITY. Every branch here can only refuse. The permit that authorised this click
 * was minted in the core realm and never crosses the message boundary — which is exactly why the
 * cycle and delivery ids exist: the page cannot check a permit, so it checks that the delivery in
 * front of it is the one and only delivery of the cycle it hit tested.
 *
 * The DOM lives behind `PageSurface`, so this file is testable in plain Node and the browser glue
 * (`apps/extension/host-lib/page-surface-dom.ts`) stays a thin adapter with no decisions in it.
 */
import { type DomMeasurement } from "@pratibimb/perception";

import {
  pageRefused,
  parsePageRequest,
  requestIdOf,
  type ElementDescription,
  type FocusReading,
  type PagePoint,
  type PageReply,
  type ViewportReading,
} from "./contracts.js";

/**
 * A click the surface has built but not yet fired.
 *
 * Split in two so exactness is checked **before** anything is dispatched: the adapter constructs the
 * real events, and `coordinatesExact` says whether the browser kept the coordinates it was given.
 * A half-dispatched sequence cannot be undone, so the question is asked first.
 */
export interface PreparedClick {
  readonly coordinatesExact: boolean;
  fire(): void;
}

/** Everything the page agent may do to a document. Six methods, one of which acts. */
export interface PageSurface<E> {
  /** `performance.timeOrigin + performance.now()` in the page's own realm. */
  now(): number;
  viewport(): ViewportReading;
  /** `document.elementFromPoint`. */
  elementAt(point: PagePoint): E | null;
  /** The SAME description function the observation uses, or MATCH would compare two vocabularies. */
  describe(element: E): ElementDescription;
  measure(): { readonly measurements: readonly DomMeasurement[]; readonly focus: FocusReading };
  prepareClick(element: E, point: PagePoint): PreparedClick;
}

/**
 * How many cycles and deliveries one document remembers.
 *
 * Bounded because unbounded state in a page that an experiment drives thousands of times is a leak,
 * and **exhaustion refuses** rather than evicting: evicting the oldest delivery id would make a
 * replay of it succeed, which is the one thing this state exists to prevent.
 */
export const DEFAULT_CYCLE_CAPACITY = 4_096;

/**
 * ONE FIRE, AS THE WORLD THAT FIRED IT SAW IT.
 *
 * A DISPATCH reply says a dispatch was answered. It cannot say how many times this agent actually
 * put events into the document, because a reply is one message and a second fire would be a second
 * message — or none at all. So the agent counts its own `fire()` calls, on both sides of the call,
 * and an evidence run reads the count from the world where the events were constructed.
 *
 * Why this is not redundant with the DISPATCH reply: a DOM event observed in the page's main world
 * has no field saying which extension dispatched it, or whether an extension dispatched it at all.
 * `at` is `performance.timeOrigin + performance.now()` in this document, and a main-world listener's
 * `timeOrigin + event.timeStamp` is the same clock — so a page-side observation can be attributed to
 * a fire here, or shown to belong to nothing here.
 *
 * NO PAGE VALUES. Ids minted by the core realm, a structural selector, and two numbers.
 */
export interface FireNote {
  readonly cycleId: string;
  readonly deliveryId: string;
  readonly requestId: string;
  /** The selector `describe` gave the element the events were dispatched to. */
  readonly to: string;
  /**
   * When the events were CONSTRUCTED, which is earlier than when they were dispatched.
   *
   * A `MouseEvent`'s `timeStamp` is fixed at construction, not at `dispatchEvent`, so a main-world
   * listener sees a time that precedes `at`. Attributing an observed event to this fire needs the
   * window to open here; a window that opened at `at` reports the extension's own click as an event
   * it did not cause, which is a false alarm that looks exactly like the thing it is watching for.
   */
  readonly preparedAt: number;
  /** Immediately before the first event is dispatched, on the page's own clock. */
  readonly at: number;
  /** Immediately after the last event returned, or `null` if the sequence threw part-way. */
  readonly doneAt: number | null;
}

/** What this agent did, for an evidence run to check a page-side observation against. */
export interface PageAgentAudit {
  readonly hitTests: number;
  /** Every DISPATCH this agent was handed, including the ones it refused. */
  readonly dispatchRequests: number;
  /** `fire()` calls started. **This is the number of browser actions this agent performed.** */
  readonly firesStarted: number;
  readonly firesCompleted: number;
  readonly refusals: readonly string[];
  readonly fires: readonly FireNote[];
}

export interface PageAgent {
  /** `null` only when the message is so malformed that no reply could be correlated to it. */
  handle(raw: unknown): PageReply | null;
  readonly cycleCount: () => number;
  /** TEST AND EVIDENCE ONLY. Counts and ids; never a page value. */
  readonly audit: () => PageAgentAudit;
}

interface CycleState {
  readonly point: PagePoint;
  dispatched: boolean;
}

const samePoint = (a: PagePoint, b: PagePoint): boolean => a.x === b.x && a.y === b.y;

const insideViewport = (p: PagePoint, v: ViewportReading): boolean =>
  p.x >= 0 && p.y >= 0 && p.x < v.w && p.y < v.h;

export function createPageAgent<E>(surface: PageSurface<E>, capacity: number = DEFAULT_CYCLE_CAPACITY): PageAgent {
  const cycles = new Map<string, CycleState>();
  const deliveries = new Set<string>();

  // The agent's own account of what it did. Bounded by the same capacity as everything else here.
  let hitTests = 0;
  let dispatchRequests = 0;
  let firesStarted = 0;
  let firesCompleted = 0;
  const refusals: string[] = [];
  const fires: FireNote[] = [];
  const noteRefusal = (code: string): void => {
    if (refusals.length < capacity) refusals.push(code);
  };
  /** Refuse, and record the code. Every `pageRefused` on the acting paths goes through this. */
  const refused = (requestId: string, code: string): PageReply => {
    noteRefusal(code);
    return pageRefused(requestId, code as Parameters<typeof pageRefused>[1]);
  };

  return {
    cycleCount: () => cycles.size,
    audit: () => ({ hitTests, dispatchRequests, firesStarted, firesCompleted, refusals: [...refusals], fires: [...fires] }),

    handle(raw: unknown): PageReply | null {
      const request = parsePageRequest(raw);
      if (!request) {
        const requestId = requestIdOf(raw);
        return requestId === null ? null : pageRefused(requestId, "MALFORMED_REQUEST");
      }

      switch (request.op) {
        case "CLOCK":
          return { op: "CLOCK", requestId: request.requestId, now: surface.now() };

        case "OBSERVE": {
          const { measurements, focus } = surface.measure();
          return {
            op: "OBSERVE",
            requestId: request.requestId,
            measurements,
            focus,
            viewport: surface.viewport(),
          };
        }

        case "HIT_TEST": {
          const receivedAt = surface.now();
          hitTests += 1;
          // A cycle is hit tested once. A second answer for the same cycle would let a caller pick
          // whichever answer suited it, which is the re-aiming this architecture forbids.
          if (cycles.has(request.cycleId)) return refused(request.requestId, "CYCLE_ALREADY_HIT_TESTED");
          if (cycles.size >= capacity) return refused(request.requestId, "STATE_CAPACITY_EXHAUSTED");
          if (!insideViewport(request.point, surface.viewport())) {
            // Outside the viewport `elementFromPoint` answers `null`, and `null` means "reliably
            // nothing here" — a MISMATCH. It is not: it is a question this document cannot answer.
            return refused(request.requestId, "POINT_OUTSIDE_VIEWPORT");
          }
          const sampledAt = surface.now();
          const element = surface.elementAt(request.point);
          const topmost = element === null ? null : surface.describe(element);
          cycles.set(request.cycleId, { point: request.point, dispatched: false });
          return {
            op: "HIT_TEST",
            requestId: request.requestId,
            cycleId: request.cycleId,
            point: request.point,
            topmost,
            receivedAt,
            sampledAt,
          };
        }

        case "DISPATCH": {
          const receivedAt = surface.now();
          dispatchRequests += 1;
          // Consumed by any attempt that names it, before any other check — a redelivery must not
          // become dispatchable by fixing whatever else was wrong with it.
          if (deliveries.has(request.deliveryId)) return refused(request.requestId, "DUPLICATE_DELIVERY");
          if (deliveries.size >= capacity) return refused(request.requestId, "STATE_CAPACITY_EXHAUSTED");
          deliveries.add(request.deliveryId);

          const cycle = cycles.get(request.cycleId);
          if (!cycle) return refused(request.requestId, "NO_HIT_TEST_FOR_CYCLE");
          if (cycle.dispatched) return refused(request.requestId, "CYCLE_ALREADY_DISPATCHED");
          cycle.dispatched = true; // spent on the attempt, not on its success

          if (!samePoint(request.point, cycle.point)) return refused(request.requestId, "POINT_NOT_HIT_TESTED");
          if (!insideViewport(request.point, surface.viewport())) {
            return refused(request.requestId, "POINT_OUTSIDE_VIEWPORT");
          }

          const element = surface.elementAt(request.point);
          if (element === null) return refused(request.requestId, "NOTHING_AT_POINT");

          const preparedAt = surface.now();
          const prepared = surface.prepareClick(element, request.point);
          if (!prepared.coordinatesExact) return refused(request.requestId, "POINT_NOT_REPRESENTABLE");

          const dispatchedTo = surface.describe(element);
          const dispatchedAt = surface.now();
          // Counted on BOTH sides of the call. A sequence that threw half-way through leaves
          // `firesStarted` ahead of `firesCompleted`, which is a different fact from never firing.
          firesStarted += 1;
          const note: { -readonly [K in keyof FireNote]: FireNote[K] } = {
            cycleId: request.cycleId,
            deliveryId: request.deliveryId,
            requestId: request.requestId,
            to: dispatchedTo.selector,
            preparedAt,
            at: dispatchedAt,
            doneAt: null,
          };
          if (fires.length < capacity) fires.push(note as FireNote);
          prepared.fire();
          firesCompleted += 1;
          note.doneAt = surface.now();
          return {
            op: "DISPATCH",
            requestId: request.requestId,
            cycleId: request.cycleId,
            deliveryId: request.deliveryId,
            point: request.point,
            dispatchedTo,
            receivedAt,
            dispatchedAt,
          };
        }
      }
    },
  };
}
