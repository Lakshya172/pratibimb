/**
 * The deterministic reasoner — a stand-in for a model, and a way to make the client prove itself.
 *
 * It plans ONE goal, for ONE page shape, and it is not a planner in any general sense. Its job is to
 * be the untrusted side of the boundary while the security architecture is built, so that replacing
 * it with a small open-weight text model on loopback is a change of one `ReasonerClient` and nothing
 * else.
 *
 * HOW IT PLANS, and the constraint is the interesting part: it sees only what the server sees. It
 * reads the handoff's redaction spans to find which reference stands for the phone number and which
 * element carries it, and the element list to find the empty field that wants one and the button that
 * submits. It cannot read a value, because there is no value in what it was given.
 *
 * THE REFUSAL MODE, AND WHY THE LITERAL HAS TO BE INJECTED. `mode: "literal-echo"` makes the reasoner
 * return the phone number itself instead of the reference — the case the client boundary exists to
 * catch. It cannot derive that number from the handoff; nothing in the handoff contains it. So the
 * caller supplies it, and **that is the point**: the fact that a hostile reasoner must be handed the
 * secret by the harness is itself the evidence that the sanitizer did its job. A simulated leak is
 * the only kind available when there is nothing to leak.
 *
 * It is still a reasoner like any other. The literal travels the same `propose` → parse → validate
 * path as the good plan, with no branch anywhere downstream that knows which mode produced it.
 */
import { type ReasonerClient, type ReasonerRequest, type ReasonerTransport } from "./contract.js";

export type ReasonerMode =
  /** Propose the opaque reference, as a well-behaved reasoner would. */
  | "reference"
  /** Propose the raw value instead. Simulates a compromised or careless reasoner. */
  | "literal-echo";

export interface DeterministicOptions {
  readonly mode?: ReasonerMode;
  /**
   * The value a `literal-echo` run returns. Required for that mode and refused otherwise, because
   * a reasoner that could obtain it from the handoff would mean the handoff had leaked it.
   */
  readonly literal?: string;
  /** Emit something that is not a plan at all, to exercise the parser. */
  readonly malformed?: "not-an-object" | "missing-steps" | "unknown-op" | "empty-steps";
  readonly transport?: ReasonerTransport;
  readonly name?: string;
}

/** The field role this planner is looking for: an empty control that accepts a phone number. */
const wantsPhone = (element: { readonly role: string; readonly name: string }): boolean =>
  element.role === "textbox" && /mobile|phone/i.test(element.name) && /confirm|re-?enter|repeat/i.test(element.name);

const isSubmit = (element: { readonly role: string; readonly name: string }): boolean =>
  element.role === "button" && /submit|apply/i.test(element.name);

/**
 * Build the deterministic reasoner.
 *
 * Returns a `ReasonerClient`, so the orchestrator cannot tell it apart from a model behind loopback.
 */
export function deterministicReasoner(options: DeterministicOptions = {}): ReasonerClient {
  const mode: ReasonerMode = options.mode ?? "reference";
  return {
    name: options.name ?? `deterministic:${mode}${options.malformed ? `:${options.malformed}` : ""}`,
    transport: options.transport ?? "IN_PROCESS",
    // eslint-disable-next-line @typescript-eslint/require-await
    async propose(request: ReasonerRequest): Promise<unknown> {
      if (options.malformed === "not-an-object") return "here is your plan";
      if (options.malformed === "missing-steps") return { planVersion: "1", goal: request.goal };
      if (options.malformed === "empty-steps") return { planVersion: "1", steps: [] };

      const elements = request.handoff.elements;
      const target = elements.find(wantsPhone);
      const submit = elements.find(isSubmit);
      const phoneSpan = request.handoff.redactions.find(
        (redaction) => redaction.class === "PHONE" && redaction.method === "token_reference"
      );

      if (!target || !submit || !phoneSpan) {
        // A reasoner that cannot see what it needs says so, rather than guessing a selector.
        return { planVersion: "1", steps: [], note: "the page does not carry the fields this goal needs" };
      }

      if (options.malformed === "unknown-op") {
        return {
          planVersion: "1",
          steps: [{ op: "navigate", target: submit.id }],
          provenance: { requestId: request.requestId, sessionId: request.sessionId, viewId: request.handoff.request.requestId },
        };
      }

      const insert =
        mode === "literal-echo"
          ? { op: "insert", target: target.id, literal: options.literal ?? "" }
          : { op: "insert", target: target.id, ref: phoneSpan.token };

      return {
        planVersion: "1",
        goal: request.goal,
        steps: [insert, { op: "click", target: submit.id }],
        provenance: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          origin: request.origin,
          viewId: request.handoff.request.requestId,
        },
      };
    },
  };
}
