/**
 * RE-HYDRATION — the signature mechanism, and the only path from a reference back to a value.
 *
 * `docs/architecture/action-schema.md` describes the sequence: the token crosses, the value does
 * not; the server plans in placeholders; the client validates; the value is restored locally. This
 * file is step 5 and step 6 of that sequence — everything the client checks before a value is
 * recovered, and the recovery itself.
 *
 * THE ORDER IS THE DESIGN. It is reconstructed rule-for-rule from the E2 class-binding experiment
 * (W2, PASS: 34/34 binding outcomes exact, 0 adversarial accepts, 0 legitimate refusals), whose
 * binder ran these checks in this sequence:
 *
 *    session and vault → stale view → document changed → unknown target → unknown token →
 *    CRITICAL token → OTP field → ambiguous field → class → origin → consumed →
 *    class×origin grant → per-use human grant
 *
 * Order matters because the causes are evidence. A stale view checked after the class check would
 * report "class mismatch" for a page that simply moved on, and a ledger full of misattributed causes
 * is worse than no ledger.
 *
 * A REFERENCE ALONE AUTHORISES NOTHING. Holding `<PII:PHONE:1>` proves only that something was
 * tokenised. To spend it a caller must also present the view it was planned against, the live
 * document, a target whose class matches, the same origin, an unspent reference, a class×origin
 * grant, and — for SENSITIVE values — a human grant for this exact reference, field and origin.
 *
 * TWO ANSWERS THAT ARE NOT REFUSALS. `NEEDS_USER` and `NEEDS_HUMAN_GRANT` mean "a human may permit
 * this, and has not yet". Nothing here can produce that permission; there is no automatic grant, no
 * blanket grant, and no persistence.
 */
import { TIER_OF, type FieldClass, type PiiClass } from "./classes.js";
import { REVEAL } from "./internal.js";
import { parseToken } from "./tokens.js";
import { type Vault } from "./vault.js";

export type BindCause =
  | "VAULT_DESTROYED"
  | "SESSION_MISMATCH"
  | "STALE_VIEW"
  | "STALE_BINDING"
  | "UNKNOWN_TARGET"
  | "UNKNOWN_TOKEN"
  | "CRITICAL_NEVER_AGENT_TYPED"
  | "CRITICAL_FIELD"
  | "AMBIGUOUS_FIELD"
  | "CLASS_MISMATCH"
  | "ORIGIN_MISMATCH"
  | "CONSUMED"
  | "CLASS_ORIGIN_GRANT_REQUIRED";

export type BindDecision =
  | { readonly decision: "BIND_OK" }
  | { readonly decision: "REFUSE"; readonly cause: BindCause }
  | { readonly decision: "NEEDS_USER"; readonly cause: BindCause }
  | { readonly decision: "NEEDS_HUMAN_GRANT" };

/** What the plan asks for: this reference, into this target, as planned against this view. */
export interface BindStep {
  readonly ref: string;
  readonly targetId: string;
  readonly viewId: string;
}

export interface ViewField {
  /** What the field was classified as. `UNKNOWN` is never bound to. */
  readonly accepts: FieldClass;
  readonly origin: string;
  /** Selector, role and name — the identity VALIDATE and HIT-TEST compare. */
  readonly fingerprint: string;
}

export interface BindView {
  readonly viewId: string;
  /** The document the view was observed in. A reload or navigation changes it. */
  readonly documentId: string;
  readonly fields: ReadonlyMap<string, ViewField>;
}

/**
 * One human decision, for one value, once.
 *
 * Every field is part of what was authorised: a grant for this reference into *that* field does not
 * authorise it into another, and a grant made on one origin does not travel. `used` makes it
 * one-shot, `expiresAt` makes it temporary, and nothing in this package writes a grant to storage —
 * it lives in the caller's memory for the life of the session and no longer.
 */
export interface UseGrant {
  readonly ref: string;
  readonly piiClass: PiiClass;
  /** The field fingerprint the human saw when they agreed. */
  readonly fingerprint: string;
  readonly origin: string;
  readonly sessionId: string;
  /** Why the value is being used, in the words shown to the human. */
  readonly purpose: string;
  /** What the value is being used for: the action the grant covers. */
  readonly actionContext: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
  used: boolean;
}

export interface BindContext {
  readonly vault: Vault;
  readonly sessionId: string;
  readonly view: BindView;
  /** The document the page is in *now*. Compared against the view's. */
  readonly currentDocumentId: string;
  /** `CLASS|origin` pairs the user has allowed for this session. */
  readonly classOriginGrants: ReadonlySet<string>;
  readonly useGrants: readonly UseGrant[];
  readonly now: number;
}

