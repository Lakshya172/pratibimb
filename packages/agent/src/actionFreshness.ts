/**
 * VALIDATE + REFRESH — the action-freshness boundary.
 *
 * Implements `docs/architecture/action-schema.md` §"Action freshness — pipeline stage 8" and
 * the decision recorded in ADR-0005. This is the first stage of the execution loop after
 * perception, and it is deliberately the smallest one: pure functions over existing
 * contracts, no network, no model, no secrets, no browser, no DOM.
 *
 * WHAT IT IS FOR
 *
 * Between the screenshot a plan was made from and the click that plan asks for, a page can
 * change. It can reflow, it can disable a control, it can remove one, and it can replace a
 * benign control with a harmful one in the same position. The contract's answer is to
 * re-check four things immediately before acting and, on any failure, to discard the plan
 * and observe again rather than guess. That is what this module does.
 *
 * THE ONLY TWO OUTCOMES ARE `ALLOW` AND `RE_OBSERVE`.
 *
 * There is no "closest candidate", no "best effort", no "allow with a warning". Anything this
 * module cannot establish, it refuses: an unknown safety state is not a safe one. The
 * rejection carries a reason so a ledger can say why, but the decision a caller switches on
 * has two cases and no default that could be mistaken for permission.
 *
 * WHAT IT IS NOT
 *
 * It does not observe, capture, re-plan or orchestrate — the observation loop does not exist
 * yet (AUDIT-0005), and inventing one here would create a second control flow. It does not
 * execute anything: there is no executor in this repository. It carries no value, no literal
 * and no vault token, so no secret can pass through it; SANITIZE and RE-HYDRATE are separate
 * stages and are also unbuilt.
 */
import {
  admitsVisualEvidence,
  iou,
  type CssBox,
  type CssPx,
  type ElementGraph,
  type ElementNode,
  type FrameId,
  type NodeId,
  type VisualEvidence,
} from "@pratibimb/perception";

/**
 * A point in the canonical CSS viewport space.
 *
 * Defined here rather than in `space.ts` on purpose: the coordinate contract is frozen and
 * deliberately exposes only `Box<T>`, so adding a type to it for one consumer would be a
 * change to a contract that nothing else needs. This reuses the existing `CssPx` brand, so it
 * introduces **no second coordinate convention** — a raw number still cannot pass as a
 * coordinate, which is the property the contract exists to enforce.
 */
export interface CssPoint {
  readonly x: CssPx;
  readonly y: CssPx;
}

/**
 * The frozen action allowlist, from `docs/architecture/action-schema.md`.
 *
 * Listed here as data so an action outside the grammar is refused by the same mechanism that
 * refuses a stale target, rather than by a reader noticing. `execute_javascript`, `eval`,
 * shell commands, download-and-run and model-supplied navigation are not in the grammar at
 * all — they cannot be expressed, which is stronger than being rejected.
 */
export const ALLOWED_ACTIONS = [
  "click",
  "type",
  "scroll",
  "select",
  "wait",
  "zoom_request",
  "confirm",
  "done",
] as const;

export type ActionKind = (typeof ALLOWED_ACTIONS)[number];

/**
 * Actions that operate on a page element, and therefore require a target claim.
 *
 * `wait` and `done` are control actions with nothing to aim at. Separating them is what lets
 * the validator insist on a target for everything else instead of treating an absent target
 * as "nothing to check".
 */
export const TARGETED_ACTIONS = ["click", "type", "scroll", "select", "zoom_request", "confirm"] as const;

const isAllowed = (k: string): k is ActionKind => (ALLOWED_ACTIONS as readonly string[]).includes(k);
const isTargeted = (k: ActionKind): boolean => (TARGETED_ACTIONS as readonly string[]).includes(k);

/**
 * What the plan believed about its target when it was made — i.e. what was reported to the
 * server and what the server planned against.
 *
 * This is the minimum the freshness check needs, and nothing more. It carries no value, no
 * `value_ref` and no token: a claim cannot smuggle a secret because it has nowhere to put one.
 */
