/**
 * THE PRIVACY BOUNDARY, WHERE THE PAGE'S VALUES ARE.
 *
 * This runs in the content script's isolated world — the same world that already reads the page for
 * the transport, and the only world in this extension that can hold a form value without it being
 * in a message the service worker receives. `chrome.runtime.sendMessage` is delivered to **every**
 * listening context; `background.ts` has a line whose only job is to say "not for me", and that line
 * is the proof. So the values stop here.
 *
 * WHAT IT OWNS, all of it from `packages/privacy`, none of it reimplemented:
 *   - the **vault** — one per run, memory only, destroyed when the run ends;
 *   - **classification** — `classifyObservation`, which is `sanitize()`'s first half;
 *   - **the leak oracle** — `holdsLiteral`, answered for text the core realm asks about;
 *   - **rehydration** — `rehydrate()`, every check in order, then one local write.
 *
 * WHAT IT DOES NOT OWN. It assembles no manifest, verifies no payload, sends nothing to a network,
 * parses no plan, mints no permit and clicks nothing. The core realm keeps all of that, and this
 * world stays a place values live rather than a place decisions are made. A content script is the
 * realm closest to the page and therefore the one to trust least with authority — it holds the
 * secrets precisely because it is the only realm that can, not because it has earned anything.
 *
 * THE OUTGOING SCAN IS THE ENFORCEMENT. Types say what may cross; `withoutHeldValues` proves what
 * did. Every reply this boundary sends is serialized and run past its own vault first, and a reply
 * the vault recognises is **not sent** — it becomes a refusal naming a class. That check uses the
 * same `holdsLiteral` the verifier and the egress guard use, so there is one answer to "is this a
 * secret?" in the whole system.
 */
import {
  classifyObservation,
  createVault,
  fingerprintOf,
  classifyField,
  rehydrate,
  type HeldLiteral,
  type ObservedField,
  type RefDescriptor,
  type Vault,
  type ViewField,
} from "@pratibimb/privacy";
import { type BindView } from "@pratibimb/privacy";

import {
  decodeGraph,
  type BoundaryReply,
  type WireClassified,
  type WireClassifyAsk,
  type WireReleaseAsk,
} from "./boundary-protocol";
import { nameOf, referenceOf } from "./page-surface-dom";

/** The form controls a page value can be in. The same set the demo's adapter reads. */
const VALUE_BEARING = "input";

/**
 * Read the page's own field values.
 *
 * Form controls only, and only what classification needs to decide what each one is: the value, the
 * label a person reads beside it, the input type, the autocomplete hint. Never an `href`, never the
 * inner text of an arbitrary node, never a screenshot. These never leave this world.
 */
export function observedFieldsFromDom(origin: string, root: Document = document): readonly ObservedField[] {
  return Array.from(root.querySelectorAll(VALUE_BEARING)).map((element) => {
    const input = element as HTMLInputElement;
    const autocomplete = input.getAttribute("autocomplete");
    return {
      id: referenceOf(input).selector,
      value: input.value,
      label: nameOf(input),
      type: input.getAttribute("type") ?? "",
      ...(autocomplete ? { autocomplete } : {}),
      origin,
    };
  });
}

/**
 * The view the binder and the validator read, built where the values are.
 *
 * `classifyField` is privacy's own D1 channel and the only thing that decides what a field accepts;
 * this assembles its answers against the graph the core realm supplied, so both realms are talking
 * about one reading of one page.
 */
