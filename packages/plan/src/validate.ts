/**
 * VALIDATE PLAN — the layer between an untrusted response and the audited execution path.
 *
 * THE BOUNDARY THIS FILE MUST NOT CROSS, and it is the reason the package exists separately from
 * `@pratibimb/privacy`:
 *
 * - **`bind()` / `rehydrate()`** answer *"may this reference become a secret again, into this field,
 *   on this origin, in this session, now?"* — authority over **values**.
 * - **`validatePlan()`** answers *"is this returned plan structurally and semantically acceptable?"*
 *   — authority over **plan structure**.
 * - **`guardedAct`** answers *"is this one live action allowed right now?"* — authority over **one
 *   action**, and it remains the only click executor.
 *
 * So this function **calls** `bind` and `checkLiteral`; it never re-answers them. There is no class
 * check here, no origin check on a reference, no session check on a vault, no consumed check, no
 * grant logic and no literal comparison of its own. Where privacy has an opinion, privacy's opinion
 * is taken verbatim and reported with privacy's own cause. This validator may refuse a plan privacy
 * would have allowed — a target the view does not have, a step order that makes no sense — but it can
 * never allow one privacy refuses, because the only path to `BIND_OK` is through `bind`.
 *
 * ORDER IS EVIDENCE, as it is in the binder. Identity and provenance first, because a plan for
 * another session is not a plan with a bad target; then the view, because a stale plan's targets are
 * all meaningless; then per-step checks. The first refusal wins and the rest are not evaluated — but
 * the steps already checked are reported, so a panel can show how far the plan got.
 *
 * NOTHING HERE TOUCHES A PAGE, REHYDRATES A VALUE OR QUOTES A LITERAL. The refusal for a leaked
 * secret carries a cause and a class; the text is never in the result, the message or an error
 * (INV-21). A literal is refused **before** anything is rehydrated and before any action — that
 * ordering is the whole claim, and it is a test in this package and in the orchestrator's.
 */
import {
  bind,
  checkLiteral,
  type BindCause,
  type BindDecision,
  type BindView,
  type LiteralCause,
  type LiteralFinding,
  type LiteralSeverity,
  type PiiClass,
  type Vault,
} from "@pratibimb/privacy";

import { isParsedPlan, type Plan, type PlanStep } from "./schema.js";

/**
 * Why the plan was refused, at this layer.
 *
 * `PRIVACY_REFUSED` and `LITERAL_REFUSED` are deliberately not decomposed here: they carry the
 * privacy layer's own cause, so a ledger records the authority that actually decided.
 */
export type PlanRefusalCause =
  | "NOT_A_PARSED_PLAN"
  | "REQUEST_MISMATCH"
  | "SESSION_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "STALE_VIEW"
  | "UNKNOWN_TARGET"
  | "TARGET_NOT_ACTIONABLE"
  | "DUPLICATE_TARGET"
  | "NO_EXECUTABLE_STEP"
  | "CLICK_BEFORE_INSERT"
  | "PRIVACY_REFUSED"
  | "LITERAL_REFUSED";

/**
 * An insert backed by a vault reference. The value comes from `rehydrate`, after a human agrees.
 */
export interface ValidatedReferenceInsert {
  readonly op: "insert";
  readonly source: "reference";
  readonly index: number;
  readonly target: string;
  readonly ref: string;
  readonly piiClass: PiiClass;
  /** Privacy's answer. `BIND_OK`, or a state a human may resolve. */
  readonly binding: BindDecision;
  /** True when privacy says a human must decide before this step may proceed. */
  readonly needsHuman: boolean;
}

/**
 * An insert carrying a literal that passed **all three checks**: the target holds no redaction
 * token, the literal is not PII-shaped, and the vault does not hold it.
 *
 * `docs/architecture/action-schema.md` is explicit that this must exist — it calls a schema that
 * cannot express a non-sensitive literal *"a functional defect"*, because most of what an agent
 * types is not secret. There is no vault reference, no rehydration and no human grant: a grant
 * authorises the use of a **locally held secret**, and this is not one.
 *
 * The text itself is deliberately **not carried here**. It is reasoner-supplied, it is already in
 * the parsed plan the caller holds, and keeping a second copy in a result that gets recorded and
 * rendered is how text ends up somewhere it was not meant to be.
 */
export interface ValidatedLiteralInsert {
  readonly op: "insert";
  readonly source: "literal";
  readonly index: number;
  readonly target: string;
  /** Always false. A safe literal is not a secret, so there is nothing for a human to release. */
  readonly needsHuman: false;
}

