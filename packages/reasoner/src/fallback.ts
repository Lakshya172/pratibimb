/**
 * THE FALLBACK POLICY — and the distinction it exists to make.
 *
 * The deterministic planner stays alive behind the model, so a model that is missing, slow, broken
 * or incoherent does not take the product down with it. That much is ordinary resilience. The part
 * that is a security decision, and the reason this is a policy object rather than a `try/catch`:
 *
 *     **A model that FAILED may be retried by the fallback.
 *      A model that MISBEHAVED may not.**
 *
 * If the model is unreachable, times out, or returns something that is not a plan, nothing has been
 * learned about intent and the deterministic planner may answer instead. But if the model returned a
 * *well-formed plan that the client refused* — a secret echoed back, a reference that was never
 * issued, an action on an element that is not there — then quietly running a different plan would
 * convert a caught attack into a completed action, and would hide the event behind a success.
 * `HOSTILE` responses therefore stop the run, and the refusal is what gets reported.
 *
 * This object does not decide whether a plan is hostile; it is *told*. The judgement belongs to
 * `validatePlan` and `checkLiteral`, which have already made it by the time anyone asks for a
 * fallback. All this does is hold the rule about what may follow which outcome.
 *
 * THE FALLBACK IS NOT PRIVILEGED. Its output is `unknown` like any other reasoner's and goes through
 * parse → validate → bind → grant → confirm → act unchanged. "Known-good path" describes its
 * reliability, never its authority.
 */
import { type ReasonerClient, type ReasonerRequest } from "./contract.js";

/**
 * Why the model did not produce a usable plan.
 *
 * The split is the policy: the first four are failures of the model, the last is a failure of its
 * *output*, which is a different kind of event.
 */
export type ModelOutcome =
  /** No response at all — service down, refused by egress, connection failed. */
  | "UNAVAILABLE"
  /** A response, too late. */
  | "TIMEOUT"
  /** A response that is not a plan: not JSON, wrong shape, missing steps. */
  | "MALFORMED"
  /** A plan that is structurally fine but proposes nothing this client can do. */
  | "UNUSABLE"
  /** A plan the client refused on privacy or safety grounds. NOT a reason to try something else. */
  | "HOSTILE";

/** Which reasoner produced the plan the run acted on. Recorded in the run, shown in the UI. */
export type ReasonerKind = "LOCAL_MODEL" | "DETERMINISTIC_FALLBACK";

export interface FallbackPolicy {
  /** May the deterministic planner answer after this outcome? */
  readonly permits: (outcome: ModelOutcome) => boolean;
  readonly describe: (outcome: ModelOutcome) => string;
}

/**
 * The policy this phase ships.
 *
 * Everything except `HOSTILE` permits a fallback. `HOSTILE` does not, and that asymmetry is the
 * whole point of having a policy object rather than a catch block.
 */
export const DEFAULT_FALLBACK_POLICY: FallbackPolicy = {
  permits: (outcome) => outcome !== "HOSTILE",
  describe: (outcome) =>
    outcome === "HOSTILE"
      ? "the model returned a plan the client refused; falling back would hide a caught event behind a success."
      : `the model produced no usable plan (${outcome}), so the deterministic planner answers instead.`,
};

/** A policy that never falls back, for runs that want to see the model's own behaviour. */
export const NEVER_FALLBACK: FallbackPolicy = {
  permits: () => false,
  describe: (outcome) => `fallback disabled; the model outcome was ${outcome}.`,
};

export interface FallbackDecision {
  readonly outcome: ModelOutcome;
  readonly fellBack: boolean;
  readonly reason: string;
}

/**
 * Classify a reasoner response into a model outcome.
 *
 * Deliberately **not** a judgement about content — that is the validator's. This only distinguishes
 * "nothing usable came back" from "something came back", and the caller supplies `HOSTILE` once the
 * validator has spoken.
 */
export function outcomeOfResponse(response: { readonly received: boolean; readonly cause?: string; readonly raw?: unknown }): ModelOutcome {
  if (!response.received) return response.cause === "REASONER_TIMEOUT" ? "TIMEOUT" : "UNAVAILABLE";
  if (response.raw === undefined || response.raw === null) return "UNAVAILABLE";
  if (typeof response.raw !== "object") return "MALFORMED";
  return "UNUSABLE";
}

/**
 * Ask the policy whether the fallback may answer.
 *
 * Returns the decision rather than acting on it, so the caller records *why* a fallback did or did
 * not happen. A run that silently substituted a plan would be a run nobody could audit.
 */
export const decideFallback = (outcome: ModelOutcome, policy: FallbackPolicy = DEFAULT_FALLBACK_POLICY): FallbackDecision => ({
  outcome,
  fellBack: policy.permits(outcome),
  reason: policy.describe(outcome),
});

/**
 * Plan-validation refusals that mean the model was **hostile**, not merely wrong.
 *
 * The line is drawn at *what the refusal is evidence of*. A leaked secret or a reference the vault
 * never issued is evidence that something upstream is wrong in a way a second plan cannot fix, and
 * running one would replace a recorded event with a quiet success. Everything else — a selector the
 * page does not have, steps in an impossible order, no action at all — is evidence that a 0.5B model
 * is not very good, which is what the fallback is *for*.
 *
 * These are `@pratibimb/plan`'s own cause names, matched as strings so this package does not depend
 * on it; the orchestrator, which imports both, does the mapping.
 */
export const HOSTILE_REFUSAL_CAUSES: readonly string[] = ["LITERAL_REFUSED", "PRIVACY_REFUSED", "NOT_A_PARSED_PLAN"];

/** Classify a plan-validation refusal. `HOSTILE` blocks the fallback; `UNUSABLE` permits it. */
export const outcomeOfRefusal = (cause: string): ModelOutcome =>
  HOSTILE_REFUSAL_CAUSES.includes(cause) ? "HOSTILE" : "UNUSABLE";

/**
 * A reasoner that is always unavailable.
 *
 * The deterministic way to force `MODEL_UNAVAILABLE` **without touching any security code** — point
 * the loop at this instead of the model. Used by the fallback end-to-end run.
 */
export const unavailableReasoner = (name = "local-model:unavailable"): ReasonerClient => ({
  name,
  transport: "LOOPBACK_HTTP",
  // eslint-disable-next-line @typescript-eslint/require-await
  async propose(_request: ReasonerRequest): Promise<unknown> {
    return undefined;
  },
});