export interface TargetClaim {
  readonly nodeId: NodeId;
  /** Role as reported. Compared for exact equality — see ADR-0005 §3. */
  readonly role: string;
  /** Accessible name as reported. Compared for exact equality. */
  readonly name: string;
  /** The frame the plan was made against. A claim does not outlive its frame. */
  readonly frameId: FrameId;
  /** The box as reported, in canonical CSS viewport pixels. */
  readonly viewportBox: CssBox;
}

/** An action a planner proposes. Target-free for `wait` and `done`; targeted otherwise. */
export interface ProposedAction {
  readonly kind: ActionKind | string;
  readonly target?: TargetClaim;
  /**
   * The exact point the caller intends to act at, if it has one.
   *
   * Optional because not every action needs a point, and checked strictly when present: a
   * point that is no longer inside the target is a miss even when the target itself passed
   * every other check.
   */
  readonly point?: CssPoint;
}

/** Why a proposal was refused. Internal richness behind a two-valued public decision. */
export type RejectionReason =
  | "ACTION_NOT_ALLOWLISTED"
  | "MALFORMED_CLAIM"
  | "FRAME_MISMATCH"
  | "TARGET_MISSING"
  | "ROLE_CHANGED"
  | "NAME_CHANGED"
  | "NOT_ENABLED"
  | "NOT_VISIBLE"
  | "MOVED_BEYOND_TOLERANCE"
  | "GEOMETRY_MISMATCH"
  | "POINT_OUTSIDE_TARGET";

/**
 * Movement and similarity tolerances.
 *
 * **PROPOSED, not approved** — see ADR-0005 §6. The action contract requires "a tolerance"
 * and names no number; the repository contains none for this purpose. These are therefore
 * configuration with documented defaults rather than constants, so an owner decision changes
 * a call site instead of a source edit.
 */
export interface FreshnessTolerance {
  /** Maximum centre displacement, in CSS px, that still counts as the same target. */
  readonly maxCentreShiftCssPx: number;
  /** Minimum IoU between the claimed box and the current box. Catches resize, not just drift. */
  readonly minBoxIou: number;
}

/**
 * `maxCentreShiftCssPx: 2.0` is **borrowed** from the QG-03a-B1/B4 detector-equivalence bound
 * the owner already approved — the project's only measured statement about what CSS-space
 * displacement is negligible. Borrowing it across purposes is a proposal, not an adoption.
 *
 * `minBoxIou: 0.8` has **no precedent** and is proposed. It sits above the frozen fusion
 * threshold of 0.5 — a box may legitimately be *fused* at 0.5, but acting on a target that
 * changed that much is a different risk — and below 1.0, which would reject sub-pixel noise.
 */
export const PROPOSED_FRESHNESS_TOLERANCE: FreshnessTolerance = {
  maxCentreShiftCssPx: 2.0,
  minBoxIou: 0.8,
};

/** What `ALLOW` hands back: the CURRENT state, never the claimed state. */
export interface AllowedAction {
  readonly decision: "ALLOW";
  readonly kind: ActionKind;
  /** Present for targeted actions, absent for `wait` / `done`. */
  readonly node?: ElementNode;
  /** The box to act on. The current one — acting on the claimed box is the bug this prevents. */
  readonly viewportBox?: CssBox;
  /** Measured centre displacement since the claim, in CSS px. */
  readonly movedCssPx?: number;
  /** Measured IoU between the claimed and current boxes. */
  readonly boxIou?: number;
}

export interface ReObserve {
  readonly decision: "RE_OBSERVE";
  readonly reason: RejectionReason;
  readonly detail: string;
}

export type FreshnessDecision = AllowedAction | ReObserve;

const reObserve = (reason: RejectionReason, detail: string): ReObserve => ({
  decision: "RE_OBSERVE",
  reason,
  detail,
});

