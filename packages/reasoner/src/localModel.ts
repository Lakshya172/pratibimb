/**
 * The local model, behind the same boundary everything else is behind.
 *
 * A small open-weight text model on loopback, reached over real HTTP. It is a **replaceable
 * reasoner and not a security authority**: `propose` returns `unknown`, exactly as the deterministic
 * planner's does, and nothing downstream can tell which produced a plan — nor should it, because
 * both are untrusted.
 *
 * **LOOPBACK IS NOT TRUST.** A response from 127.0.0.1 gets the same treatment as one from the
 * internet: parsed, validated, bound and confirmed before anything happens. The only thing loopback
 * buys is that no byte left the machine.
 *
 * WHAT THE MODEL IS SENT, and the list is the whole privacy claim: the goal, element ids, roles,
 * accessible names, which fields are empty, the reference tokens and their classes and shape hints.
 * All of it comes from the **verified handoff**. It is never handed a value, a vault, a grant, or
 * anything the sanitizer removed — and it does not have to be trusted not to leak one, because the
 * egress guard scans the finished bytes against the vault before they go.
 *
 * WHAT THE MODEL IS NOT ASKED FOR: **provenance**. Request id, session id and view id are facts
 * about *this client*, not opinions a server should hold, so the adapter fills them in from the
 * request it made. A model that could assert provenance could assert it wrongly, and the only thing
 * that would achieve is a confusing refusal.
 *
 * WHY THE PROMPT LOOKS LIKE THIS. Measured, not guessed (see the LOOP-2 record). A 0.5B model given
 * the bare schema produced *schema-valid nonsense* — inserting a name into a button, clicking a text
 * field, inventing `token:PII:NAME:1`. Three changes fixed it, in increasing order of effect:
 * enum-constraining `target` and `ref` to the sets the client already knows, splitting fields from
 * buttons and marking which field is empty, and **one worked example in a different domain**. With
 * all three it produced the correct plan 5/5 at a p50 of 475 ms. None of this is a security control
 * — it is how you get a small model to be useful — and every one of its outputs still goes through
 * the validator.
 */
import { sendVerified, type EgressRecord, type EgressRefusal } from "@pratibimb/egress";
import { type VerifiedHandoff } from "@pratibimb/privacy";

import { type ReasonerClient, type ReasonerRequest } from "./contract.js";

export interface LocalModelOptions {
  /** The loopback endpoint. Anything that is not on this machine is refused by the egress guard. */
  readonly endpoint?: string;
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Deterministic by default: this is a planner, not a writer. */
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Called with the egress record or refusal for every attempt, so a run can report what left. */
  readonly onEgress?: (event: { readonly record?: EgressRecord; readonly refusal?: EgressRefusal }) => void;
}

export const DEFAULT_MODEL_ENDPOINT = "http://127.0.0.1:8977/v1/chat/completions";

/** What the model is allowed to name. Everything else is unrepresentable in its output. */
interface Grounding {
  readonly targets: readonly string[];
  readonly refs: readonly string[];
}

const groundingOf = (handoff: VerifiedHandoff): Grounding => ({
  targets: handoff.elements.map((element) => element.id),
  refs: handoff.redactions.filter((redaction) => redaction.token !== "").map((redaction) => redaction.token),
});

/**
 * The JSON schema the decoder is constrained to.
 *
 * `target` and `ref` are enums over what actually exists, so the model cannot emit a selector the
 * page does not have or a reference the vault never issued. That is grounding, not enforcement:
 * `validatePlan` still checks every one of them, because a constrained decoder is a convenience and
 * the validator is the authority.
 */
