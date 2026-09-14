/**
 * The composed execution path: VALIDATE → AUTHORISE → HIT-TEST → MINT → ACT → VERIFY RESULT.
 * ADR-0007, as amended by ADR-0008 (PROPOSED).
 *
 * The stages are separate modules on purpose and they stay separate here — this file sequences
 * them, it does not merge them. Each one can refuse, each refusal stops everything after it, and
 * the outcome says exactly how far the action got:
 *
 *     PROPOSE
 *         ↓
 *     VALIDATE ──── RE_OBSERVE ───────────────→ stop. nothing was touched.
 *         ↓ ALLOW
 *    AUTHORISE ──── no postcondition /
 *                   UNSUPPORTED / TIER ───────→ stop. the page is not even queried.
 *         ↓
 *     HIT-TEST ──── MISMATCH / UNKNOWN ───────→ stop. no permit can be minted.
 *         ↓ MATCH
 *       MINT ────── any refusal ──────────────→ stop. ACT is never called.
 *         ↓ single-use permit
 *       ACT ─────── permit refused ───────────→ nothing was dispatched.
 *         ↓ EXECUTED (dispatched — NOT "worked")
 *   VERIFY RESULT → CONFIRMED / NOT_CONFIRMED / UNKNOWN          (mandatory)
 *
 * TWO PROPERTIES ARE WORTH READING THE FILE FOR.
 *
 * 1. **`act` is called from exactly one place**, with a permit minted synchronously from the MATCH:
 *    there is no `await` between the agreement, the mint and the dispatch. And `act` cannot be
 *    reached any other way — it accepts only a permit, and only the execution gate mints one.
 * 2. **Verification is not optional.** `verify` and `permitTtlMs` are required. A call without a
 *    usable postcondition is refused before the page is touched, so no dispatch can happen that
 *    nothing will read back. A dispatch is still never reported as a success on its own.
 *
 * WHAT THIS IS NOT. It is not an agent loop. It does not observe, plan, retry, recover, choose a
 * target, or decide what to do next; every one of those belongs to an orchestration layer that
 * does not exist (AUDIT-0005). It performs one proposed action, once, and reports what happened.
 */
import { type ElementGraph } from "@pratibimb/perception";

import {
  type FreshnessDecision,
  type FreshnessTolerance,
  type ProposedAction,
  validateActionFreshness,
} from "./actionFreshness.js";
import { act, type ActResult, type PageActionBridge } from "./act.js";
import {
  agreesForDispatch,
  establishHitAgreement,
  type HitTestBridge,
  type HitTestOptions,
  type HitTestResult,
} from "./hitTest.js";
import { type HumanConfirmation } from "./humanConfirmation.js";
import { authorisationPreflight, mintDispatchPermit, monotonicNow, type MonotonicClock } from "./permit.js";
import {
  type ExpectedPostcondition,
  type PostActionObservation,
  verifyActionResult,
  type VerificationResult,
} from "./verifyResult.js";

/**
 * The two bridges, kept apart. Looking and touching are different authorities, and an adapter may
 * legitimately hold only one of them.
 */
export interface GuardedBridges {
  readonly action: PageActionBridge;
  readonly hitTest: HitTestBridge;
}

/**
 * How to verify the result — both halves, always.
 *
 * Coupled in one object so a caller cannot declare an expectation and forget the observation that
 * would test it.
 */
export interface VerificationPlan {
  readonly expect: ExpectedPostcondition;
  /** Observe the page AFTER the action. Must produce a genuinely fresh frame. */
  readonly observe: () => Promise<PostActionObservation>;
}

export interface GuardedActOptions {
  /** REQUIRED. The postcondition and the readback that tests it. */
  readonly verify: VerificationPlan;
  /**
   * REQUIRED. Permit lifetime in milliseconds. There is no default because no repository evidence
   * supports one (ADR-0008 §5) — the value is an open owner decision.
   */
  readonly permitTtlMs: number;
  readonly tolerance?: FreshnessTolerance;
  readonly hitTest?: HitTestOptions;
  /** Dispatch deadline. */
  readonly timeoutMs?: number;
  /** One clock for mint and redemption. */
  readonly now?: MonotonicClock;
  /**
   * A human's consent, required only for a target in the action schema's confirmation tier.
   * Omitted, such a target is refused at AUTHORISE exactly as it always was.
   */
  readonly confirmation?: HumanConfirmation;
  /** The page origin a confirmation is bound to. Required whenever `confirmation` is supplied. */
  readonly origin?: string;
}

