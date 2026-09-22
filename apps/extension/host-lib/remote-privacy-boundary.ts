/**
 * THE PRIVACY BOUNDARY AS THE CORE REALM SEES IT — a `PrivacyBoundary` over a message channel.
 *
 * The offscreen document runs the orchestrator, the reasoner and the egress guard. The page's
 * values are in the content script's isolated world and stay there. This is the adapter between
 * those two facts, and it is an adapter: it classifies nothing, holds no vault, and decides nothing
 * that `packages/privacy` does not decide.
 *
 * WHAT IT ASSEMBLES, AND WHY THAT IS NOT A SECOND SANITIZER. `sanitize()` is the composition of
 * `classifyObservation` → `buildHandoffDraft` → `verifyHandoff` → ledger. The page realm runs the
 * first, because it needs the values. This runs the other three, in that order, on this side —
 * because `verifyHandoff`'s first check is that a draft came from the sanitizer, and a handoff
 * shipped in as data would have lost that. Assembling here from value-free parts keeps the check
 * real: **the realm that will send the bytes is the realm that verified them.**
 *
 * THE ONE ROUND TRIP THAT CARRIES TEXT is a question for the vault, and it does not travel as a
 * message. A literal a reasoner returned may *be* the page's value — that is exactly the case the
 * check exists for — so it goes through a one-shot capability: the worker carries a nonce, the page
 * realm collects the text as a reply, answers with a class and a boolean, and the worker sees
 * neither the question nor anything but the verdict.
 *
 * NOTHING HERE CAN RELEASE A VALUE. `releaseInto` sends a reference and a target; the value is
 * already in the realm it is going to. Read the return types: there is no member anywhere in this
 * file that a value could occupy.
 */
import {
  buildHandoffDraft,
  createVaultView,
  verifyHandoff,
  createLedger,
  type AsyncLiteralOracle,
  type BindView,
  type EgressLedger,
  type HeldLiteral,
  type VaultView,
} from "@pratibimb/privacy";
import { redactPlan, type Plan, type SafePlan } from "@pratibimb/plan";
import {
  type PrivacyBoundary,
  type ReleaseAnswer,
  type ReleaseAsk,
  type SanitizeAnswer,
  type SanitizeAsk,
} from "@pratibimb/orchestrator";
import { type TransportBinding } from "@pratibimb/extension-transport";

import {
  encodeGraph,
  QUESTION_TARGET,
  type BoundaryReply,
  type BoundaryRequest,
  type CapabilityPayload,
} from "./boundary-protocol";
import { type ReleaseAuthority } from "./value-release";

/** What the run can say about the boundary afterwards. Counts and codes; never text. */
export interface RemoteBoundaryReport {
  classifications: number;
  fieldsSeenByThePageRealm: number;
  referencesIssued: number;
  /** Questions asked of the vault, and how many texts they covered. */
  questions: number;
  textsAsked: number;
  capabilitiesArmed: number;
  releases: number;
  writes: number;
  readonly refusals: string[];
}

export interface RemoteBoundaryDeps {
  readonly binding: TransportBinding;
  /** Carry one request to the page realm and bring back its reply. Never carries a value. */
  send(request: BoundaryRequest): Promise<BoundaryReply>;
  /** The realm's one capability authority — the same one the collection handler redeems from. */
  readonly capabilities: ReleaseAuthority<CapabilityPayload>;
  readonly capabilityTtlMs: number;
  readonly ledger?: EgressLedger;
}

export interface RemotePrivacyBoundary extends PrivacyBoundary {
  readonly report: RemoteBoundaryReport;
  /** End the run in the page realm: its vault is destroyed there. */
  forget(): Promise<number>;
}

