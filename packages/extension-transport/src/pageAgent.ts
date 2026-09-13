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

export interface PageAgent {
  /** `null` only when the message is so malformed that no reply could be correlated to it. */
  handle(raw: unknown): PageReply | null;
  readonly cycleCount: () => number;
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

  return {
    cycleCount: () => cycles.size,

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
          // A cycle is hit tested once. A second answer for the same cycle would let a caller pick
          // whichever answer suited it, which is the re-aiming this architecture forbids.
          if (cycles.has(request.cycleId)) return pageRefused(request.requestId, "CYCLE_ALREADY_HIT_TESTED");
          if (cycles.size >= capacity) return pageRefused(request.requestId, "STATE_CAPACITY_EXHAUSTED");
          if (!insideViewport(request.point, surface.viewport())) {
            // Outside the viewport `elementFromPoint` answers `null`, and `null` means "reliably
            // nothing here" — a MISMATCH. It is not: it is a question this document cannot answer.
            return pageRefused(request.requestId, "POINT_OUTSIDE_VIEWPORT");
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
          // Consumed by any attempt that names it, before any other check — a redelivery must not
          // become dispatchable by fixing whatever else was wrong with it.
          if (deliveries.has(request.deliveryId)) return pageRefused(request.requestId, "DUPLICATE_DELIVERY");
          if (deliveries.size >= capacity) return pageRefused(request.requestId, "STATE_CAPACITY_EXHAUSTED");
          deliveries.add(request.deliveryId);

          const cycle = cycles.get(request.cycleId);
          if (!cycle) return pageRefused(request.requestId, "NO_HIT_TEST_FOR_CYCLE");
          if (cycle.dispatched) return pageRefused(request.requestId, "CYCLE_ALREADY_DISPATCHED");
          cycle.dispatched = true; // spent on the attempt, not on its success

          if (!samePoint(request.point, cycle.point)) return pageRefused(request.requestId, "POINT_NOT_HIT_TESTED");
          if (!insideViewport(request.point, surface.viewport())) {
            return pageRefused(request.requestId, "POINT_OUTSIDE_VIEWPORT");
          }

          const element = surface.elementAt(request.point);
          if (element === null) return pageRefused(request.requestId, "NOTHING_AT_POINT");

          const prepared = surface.prepareClick(element, request.point);
          if (!prepared.coordinatesExact) return pageRefused(request.requestId, "POINT_NOT_REPRESENTABLE");

          const dispatchedTo = surface.describe(element);
          const dispatchedAt = surface.now();
          prepared.fire();
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