const planSchema = (grounding: Grounding): Record<string, unknown> => ({
  type: "object",
  properties: {
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        oneOf: [
          {
            type: "object",
            properties: { op: { const: "insert" }, target: { enum: grounding.targets }, ref: { enum: grounding.refs } },
            required: ["op", "target", "ref"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: { op: { const: "click" }, target: { enum: grounding.targets } },
            required: ["op", "target"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
});

const SYSTEM = [
  "Plan the fewest browser steps that achieve the goal.",
  "- 'insert' puts a stored value into an EMPTY text field. Never into a button, never into a field that already has a value.",
  "- 'click' presses a button. Never a text field.",
  "- Pick the reference whose class matches the field.",
].join("\n");

/**
 * One worked example, in a different domain, so the model generalises rather than copies.
 *
 * ITS REFERENCE IS DELIBERATELY NOT TOKEN-SHAPED. The obvious way to write this example uses
 * `<PII:EMAIL:1>` — and the egress guard refused the whole request when it did, because that is a
 * reference *this handoff never issued* and the guard does not care that it came from a prompt. The
 * rule is a good rule, so the example changed rather than the rule. `REF_A` teaches the same shape,
 * and the decoder's enum means the model can only ever emit a token that really exists.
 */
const EXAMPLE = {
  user: JSON.stringify({
    goal: "Register with my email",
    fields: [
      { id: "#email", name: "Email", empty: false },
      { id: "#email2", name: "Confirm email", empty: true },
    ],
    buttons: [{ id: "#go", name: "Register" }],
    references: [{ token: "REF_A", class: "EMAIL" }],
  }),
  assistant: JSON.stringify({
    steps: [
      { op: "insert", target: "#email2", ref: "REF_A" },
      { op: "click", target: "#go" },
    ],
  }),
};

/**
 * The sanitized context, built only from the verified handoff.
 *
 * `empty` is the one thing not in the manifest, and it is derived from the redaction spans rather
 * than from any value: a field with a reference held something, a field without one did not. So the
 * client tells the model *which field needs filling* without telling it what is in any of them.
 */
function contextFor(handoff: VerifiedHandoff, goal: string): Record<string, unknown> {
  const redactedTargets = new Set(handoff.redactions.map((redaction) => redaction.targetId));
  const fields = handoff.elements
    .filter((element) => element.role === "textbox")
    .map((element) => ({ id: element.id, name: element.name, empty: !redactedTargets.has(element.id) }));
  const buttons = handoff.elements
    .filter((element) => element.role === "button")
    .map((element) => ({ id: element.id, name: element.name }));
  const references = handoff.redactions
    .filter((redaction) => redaction.token !== "")
    .map((redaction) => ({ token: redaction.token, class: redaction.class, hint: redaction.hint }));
  return { goal, fields, buttons, references };
}

/**
 * Build the reasoner.
 *
 * The returned object is a `ReasonerClient` like any other. `propose` resolves with whatever came
 * back — including `undefined` when the request was refused or failed, which the caller's fallback
 * policy reads as "no usable plan".
 */
export function localModelReasoner(options: LocalModelOptions = {}): ReasonerClient {
  const endpoint = options.endpoint ?? DEFAULT_MODEL_ENDPOINT;
  return {
    name: `local-model:${options.model ?? "qwen2.5-0.5b-instruct-q4_k_m"}`,
    transport: "LOOPBACK_HTTP",
    async propose(request: ReasonerRequest): Promise<unknown> {
      const grounding = groundingOf(request.handoff);
      if (grounding.targets.length === 0 || grounding.refs.length === 0) return undefined;

      const body = {
        ...(options.model ? { model: options.model } : {}),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: EXAMPLE.user },
          { role: "assistant", content: EXAMPLE.assistant },
          { role: "user", content: JSON.stringify(contextFor(request.handoff, request.goal)) },
        ],
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 160,
        response_format: { type: "json_schema", json_schema: { name: "plan", schema: planSchema(grounding), strict: true } },
      };

      // Every byte goes through the choke point. This adapter never touches the network itself.
      const outcome = await sendVerified({
        handoff: request.handoff,
        vault: request.vault,
        body,
        destination: endpoint,
        requestId: request.requestId,
        sessionId: request.sessionId,
        reasoner: `local-model:${options.model ?? "qwen2.5-0.5b-instruct-q4_k_m"}`,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });

      if (!outcome.sent) {
        options.onEgress?.({ refusal: outcome.refusal });
        return undefined;
      }
      options.onEgress?.({ record: outcome.record });

      // From here down everything is untrusted text. A malformed body is not an error to throw on;
      // it is a response that fails to parse, which the pipeline already knows how to refuse.
      let content: unknown;
      try {
        const parsed = JSON.parse(outcome.responseText) as {
          choices?: { message?: { content?: unknown } }[];
        };
        content = parsed.choices?.[0]?.message?.content;
      } catch {
        return undefined;
      }
      if (typeof content !== "string") return undefined;

      let steps: unknown;
      try {
        steps = (JSON.parse(content) as { steps?: unknown }).steps;
      } catch {
        // The model returned something that is not JSON. Hand it on as-is: the parser refuses it,
        // and inventing a plan here would be the adapter deciding something it may not decide.
        return content;
      }

      // Provenance is the client's own. See the header.
      return {
        planVersion: "1",
        goal: request.goal,
        steps,
        provenance: {
          requestId: request.requestId,
          sessionId: request.sessionId,
          viewId: request.handoff.request.requestId,
          origin: request.origin,
        },
      };
    },
  };
}