export function createRemotePrivacyBoundary(deps: RemoteBoundaryDeps): RemotePrivacyBoundary {
  const report: RemoteBoundaryReport = {
    classifications: 0,
    fieldsSeenByThePageRealm: 0,
    referencesIssued: 0,
    questions: 0,
    textsAsked: 0,
    capabilitiesArmed: 0,
    releases: 0,
    writes: 0,
    refusals: [],
  };

  const ledger = deps.ledger ?? createLedger();
  const document = {
    tabId: deps.binding.document.tabId,
    frameId: deps.binding.document.frameId,
    documentId: deps.binding.document.documentId,
  };

  let view: VaultView | null = null;
  let bindView: BindView | null = null;

  const theView = (): VaultView => {
    if (view === null) throw new Error("privacy boundary: nothing has been classified yet.");
    return view;
  };

  /**
   * Hand something to the page realm through a capability it must come and collect.
   *
   * The worker carries the nonce and the field name. Everything the capability actually holds is
   * handed over as a reply to the page realm's own request, which the worker does not see.
   */
  const throughCapability = async (target: string, payload: CapabilityPayload): Promise<BoundaryReply> => {
    const nonce = deps.capabilities.arm(document, target, payload, deps.capabilityTtlMs);
    report.capabilitiesArmed += 1;
    try {
      return await deps.send({ kind: "CAPABILITY", nonce, target });
    } finally {
      // Nothing outstanding survives the operation that created it.
      deps.capabilities.revokeAll();
    }
  };

  /** Ask the realm that holds the values whether it recognises any of these. */
  const askVault = async (texts: readonly string[]): Promise<readonly HeldLiteral[]> => {
    if (texts.length === 0) return [];
    report.questions += 1;
    report.textsAsked += texts.length;
    const reply = await throughCapability(QUESTION_TARGET, { kind: "QUESTION", texts });
    if (!reply.ok || reply.kind !== "ANSWERED") {
      const refused = reply.ok ? `UNEXPECTED_${reply.kind}` : reply.refused;
      report.refusals.push(refused);
      // A question that could not be answered is not a "no". Refusing here is what stops a leak
      // check from passing because the channel was broken.
      throw new Error(`privacy boundary: the page realm could not answer (${refused}).`);
    }
    if (reply.answers.length !== texts.length) {
      throw new Error("privacy boundary: the page realm answered a different number of questions.");
    }
    return reply.answers;
  };

  const oracle: AsyncLiteralOracle = {
    holdsLiteral: async (literal) => (await askVault([literal]))[0]!,
  };

  return {
    report,

    get reader() {
      return theView();
    },
    get oracle() {
      return oracle;
    },

    async sanitize(ask: SanitizeAsk): Promise<SanitizeAnswer> {
      const reply = await deps.send({
        kind: "CLASSIFY",
        ask: {
          graph: encodeGraph(ask.graph),
          sessionId: ask.sessionId,
          requestId: ask.requestId,
          viewId: ask.viewId,
          origin: ask.origin,
          documentId: ask.documentId,
          viewport: ask.viewport,
          now: ask.now,
        },
      });
      if (!reply.ok) {
        report.refusals.push(reply.refused);
        return { ok: false, refused: reply.refused };
      }
      if (reply.kind !== "CLASSIFIED") return { ok: false, refused: `UNEXPECTED_${reply.kind}` };

      const { classified } = reply;
      report.classifications += 1;
      report.fieldsSeenByThePageRealm = classified.fieldsSeen;
      report.referencesIssued = classified.descriptors.length;

      view = createVaultView({
        sessionId: ask.sessionId,
        origin: ask.origin,
        descriptors: classified.descriptors,
      });
      bindView = {
        viewId: classified.view.viewId,
        documentId: classified.view.documentId,
        fields: new Map(classified.view.fields),
      };

      // Assemble here, verify here. `buildHandoffDraft` marks the draft in this realm, so the
      // verifier's provenance check is about something that actually happened on this side.
      const draft = buildHandoffDraft(
        { redactions: classified.redactions, elements: classified.elements },
        ask.goal,
        {
          sessionId: ask.sessionId,
          requestId: ask.requestId,
          origin: ask.origin,
          viewport: ask.viewport,
          now: ask.now,
        }
      );

      // The residual scan runs over exactly the bytes the verifier will serialize, and the answer
      // comes from the realm that holds the values. Establishing it first is what lets a
      // synchronous verifier ask a vault that is a message away.
      const bytes = JSON.stringify(draft);
      theView().learn(bytes, (await askVault([bytes]))[0]!);

      const verification = verifyHandoff(draft, {
        sessionId: ask.sessionId,
        requestId: ask.requestId,
        origin: ask.origin,
        vault: theView(),
      });
      if (!verification.verified) {
        report.refusals.push(`VERIFY_${verification.cause}`);
        return { ok: false, refused: `VERIFY_${verification.cause}` };
      }

      const recorded = await ledger.record(verification.handoff, { destination: ask.destination, at: ask.now });
      if (!recorded.recorded) return { ok: false, refused: "VERIFY_NOT_FROM_SANITIZER" };

      return {
        ok: true,
        handoff: verification.handoff,
        ledgerEntry: recorded.entry,
        view: bindView,
        descriptors: classified.descriptors,
        report: classified.report,
      };
    },

    async inspect(literals) {
      if (literals.length === 0) return;
      const answers = await askVault(literals);
      literals.forEach((literal, index) => theView().learn(literal, answers[index]!));
    },

    redact: (plan: Plan): SafePlan => redactPlan(plan, theView()),

    async releaseInto(ask: ReleaseAsk): Promise<ReleaseAnswer> {
      report.releases += 1;
      const reply = await throughCapability(ask.target, {
        kind: "RELEASE",
        ask: {
          ref: ask.ref,
          target: ask.target,
          viewId: ask.viewId,
          sessionId: ask.sessionId,
          currentDocumentId: ask.currentDocumentId,
          classOriginGrants: ask.classOriginGrants,
          useGrants: ask.useGrants,
          now: ask.now,
        },
      });
      if (!reply.ok) {
        report.refusals.push(reply.refused);
        return { ok: false, cause: reply.refused };
      }
      if (reply.kind !== "RELEASED") return { ok: false, cause: `UNEXPECTED_${reply.kind}` };
      if (reply.inserted) report.writes += 1;
      return { ok: true, ref: reply.ref, piiClass: reply.piiClass, inserted: reply.inserted };
    },

    async forget() {
      view?.destroy();
      view = null;
      bindView = null;
      const reply = await deps.send({ kind: "FORGET" });
      return reply.ok && reply.kind === "FORGOTTEN" ? reply.refs : 0;
    },
  };
}
