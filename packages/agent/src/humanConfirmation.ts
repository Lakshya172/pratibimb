/**
 * The confirmation channel the gate has been refusing for want of one.
 *
 * `authorisationPreflight` puts any control in the action schema's confirmation tier — anything named
 * "Submit", "Pay", "Delete" — beyond the gate's reach, with a refusal that states the reason exactly:
 * *"No confirmation channel exists, so no permit can be issued on a human's behalf."* That was the
 * correct answer while nothing could represent a human's consent. This module is that representation,
 * and nothing here weakens the tier: a confirmation-tier control is still refused unless a human has
 * confirmed **this** control, in **this** frame, on **this** page, and the confirmation has not
 * already been spent.
 *
 * WHY A FLAG WOULD NOT DO, for the third time in this repository and for the same reason. A boolean
 * `confirmed: true`, or a plain object shaped like a confirmation, is one literal away from any
 * caller that wants to get past the tier — and a gate that can be talked past by its own callers is
 * not a gate. So a confirmation is recognised by **membership in a module-private `WeakSet`**, exactly
 * as `DispatchPermit` is (ADR-0008 §3) and as `VerifiedHandoff` is in `@pratibimb/privacy`. A forged
 * object with every field right is not a confirmation, because this module never saw it.
 *
 * ONE CONFIRMATION, ONE PERMIT. Spending is what makes a human's "yes" mean one action rather than a
 * standing permission. `mintDispatchPermit` spends the confirmation as it issues the permit, so the
 * same "yes" cannot mint a second permit — not for the same target, and not for another.
 *
 * WHAT A CONFIRMATION IS NOT. It is not authorisation to do anything else: it names one node, one
 * frame and one origin, and every other gate still runs. Freshness, hit-test agreement, the point
 * check, the TTL and the postcondition requirement are all unchanged and all still refuse. A
 * confirmation only answers the one question the tier asks, which is whether a human agreed.
 *
 * WHAT IT CANNOT ESTABLISH. That the human understood, or that the words they were shown described
 * the action honestly. `purpose` is carried so a ledger can record what was on screen, and this
 * module cannot check it against reality. The UI that collects the consent is trusted to be truthful
 * about what it asked; that trust is the product's, not the gate's.
 */
import { type FrameId, type NodeId } from "@pratibimb/perception";

import { monotonicNow, type MonotonicClock } from "./permit.js";

/**
 * The one control a confirmation covers.
 *
 * The same structural identity the rest of the gate compares — role, accessible name, stable
 * selector, frame — plus the page origin, which nothing else in the decision carries. No value, no
 * content, no text the page supplied beyond the accessible name the graph already holds.
 */
export interface ConfirmationSubject {
  readonly nodeId: NodeId;
  readonly selector: string;
  readonly role: string;
  readonly name: string;
  readonly frameId: FrameId;
  /** The page the human was looking at. A confirmation does not travel between origins. */
  readonly origin: string;
}

export interface HumanConfirmation {
  readonly subject: ConfirmationSubject;
  /** The words the human was actually shown. Recorded for the ledger; unverifiable here. */
  readonly purpose: string;
  readonly confirmedAt: number;
  readonly expiresAt: number;
}

/** Every confirmation this module recorded. A structurally perfect object not in here is not one. */
const recorded = new WeakSet<object>();
/** Every confirmation already spent on a permit. */
const spent = new WeakSet<object>();

export interface ConfirmationOptions {
  /** What the human was told they were approving. */
  readonly purpose: string;
  /**
   * How long the consent stays spendable. **REQUIRED, no default** — for the same reason the permit
   * has none (ADR-0008 §5): no measurement in this repository supports a value, so the caller states
   * one and owns it.
   */
  readonly ttlMs: number;
  readonly now?: MonotonicClock;
}

export type ConfirmationRefusalCause = "INVALID_SUBJECT" | "INVALID_TTL" | "EMPTY_PURPOSE";

export type ConfirmationResult =
  | { readonly recorded: true; readonly confirmation: HumanConfirmation }
  | { readonly recorded: false; readonly cause: ConfirmationRefusalCause };

const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim() !== "";

/**
 * Record that a human confirmed this exact control.
 *
 * The **only** way a `HumanConfirmation` comes into existence, and it must be called from the code
 * that actually collected the consent. Nothing here asks a human anything — it cannot — so a caller
 * that invents a call to this function is fabricating consent, which is a product-integrity failure
 * this module can neither detect nor prevent. It is the same trust boundary `act` has with its
 * bridge, named rather than hidden.
 */
