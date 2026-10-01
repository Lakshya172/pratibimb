/**
 * The egress ledger — what was sent, to where, and what it hashed to.
 *
 * WHAT THIS IS, STATED BEFORE ANYTHING ELSE: **this phase has no network client.** Nothing here
 * sends, and no entry in this ledger is evidence that a byte left the machine. It is a privacy-layer
 * artifact: a record of what the client *would* transmit and of the checks that ran first. INV-01
 * and INV-02 — one egress module, hash-pinned — are not implemented by this file and are not
 * claimed by it.
 *
 * WHY THE HASH IS HERE ANYWAY. INV-02/INV-03 require that the verified artifact and the transmitted
 * artifact are the same bytes, "nothing re-encoded, re-serialized or mutated between hashing and
 * sending". Recording the hash of the exact serialization at the moment of verification is the half
 * of that pin the client can honour today, and it makes the demo's central claim falsifiable: a
 * reader can hash the payload themselves and compare.
 *
 * WHAT NEVER ENTERS AN ENTRY (INV-21): no value, no field contents, no goal text, no error message
 * that quotes a value. An entry carries identity, counts, classes, a destination and a digest. The
 * classes are metadata about *what kind* of thing was referenced — which is the point of a ledger a
 * human is meant to audit — and the digest is over the sanitized bytes, which by construction hold
 * no secret.
 */
import { type PiiClass, type Tier } from "./classes.js";
import { isVerifiedHandoff, serializeHandoff, type VerifiedHandoff } from "./handoff.js";

export interface LedgerEntry {
  readonly sessionId: string;
  readonly requestId: string;
  readonly at: number;
  /** Where this payload was destined. In this phase there is no client, so it is declarative. */
  readonly destination: string;
  readonly payloadSha256: string;
  readonly payloadBytes: number;
  /** Always true: an unverified payload cannot produce an entry. */
  readonly verified: true;
  /** The value-aware residual check's verdict at verification time. */
  readonly leakCheck: "CLEAN";
  readonly elements: number;
  /** One row per reference the server was given. Class and tier only. */
  readonly references: readonly { readonly token: string; readonly class: PiiClass; readonly tier: Tier }[];
  /** Spans masked without a reference — CRITICAL classes. Counted, never named individually. */
  readonly maskedWithoutReference: number;
  readonly note: string;
}

export type LedgerRefusalCause = "NOT_VERIFIED";

export type LedgerOutcome =
  | { readonly recorded: true; readonly entry: LedgerEntry }
  | { readonly recorded: false; readonly cause: LedgerRefusalCause };

const NO_NETWORK_NOTE =
  "privacy-layer record only: this phase has no egress client, so this is not evidence of a network send";

/** SHA-256 of a UTF-8 string, hex. Same primitive the ORT runtime pin uses. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class EgressLedger {
  private readonly rows: LedgerEntry[] = [];

  get entries(): readonly LedgerEntry[] {
    return this.rows;
  }

  /**
   * Record one payload.
   *
   * Refuses anything the verifier did not produce — and asks `isVerifiedHandoff`, not
   * `handoff.verified`, because the second is a field a forged literal can set (INV-22).
   */
  async record(
    handoff: VerifiedHandoff,
    options: { readonly destination: string; readonly at: number }
  ): Promise<LedgerOutcome> {
    if (!isVerifiedHandoff(handoff)) return { recorded: false, cause: "NOT_VERIFIED" };

    const serialized = serializeHandoff(handoff);
    const references = handoff.redactions
      .filter((redaction) => redaction.method === "token_reference")
      .map((redaction) => ({ token: redaction.token, class: redaction.class, tier: redaction.tier }));

    const entry: LedgerEntry = Object.freeze({
      sessionId: handoff.request.sessionId,
      requestId: handoff.request.requestId,
      at: options.at,
      destination: options.destination,
      payloadSha256: await sha256Hex(serialized),
      payloadBytes: new TextEncoder().encode(serialized).length,
      verified: true as const,
      leakCheck: "CLEAN" as const,
      elements: handoff.elements.length,
      references,
      maskedWithoutReference: handoff.redactions.filter((r) => r.method === "masked_no_token").length,
      note: NO_NETWORK_NOTE,
    });
    this.rows.push(entry);
    return { recorded: true, entry };
  }

  toJSON(): readonly LedgerEntry[] {
    return this.rows;
  }
}

export const createLedger = (): EgressLedger => new EgressLedger();
