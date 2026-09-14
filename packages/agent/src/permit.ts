/**
 * THE EXECUTION GATE — the only place a dispatch permit can come from. ADR-0008 (PROPOSED).
 *
 * Before this module, ACT accepted a freshness decision and re-derived its own authority: it
 * checked the allowlist, the confirmation tier and the point itself, and it could be reached
 * without any hit-test agreement at all — `act()` was exported, and so was `validateAndAct()`,
 * which called it without one (ADR-0007 §8). The safe composition existed (`guardedAct`); the
 * lowest boundary did not enforce it.
 *
 * Now authority is minted here, once, and ACT only redeems it:
 *
 *     VALIDATE ─► AUTHORISE (kind, target, tier) ─► HIT-TEST MATCH ─► MINT ─► ACT(permit)
 *
 * WHAT A PERMIT IS.
 *
 * A frozen, attested, single-use, expiring object that fixes — before ACT runs — everything a
 * dispatch could otherwise choose: the action kind, the frame, the point and the target. ACT has
 * no parameter for any of them. It can only spend a permit or refuse to.
 *
 * THREE PROPERTIES, EACH ENFORCED IN CODE RATHER than DOCUMENTATION.
 *
 * 1. **Minted only from an attested ALLOW and an attested MATCH established FOR THAT DECISION.**
 *    A MATCH obtained for one decision cannot mint a permit for another: `hitAgreementIsFor`
 *    compares object identity through a module-private map in `hitTest.ts`.
 * 2. **Single use, consumed before dispatch.** A redemption attempt on a genuine permit consumes
 *    it whether or not the dispatch then succeeds. A bridge that throws or times out has spent
 *    the permit; trying again needs a new VALIDATE → HIT-TEST → MINT cycle, never a retry of the
 *    old authority.
 * 3. **Expiring, with NO default lifetime.** The repository holds no measurement from which a
 *    hit-test→dispatch budget could be derived — MVP-2's log (workstation 1) records no timing
 *    fields — so this module refuses to pick one. `ttlMs` is a required argument and `mint`
 *    rejects a missing, non-finite or non-positive value. The number is an open owner decision,
 *    not a constant hiding here.
 *
 * THE LIMIT OF THE ATTESTATION, stated as ADR-0005 and ADR-0007 state theirs: a module-private
 * registry of issued objects is a same-realm integrity check, not a capability. (ADR-0005 and
 * ADR-0007 attest with a hidden symbol; a permit does not need one. Membership of the registry is
 * strictly stronger — it also refuses a reflective copy that re-applies a hidden symbol — and the
 * mutation check showed the symbol added nothing the registry did not already enforce.) It
 * makes an accidental bypass impossible — a copy, a spread, a `JSON.parse` revival and a
 * hand-built literal are all refused — and a deliberate in-process bypass unwritable by mistake.
 * The adversaries PratiBimb names cannot reach it: page script runs in another JavaScript world,
 * and a server can send only JSON.
 *
 * NOT HERE, ON PURPOSE:
 * - **Computed-style visibility.** Which deterministic checks close the opacity/clip/decoy cases
 *   is the question experiment E7 answers. The permit gains a mandatory visibility input when E7
 *   has chosen them — not before, and not by guessing.
 * - **BIND / HUMAN GRANT.** There is no TYPE, no vault and no grant path. A confirmation-tier
 *   target is therefore refused, always.
 * - **The browser dispatch mechanism.** Point-based versus element-based dispatch is experiment
 *   E6's question. The permit carries both the point and the stable target reference, so either
 *   binding can be enforced later without widening what a permit authorises.
 */
import { type CssBox, type ElementNode, type FrameId, type NodeId } from "@pratibimb/perception";

import {
  ALLOWED_ACTIONS,
  bearsFreshnessAttestation,
  type ActionKind,
  type CssPoint,
  type FreshnessDecision,
} from "./actionFreshness.js";
import { bearsHitAgreement, dispatchPointOf, hitAgreementIsFor, type HitTestResult } from "./hitTest.js";
import { confirmationCovers, spendConfirmation, type HumanConfirmation } from "./humanConfirmation.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// What the gate will authorise at all
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The action kinds a permit may authorise. Exactly one — ADR-0006 §3. */
export const EXECUTABLE_ACTIONS = ["click"] as const;
export type ExecutableAction = (typeof EXECUTABLE_ACTIONS)[number];

