/**
 * The plan contract, and the parser that is the only way an untrusted response becomes one.
 *
 * `parsePlan` takes `unknown` — whatever the reasoner returned — and either produces a `Plan` or
 * refuses. There is no cast, no `as Plan`, and no field read before it has been proved present. A
 * plan that this function did not produce cannot be validated: `validatePlan` checks membership in a
 * module-private `WeakSet`, the same mechanism `DispatchPermit`, `VerifiedHandoff` and
 * `HumanConfirmation` use, so a hand-built object shaped like a plan is refused rather than trusted.
 *
 * TWO OPERATIONS, AND ONLY ONE OF THEM IS AN AGENT ACTION.
 *
 * - **`click`** is an action. It goes to `guardedAct` and to nothing else. `EXECUTABLE_ACTIONS`
 *   remains `["click"]` and this package does not widen it.
 * - **`insert`** is **not** an agent action and must not be confused for one. It is a request that
 *   the *trusted client* restore a locally held value into an approved target, after the privacy
 *   layer and a human have both agreed. The agent never types; there is no TYPE action; the value
 *   never passes through the reasoner, the plan, or the execution gate. An `insert` step carries a
 *   reference or a literal, never a secret the plan itself supplies — and a literal is exactly what
 *   the literal-echo check exists to refuse.
 *
 * WHY A LITERAL IS EXPRESSIBLE AT ALL. `docs/architecture/action-schema.md` is explicit that a schema
 * unable to express a non-sensitive literal cannot drive a browser, and that literals are therefore
 * allowed and then checked. Making them unrepresentable here would move the refusal from a place that
 * reports it to a place that cannot see it.
 */

/** Restore a locally held value into a target. Performed by the client, never by the agent. */
export interface InsertStep {
  readonly op: "insert";
  readonly target: string;
  /** An opaque reference the privacy layer issued. Exactly one of `ref` or `literal`. */
  readonly ref?: string;
  /** A plain string the reasoner supplied. Subject to all three checks on a literal. */
  readonly literal?: string;
}

/** The one agent action. Goes to `guardedAct`; nothing here dispatches anything. */
export interface ClickStep {
  readonly op: "click";
  readonly target: string;
}

export type PlanStep = InsertStep | ClickStep;

/** The operations this client will consider. Anything else is refused by name. */
export const PLAN_OPERATIONS = ["insert", "click"] as const;
export type PlanOperation = (typeof PLAN_OPERATIONS)[number];

/**
 * Where a plan claims to have come from.
 *
 * A plan without provenance cannot be matched to the request that produced it, the session it
 * belongs to, or the view it was planned against — so it is refused. This is identity, not security
 * on its own: it is an untrusted claim, checked against what the client already knows.
 */
export interface PlanProvenance {
  readonly requestId: string;
  readonly sessionId: string;
  /** The view the reasoner was shown. Compared against the live view before anything is bound. */
  readonly viewId: string;
  readonly origin?: string;
}

export interface Plan {
  readonly planVersion: "1";
  readonly steps: readonly PlanStep[];
  readonly provenance: PlanProvenance;
  readonly goal?: string;
}

export type ParseRefusalCause =
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_PLAN_VERSION"
  | "STEPS_NOT_AN_ARRAY"
  | "NO_STEPS"
  | "TOO_MANY_STEPS"
  | "STEP_NOT_AN_OBJECT"
  | "UNSUPPORTED_OPERATION"
  | "MALFORMED_TARGET"
  | "INSERT_NEEDS_REF_OR_LITERAL"
  | "INSERT_NOT_BOTH"
  | "MISSING_PROVENANCE";

export type ParseOutcome =
  | { readonly ok: true; readonly plan: Plan }
  | { readonly ok: false; readonly cause: ParseRefusalCause; readonly at?: number };

/** Plans this parser produced. A plan assembled anywhere else is not validatable. */
const PARSED = new WeakSet<object>();

/** `true` only for a plan `parsePlan` built. Asked by `validatePlan`, never assumed. */
export const isParsedPlan = (candidate: unknown): candidate is Plan =>
  typeof candidate === "object" && candidate !== null && PARSED.has(candidate);

/**
 * A step count this client will consider at all.
 *
 * The demo's plan is two steps. The cap is not a security boundary — it is a refusal to iterate over
 * an unbounded structure an untrusted party controls.
 */
export const MAX_PLAN_STEPS = 8;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * Turn an untrusted response into a plan, or refuse.
 *
 * Structure only. Whether a target exists, a reference is known, or a literal is a leak are all
 * questions for `validatePlan` — this function establishes that there is something well formed to
 * ask them about.
 */
export function parsePlan(raw: unknown): ParseOutcome {
  if (!isObject(raw)) return { ok: false, cause: "NOT_AN_OBJECT" };
  if (raw.planVersion !== "1") return { ok: false, cause: "UNSUPPORTED_PLAN_VERSION" };
  if (!Array.isArray(raw.steps)) return { ok: false, cause: "STEPS_NOT_AN_ARRAY" };
  if (raw.steps.length === 0) return { ok: false, cause: "NO_STEPS" };
  if (raw.steps.length > MAX_PLAN_STEPS) return { ok: false, cause: "TOO_MANY_STEPS" };

  const provenance = raw.provenance;
  if (
    !isObject(provenance) ||
    !isNonEmptyString(provenance.requestId) ||
    !isNonEmptyString(provenance.sessionId) ||
    !isNonEmptyString(provenance.viewId)
  ) {
    return { ok: false, cause: "MISSING_PROVENANCE" };
  }

  const steps: PlanStep[] = [];
  for (const [index, candidate] of raw.steps.entries()) {
    if (!isObject(candidate)) return { ok: false, cause: "STEP_NOT_AN_OBJECT", at: index };
    const op = candidate.op;
    if (op !== "insert" && op !== "click") return { ok: false, cause: "UNSUPPORTED_OPERATION", at: index };
    if (!isNonEmptyString(candidate.target)) return { ok: false, cause: "MALFORMED_TARGET", at: index };

    if (op === "click") {
      steps.push({ op, target: candidate.target });
      continue;
    }

    const hasRef = candidate.ref !== undefined;
    const hasLiteral = candidate.literal !== undefined;
    if (hasRef && hasLiteral) return { ok: false, cause: "INSERT_NOT_BOTH", at: index };
    if (hasRef) {
      if (!isNonEmptyString(candidate.ref)) return { ok: false, cause: "INSERT_NEEDS_REF_OR_LITERAL", at: index };
      steps.push({ op, target: candidate.target, ref: candidate.ref });
      continue;
    }
    // An empty literal is still a literal and still gets checked; only its absence is malformed.
    if (typeof candidate.literal !== "string") return { ok: false, cause: "INSERT_NEEDS_REF_OR_LITERAL", at: index };
    steps.push({ op, target: candidate.target, literal: candidate.literal });
  }

  const plan: Plan = Object.freeze({
    planVersion: "1" as const,
    steps: Object.freeze(steps),
    provenance: Object.freeze({
      requestId: provenance.requestId,
      sessionId: provenance.sessionId,
      viewId: provenance.viewId,
      ...(isNonEmptyString(provenance.origin) ? { origin: provenance.origin } : {}),
    }),
    ...(isNonEmptyString(raw.goal) ? { goal: raw.goal } : {}),
  });
  PARSED.add(plan);
  return { ok: true, plan };
}