function viewFromFields(
  graph: ReturnType<typeof decodeGraph>,
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

/**
 * Put one value into one field. The trusted client's restoration, **not an agent action**.
 *
 * No permit, no hit test, no pointer, nothing dispatched. Everything that authorises it happened
 * before: privacy released the reference, a human approved this value for this field on this page,
 * and a one-shot capability named this exact document. This function checks none of that and must
 * not — an authority here would be an authority in the realm closest to the page.
 */
function writeLocally(target: string, value: string, root: Document = document): { written: boolean; refused?: string } {
  const found = root.querySelector(target);
  if (found === null || found.tagName !== "INPUT") return { written: false, refused: "NO_INPUT" };
  const element = found as HTMLInputElement;
  if (element.disabled || element.readOnly) return { written: false, refused: "FIELD_NOT_WRITABLE" };
  element.value = value;
  // What any framework on the page needs in order to see the change. They carry no pointer and
  // click nothing.
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { written: element.value === value };
}

export interface PagePrivacyBoundary {
  classify(ask: WireClassifyAsk): BoundaryReply;
  /** Answer the vault's one question about some text. Classes and booleans, never the text. */
  answer(texts: readonly string[]): BoundaryReply;
  release(ask: WireReleaseAsk): BoundaryReply;
  /** End the run: destroy the vault. Unconditional and irreversible (INV-06). */
  forget(): BoundaryReply;
  /** Sizes only, for a status reply. Never contents. */
  state(): { readonly refs: number; readonly open: boolean };
}

export interface PageBoundaryDeps {
  readonly document?: Document;
  readonly now?: () => number;
}

export function createPagePrivacyBoundary(deps: PageBoundaryDeps = {}): PagePrivacyBoundary {
  const root = deps.document ?? document;
  const clock = deps.now ?? (() => Date.now());

  let vault: Vault | null = null;
  let view: BindView | null = null;

  /**
   * The last check before anything leaves this world.
   *
   * Serialize the reply and ask this run's own vault whether it recognises anything in it. A reply
   * that would carry a value is replaced by a refusal naming the class — so a mistake anywhere above
   * becomes a visible refusal rather than a quiet leak, and the check is the same `holdsLiteral` the
   * handoff verifier and the egress guard use.
   */
  const withoutHeldValues = (reply: BoundaryReply): BoundaryReply => {
    if (vault === null) return reply;
    let serialized: string;
    try {
      serialized = JSON.stringify(reply);
    } catch {
      return { ok: false, refused: "REPLY_NOT_SERIALIZABLE" };
    }
    const held = vault.holdsLiteral(serialized);
    return held.held ? { ok: false, refused: `REPLY_WITHHELD_${held.piiClass}` } : reply;
  };

  return {
    classify(ask) {
      vault?.destroy();
      const graph = decodeGraph(ask.graph);
      const fields = observedFieldsFromDom(ask.origin, root);
      const opened = createVault({ sessionId: ask.sessionId, origin: ask.origin, now: clock });
      const outcome = classifyObservation(
        graph,
        {
          sessionId: ask.sessionId,
          requestId: ask.requestId,
          origin: ask.origin,
          viewport: ask.viewport,
          now: ask.now,
          vault: opened,
        },
        { fields }
      );
      if (!outcome.ok) return { ok: false, refused: outcome.refused };
      vault = outcome.vault;
      view = viewFromFields(graph, fields, ask.viewId, ask.documentId, ask.origin);

      const descriptors = outcome.redactions
        .map((redaction) => outcome.vault.describe(redaction.token))
        .filter((descriptor): descriptor is RefDescriptor => descriptor !== null);

      const classified: WireClassified = {
        redactions: outcome.redactions,
        elements: outcome.elements,
        report: outcome.report,
        descriptors,
        view: { viewId: ask.viewId, documentId: ask.documentId, fields: [...view.fields] },
        fieldsSeen: fields.length,
      };
      return withoutHeldValues({ ok: true, kind: "CLASSIFIED", classified });
    },

    answer(texts) {
      if (vault === null) return { ok: false, refused: "NO_VAULT" };
      const answers: HeldLiteral[] = texts.map((text) => vault!.holdsLiteral(text));
      // Not passed through `withoutHeldValues`: the answers are classes and booleans by type, and a
      // scan would be comparing the vault against its own verdicts rather than against any text.
      return { ok: true, kind: "ANSWERED", answers };
    },

    release(ask) {
      if (vault === null || view === null) return { ok: false, refused: "NO_VAULT" };
      const outcome = rehydrate(
        { ref: ask.ref, targetId: ask.target, viewId: ask.viewId },
        {
          vault,
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
          refused: outcome.decision.decision === "REFUSE" ? outcome.decision.cause : outcome.decision.decision,
        };
      }
      const written = writeLocally(ask.target, outcome.value, root);
      return withoutHeldValues({
        ok: true,
        kind: "RELEASED",
        ref: outcome.ref,
        piiClass: outcome.piiClass,
        inserted: written.written,
      });
    },

    forget() {
      const refs = vault?.size ?? 0;
      vault?.destroy();
      vault = null;
      view = null;
      return { ok: true, kind: "FORGOTTEN", refs };
    },

    state: () => ({ refs: vault?.size ?? 0, open: vault !== null && !vault.isDestroyed }),
  };
}