/** Why the gate refused to authorise. */
export type RejectionCause =
  | "NOT_VALIDATED"
  | "TARGET_MISSING_IN_DECISION"
  | "HUMAN_CONFIRMATION_REQUIRED"
  | "POINT_OUTSIDE_TARGET"
  | "NO_HIT_AGREEMENT"
  | "HIT_NOT_FOR_THIS_DECISION"
  | "POINT_MISMATCH"
  | "FRAME_MISMATCH"
  | "INVALID_TTL"
  | "POSTCONDITION_REQUIRED"
  | "NOT_PERMITTED"
  | "PERMIT_CONSUMED"
  | "PERMIT_EXPIRED"
  | "BRIDGE_FRAME_MISMATCH";

/** Why an allowlisted action is not authorised by this gate. */
export type UnsupportedCause =
  | "NOT_ON_ALLOWLIST"
  | "CLEARANCE_PIPELINE_ABSENT"
  | "NO_SAFE_PAYLOAD_CONTRACT"
  | "NO_HUMAN_CONFIRMATION_CHANNEL"
  | "NOT_A_PAGE_OPERATION";

/** A refusal from the gate. Shaped as an `ActResult` refusal so a composition can report it uniformly. */
export type GateRefusal =
  | {
      readonly status: "REJECTED";
      readonly cause: RejectionCause;
      readonly detail: string;
      readonly kind?: ActionKind;
    }
  | {
      readonly status: "UNSUPPORTED_ACTION";
      readonly kind: string;
      readonly cause: UnsupportedCause;
      readonly detail: string;
    };

const rejected = (cause: RejectionCause, detail: string, kind?: ActionKind): GateRefusal =>
  kind === undefined ? { status: "REJECTED", cause, detail } : { status: "REJECTED", cause, detail, kind };

/**
 * Why each allowlisted action the gate will not authorise is refused. ADR-0006 §3.
 * Unchanged in substance; moved here because refusing is the gate's job, not the executor's.
 */
const REFUSALS: Readonly<Record<Exclude<ActionKind, ExecutableAction>, { cause: UnsupportedCause; detail: string }>> = {
  type: {
    cause: "CLEARANCE_PIPELINE_ABSENT",
    detail:
      "both modes of `type` depend on stages that do not exist: `value_ref` needs the vault " +
      "(RE-HYDRATE), and a literal is admissible only after the action schema's three checks " +
      "(target, D1/D2/D3 shape, vault comparison), none of which is implemented. Typing a " +
      "synthetic string instead would be a secret-handling workaround.",
  },
  scroll: {
    cause: "NO_SAFE_PAYLOAD_CONTRACT",
    detail:
      "the grammar names `scroll` with no payload, and freshness validation treats it as " +
      "targeted — so only a scroll aimed at an already-visible element can pass, which is not " +
      "what scrolling is for. See ADR-0006 §7.",
  },
  select: {
    cause: "NO_SAFE_PAYLOAD_CONTRACT",
    detail: "option identity is not carried by the element graph, so there is nothing to validate an option against.",
  },
  wait: {
    cause: "NOT_A_PAGE_OPERATION",
    detail: "waiting is the loop scheduler's concern; the executor does not own a clock.",
  },
  zoom_request: {
    cause: "NOT_A_PAGE_OPERATION",
    detail: "a request to the capture layer (OBSERVE), not an operation performed on the page.",
  },
  confirm: {
    cause: "NO_HUMAN_CONFIRMATION_CHANNEL",
    detail:
      "there is no confirmation UI, so nothing can represent a human's consent. A gate that " +
      "could emit a confirmation would be fabricating one.",
  },
  done: {
    cause: "NOT_A_PAGE_OPERATION",
    detail: "a terminal signal for the loop, not a browser operation.",
  },
};

/**
 * Accessible names that put a control in the action schema's human-confirmation tier.
 * **PROPOSED — ADR-0006 §6**, pending owner decision D-ACT-1. Unchanged; moved with the tier check.
 */
export const PROPOSED_CONFIRMATION_NAME_PATTERNS: readonly RegExp[] = [
  /\bsubmit\b/i,
  /\bsend\b/i,
  /\bpay\b|\bpayment\b/i,
  /\bpurchase\b|\bbuy\b|\border\b|\bcheckout\b/i,
  /\bdelete\b|\bremove\b|\berase\b/i,
  /\btransfer\b|\bwithdraw\b|\bdeposit\b/i,
  /\bsign\s?in\b|\bsign\s?out\b|\blog\s?in\b|\blog\s?out\b|\blogin\b|\blogout\b/i,
  /\bauthorise\b|\bauthorize\b|\bauthenticate\b/i,
  /\bconfirm\b|\bapprove\b|\baccept\b|\bagree\b/i,
];

