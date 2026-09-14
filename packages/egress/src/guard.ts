/**
 * THE EGRESS CHOKE POINT — the single place bytes leave this machine.
 *
 * `SECURITY.md` §5 lists *"Egress can bypass the single egress module"* as a **halt-and-escalate**
 * stop condition. Until now there was no egress module to bypass, because there was no network. This
 * is that module, and it exists so the invariant is a property of the code rather than a habit:
 *
 *     NO REQUEST LEAVES WITHOUT A VERIFIED SANITIZED PAYLOAD.
 *
 * HOW THAT IS MADE STRUCTURAL, rather than a rule callers are asked to remember:
 *
 * 1. **This module performs the `fetch`.** Callers hand over a body and get a response; they never
 *    hold a socket. `packages/reasoner` contains no `fetch(` at all, and a test scans for it.
 * 2. **The bytes are serialized exactly once**, here, and the *same string* is what gets scanned,
 *    hashed, recorded and sent. There is no path where verification inspects one thing and the
 *    network carries another — the dossier's "a payload can be mutated between verification and
 *    transmission" stop condition, closed by construction rather than by review.
 * 3. **The order is fixed and every step can refuse:** verified handoff → loopback destination →
 *    declared tokens only → value-aware residual scan → digest → record → send. A refusal at any
 *    step returns before the send, so the code that transmits is unreachable.
 *
 * WHAT THIS MODULE DOES NOT DECIDE. It re-answers nothing privacy already answers. Whether a handoff
 * is verified is `isVerifiedHandoff`'s answer; whether the bytes contain a secret is
 * `scanForVaultValues`'s, which compares against the values the vault actually holds, exactly and
 * under normalisation. This module sequences those answers and owns the socket.
 *
 * LOOPBACK IS NOT TRUST. The destination check exists so a misconfigured endpoint cannot quietly
 * become a remote one — not because 127.0.0.1 is safe. Everything that comes *back* is untrusted no
 * matter where it came from.
 *
 * WHAT IS NEVER RECORDED. A refusal names a class, a stage and a request id. It never carries the
 * literal that triggered it, and never the body (INV-21). The digest of a payload that was refused
 * for leakage is not recorded either: it is a hash *of the secret-bearing bytes*, and publishing it
 * would be publishing an oracle.
 */
import { isVerifiedHandoff, scanForVaultValues, sha256Hex, type PiiClass, type Vault, type VerifiedHandoff } from "@pratibimb/privacy";

/**
 * Byte length of a UTF-8 string, without `Buffer`.
 *
 * This module runs in a browser as well as in Node — the Planning View imports it — so it uses only
 * platform-neutral APIs, the same rule `@pratibimb/security` follows.
 */
const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** Every reference token looks like this. Used to check nothing undeclared is leaving. */
const TOKEN_PATTERN = /<PII:[A-Z]+:\d+>/g;

export type EgressTransport = "LOOPBACK_HTTP";

export type EgressRefusalCause =
  | "HANDOFF_NOT_VERIFIED"
  | "DESTINATION_NOT_LOOPBACK"
  | "NOT_SERIALIZABLE"
  | "UNDECLARED_TOKEN"
  | "VAULT_VALUE_IN_PAYLOAD"
  | "TRANSPORT_FAILED"
  | "TRANSPORT_TIMEOUT";

/**
 * What left, and what came back. Safe to write to a file.
 *
 * This is the record that answers *"what exactly left the device?"* — identity, destination, the
 * digest of the exact bytes, their size, and the references they carried. No body, no value.
 */
export interface EgressRecord {
  readonly requestId: string;
  readonly sessionId: string;
  readonly at: number;
  readonly destination: string;
  readonly transport: EgressTransport;
  readonly reasoner: string;
  /** Always true: an unverified payload cannot reach this record. */
  readonly verified: true;
  readonly payloadSha256: string;
  readonly payloadBytes: number;
  /** Always `CLEAN`: a payload that failed the scan is never sent and never recorded here. */
  readonly leakCheck: "CLEAN";
  /** The reference tokens the payload carried. Opaque by construction. */
  readonly references: readonly string[];
  readonly responseStatus: number | null;
  readonly responseBytes: number | null;
  readonly elapsedMs: number;
}

/** A refusal, shaped so it can be logged. Carries metadata and never the payload. */
export interface EgressRefusal {
  readonly requestId: string;
  readonly sessionId: string;
  readonly at: number;
  readonly destination: string;
  readonly cause: EgressRefusalCause;
  readonly stage: "VERIFY" | "DESTINATION" | "SERIALIZE" | "TOKENS" | "LEAK_SCAN" | "TRANSPORT";
  /** Present only for a leakage event. The class, never the value. */
  readonly leakedClass?: PiiClass;
  /** `LEAKAGE_EVENT` marks a residual-leakage failure; everything else is a transport or shape problem. */
  readonly severity: "LEAKAGE_EVENT" | "REFUSED";
  readonly detail: string;
}

export type EgressOutcome =
  | { readonly sent: true; readonly record: EgressRecord; readonly responseText: string }
  | { readonly sent: false; readonly refusal: EgressRefusal };