const refuse = (cause: BindCause): BindDecision => ({ decision: "REFUSE", cause });
const needsUser = (cause: BindCause): BindDecision => ({ decision: "NEEDS_USER", cause });

/** The class×origin grant key. One per class per page, never "all PII". */
export const classOriginKey = (piiClass: PiiClass, origin: string): string => `${piiClass}|${origin}`;

/**
 * May this reference go into this field, now?
 *
 * Ordered and fail-closed, with exactly one statement that returns `BIND_OK`.
 */
export function bind(step: BindStep, ctx: BindContext): BindDecision {
  if (ctx.vault.isDestroyed) return refuse("VAULT_DESTROYED");
  if (ctx.vault.sessionId !== ctx.sessionId) return refuse("SESSION_MISMATCH");

  if (step.viewId !== ctx.view.viewId) return refuse("STALE_VIEW");
  if (ctx.currentDocumentId !== ctx.view.documentId) return refuse("STALE_BINDING");

  const field = ctx.view.fields.get(step.targetId);
  if (!field) return refuse("UNKNOWN_TARGET");

  const parsed = parseToken(step.ref);
  if (!parsed) return refuse("UNKNOWN_TOKEN");
  const descriptor = ctx.vault.describe(step.ref);
  if (!descriptor) return refuse("UNKNOWN_TOKEN");

  // A CRITICAL reference cannot exist — issuance refuses one — so this is defence in depth against a
  // vault that was populated some other way.
  if (TIER_OF[descriptor.piiClass] === "CRITICAL") return needsUser("CRITICAL_NEVER_AGENT_TYPED");
  if (field.accepts === "OTP") return needsUser("CRITICAL_FIELD");
  if (field.accepts === "UNKNOWN" || field.accepts === "FREE_TEXT") return needsUser("AMBIGUOUS_FIELD");
  if (field.accepts !== descriptor.piiClass) return refuse("CLASS_MISMATCH");
  if (field.origin !== descriptor.origin) return refuse("ORIGIN_MISMATCH");
  if (descriptor.consumed) return refuse("CONSUMED");
  if (!ctx.classOriginGrants.has(classOriginKey(descriptor.piiClass, field.origin))) {
    return needsUser("CLASS_ORIGIN_GRANT_REQUIRED");
  }

  if (descriptor.tier === "SENSITIVE" && !findUseGrant(step.ref, field, ctx)) {
    return { decision: "NEEDS_HUMAN_GRANT" };
  }

  return { decision: "BIND_OK" };
}

/** The one grant that authorises this exact use, or `undefined`. */
export function findUseGrant(ref: string, field: ViewField, ctx: BindContext): UseGrant | undefined {
  return ctx.useGrants.find(
    (grant) =>
      grant.ref === ref &&
      grant.fingerprint === field.fingerprint &&
      grant.origin === field.origin &&
      grant.sessionId === ctx.sessionId &&
      !grant.used &&
      ctx.now < grant.expiresAt
  );
}

export type RehydrateOutcome =
  | { readonly ok: true; readonly value: string; readonly ref: string; readonly piiClass: PiiClass }
  | { readonly ok: false; readonly decision: BindDecision };

/**
 * Recover the value for a reference, if — and only if — binding permits it.
 *
 * On success the reference is **spent** and any grant used is marked used, before the value is
 * returned: a caller that drops the value on the floor has still consumed the authority, so a retry
 * needs a fresh plan and a fresh grant rather than a second attempt at the same one.
 *
 * The value is returned to the caller and to nobody else. It is not logged, not stored, not put in
 * an error, and not echoed in any refusal (INV-21).
 */
export function rehydrate(step: BindStep, ctx: BindContext): RehydrateOutcome {
  const decision = bind(step, ctx);
  if (decision.decision !== "BIND_OK") return { ok: false, decision };

  const descriptor = ctx.vault.describe(step.ref);
  if (!descriptor) return { ok: false, decision: refuse("UNKNOWN_TOKEN") };

  const field = ctx.view.fields.get(step.targetId);
  if (field && descriptor.tier === "SENSITIVE") {
    const grant = findUseGrant(step.ref, field, ctx);
    if (!grant) return { ok: false, decision: { decision: "NEEDS_HUMAN_GRANT" } };
    grant.used = true;
  }

  if (!ctx.vault.consume(step.ref)) return { ok: false, decision: refuse("CONSUMED") };

  const value = ctx.vault[REVEAL](step.ref);
  if (value === null) return { ok: false, decision: refuse("UNKNOWN_TOKEN") };
  return { ok: true, value, ref: step.ref, piiClass: descriptor.piiClass };
}
