/**
 * The three checks on a literal — `docs/architecture/action-schema.md`, "The three checks on a
 * literal", and INV-09 / INV-10.
 *
 * A plan may legitimately carry literals: *search for Chandrayaan-3, select Punjab, enter 2026*. A
 * schema that cannot express a non-sensitive literal cannot drive a browser. So literals are allowed
 * and then checked, and the checks are where the privacy claim is actually enforced:
 *
 * 1. **Target.** If the target field carries a redaction token, a literal is rejected outright,
 *    whatever it contains. A sensitive field is filled by reference or not at all (INV-09).
 * 2. **Shape.** The literal is run through the deterministic detectors. Anything PII-shaped is
 *    rejected and recorded as a **server defect** — the server should have used a reference.
 * 3. **Vault.** The literal is compared, exactly and normalised, against every value the vault
 *    holds. **A match is not a defect. It is a leak** (INV-10): the server has reproduced a secret it
 *    was never sent, so something upstream failed.
 *
 * WHY ALL THREE RUN, AND WHY SEVERITY DECIDES WHAT IS REPORTED. The demo's refusal case — a
 * reasoner returning the phone number instead of `<PII:PHONE:1>` — trips check 1 *and* check 3, and
 * the frozen contract is explicit that the two "must never be logged as the same event". Reporting
 * whichever check happened to run first would file a leak as a plan defect. So every check runs, and
 * the reported finding is the most severe: a vault match outranks a redacted-field violation, which
 * outranks a PII-shaped literal.
 *
 * NO REFUSAL QUOTES THE LITERAL. The cause, the severity and the class are returned; the text never
 * is — not in the result, not in a message, not in a thrown error (INV-21).
 */
import { type PiiClass } from "./classes.js";
import { classifyValue } from "./classify.js";
import { type Vault } from "./vault.js";

export type LiteralCause = "VAULT_LITERAL_ECHO" | "LITERAL_AT_REDACTED_FIELD" | "PII_SHAPED_LITERAL";

/**
 * What kind of event this is, for the ledger.
 *
 * `LEAKAGE_EVENT` counts as a residual-leakage failure of the run. `PLAN_DEFECT` is a badly formed
 * plan, which is a server quality problem and not a privacy failure.
 */
export type LiteralSeverity = "LEAKAGE_EVENT" | "PLAN_DEFECT";

export interface LiteralFinding {
  readonly cause: LiteralCause;
  readonly severity: LiteralSeverity;
  /** Present when a class was established. Metadata about the kind, never the value. */
  readonly piiClass?: PiiClass;
}

export type LiteralVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      /** The most severe finding. */
      readonly cause: LiteralCause;
      readonly severity: LiteralSeverity;
      readonly piiClass?: PiiClass;
      /** Every check that fired, so a panel can show the whole picture. */
      readonly findings: readonly LiteralFinding[];
    };

export interface LiteralContext {
  readonly vault: Vault;
  /** Does the target field carry a redaction token in the handoff that was sent? */
  readonly targetIsRedacted: boolean;
  readonly today?: Date;
}

const SEVERITY_ORDER: Readonly<Record<LiteralCause, number>> = {
  VAULT_LITERAL_ECHO: 3,
  LITERAL_AT_REDACTED_FIELD: 2,
  PII_SHAPED_LITERAL: 1,
};

/**
 * Check a literal a plan wants to type or send.
 *
 * Returns `allowed: true` only when all three checks pass. This runs **before** rehydration, before
 * any action, and before anything is written to a page.
 */
export function checkLiteral(literal: string, ctx: LiteralContext): LiteralVerdict {
  const findings: LiteralFinding[] = [];

  // 3 — the vault check runs first so a leak is always recorded as a leak.
  const held = ctx.vault.holdsLiteral(literal);
  if (held.held) {
    findings.push({ cause: "VAULT_LITERAL_ECHO", severity: "LEAKAGE_EVENT", piiClass: held.piiClass });
  }

  // 1 — the target check.
  if (ctx.targetIsRedacted) {
    findings.push({ cause: "LITERAL_AT_REDACTED_FIELD", severity: "PLAN_DEFECT" });
  }

  // 2 — the shape check.
  const shapeClass = classifyValue(literal, ctx.today ?? new Date());
  if (shapeClass !== "UNKNOWN") {
    findings.push({ cause: "PII_SHAPED_LITERAL", severity: "PLAN_DEFECT", piiClass: shapeClass });
  }

  if (findings.length === 0) return { allowed: true };

  const worst = findings.reduce((a, b) => (SEVERITY_ORDER[b.cause] > SEVERITY_ORDER[a.cause] ? b : a));
  return {
    allowed: false,
    cause: worst.cause,
    severity: worst.severity,
    ...(worst.piiClass ? { piiClass: worst.piiClass } : {}),
    findings,
  };
}