const finite = (...xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x));
const centre = (b: CssBox): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p: CssPoint, b: CssBox): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * Two boxes, deliberately, and conflating them is a real bug — this distinction was added
 * after a test caught the validator refusing a legitimately clipped target.
 *
 * `comparisonBox` is the element's FULL box. It is the quantity the claim holds, so it is the
 * only thing the movement and IoU checks may compare against: measuring a claim's full box
 * against a visible fragment reports a move and a shape change that never happened.
 *
 * `actableBox` is where a caller may actually put a click. For a CLIPPED element that is the
 * visible part only — `viewportBox` describes the whole element, and its centre can be a point
 * that is not on screen at all.
 */
function comparisonBox(e: VisualEvidence): CssBox | null {
  return admitsVisualEvidence(e) ? e.viewportBox : null;
}

function actableBox(e: VisualEvidence): CssBox | null {
  if (!admitsVisualEvidence(e)) return null;
  return e.kind === "CLIPPED" ? e.visiblePart : e.viewportBox;
}

/**
 * VALIDATE. Decide whether a proposed action may still be executed against this observation.
 *
 * Fail-closed in every branch: each check either establishes its fact or returns
 * `RE_OBSERVE`. There is no path that reaches `ALLOW` with a fact unestablished, and no
 * fallback target is ever produced.
 *
 * The checks run identity-before-geometry on purpose. A visually identical replacement in the
 * old location must be caught as a changed role or name, not waved through by a box
 * comparison that it would pass.
 */
