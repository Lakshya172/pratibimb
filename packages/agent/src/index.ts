/**
 * `@pratibimb/agent` — the execution-loop stages that exist.
 *
 * Today that is exactly one: VALIDATE + REFRESH, the action-freshness boundary between
 * perception and any browser action (ADR-0005).
 *
 * Deliberately absent, and absent on purpose rather than by oversight: ACT (no executor),
 * REASON (no server, B-03), PLAN (no planner), SANITIZE (no PII detectors), VERIFY (no
 * verifier), RE-HYDRATE (no vault). See `artifacts/reviews/AUDIT-0005-mvp-loop-readiness.md`.
 *
 * This package imports nothing that can reach the network and holds no state, so it cannot
 * weaken Invariant E or the vault invariants.
 */
export {
  ALLOWED_ACTIONS,
  PROPOSED_FRESHNESS_TOLERANCE,
  TARGETED_ACTIONS,
  actionableTarget,
  mustReObserve,
  validateActionFreshness,
  type ActionKind,
  type CssPoint,
  type AllowedAction,
  type FreshnessDecision,
  type FreshnessTolerance,
  type ProposedAction,
  type ReObserve,
  type RejectionReason,
  type TargetClaim,
} from "./actionFreshness.js";