/** The furthest stage the action reached. Nothing after it ran. */
export type ReachedStage = "VALIDATE" | "AUTHORISE" | "HIT_TEST" | "PERMIT" | "ACT" | "VERIFY_RESULT";

export interface GuardedOutcome {
  readonly reached: ReachedStage;
  readonly decision: FreshnessDecision;
  /** `null` when the hit test was never performed. */
  readonly hit: HitTestResult | null;
  /** The gate's refusal, or ACT's result. `null` only when refused at VALIDATE or HIT_TEST. */
  readonly result: ActResult | null;
  /** `null` whenever nothing was dispatched. */
  readonly verification: VerificationResult | null;
}

/** "Did this action actually work?" Only the page saying so counts. */
export const guardedActionConfirmed = (o: GuardedOutcome): boolean =>
  o.verification !== null && o.verification.verification === "CONFIRMED";

/** `true` only if a browser operation was actually dispatched. Not a claim that it worked. */
export const guardedActionDispatched = (o: GuardedOutcome): boolean =>
  o.result !== null && o.result.status === "EXECUTED";

const planIsUsable = (v: VerificationPlan | undefined): boolean =>
  typeof v === "object" &&
  v !== null &&
  typeof v.observe === "function" &&
  typeof v.expect === "object" &&
  v.expect !== null;

/**
 * Run one proposed action through the whole protected sequence.
 *
 * Fail-closed at every boundary, structurally: each gate returns early, so the code after it is
 * unreachable when it refuses.
 */
export async function guardedAct(
  graph: ElementGraph,
  action: ProposedAction,
  bridges: GuardedBridges,
  options: GuardedActOptions
): Promise<GuardedOutcome> {
  // ── VALIDATE ───────────────────────────────────────────────────────────────────────────────
  const decision = validateActionFreshness(graph, action, options?.tolerance);
  if (decision.decision !== "ALLOW") {
    return { reached: "VALIDATE", decision, hit: null, result: null, verification: null };
  }

  // ── AUTHORISE ──────────────────────────────────────────────────────────────────────────────
  // The static half of the gate, before the page is queried.
  if (!planIsUsable(options?.verify)) {
    return {
      reached: "AUTHORISE",
      decision,
      hit: null,
      result: {
        status: "REJECTED",
        cause: "POSTCONDITION_REQUIRED",
        detail: "no usable verification plan was supplied. A dispatch that nothing will read back is not authorised.",
      },
      verification: null,
    };
  }
  const evidence = {
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
    ...(options.now === undefined ? {} : { now: options.now }),
  };
  const pre = authorisationPreflight(decision, evidence);
  if (pre) return { reached: "AUTHORISE", decision, hit: null, result: pre, verification: null };

  // ── HIT-TEST AGREEMENT ─────────────────────────────────────────────────────────────────────
  const hit = await establishHitAgreement(decision, bridges.hitTest, options.hitTest ?? {});
  if (!agreesForDispatch(hit)) {
    return { reached: "HIT_TEST", decision, hit, result: null, verification: null };
  }

  // ── MINT ── synchronous: nothing is awaited between the agreement and the dispatch ───────────
  const clock = options.now ?? monotonicNow;
  const minted = mintDispatchPermit(decision, hit, {
    ttlMs: options.permitTtlMs,
    now: clock,
    ...(options.confirmation === undefined ? {} : { confirmation: options.confirmation }),
    ...(options.origin === undefined ? {} : { origin: options.origin }),
  });
  if (!minted.minted) {
    return { reached: "PERMIT", decision, hit, result: minted.refusal, verification: null };
  }

  // ── ACT ────────────────────────────────────────────────────────────────────────────────────
  const result = await act(minted.permit, bridges.action, {
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    now: clock,
  });
  if (result.status !== "EXECUTED" && result.status !== "EXECUTION_ERROR") {
    // Refused at redemption: nothing was dispatched, so there is nothing to verify.
    return { reached: "ACT", decision, hit, result, verification: null };
  }

  // ── VERIFY RESULT ── mandatory ───────────────────────────────────────────────────────────────
  // authorisationPreflight established both.
  const node = decision.node!;
  const frame = decision.frameId!;
  const observation = await options.verify.observe();
  const verification = verifyActionResult({
    result,
    acted: node,
    actedFrameId: frame,
    expected: options.verify.expect,
    observation,
  });
  return { reached: "VERIFY_RESULT", decision, hit, result, verification };
}