export type ValidatedInsert = ValidatedReferenceInsert | ValidatedLiteralInsert;

export interface ValidatedClick {
  readonly op: "click";
  readonly index: number;
  readonly target: string;
}

export type ValidatedStep = ValidatedInsert | ValidatedClick;

export interface PlanRefusal {
  readonly cause: PlanRefusalCause;
  /** Index of the offending step, where one is identifiable. */
  readonly at?: number;
  readonly target?: string;
  /** The binder's own cause, when privacy refused. */
  readonly bindCause?: BindCause;
  /** The literal check's own cause, when a literal was refused. */
  readonly literalCause?: LiteralCause;
  readonly literalSeverity?: LiteralSeverity;
  readonly literalFindings?: readonly LiteralFinding[];
  /** Class metadata, never the value. */
  readonly piiClass?: PiiClass;
  /** Human-readable, and written to never contain a value. */
  readonly detail: string;
}

export type PlanValidation =
  | { readonly ok: true; readonly steps: readonly ValidatedStep[]; readonly needsHuman: readonly ValidatedInsert[] }
  | { readonly ok: false; readonly refusal: PlanRefusal; readonly checked: readonly ValidatedStep[] };

export interface PlanValidationContext {
  /** Everything privacy needs to answer about a reference. Passed straight through. */
  readonly vault: Vault;
  readonly sessionId: string;
  readonly requestId: string;
  readonly origin: string;
  /** The live view. Its id is compared against the plan's provenance. */
  readonly view: BindView;
  readonly currentDocumentId: string;
  readonly classOriginGrants: ReadonlySet<string>;
  readonly useGrants: readonly import("@pratibimb/privacy").UseGrant[];
  readonly now: number;
  /** Targets that carry a redaction span in the handoff that was sent. */
  readonly redactedTargets: ReadonlySet<string>;
  /** Which targets this client is willing to act on: present, visible, enabled. */
  readonly actionableTargets: ReadonlySet<string>;
  readonly today?: Date;
}

const refuse = (refusal: PlanRefusal, checked: readonly ValidatedStep[]): PlanValidation => ({
  ok: false,
  refusal,
  checked,
});

/**
 * Validate a parsed plan against the live client state.
 *
 * Returns the steps it accepted, and which of them a human must still authorise. It does **not**
 * rehydrate, grant, or act — every one of those is a later stage with its own gate.
 */
export function validatePlan(plan: Plan, ctx: PlanValidationContext): PlanValidation {
  const checked: ValidatedStep[] = [];

  // ── provenance and identity ───────────────────────────────────────────────────────────────
  // A plan this client did not parse is not a plan. Checked first: everything below reads fields
  // whose presence only the parser established.
  if (!isParsedPlan(plan)) {
    return refuse(
      { cause: "NOT_A_PARSED_PLAN", detail: "this object was not produced by parsePlan, so its shape is unestablished." },
      checked
    );
  }
  if (plan.provenance.requestId !== ctx.requestId) {
    return refuse({ cause: "REQUEST_MISMATCH", detail: "the plan answers a different request." }, checked);
  }
  if (plan.provenance.sessionId !== ctx.sessionId) {
    return refuse({ cause: "SESSION_MISMATCH", detail: "the plan belongs to a different session." }, checked);
  }
  if (plan.provenance.origin !== undefined && plan.provenance.origin !== ctx.origin) {
    return refuse({ cause: "ORIGIN_MISMATCH", detail: "the plan was made against a different page." }, checked);
  }
  // ── the view ──────────────────────────────────────────────────────────────────────────────
  // Before any target is looked up: if the page has moved on, every selector in the plan refers to
  // something that may no longer be there, and "unknown target" would misreport why.
  if (plan.provenance.viewId !== ctx.view.viewId) {
    return refuse(
      { cause: "STALE_VIEW", detail: "the plan was made against a view the client has replaced." },
      checked
    );
  }

  const seen = new Set<string>();
  let inserted = false;

  for (const [index, step] of plan.steps.entries()) {
    const target = step.target;

    // ── target identity ─────────────────────────────────────────────────────────────────────
    const field = ctx.view.fields.get(target);
    if (!field) {
      return refuse({ cause: "UNKNOWN_TARGET", at: index, target, detail: "the live view has no such element." }, checked);
    }
    if (seen.has(`${step.op}:${target}`)) {
      return refuse(
        { cause: "DUPLICATE_TARGET", at: index, target, detail: "the plan repeats an operation on one element." },
        checked
      );
    }
    seen.add(`${step.op}:${target}`);

    if (step.op === "click") {
      if (!ctx.actionableTargets.has(target)) {
        return refuse(
          {
            cause: "TARGET_NOT_ACTIONABLE",
            at: index,
            target,
            detail: "the element is not present, visible and enabled, so no click may be proposed against it.",
          },
          checked
        );
      }
      // A click that submits a form before the value it needs has been restored would send an
      // incomplete application. Ordering is a plan-structure question, which is this layer's.
      if (!inserted && plan.steps.some((s) => s.op === "insert")) {
        return refuse(
          { cause: "CLICK_BEFORE_INSERT", at: index, target, detail: "the plan acts before restoring the value it needs." },
          checked
        );
      }
      checked.push({ op: "click", index, target });
      continue;
    }

    // ── insert ──────────────────────────────────────────────────────────────────────────────
    const validated = validateInsert(step, index, ctx);
    if ("refusal" in validated) return refuse(validated.refusal, checked);
    checked.push(validated.step);
    inserted = true;
  }

  if (!checked.some((s) => s.op === "click")) {
    return refuse(
      { cause: "NO_EXECUTABLE_STEP", detail: "the plan proposes no action, so there is nothing to authorise." },
      checked
    );
  }

  return {
    ok: true,
    steps: checked,
    needsHuman: checked.filter((s): s is ValidatedInsert => s.op === "insert" && s.needsHuman),
  };
}

