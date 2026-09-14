/**
 * `@pratibimb/agent` — the execution-loop stages that exist.
 *
 * Today that is five:
 *
 * - **VALIDATE + REFRESH** — the action-freshness boundary between perception and any browser
 *   action (ADR-0005);
 * - **HIT-TEST AGREEMENT** — the TOCTOU gate that asks, immediately before the click, whether the
 *   validated element is still topmost at the point about to be clicked (ADR-0007);
 * - **THE EXECUTION GATE** — mints a single-use, expiring `DispatchPermit` from an attested ALLOW
 *   and an attested MATCH established for that decision (ADR-0008, PROPOSED);
 * - **ACT** — the executor, which redeems a permit and performs the one dispatch it fixes, and
 *   accepts nothing else (ADR-0006, amended by ADR-0008);
 * - **VERIFY RESULT** — the page readback that decides whether the action actually did anything
 *   (ADR-0007). `EXECUTED` is a dispatch, never a success.
 *
 * `guardedAct` composes them in order, with a mandatory postcondition. The residual ADR-0007 §8
 * recorded — `act()` and `validateAndAct()` reaching a page without hit-test agreement — is closed:
 * `validateAndAct` is removed, and `act` accepts only a permit the gate minted after a MATCH.
 *
 * Deliberately absent, and absent on purpose rather than by oversight: REASON (no server, B-03),
 * PLAN (no planner), SANITIZE (no PII detectors), VERIFY (no privacy verifier), RE-HYDRATE (no
 * vault). Because the vault and the sanitizer are absent, `type` is refused rather than
 * approximated — see ADR-0006 §3. See `artifacts/reviews/AUDIT-0005-mvp-loop-readiness.md`.
 *
 * This package imports nothing that can reach the network and holds no state, so it cannot
 * weaken Invariant E or the vault invariants. Its entire browser authority is two interface
 * methods: `PageActionBridge.clickAtCssPoint`, which acts, and `HitTestBridge.topmostAtCssPoint`,
 * which only looks.
 */
export {
  ALLOWED_ACTIONS,
  bearsFreshnessAttestation,
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

export {
  EXECUTABLE_ACTIONS,
  PROPOSED_CONFIRMATION_NAME_PATTERNS,
  authorisationPreflight,
  confirmationTierOf,
  isIssuedPermit,
  mintDispatchPermit,
  monotonicNow,
  permitState,
  type AuthorisationEvidence,
  type ConfirmationTier,
  type DispatchPermit,
  type ExecutableAction,
  type GateRefusal,
  type MintOptions,
  type MintResult,
  type MonotonicClock,
  type PermitState,
  type PermittedTarget,
  type RejectionCause,
  type UnsupportedCause,
} from "./permit.js";

export {
  confirmationCovers,
  confirmationState,
  isHumanConfirmation,
  recordHumanConfirmation,
  type ConfirmationCheck,
  type ConfirmationMismatch,
  type ConfirmationOptions,
  type ConfirmationRefusalCause,
  type ConfirmationResult,
  type ConfirmationState,
  type ConfirmationSubject,
  type HumanConfirmation,
} from "./humanConfirmation.js";

export {
  DEFAULT_DISPATCH_TIMEOUT_MS,
  act,
  wasDispatched,
  type ActOptions,
  type ActResult,
  type ActedTarget,
  type ErrorCategory,
  type ExecutionStatus,
  type PageActionBridge,
} from "./act.js";

export {
  DEFAULT_HIT_TEST_TIMEOUT_MS,
  PROPOSED_HIT_TEST_TOLERANCE,
  agreesForDispatch,
  bearsHitAgreement,
  dispatchPointOf,
  establishHitAgreement,
  hitAgreementIsFor,
  type Agreement,
  type HitTestBridge,
  type HitTestOptions,
  type HitTestResult,
  type HitTestTolerance,
  type MismatchCause,
  type TopmostElement,
  type UnknownCause,
} from "./hitTest.js";

export {
  actedNodeId,
  verifyActionResult,
  wasConfirmed,
  type ExpectedPostcondition,
  type NotConfirmedCause,
  type PostActionObservation,
  type UnknownVerificationCause,
  type VerificationRequest,
  type VerificationResult,
} from "./verifyResult.js";

export {
  guardedAct,
  guardedActionConfirmed,
  guardedActionDispatched,
  type GuardedActOptions,
  type GuardedBridges,
  type GuardedOutcome,
  type ReachedStage,
  type VerificationPlan,
} from "./guardedAct.js";