export function validateActionFreshness(
  graph: ElementGraph,
  action: ProposedAction,
  tolerance: FreshnessTolerance = PROPOSED_FRESHNESS_TOLERANCE
): FreshnessDecision {
  // 0 — the action must be in the frozen grammar.
  if (!isAllowed(action.kind)) {
    return reObserve(
      "ACTION_NOT_ALLOWLISTED",
      `"${String(action.kind)}" is not in the frozen action allowlist (${ALLOWED_ACTIONS.join(", ")}).`
    );
  }
  const kind: ActionKind = action.kind;

  // 1 — a targeted action needs a target; a control action must not carry one.
  if (!isTargeted(kind)) {
    if (action.target) {
      return reObserve("MALFORMED_CLAIM", `"${kind}" takes no target, but one was supplied.`);
    }
    return { decision: "ALLOW", kind };
  }
  const claim = action.target;
  if (!claim) return reObserve("MALFORMED_CLAIM", `"${kind}" requires a target claim, and none was supplied.`);

  // 2 — the claim must be well formed. Unknown is not safe.
  const b = claim.viewportBox;
  if (!b || !finite(b.x, b.y, b.w, b.h) || b.w <= 0 || b.h <= 0) {
    return reObserve("MALFORMED_CLAIM", "the claimed box is missing, non-finite or has non-positive extent.");
  }
  if (!claim.role || !claim.name) {
    return reObserve(
      "MALFORMED_CLAIM",
      "the claim carries no role or no accessible name, so identity cannot be re-established."
    );
  }
  if (action.point && !finite(action.point.x, action.point.y)) {
    return reObserve("MALFORMED_CLAIM", "the proposed point is non-finite.");
  }

  // 3 — frame first: a stale frame makes every later answer meaningless.
  if (claim.frameId !== graph.frameId) {
    return reObserve(
      "FRAME_MISMATCH",
      `the plan was made against frame ${claim.frameId}, but this observation is frame ${graph.frameId}. ` +
        "A claim does not outlive its frame."
    );
  }

  // 4 — the target must still exist.
  const node = graph.byId.get(claim.nodeId);
  if (!node) return reObserve("TARGET_MISSING", `node ${claim.nodeId} is not in the current graph.`);

  // 5, 6 — identity, exactly. Checked before geometry so a lookalike swap cannot pass.
  if (node.role !== claim.role) {
    return reObserve("ROLE_CHANGED", `node ${claim.nodeId} was role "${claim.role}", is now "${node.role}".`);
  }
  if (node.name !== claim.name) {
    return reObserve("NAME_CHANGED", `node ${claim.nodeId} was named "${claim.name}", is now "${node.name}".`);
  }

  // 7 — actionable state.
  if (!node.enabled) return reObserve("NOT_ENABLED", `node ${claim.nodeId} is disabled.`);

  // 8 — visibility, via the existing evidence contract rather than a new framework.
  const current = comparisonBox(node.evidence);
  const actable = actableBox(node.evidence);
  if (!current || !actable) {
    return reObserve(
      "NOT_VISIBLE",
      `node ${claim.nodeId} has ${node.evidence.kind} evidence, which supports no visual claim` +
        (node.evidence.kind === "UNOBSERVED" ? ` (${node.evidence.reason}: ${node.evidence.detail})` : "") +
        "."
    );
  }
  for (const [label, bb] of [["current", current], ["actionable", actable]] as const) {
    if (!finite(bb.x, bb.y, bb.w, bb.h) || bb.w <= 0 || bb.h <= 0) {
      return reObserve("MALFORMED_CLAIM", `node ${claim.nodeId} has a non-finite or empty ${label} box.`);
    }
  }

  // 9 — defence in depth: the evidence carries its own frame, and it must agree too.
  const evidenceFrame = admitsVisualEvidence(node.evidence) ? node.evidence.frameId : null;
  if (evidenceFrame !== graph.frameId) {
    return reObserve(
      "FRAME_MISMATCH",
      `node ${claim.nodeId} carries evidence from frame ${String(evidenceFrame)}, but the graph is frame ${graph.frameId}.`
    );
  }

  // 10 — movement.
  const a = centre(b);
  const c = centre(current);
  const moved = Math.hypot(c.x - a.x, c.y - a.y);
  if (moved > tolerance.maxCentreShiftCssPx) {
    return reObserve(
      "MOVED_BEYOND_TOLERANCE",
      `node ${claim.nodeId} moved ${moved.toFixed(3)} CSS px, beyond the ${tolerance.maxCentreShiftCssPx} px tolerance.`
    );
  }

  // 11 — shape. Movement alone misses a resize that keeps the centre.
  const overlap = iou(b, current);
  if (overlap < tolerance.minBoxIou) {
    return reObserve(
      "GEOMETRY_MISMATCH",
      `node ${claim.nodeId} overlaps its claimed box at IoU ${overlap.toFixed(4)}, below the ${tolerance.minBoxIou} floor.`
    );
  }

  // 12 — the intended point must still be on the thing, in its CURRENT position, and on the
  // part of it that is actually on screen.
  if (action.point && !inside(action.point, actable)) {
    return reObserve(
      "POINT_OUTSIDE_TARGET",
      `the proposed point (${action.point.x}, ${action.point.y}) is outside node ${claim.nodeId}'s current ` +
        `actionable box (${actable.x}, ${actable.y}, ${actable.w}x${actable.h}).`
    );
  }

  // The box handed back is the ACTABLE one: for a clipped element, the part a caller may
  // legitimately click, never the full box whose centre may be off screen.
  return {
    decision: "ALLOW",
    kind,
    node,
    viewportBox: actable,
    movedCssPx: moved,
    boxIou: overlap,
  };
}

/**
 * REFRESH, as a decision rather than an orchestration.
 *
 * `true` means: do not execute, discard the whole plan, obtain a fresh observation with a new
 * frame, and re-plan from it. Never re-submit the same claim against a new graph — the claim
 * describes a frame that is gone.
 *
 * Expressed as a helper so a caller cannot treat an unrecognised decision as permission: the
 * safe reading of anything that is not exactly `ALLOW` is that the action must not happen.
 */
export const mustReObserve = (d: FreshnessDecision): boolean => d.decision !== "ALLOW";

/**
 * The box a caller is permitted to act on, or `null` if it is not permitted to act.
 *
 * Returning the current box — never the claimed one — is what stops a caller validating
 * against fresh state and then acting on stale coordinates.
 */
export const actionableTarget = (d: FreshnessDecision): CssBox | null =>
  d.decision === "ALLOW" ? (d.viewportBox ?? null) : null;