export function recordHumanConfirmation(
  subject: ConfirmationSubject,
  options: ConfirmationOptions
): ConfirmationResult {
  if (
    typeof subject !== "object" ||
    subject === null ||
    !nonEmpty(subject.selector) ||
    !nonEmpty(subject.role) ||
    typeof subject.name !== "string" ||
    !nonEmpty(subject.origin) ||
    subject.frameId === undefined ||
    subject.nodeId === undefined
  ) {
    return { recorded: false, cause: "INVALID_SUBJECT" };
  }
  if (!nonEmpty(options?.purpose)) return { recorded: false, cause: "EMPTY_PURPOSE" };
  const ttl = options?.ttlMs;
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) return { recorded: false, cause: "INVALID_TTL" };

  const clock = options.now ?? monotonicNow;
  const confirmedAt = clock();
  if (!Number.isFinite(confirmedAt)) return { recorded: false, cause: "INVALID_TTL" };

  const confirmation: HumanConfirmation = Object.freeze({
    subject: Object.freeze({ ...subject }),
    purpose: options.purpose,
    confirmedAt,
    expiresAt: confirmedAt + ttl,
  });
  recorded.add(confirmation);
  return { recorded: true, confirmation };
}

/** Whether an object is a confirmation this module recorded — spent or not. */
export const isHumanConfirmation = (c: unknown): c is HumanConfirmation =>
  typeof c === "object" && c !== null && recorded.has(c);

export type ConfirmationState = "NOT_RECORDED" | "LIVE" | "SPENT" | "EXPIRED";

/** Read-only state, for a ledger and for tests. Never changes a confirmation. */
export function confirmationState(c: unknown, now: MonotonicClock = monotonicNow): ConfirmationState {
  if (!isHumanConfirmation(c)) return "NOT_RECORDED";
  if (spent.has(c)) return "SPENT";
  return now() >= c.expiresAt ? "EXPIRED" : "LIVE";
}

export type ConfirmationMismatch =
  | "NOT_RECORDED"
  | "ALREADY_SPENT"
  | "EXPIRED"
  | "DIFFERENT_TARGET"
  | "DIFFERENT_FRAME"
  | "DIFFERENT_ORIGIN"
  | "ORIGIN_NOT_SUPPLIED";

export type ConfirmationCheck = { readonly covers: true } | { readonly covers: false; readonly cause: ConfirmationMismatch };

/**
 * Does this confirmation cover this control, right now? **Pure — it spends nothing.**
 *
 * Separate from spending because the gate checks twice: once in `authorisationPreflight`, which a
 * composition calls before it touches the page, and once inside `mintDispatchPermit`, which must not
 * trust that any composition did. A check that consumed would make the second call fail.
 */
export function confirmationCovers(
  confirmation: unknown,
  subject: Omit<ConfirmationSubject, "origin">,
  origin: string | undefined,
  now: MonotonicClock = monotonicNow
): ConfirmationCheck {
  if (!isHumanConfirmation(confirmation)) return { covers: false, cause: "NOT_RECORDED" };
  if (spent.has(confirmation)) return { covers: false, cause: "ALREADY_SPENT" };
  if (now() >= confirmation.expiresAt) return { covers: false, cause: "EXPIRED" };

  const s = confirmation.subject;
  // Origin is not carried by the freshness decision, so the caller supplies it. Absent, the binding
  // cannot be checked at all — which is an unknown, and an unknown does not authorise anything.
  if (!nonEmpty(origin)) return { covers: false, cause: "ORIGIN_NOT_SUPPLIED" };
  if (s.origin !== origin) return { covers: false, cause: "DIFFERENT_ORIGIN" };
  if (s.frameId !== subject.frameId) return { covers: false, cause: "DIFFERENT_FRAME" };
  if (s.nodeId !== subject.nodeId || s.selector !== subject.selector || s.role !== subject.role || s.name !== subject.name) {
    return { covers: false, cause: "DIFFERENT_TARGET" };
  }
  return { covers: true };
}

/**
 * Spend a confirmation. Called by `mintDispatchPermit` and by nothing else.
 *
 * Returns `false` if it was already spent, so the caller cannot issue a second permit from one "yes"
 * even by racing itself.
 */
export function spendConfirmation(confirmation: HumanConfirmation): boolean {
  if (!isHumanConfirmation(confirmation) || spent.has(confirmation)) return false;
  spent.add(confirmation);
  return true;
}