export type ConfirmationTier = "ROUTINE" | "CONFIRM_REQUIRED";

/**
 * Screen a target against the confirmation tier. Fails towards CONFIRM_REQUIRED.
 * Role `link` is always CONFIRM_REQUIRED: the graph carries no `href`, so the destination origin is
 * unknowable here (INV-20), and unknown is not safe. Known weakness: a submit control named
 * "Continue" passes — ADR-0006 §6.
 */
export function confirmationTierOf(node: Pick<ElementNode, "role" | "name">): ConfirmationTier {
  if (node.role === "link") return "CONFIRM_REQUIRED";
  const name = node.name ?? "";
  return PROPOSED_CONFIRMATION_NAME_PATTERNS.some((p) => p.test(name)) ? "CONFIRM_REQUIRED" : "ROUTINE";
}

const isExecutable = (k: ActionKind): k is ExecutableAction => (EXECUTABLE_ACTIONS as readonly string[]).includes(k);

const finite = (...xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x));

const inside = (p: CssPoint, b: CssBox): boolean =>
  p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

/**
 * Evidence that does not come from the decision.
 *
 * Optional in its entirety, and omitting it leaves every pre-existing behaviour exactly as it was:
 * a confirmation-tier control is refused, as it has always been. Supplying a confirmation does not
 * relax any other check — see `humanConfirmation.ts` for what it can and cannot establish.
 */
export interface AuthorisationEvidence {
  /** A human's consent for this exact control, from `recordHumanConfirmation`. */
  readonly confirmation?: HumanConfirmation;
  /** The page origin the confirmation is checked against. Required whenever one is supplied. */
  readonly origin?: string;
  readonly now?: MonotonicClock;
}

/**
 * The static half of authorisation: everything that can be decided from the decision alone.
 *
 * A composition calls this BEFORE the hit test so an unsupported or confirmation-tier action never
 * even queries the page, and `mintDispatchPermit` calls it again because the gate must not trust
 * that any composition did. Returns `null` only when every static condition holds.
 */
