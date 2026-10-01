/**
 * Opaque references — `<PII:CLASS:N>`, the token format frozen in
 * `docs/architecture/manifest-schema.md`.
 *
 * WHAT A TOKEN IS: a capability handle for a class of value, and an ordinal that distinguishes one
 * handle from another **within a session**. `N` is a per-session, per-class counter, exactly as the
 * contract specifies.
 *
 * WHAT A TOKEN IS NOT, AND WHY THIS MATTERS MORE THAN THE FORMAT: it is not a function of the value.
 * No hash, no prefix, no length, no encoding, no checksum of the secret appears in it. Two reasons,
 * and the second is the one that is easy to get wrong:
 *
 * 1. A reversible or brute-forceable derivation would put the secret on the wire in a costume. A
 *    ten-digit phone number has 10^9 candidates; any deterministic fingerprint of it is recoverable
 *    by enumeration in the time it takes to read this comment.
 * 2. Even an irreversible fingerprint leaks **equality**. If the same value always produced the same
 *    token, a server could tell that the number in this session is the number from the last one, or
 *    that two fields hold the same value. So issuance never deduplicates: storing one value twice
 *    yields two ordinals, and the tokens carry no evidence that they stand for the same thing.
 *
 * The ordinal therefore counts issuances, not distinct secrets.
 */
import { TOKENISABLE_CLASSES, type PiiClass } from "./classes.js";

/** `<PII:CLASS:N>` where CLASS is tokenisable and N is a positive ordinal. */
const TOKEN_PATTERN = /^<PII:([A-Z]+):([1-9][0-9]*)>$/;

export interface ParsedToken {
  readonly piiClass: PiiClass;
  readonly ordinal: number;
}

export const formatToken = (piiClass: PiiClass, ordinal: number): string => `<PII:${piiClass}:${ordinal}>`;

/**
 * Parse a reference, or `null`.
 *
 * A syntactically perfect token for a class that may not be tokenised — `<PII:OTP:1>` — does not
 * parse. The client never guesses which token was meant (INV-08), and it never accepts one that
 * should not exist.
 */
export function parseToken(ref: unknown): ParsedToken | null {
  if (typeof ref !== "string") return null;
  const match = TOKEN_PATTERN.exec(ref);
  if (!match) return null;
  const [, rawClass, rawOrdinal] = match;
  const piiClass = rawClass as PiiClass;
  if (!TOKENISABLE_CLASSES.includes(piiClass)) return null;
  const ordinal = Number(rawOrdinal);
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? { piiClass, ordinal } : null;
}

export const isToken = (ref: unknown): ref is string => parseToken(ref) !== null;

/**
 * Per-session, per-class ordinals.
 *
 * Held by the vault that owns the session. A counter is state, and state that outlives a session
 * would make ordinals comparable across sessions.
 */
export class OrdinalCounter {
  private readonly counts = new Map<PiiClass, number>();

  next(piiClass: PiiClass): number {
    const value = (this.counts.get(piiClass) ?? 0) + 1;
    this.counts.set(piiClass, value);
    return value;
  }

  issued(piiClass: PiiClass): number {
    return this.counts.get(piiClass) ?? 0;
  }
}
