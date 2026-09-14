/**
 * The vault — **a memory-only prototype vault. This is NOT production storage.**
 *
 * It holds the values the server must never see, keyed by the opaque references that go in their
 * place. The invariants it implements are frozen ones:
 *
 * - **INV-04 / INV-05 — memory only.** A `Map` in this object, and nowhere else. No `localStorage`,
 *   no `IndexedDB`, no `chrome.storage`, no file, no log, no analytics. There is no serializer on
 *   this class, and `toJSON` deliberately returns counts so that an accidental `JSON.stringify` of a
 *   structure holding a vault produces metadata instead of secrets.
 * - **INV-06 — destroyed at session end, tab change and origin change.** `destroy()` is
 *   unconditional, and `enforceOrigin()` destroys before it answers when the origin has changed.
 * - **INV-07 — values cross the boundary only as references.** `store()` returns a reference; there
 *   is no public method that returns a value.
 * - **INV-08 — unknown references abort.** Lookups answer about existence and class, never by
 *   guessing a near match.
 * - **INV-21 — no secret in any log, error or message.** Nothing here formats a value into a string.
 *
 * WHAT IT DELIBERATELY DOES NOT OFFER:
 *
 * - **No enumeration.** There is no `values()`, no `entries()`, no iterator, and `refs()` is absent
 *   on purpose. Holding a vault gives you the ability to ask about a reference you already have, not
 *   the ability to walk the contents. (`size` is a count, which a ledger legitimately displays.)
 * - **No public reveal.** Recovery goes through the binding boundary in `bind.ts`, which reaches the
 *   value with a module-private symbol (`internal.ts`). Read that file for the limit of that claim.
 *
 * CRITICAL AND UNKNOWN CLASSES ARE REFUSED AT THE DOOR. An OTP never receives a reference, so there
 * is nothing to rehydrate later — the refusal lives at issuance rather than at use, because a token
 * that exists is a token something will eventually try to spend.
 */
import { TIER_OF, isTokenisable, type PiiClass, type Tier } from "./classes.js";
import { REVEAL } from "./internal.js";
import { containsSecret } from "./normalise.js";
import { OrdinalCounter, formatToken, parseToken } from "./tokens.js";

export interface VaultSessionContext {
  readonly sessionId: string;
  /** The page origin this session belongs to. A change destroys the vault (INV-06). */
  readonly origin: string;
  readonly now?: () => number;
}

export interface StoreRequest {
  readonly piiClass: PiiClass;
  readonly value: string;
  /** The element the value came from, where one applies. Binding compares against it. */
  readonly target?: string;
  /** Stable fingerprint of that element, when the caller has one. */
  readonly fingerprint?: string;
}

export type StoreOutcome =
  | { readonly issued: true; readonly ref: string; readonly piiClass: PiiClass; readonly tier: Tier }
  | { readonly issued: false; readonly cause: StoreRefusalCause };

export type StoreRefusalCause =
  | "CRITICAL_NOT_TOKENISED"
  | "UNKNOWN_CLASS"
  | "EMPTY_VALUE"
  | "VAULT_DESTROYED";

/** What a reference stands for, minus the thing it stands for. Safe to show a human or a ledger. */
export interface RefDescriptor {
  readonly ref: string;
  readonly piiClass: PiiClass;
  readonly tier: Tier;
  readonly origin: string;
  readonly sessionId: string;
  readonly target: string | null;
  readonly fingerprint: string | null;
  readonly consumed: boolean;
}

interface VaultEntry {
  readonly ref: string;
  readonly piiClass: PiiClass;
  readonly tier: Tier;
  readonly origin: string;
  readonly target: string | null;
  readonly fingerprint: string | null;
  readonly value: string;
  readonly storedAt: number;
  consumedAt: number | null;
}

export class Vault {
  readonly sessionId: string;
  readonly origin: string;
  /**
   * `#` fields, not `private` fields.
   *
   * TypeScript's `private` is erased at runtime: `(vault as any).entries` would hand any caller the
   * whole map, which would make "no enumeration" a type-checker convention rather than a property of
   * the object. ECMAScript private fields are not reachable from outside the class at all.
   */
  readonly #entries = new Map<string, VaultEntry>();
  readonly #ordinals = new OrdinalCounter();
  readonly #clock: () => number;
  #destroyed = false;

  constructor(context: VaultSessionContext) {
    this.sessionId = context.sessionId;
    this.origin = context.origin;
    this.#clock = context.now ?? (() => Date.now());
  }

  /** Number of references issued. A count, never the contents. */
  get size(): number {
    return this.#entries.size;
  }

  get isDestroyed(): boolean {
    return this.#destroyed;
  }