export function authorisationPreflight(decision: FreshnessDecision, evidence?: AuthorisationEvidence): GateRefusal | null {
  if (decision.decision !== "ALLOW" || !bearsFreshnessAttestation(decision)) {
    return rejected(
      "NOT_VALIDATED",
      decision.decision === "ALLOW"
        ? "the decision is shaped like an ALLOW but carries no freshness attestation; nothing can be authorised from it."
        : `the decision is ${String(decision.decision)}` +
            ("reason" in decision ? ` (${decision.reason}: ${decision.detail})` : "") +
            ". The plan must be discarded and the page re-observed; nothing is authorised."
    );
  }
  const kind = decision.kind;
  if (!(ALLOWED_ACTIONS as readonly string[]).includes(kind)) {
    return { status: "UNSUPPORTED_ACTION", kind: String(kind), cause: "NOT_ON_ALLOWLIST", detail: `"${String(kind)}" is not in the frozen action allowlist.` };
  }
  if (!isExecutable(kind)) {
    const refusal = REFUSALS[kind as Exclude<ActionKind, ExecutableAction>];
    return { status: "UNSUPPORTED_ACTION", kind, cause: refusal.cause, detail: refusal.detail };
  }
  const node = decision.node;
  const box = decision.viewportBox;
  if (!node || !box || decision.frameId === undefined) {
    return rejected("TARGET_MISSING_IN_DECISION", "the ALLOW carries no node, box or frame, so there is nothing to authorise. The gate does not look for one.", kind);
  }
  if (confirmationTierOf(node) === "CONFIRM_REQUIRED") {
    // The tier is not relaxed: it is satisfied, or it refuses. A confirmation must have been
    // recorded by this process for THIS node, in THIS frame, on THIS origin, and be unspent.
    const cover = confirmationCovers(
      evidence?.confirmation,
      { nodeId: node.id, selector: node.domRef.selector, role: node.role, name: node.name, frameId: decision.frameId },
      evidence?.origin,
      evidence?.now ?? monotonicNow
    );
    if (!cover.covers) {
      return rejected(
        "HUMAN_CONFIRMATION_REQUIRED",
        `node ${node.id} (role ${node.role}, name "${node.name}") is in the action schema's human-confirmation ` +
          (evidence?.confirmation === undefined
            ? "tier, and no confirmation was supplied. No permit can be issued on a human's behalf."
            : `tier, and the confirmation supplied does not authorise it (${cover.cause}).`),
        kind
      );
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The permit
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A monotonic millisecond clock. Injected so expiry is testable without real waiting. */
export type MonotonicClock = () => number;

export const monotonicNow: MonotonicClock = () => performance.now();

/** The target a permit is bound to, fixed at mint. Structural identity only — no value, no content. */
export interface PermittedTarget {
  readonly nodeId: NodeId;
  /** Stable DOM reference the hit test agreed on. Carried so an element-based binding (E6) can be enforced. */
  readonly selector: string;
  readonly nth?: number;
  readonly role: string;
  readonly name: string;
  /** The actable box the point was validated inside. */
  readonly box: CssBox;
}

/**
 * The only input ACT accepts.
 *
 * Every field is fixed at mint and the object is frozen. There is deliberately no field for a
 * value, a token or a selector ACT could choose among.
 */
export interface DispatchPermit {
  readonly kind: ExecutableAction;
  readonly frameId: FrameId;
  readonly point: CssPoint;
  readonly target: PermittedTarget;
  readonly mintedAt: number;
  readonly expiresAt: number;
}

/** Every permit this module issued. A structurally perfect object not in here was not issued. */
const issued = new WeakSet<object>();
/** Every permit that has been redeemed — successfully or not. */
const consumed = new WeakSet<object>();

export interface MintOptions {
  /**
   * Permit lifetime in milliseconds. **REQUIRED, no default.** No measurement in the repository
   * supports a value (ADR-0008 §5); the owner sets it from measured hit-test→dispatch intervals.
   */
  readonly ttlMs: number;
  readonly now?: MonotonicClock;
  /**
   * A human's consent, for a control in the confirmation tier. Omitted, such a control is refused
   * exactly as before. Spent here, as the permit is issued: one "yes", one permit.
   */
  readonly confirmation?: HumanConfirmation;
  /** The page origin the confirmation is bound to. Required whenever a confirmation is supplied. */
  readonly origin?: string;
}

export type MintResult =
  | { readonly minted: true; readonly permit: DispatchPermit }
  | { readonly minted: false; readonly refusal: GateRefusal };

const refuse = (refusal: GateRefusal): MintResult => ({ minted: false, refusal });

/**
 * MINT. The only way a `DispatchPermit` comes into existence.
 *
 * Fail-closed in every branch, and there is exactly one statement that issues a permit.
 */
export function mintDispatchPermit(decision: FreshnessDecision, hit: HitTestResult, options: MintOptions): MintResult {
  const pre = authorisationPreflight(decision, {
    ...(options?.confirmation === undefined ? {} : { confirmation: options.confirmation }),
    ...(options?.origin === undefined ? {} : { origin: options.origin }),
    ...(options?.now === undefined ? {} : { now: options.now }),
  });
  if (pre) return refuse(pre);
  // authorisationPreflight established all of these; narrowed again for the compiler.
  if (decision.decision !== "ALLOW" || !decision.node || !decision.viewportBox || decision.frameId === undefined) {
    return refuse(rejected("TARGET_MISSING_IN_DECISION", "the decision lost its target between checks."));
  }
  const kind = decision.kind as ExecutableAction;
  const node = decision.node;
  const box = decision.viewportBox;
  const frameId = decision.frameId;

  const ttl = options?.ttlMs;
  if (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0) {
    return refuse(
      rejected("INVALID_TTL", `a permit needs a finite, positive lifetime; got ${String(ttl)}. There is no default.`, kind)
    );
  }

  if (!hit || !bearsHitAgreement(hit) || hit.agreement !== "MATCH") {
    return refuse(
      rejected(
        "NO_HIT_AGREEMENT",
        hit && bearsHitAgreement(hit)
          ? `the hit test returned ${hit.agreement}; only an attested MATCH can authorise a dispatch.`
          : "the hit-test result is not one `establishHitAgreement` produced, so it is not evidence of agreement.",
        kind
      )
    );
  }

  if (!hitAgreementIsFor(hit, decision)) {
    return refuse(
      rejected(
        "HIT_NOT_FOR_THIS_DECISION",
        "the MATCH was established for a different decision. Agreement about one target is not agreement about another.",
        kind
      )
    );
  }

  const point = dispatchPointOf(decision);
  if (!point || !finite(point.x, point.y) || point.x !== hit.point.x || point.y !== hit.point.y) {
    return refuse(
      rejected("POINT_MISMATCH", "the point the hit test agreed on is not the point this decision dispatches at.", kind)
    );
  }
  if (!inside(point, box)) {
    return refuse(rejected("POINT_OUTSIDE_TARGET", `the point (${point.x}, ${point.y}) is not inside the validated box.`, kind));
  }
  if (hit.observed.frameId !== frameId) {
    return refuse(rejected("FRAME_MISMATCH", `the agreement was observed in frame ${String(hit.observed.frameId)}, not ${String(frameId)}.`, kind));
  }

  const clock = options.now ?? monotonicNow;
  const mintedAt = clock();
  if (!Number.isFinite(mintedAt)) {
    return refuse(rejected("INVALID_TTL", "the clock returned a non-finite time; expiry cannot be established.", kind));
  }

  const target: PermittedTarget = Object.freeze({
    nodeId: node.id,
    selector: node.domRef.selector,
    ...(node.domRef.nth === undefined ? {} : { nth: node.domRef.nth }),
    role: node.role,
    name: node.name,
    box,
  });
  // A confirmation is spent as the permit is issued, so one human "yes" can mint exactly one permit.
  // Spending last means a refusal above leaves the consent intact and re-usable for a retry the
  // human has already agreed to; spending before the permit exists means no permit can outlive it.
  if (confirmationTierOf(node) === "CONFIRM_REQUIRED" && options.confirmation !== undefined) {
    if (!spendConfirmation(options.confirmation)) {
      return refuse(
        rejected("HUMAN_CONFIRMATION_REQUIRED", "the confirmation was spent between the check and the mint.", kind)
      );
    }
  }

  const permit: DispatchPermit = { kind, frameId, point, target, mintedAt, expiresAt: mintedAt + ttl };
  Object.freeze(permit);
  issued.add(permit);
  return { minted: true, permit };
}

/** Whether an object is a permit this gate issued — regardless of whether it is still spendable. */
export const isIssuedPermit = (p: unknown): p is DispatchPermit => typeof p === "object" && p !== null && issued.has(p);

export type PermitState = "NOT_ISSUED" | "LIVE" | "CONSUMED" | "EXPIRED";

/** Read-only state, for a ledger and for tests. Never changes a permit. */
export function permitState(p: unknown, now: MonotonicClock = monotonicNow): PermitState {
  if (!isIssuedPermit(p)) return "NOT_ISSUED";
  if (consumed.has(p)) return "CONSUMED";
  return now() >= p.expiresAt ? "EXPIRED" : "LIVE";
}

export type Redemption = { readonly redeemed: true; readonly permit: DispatchPermit } | { readonly redeemed: false; readonly refusal: GateRefusal };

/**
 * REDEEM. Called by ACT, immediately before dispatch, and nowhere else.
 *
 * Consumes a genuine permit on EVERY attempt that identifies it — an expired permit or one
 * presented to the wrong frame is spent too, so the only path forward is a new cycle.
 */
export function redeemPermit(p: DispatchPermit, bridgeFrameId: FrameId, now: MonotonicClock = monotonicNow): Redemption {
  if (!isIssuedPermit(p)) {
    return {
      redeemed: false,
      refusal: rejected(
        "NOT_PERMITTED",
        "the object handed to ACT is not a permit this gate issued — a copy, a revival or a hand-built literal is not authority."
      ),
    };
  }
  if (consumed.has(p)) {
    return { redeemed: false, refusal: rejected("PERMIT_CONSUMED", "this permit was already redeemed. A new VALIDATE → HIT-TEST → MINT cycle is required.", p.kind) };
  }
  consumed.add(p);
  const t = now();
  if (!Number.isFinite(t) || t >= p.expiresAt) {
    return { redeemed: false, refusal: rejected("PERMIT_EXPIRED", "this permit expired before it was redeemed, and is now spent.", p.kind) };
  }
  if (bridgeFrameId !== p.frameId) {
    return {
      redeemed: false,
      refusal: rejected(
        "BRIDGE_FRAME_MISMATCH",
        `the permit authorises frame ${String(p.frameId)} but the bridge drives frame ${String(bridgeFrameId)}. The permit is now spent.`,
        p.kind
      ),
    };
  }
  return { redeemed: true, permit: p };
}
