/**
 * A plan that is safe to keep and safe to show.
 *
 * THE PROBLEM THIS SOLVES, found by a test rather than by reasoning about it. When the reasoner
 * echoes a secret, the client genuinely receives those bytes — that is what being attacked looks
 * like. The refusal never quotes the value, but a run record that stored the raw response, and a
 * Planning View that rendered "the received plan", would both put the leaked value straight back into
 * the client's own surfaces: a log, a screenshot, a demo on a projector.
 *
 * So the client keeps a projection instead of the bytes. A literal is replaced by what it *was* —
 * `⟨literal:PHONE⟩` when the vault recognises it, `⟨literal⟩` when it does not — using the vault's own
 * `holdsLiteral`, which answers with a class and never with the text. The shape of the plan, the
 * operations, the targets and the references all survive; only the one field that could carry a
 * secret does not.
 *
 * References are **not** redacted. `<PII:PHONE:1>` is an opaque token that stands for a value without
 * revealing anything about it — showing it is the entire point of the demo.
 */
import { type PiiClass, type Vault } from "@pratibimb/privacy";

import { type Plan } from "./schema.js";

export interface SafeInsertStep {
  readonly op: "insert";
  readonly target: string;
  readonly ref?: string;
  /** A marker, never the text. Present only when the plan carried a literal. */
  readonly literalMarker?: string;
  /** The class the vault recognised the literal as, when it recognised one. */
  readonly literalClass?: PiiClass;
}

export interface SafeClickStep {
  readonly op: "click";
  readonly target: string;
}

export type SafeStep = SafeInsertStep | SafeClickStep;

export interface SafePlan {
  readonly planVersion: "1";
  readonly steps: readonly SafeStep[];
  readonly provenance: Plan["provenance"];
  readonly goal?: string;
}

/** What a literal is replaced by. Mirrors the sanitizer's `⟨redacted:CLASS⟩` marker. */
export const literalMarker = (piiClass: PiiClass | null): string =>
  piiClass === null ? "⟨literal⟩" : `⟨literal:${piiClass}⟩`;

/**
 * Project a plan into something the client may keep, log and display.
 *
 * Ask the vault, not a detector: `holdsLiteral` compares against the values actually held, exactly
 * and under normalisation, and returns a class. A literal the vault does not recognise is still
 * masked — the client has no reason to retain reasoner-supplied text either way.
 */
export function redactPlan(plan: Plan, vault: Vault): SafePlan {
  return {
    planVersion: plan.planVersion,
    provenance: plan.provenance,
    ...(plan.goal === undefined ? {} : { goal: plan.goal }),
    steps: plan.steps.map((step): SafeStep => {
      if (step.op === "click") return { op: "click", target: step.target };
      if (step.literal !== undefined) {
        const held = vault.holdsLiteral(step.literal);
        return {
          op: "insert",
          target: step.target,
          literalMarker: literalMarker(held.held ? held.piiClass : null),
          ...(held.held ? { literalClass: held.piiClass } : {}),
        };
      }
      return { op: "insert", target: step.target, ...(step.ref === undefined ? {} : { ref: step.ref }) };
    }),
  };
}