  /**
   * Store a value and get its reference.
   *
   * Refuses CRITICAL and unclassified values outright: there is no argument that makes an OTP
   * tokenisable, so the refusal is not a policy check that a caller could pass differently.
   */
  store(request: StoreRequest): StoreOutcome {
    if (this.#destroyed) return { issued: false, cause: "VAULT_DESTROYED" };
    if (request.value.trim() === "") return { issued: false, cause: "EMPTY_VALUE" };
    if (TIER_OF[request.piiClass] === "CRITICAL") return { issued: false, cause: "CRITICAL_NOT_TOKENISED" };
    if (!isTokenisable(request.piiClass)) return { issued: false, cause: "UNKNOWN_CLASS" };

    // A fresh ordinal every time, even for a value already held: an ordinal counts issuances, so it
    // cannot become an equality oracle over the secrets (see tokens.ts).
    const ref = formatToken(request.piiClass, this.#ordinals.next(request.piiClass));
    this.#entries.set(ref, {
      ref,
      piiClass: request.piiClass,
      tier: TIER_OF[request.piiClass],
      origin: this.origin,
      target: request.target ?? null,
      fingerprint: request.fingerprint ?? null,
      value: request.value,
      storedAt: this.#clock(),
      consumedAt: null,
    });
    return { issued: true, ref, piiClass: request.piiClass, tier: TIER_OF[request.piiClass] };
  }

  /** Does this exact reference exist here? No fuzzy matching, no "did you mean" (INV-08). */
  has(ref: unknown): boolean {
    return typeof ref === "string" && parseToken(ref) !== null && this.#entries.has(ref);
  }

  /** What a reference stands for, without the value. `null` for anything unknown. */
  describe(ref: unknown): RefDescriptor | null {
    if (typeof ref !== "string") return null;
    const entry = this.#entries.get(ref);
    if (!entry) return null;
    return {
      ref: entry.ref,
      piiClass: entry.piiClass,
      tier: entry.tier,
      origin: entry.origin,
      sessionId: this.sessionId,
      target: entry.target,
      fingerprint: entry.fingerprint,
      consumed: entry.consumedAt !== null,
    };
  }

  isConsumed(ref: string): boolean {
    return this.#entries.get(ref)?.consumedAt !== null && this.#entries.has(ref);
  }

  /** Spend a reference. Idempotent in effect: a second spend is refused by `isConsumed`. */
  consume(ref: string): boolean {
    const entry = this.#entries.get(ref);
    if (!entry || entry.consumedAt !== null) return false;
    entry.consumedAt = this.#clock();
    return true;
  }

  /**
   * Does the vault hold this literal — exactly, or under normalisation?
   *
   * The question a returned literal must be asked before anything is done with it (INV-10). The
   * answer is a boolean and a class; **the value is never echoed back**, so a caller cannot use this
   * as an oracle to read the vault one guess at a time... except by guessing the value itself, which
   * is the one case where the caller already knows it.
   */
  holdsLiteral(literal: string): { readonly held: true; readonly piiClass: PiiClass } | { readonly held: false } {
    if (this.#destroyed || literal.trim() === "") return { held: false };
    for (const entry of this.#entries.values()) {
      if (entry.value === literal || containsSecret(literal, entry.value)) {
        return { held: true, piiClass: entry.piiClass };
      }
    }
    return { held: false };
  }

  /**
   * Destroy everything held. Unconditional, and irreversible for this instance (INV-06).
   *
   * Values are overwritten before the map is cleared. In a garbage-collected runtime that is a
   * gesture rather than a guarantee — the original strings may survive until collection — and it is
   * written here as a gesture that costs nothing, not as a claim of memory hygiene.
   */
  destroy(): void {
    for (const entry of this.#entries.values()) {
      (entry as { value: string }).value = "";
    }
    this.#entries.clear();
    this.#destroyed = true;
  }

  /**
   * Assert the page is still the origin this session was opened for.
   *
   * A mismatch destroys the vault **before answering** — the carry-over is what the origin policy
   * forbids, and destroying after reporting would leave a window in which a caller acts on the
   * stale contents.
   */
  enforceOrigin(currentOrigin: string): boolean {
    if (currentOrigin === this.origin && !this.#destroyed) return true;
    this.destroy();
    return false;
  }

  /** Counts only. An accidental `JSON.stringify` of anything holding a vault yields metadata. */
  toJSON(): Record<string, unknown> {
    return { sessionId: this.sessionId, origin: this.origin, refs: this.#entries.size, destroyed: this.#destroyed };
  }

  /**
   * The only path to a value, keyed by a symbol this package does not export.
   *
   * Called by `bind.ts` after every check has passed. See `internal.ts` for what that boundary is
   * and is not.
   */
  [REVEAL](ref: string): string | null {
    if (this.#destroyed) return null;
    return this.#entries.get(ref)?.value ?? null;
  }
}

export const createVault = (context: VaultSessionContext): Vault => new Vault(context);
