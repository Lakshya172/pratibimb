/**
 * WHERE THE PAGE'S VALUES ARE — and everything that has to happen there.
 *
 * The vault is a live object with private fields. Anything that reads a value has to be in its
 * realm, which makes the question "where does the vault live?" the same question as "where do these
 * three operations run?":
 *
 *   1. **SANITIZE** — read the values, classify them, tokenise them, keep the originals.
 *   2. **ASK** — "do you hold this string?", for a literal a reasoner sent back.
 *   3. **RELEASE** — recover one value, once, and put it into one field.
 *
 * Everything else the orchestrator does — binding, validation, the grant, the permit, the click,
 * the verification — is answerable from descriptors, references and geometry, and none of it needs
 * to be near a value. That asymmetry is what this interface is for.
 *
 * WHEN IT IS THE SAME REALM, which is the demo and every unit test, `createLocalPrivacyBoundary`
 * runs exactly the code `runTask` used to run inline, against a vault it owns. Nothing changes.
 *
 * WHEN IT IS NOT, which is the MV3 extension, the boundary is implemented over a message channel to
 * the content script's isolated world, where the page's values are read and never leave. What
 * crosses is what these signatures allow: a value-free graph down, a verified handoff and
 * descriptors up, a class and a boolean for each question asked. There is no method here that
 * returns a value, which is the property the whole arrangement rests on.
 *
 * THE ORCHESTRATOR STILL DECIDES. It is not delegating authority — a boundary can refuse, and every
 * refusal it reports is one of `packages/privacy`'s own. It cannot grant anything the orchestrator
 * did not ask for, and asking is gated by everything upstream of `releaseInto`.
 */
import { type ElementGraph } from "@pratibimb/perception";
import {
  classifyField,
  fingerprintOf,
  rehydrate,
  sanitize,
  type AsyncLiteralOracle,
  type BindView,
  type LedgerEntry,
  type ObservedField,
  type PiiClass,
  type RefDescriptor,
  type SanitizeReport,
  type UseGrant,
  type VaultFacade,
  type VerifiedHandoff,
  type ViewField,
} from "@pratibimb/privacy";
import { redactPlan, type Plan, type SafePlan } from "@pratibimb/plan";

import { type Observation } from "./ports.js";

/** What the boundary is asked to sanitize. Carries a value-free graph; the values are its own. */
export interface SanitizeAsk {
  readonly graph: ElementGraph;
  readonly goal: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly viewId: string;
  readonly origin: string;
  readonly documentId: string;
  readonly viewport: Observation["viewport"];
  readonly now: number;
  readonly today?: Date;
  readonly destination: string;
}

/**
 * Everything the boundary is willing to hand back, and nothing else.
 *
 * The handoff is the one privacy verified; the view carries classes, origins and fingerprints; the
 * descriptors say what each reference stands for. No member of this type can hold a page value —
 * that is a property of the types, checkable by reading them.
 */
export type SanitizeAnswer =
  | {
      readonly ok: true;
      readonly handoff: VerifiedHandoff;
      readonly ledgerEntry: LedgerEntry;
      readonly view: BindView;
      readonly descriptors: readonly RefDescriptor[];
      readonly report: SanitizeReport;
    }
  | { readonly ok: false; readonly refused: string };

/** One restoration: this reference, into this field, under these grants, now. */
export interface ReleaseAsk {
  readonly ref: string;
  readonly target: string;
  readonly viewId: string;
  readonly sessionId: string;
  readonly currentDocumentId: string;
  readonly classOriginGrants: readonly string[];
  readonly useGrants: readonly UseGrant[];
  readonly now: number;
}

export type ReleaseAnswer =
  | { readonly ok: true; readonly ref: string; readonly piiClass: PiiClass; readonly inserted: boolean }
  /** `packages/privacy`'s own refusal, flattened to its cause. Never a value, never a quote. */
  | { readonly ok: false; readonly cause: string };

export interface PrivacyBoundary {
  /**
   * Descriptors and pre-established literal answers, for the stages that must run synchronously:
   * `redactPlan` and `validatePlan`. Every literal they will ask about is established by `inspect`
   * first, so this never has to guess.
   */
  readonly reader: VaultFacade;
  /**
   * The same question, for the egress guard, which cannot know the bytes it is about to send until
   * it has built them and so cannot have an answer arranged in advance.
   */
  readonly oracle: AsyncLiteralOracle;

