/**
 * The reasoner boundary — SEND, and the shape of what comes back.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE IN THE TYPE SYSTEM: **a reasoner returns `unknown`.**
 * Not a `Plan`, not a `ReasonerResponse`, not anything with a field a caller could read without
 * first proving it is there. The reasoner is untrusted — that is the product thesis, not a posture —
 * and a client that types its output as a plan has already decided to believe it. Parsing and
 * validation live in `@pratibimb/plan`, behind this boundary, and there is no path from here to
 * execution that does not go through them.
 *
 * WHY A BOUNDARY AT ALL WHEN THE PLANNER IS IN-PROCESS. This phase ships a deterministic planner
 * running in the same realm; nothing crosses a network. The boundary is still real because the
 * security architecture must not change when the planner is replaced by a small open-weight text
 * model on loopback. What changes then is one implementation of `ReasonerClient`. What must not
 * change is anything after it.
 *
 * WHAT DOES NOT CROSS. The request carries the `VerifiedHandoff` — the object `@pratibimb/privacy`
 * verified — and nothing else about the page. No vault, no values, no element the sanitizer removed.
 * The handoff's own verification is what makes that claim checkable, and `sendToReasoner` refuses to
 * send anything else.
 *
 * WHAT THIS PHASE DOES NOT CLAIM. No byte leaves the machine. There is no network client, no egress
 * proof, and the transport below is an in-process function call. `ReasonerResponse.transport` says
 * which, in the record, so no artifact can imply otherwise.
 */
import { isVerifiedHandoff, type Vault, type VerifiedHandoff } from "@pratibimb/privacy";

/** What the client asks for. The handoff is the only page-derived thing in it. */
export interface ReasonerRequest {
  /** The verified handoff. Verified by `@pratibimb/privacy`, not by a flag anyone can set. */
  readonly handoff: VerifiedHandoff;
  /** The user's own words. Carried separately so a reasoner cannot mistake page text for intent. */
  readonly goal: string;
  readonly requestId: string;
  readonly sessionId: string;
  /** The page the handoff describes. Echoed so a response can be matched to a page. */
  readonly origin: string;
  /**
   * The session vault — carried so the **egress guard** can scan outgoing bytes against the values
   * it holds, and for no other purpose.
   *
   * Handing a vault to an untrusted-adapter boundary looks alarming and is not, because the vault
   * has no public accessor that returns a value: `holdsLiteral` answers with a class, `describe`
   * with a descriptor, `toJSON` with counts, and the one path to a secret is a symbol this package
   * cannot import. An adapter can ask "do you hold this?" — which is exactly what the leak scan is —
   * and can learn nothing else. A test asserts no reasoner source reaches for the value path.
   */
  readonly vault: Vault;
}

/**
 * How the request actually travelled, recorded so an artifact cannot overstate it.
 *
 * `IN_PROCESS` is a function call in this realm. `LOOPBACK_HTTP` would be a real request to
 * 127.0.0.1 — no implementation of it exists in this phase.
 */
export type ReasonerTransport = "IN_PROCESS" | "LOOPBACK_HTTP";

/**
 * A reasoner. One method, and its return type is the whole point.
 *
 * An implementation may be a deterministic planner, a local model, or a remote service. None of them
 * is trusted, so none of them may describe its own output.
 */
export interface ReasonerClient {
  readonly name: string;
  readonly transport: ReasonerTransport;
  /** Returns whatever it returns. The caller may not assume any shape. */
  propose(request: ReasonerRequest): Promise<unknown>;
}

export type SendRefusalCause =
  | "HANDOFF_NOT_VERIFIED"
  | "EMPTY_GOAL"
  | "IDENTITY_MISMATCH"
  | "REASONER_THREW"
  | "REASONER_TIMEOUT";

/**
 * What came back, still untrusted.
 *
 * `raw` is deliberately `unknown` and deliberately the only place the response lives. There is no
 * convenience accessor, no `plan` field and no `ok` shortcut that would let a caller skip parsing.
 */
export type ReasonerResponse =
  | {
      readonly received: true;
      readonly raw: unknown;
      readonly reasoner: string;
      readonly transport: ReasonerTransport;
      readonly elapsedMs: number;
      /** Fixed at send time. A response is about one request. */
      readonly requestId: string;
    }
  | { readonly received: false; readonly cause: SendRefusalCause; readonly elapsedMs: number };

export interface SendOptions {
  /** Deadline for the reasoner. A planner that never returns must not hang the loop. */
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export const DEFAULT_REASONER_TIMEOUT_MS = 10_000;

/**
 * SEND. The only place a request reaches a reasoner.
 *
 * Refuses before sending if the handoff is not one the privacy verifier produced — asked of the
 * verifier itself, never of `handoff.verified`, because the flag type-checks and the membership does
 * not (INV-22). A thrown reasoner and a timed-out one are both refusals: neither produces a plan, and
 * neither is allowed to look like one.
 */
export async function sendToReasoner(
  client: ReasonerClient,
  request: ReasonerRequest,
  options: SendOptions = {}
): Promise<ReasonerResponse> {
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();
  const since = () => clock() - startedAt;

  if (!isVerifiedHandoff(request.handoff)) {
    return { received: false, cause: "HANDOFF_NOT_VERIFIED", elapsedMs: since() };
  }
  if (typeof request.goal !== "string" || request.goal.trim() === "") {
    return { received: false, cause: "EMPTY_GOAL", elapsedMs: since() };
  }
  // The handoff names the request and session it was verified for. Sending it under another
  // identity would make the reply impossible to match back to a page.
  if (
    request.handoff.request.requestId !== request.requestId ||
    request.handoff.request.sessionId !== request.sessionId ||
    request.handoff.capture.origin !== request.origin
  ) {
    return { received: false, cause: "IDENTITY_MISMATCH", elapsedMs: since() };
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REASONER_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("timeout");
  try {
    const raw = await Promise.race([
      client.propose(request),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
    if (raw === TIMED_OUT) return { received: false, cause: "REASONER_TIMEOUT", elapsedMs: since() };
    return {
      received: true,
      raw,
      reasoner: client.name,
      transport: client.transport,
      elapsedMs: since(),
      requestId: request.requestId,
    };
  } catch {
    // The error is dropped, not reported: a reasoner's exception message is untrusted text that
    // could quote anything it was given (INV-21).
    return { received: false, cause: "REASONER_THREW", elapsedMs: since() };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
