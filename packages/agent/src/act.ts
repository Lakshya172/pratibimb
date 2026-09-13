/**
 * ACT — the browser-action executor. ADR-0006, as amended by ADR-0008 (PROPOSED).
 *
 * The deliberately boring stage, now more boring than before: ACT accepts a `DispatchPermit` and
 * nothing else. It does not validate, does not hit test, does not screen the confirmation tier and
 * does not compute a point. All of that is authority, and authority is minted by the execution gate
 * (`permit.ts`). ACT redeems a permit — which consumes it — and then performs exactly the dispatch
 * the permit fixes, or reports that it could not.
 *
 * Three properties are worth reading the file for:
 *
 * 1. **No permit, no call.** `act` has one authority-bearing parameter and its type is
 *    `DispatchPermit`. A freshness decision, a hit-test result, a target or a point does not
 *    type-check, and a permit-shaped object the gate did not issue is refused at runtime.
 * 2. **ACT chooses nothing.** It has no parameter for a target, a point, a selector or a value.
 * 3. **Spent before it is used.** The permit is consumed before the bridge is called, so a bridge
 *    that throws or never answers has used the authority up. There is no retry of an old permit.
 *
 * The whole of ACT's browser authority is still one interface method, `clickAtCssPoint`.
 *
 * Absent on purpose: VERIFY RESULT (`EXECUTED` means dispatched, never "the page changed"), and the
 * final browser dispatch mechanism, which experiment E6 decides.
 */
import { type CssBox, type FrameId, type NodeId } from "@pratibimb/perception";

import { type CssPoint } from "./actionFreshness.js";
import {
  monotonicNow,
  redeemPermit,
  type DispatchPermit,
  type ExecutableAction,
  type GateRefusal,
  type MonotonicClock,
} from "./permit.js";

/**
 * The executor's entire authority over a browser. One method.
 *
 * An implementation is an adapter over whatever can actually drive a page. Which one the product
 * uses — and therefore whether a dispatch lands at a point or on an element — is experiment E6's
 * question, not this interface's.
 */
export interface PageActionBridge {
  /** The frame this bridge drives. A permit for another frame is refused and spent. */
  readonly frameId: FrameId;
  /**
   * Dispatch a user-style click at a CSS-viewport point, through the browser's ordinary
   * actionability path. Must NOT force past it.
   */
  clickAtCssPoint(point: CssPoint): Promise<void>;
}

export type ExecutionStatus = "EXECUTED" | "REJECTED" | "UNSUPPORTED_ACTION" | "EXECUTION_ERROR";

/**
 * How a dispatch failed. `BRIDGE_TIMEOUT` means the outcome is **unknown** — treat the action as
 * possibly performed, never as not performed.
 */
export type ErrorCategory = "BRIDGE_THREW" | "BRIDGE_TIMEOUT";

/** The safe identity of what was acted on. Role and accessible name only — never a value. */
export interface ActedTarget {
  readonly nodeId: NodeId;
  readonly role: string;
  readonly name: string;
  readonly point: CssPoint;
  readonly box: CssBox;
}

export type ActResult =
  | {
      readonly status: "EXECUTED";
      readonly kind: ExecutableAction;
      readonly target: ActedTarget;
      /** Wall-clock milliseconds spent inside the bridge call. */
      readonly dispatchMs: number;
    }
  | GateRefusal
  | {
      readonly status: "EXECUTION_ERROR";
      readonly kind: ExecutableAction;
      readonly category: ErrorCategory;
      /** The error's class name only. The message is dropped: it can quote page markup (INV-21). */
      readonly errorName: string;
      readonly dispatchMs: number;
    };

/** `true` only for a dispatch this executor actually performed. */
export const wasDispatched = (r: ActResult): boolean => r.status === "EXECUTED";

/** Default dispatch deadline. A bridge that never returns must not hang the loop. */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 5_000;

export interface ActOptions {
  /** Milliseconds to wait for the bridge before reporting `BRIDGE_TIMEOUT` (outcome unknown). */
  readonly timeoutMs?: number;
  /** The clock expiry is judged against. Must be the clock the permit was minted with. */
  readonly now?: MonotonicClock;
}

/**
 * ACT. Redeem a permit and perform the one dispatch it fixes.
 */
export async function act(permit: DispatchPermit, bridge: PageActionBridge, options: ActOptions = {}): Promise<ActResult> {
  // Redemption consumes the permit — on success and on every refusal that identifies it.
  const redemption = redeemPermit(permit, bridge.frameId, options.now ?? monotonicNow);
  if (!redemption.redeemed) return redemption.refusal;
  const p = redemption.permit;

  const timeoutMs = options.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<"TIMEOUT">((resolve) => {
      timer = setTimeout(() => resolve("TIMEOUT"), timeoutMs);
    });
    const outcome = await Promise.race([bridge.clickAtCssPoint(p.point).then(() => "OK" as const), timeout]);
    if (outcome === "TIMEOUT") {
      return { status: "EXECUTION_ERROR", kind: p.kind, category: "BRIDGE_TIMEOUT", errorName: "DispatchTimeout", dispatchMs: Date.now() - started };
    }
    return {
      status: "EXECUTED",
      kind: p.kind,
      target: { nodeId: p.target.nodeId, role: p.target.role, name: p.target.name, point: p.point, box: p.target.box },
      dispatchMs: Date.now() - started,
    };
  } catch (e) {
    // Not swallowed, not converted into success — and the permit is already spent.
    return {
      status: "EXECUTION_ERROR",
      kind: p.kind,
      category: "BRIDGE_THREW",
      errorName: e instanceof Error ? e.name : typeof e,
      dispatchMs: Date.now() - started,
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