export interface EgressRequest {
  /** The verified handoff this payload was built from. Its tokens bound what may leave. */
  readonly handoff: VerifiedHandoff;
  /** The vault whose values the outgoing bytes are scanned against. */
  readonly vault: Vault;
  /** The request body. Serialized here, once, and the result is what is sent. */
  readonly body: unknown;
  readonly destination: string;
  readonly requestId: string;
  readonly sessionId: string;
  /** Which reasoner this request is for. Recorded, not trusted. */
  readonly reasoner: string;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly headers?: Readonly<Record<string, string>>;
}

export const DEFAULT_EGRESS_TIMEOUT_MS = 30_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Is this destination on this machine? A guard against a misconfigured endpoint, not a trust claim. */
export function isLoopback(destination: string): boolean {
  try {
    const url = new URL(destination);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Send a payload, or refuse.
 *
 * The only function in this repository that performs network egress. Read the order below as the
 * security property: each check returns, so everything after a refusal is unreachable.
 */
export async function sendVerified(request: EgressRequest): Promise<EgressOutcome> {
  const clock = request.now ?? (() => Date.now());
  const startedAt = clock();
  const base = { requestId: request.requestId, sessionId: request.sessionId, destination: request.destination };
  const refuse = (
    stage: EgressRefusal["stage"],
    cause: EgressRefusalCause,
    detail: string,
    extra: { leakedClass?: PiiClass; severity?: EgressRefusal["severity"] } = {}
  ): EgressOutcome => ({
    sent: false,
    refusal: {
      ...base,
      at: clock(),
      stage,
      cause,
      severity: extra.severity ?? "REFUSED",
      ...(extra.leakedClass ? { leakedClass: extra.leakedClass } : {}),
      detail,
    },
  });

  // ── 1. verified ───────────────────────────────────────────────────────────────────────────
  // Asked of the verifier, never of `handoff.verified`: the flag type-checks and the membership
  // does not (INV-22).
  if (!isVerifiedHandoff(request.handoff)) {
    return refuse("VERIFY", "HANDOFF_NOT_VERIFIED", "the payload is not built on a handoff the privacy verifier produced.");
  }

  // ── 2. destination ────────────────────────────────────────────────────────────────────────
  if (!isLoopback(request.destination)) {
    return refuse("DESTINATION", "DESTINATION_NOT_LOOPBACK", "this phase sends only to a service on this machine.");
  }

  // ── 3. the exact bytes, produced once ─────────────────────────────────────────────────────
  let bytes: string;
  try {
    bytes = JSON.stringify(request.body);
    if (typeof bytes !== "string") throw new Error("not serializable");
  } catch {
    return refuse("SERIALIZE", "NOT_SERIALIZABLE", "the body could not be serialized, so nothing could be checked.");
  }

  // ── 4. only tokens this handoff declared ──────────────────────────────────────────────────
  // A reference the handoff never issued has no business leaving: either the caller built the body
  // from something else, or a token was invented. Both are reasons to stop.
  const declared = new Set(request.handoff.redactions.map((redaction) => redaction.token).filter((token) => token !== ""));
  const carried = [...new Set(bytes.match(TOKEN_PATTERN) ?? [])];
  const undeclared = carried.filter((token) => !declared.has(token));
  if (undeclared.length > 0) {
    return refuse("TOKENS", "UNDECLARED_TOKEN", `${undeclared.length} reference(s) in the payload were not issued for this handoff.`);
  }

  // ── 5. the value-aware residual scan, over the bytes that would actually go ────────────────
  const leaked = scanForVaultValues(bytes, request.vault);
  if (leaked) {
    return refuse("LEAK_SCAN", "VAULT_VALUE_IN_PAYLOAD", "a value this client holds locally appears in the outgoing bytes.", {
      leakedClass: leaked,
      severity: "LEAKAGE_EVENT",
    });
  }

  // ── 6. digest, of those same bytes ────────────────────────────────────────────────────────
  const payloadSha256 = await sha256Hex(bytes);

  // ── 7. send exactly them ──────────────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_EGRESS_TIMEOUT_MS);

  // The try wraps the network call and **nothing else**. An earlier revision wrapped the record
  // construction too, and when `Buffer.byteLength` — a Node-only global — threw in a browser, the
  // resulting `ReferenceError` was reported as `TRANSPORT_FAILED`. A bug in this module was
  // indistinguishable from the service being down, which is exactly the kind of misreport the rest
  // of this codebase refuses to make about anything else.
  let response: Response;
  let responseText: string;
  try {
    response = await fetch(request.destination, {
      method: "POST",
      headers: { "content-type": "application/json", ...(request.headers ?? {}) },
      body: bytes,
      signal: controller.signal,
    });
    responseText = await response.text();
  } catch (error) {
    // The message is dropped: a transport error can quote the URL and, in some runtimes, the body.
    const timedOut = error instanceof Error && error.name === "AbortError";
    return refuse(
      "TRANSPORT",
      timedOut ? "TRANSPORT_TIMEOUT" : "TRANSPORT_FAILED",
      timedOut ? "the service did not answer in time." : "the request could not be completed."
    );
  } finally {
    clearTimeout(timer);
  }

  return {
    sent: true,
    responseText,
    record: {
      ...base,
      at: clock(),
      transport: "LOOPBACK_HTTP",
      reasoner: request.reasoner,
      verified: true,
      payloadSha256,
      payloadBytes: utf8Length(bytes),
      leakCheck: "CLEAN",
      references: carried,
      responseStatus: response.status,
      responseBytes: utf8Length(responseText),
      elapsedMs: clock() - startedAt,
    },
  };
}