/**
 * One insert step.
 *
 * A literal and a reference are different questions with different authorities, and neither is
 * answered here: a literal goes to `checkLiteral`, a reference goes to `bind`.
 */
function validateInsert(
  step: Extract<PlanStep, { op: "insert" }>,
  index: number,
  ctx: PlanValidationContext
): { readonly step: ValidatedInsert } | { readonly refusal: PlanRefusal } {
  const target = step.target;

  if (step.literal !== undefined) {
    // THE REFUSAL THAT MATTERS. This runs before any binding, any rehydration and any action. The
    // verdict is privacy's; this layer only reports it, and reports it without the text.
    const verdict = checkLiteral(step.literal, {
      vault: ctx.vault,
      targetIsRedacted: ctx.redactedTargets.has(target),
      ...(ctx.today ? { today: ctx.today } : {}),
    });
    if (verdict.allowed) {
      // All three checks passed: no redaction token on the target, nothing PII-shaped, and the
      // vault does not hold it. The contract permits this and says so in terms — refusing it would
      // reintroduce the v3.0 defect where a schema cannot express "search for Chandrayaan-3".
      return { step: { op: "insert", source: "literal", index, target, needsHuman: false } };
    }
    return {
      refusal: {
        cause: "LITERAL_REFUSED",
        at: index,
        target,
        literalCause: verdict.cause,
        literalSeverity: verdict.severity,
        literalFindings: verdict.findings,
        ...(verdict.piiClass ? { piiClass: verdict.piiClass } : {}),
        detail:
          verdict.severity === "LEAKAGE_EVENT"
            ? "the plan returned a value this client holds locally and never sent. Refused before rehydration and before any action; the value is not quoted."
            : "the plan put a literal where only a reference is admissible.",
      },
    };
  }

  if (step.ref === undefined) {
    return { refusal: { cause: "LITERAL_REFUSED", at: index, target, detail: "the step carries neither reference nor literal." } };
  }

  // ── the privacy authority ───────────────────────────────────────────────────────────────
  // Everything about whether this reference may become a value again is decided here, by privacy,
  // and this layer neither pre-empts nor second-guesses it.
  const decision = bind({ ref: step.ref, targetId: target, viewId: ctx.view.viewId }, ctx);
  const descriptor = ctx.vault.describe(step.ref);

  if (decision.decision === "REFUSE") {
    return {
      refusal: {
        cause: "PRIVACY_REFUSED",
        at: index,
        target,
        bindCause: decision.cause,
        ...(descriptor ? { piiClass: descriptor.piiClass } : {}),
        detail: `the privacy layer refused this reference (${decision.cause}).`,
      },
    };
  }

  if (!descriptor) {
    // bind did not refuse, so the reference is known to the vault; this cannot happen, and if it
    // does the plan does not proceed on a guess.
    return { refusal: { cause: "PRIVACY_REFUSED", at: index, target, detail: "the reference lost its descriptor between checks." } };
  }

  return {
    step: {
      op: "insert",
      source: "reference",
      index,
      target,
      ref: step.ref,
      piiClass: descriptor.piiClass,
      binding: decision,
      needsHuman: decision.decision !== "BIND_OK",
    },
  };
}