  sanitize(ask: SanitizeAsk): Promise<SanitizeAnswer>;
  /** Establish the vault's answer for each of these literals, before anything reads `reader`. */
  inspect(literals: readonly string[]): Promise<void>;
  /** The projection of a plan that may be recorded: a held literal becomes a class marker. */
  redact(plan: Plan): SafePlan;
  releaseInto(ask: ReleaseAsk): Promise<ReleaseAnswer>;
}

/**
 * The view the binder and the validator both read.
 *
 * **What a field accepts is decided by `classifyField`, privacy's own D1 channel** — never by
 * anything here. It lives with the values because that is what it reads: the observed field, its
 * autocomplete attribute, its input type, its label. Graph nodes that are not form fields carry no
 * value and accept nothing, so they are `UNKNOWN` and a reference can never bind into one.
 */
export function viewFrom(
  graph: ElementGraph,
  fields: readonly ObservedField[],
  viewId: string,
  documentId: string,
  origin: string
): BindView {
  const observedBySelector = new Map(fields.map((field) => [field.id, field]));
  const built = new Map<string, ViewField>();
  for (const node of graph.nodes) {
    const selector = node.domRef.selector;
    const observed = observedBySelector.get(selector);
    built.set(selector, {
      accepts: observed ? classifyField(observed) : "UNKNOWN",
      origin,
      fingerprint: fingerprintOf(selector, node.role, node.name),
    });
  }
  return { viewId, documentId, fields: built };
}

/** Where the values come from when the boundary is in this realm. */
export interface LocalBoundaryDeps {
  /** The values, read locally, for one observation. */
  fieldsFor(ask: SanitizeAsk): readonly ObservedField[] | Promise<readonly ObservedField[]>;
  /** Put one value into one field, locally. Not an agent action; see `ClientPorts.insert`. */
  insert(target: string, value: string): Promise<boolean>;
}

/**
 * The boundary, in the caller's own realm.
 *
 * This is the code `runTask` used to run inline, moved behind the interface and otherwise untouched,
 * so a client that holds its own values behaves exactly as it did.
 */
export function createLocalPrivacyBoundary(deps: LocalBoundaryDeps): PrivacyBoundary {
  // Assigned by `sanitize`; before that there is nothing to read and nothing to release.
  let vault: import("@pratibimb/privacy").Vault | null = null;
  let view: BindView | null = null;

  const theVault = (): import("@pratibimb/privacy").Vault => {
    if (vault === null) throw new Error("privacy boundary: nothing has been sanitized yet.");
    return vault;
  };

  return {
    get reader(): VaultFacade {
      return theVault();
    },
    get oracle(): AsyncLiteralOracle {
      return theVault();
    },

    async sanitize(ask) {
      const fields = await deps.fieldsFor(ask);
      const outcome = await sanitize(
        ask.graph,
        ask.goal,
        {
          sessionId: ask.sessionId,
          requestId: ask.requestId,
          origin: ask.origin,
          viewport: ask.viewport,
          now: ask.now,
          ...(ask.today ? { today: ask.today } : {}),
          destination: ask.destination,
        },
        { fields }
      );
      if (!outcome.ok) return { ok: false, refused: outcome.refused };
      vault = outcome.vault;
      view = viewFrom(ask.graph, fields, ask.viewId, ask.documentId, ask.origin);
      const descriptors = outcome.handoff.redactions
        .map((redaction) => outcome.vault.describe(redaction.token))
        .filter((descriptor): descriptor is RefDescriptor => descriptor !== null);
      return {
        ok: true,
        handoff: outcome.handoff,
        ledgerEntry: outcome.ledgerEntry,
        view,
        descriptors,
        report: outcome.report,
      };
    },

    // Nothing to establish: the answers are in this realm already.
    // eslint-disable-next-line @typescript-eslint/require-await
    async inspect() {},

    redact: (plan) => redactPlan(plan, theVault()),

    async releaseInto(ask) {
      if (view === null) return { ok: false, cause: "NO_VIEW" };
      const outcome = rehydrate(
        { ref: ask.ref, targetId: ask.target, viewId: ask.viewId },
        {
          vault: theVault(),
          sessionId: ask.sessionId,
          view,
          currentDocumentId: ask.currentDocumentId,
          classOriginGrants: new Set(ask.classOriginGrants),
          useGrants: ask.useGrants,
          now: ask.now,
        }
      );
      if (!outcome.ok) {
        return {
          ok: false,
          cause: outcome.decision.decision === "REFUSE" ? outcome.decision.cause : outcome.decision.decision,
        };
      }
      const inserted = await deps.insert(ask.target, outcome.value);
      return { ok: true, ref: outcome.ref, piiClass: outcome.piiClass, inserted };
    },
  };
}
