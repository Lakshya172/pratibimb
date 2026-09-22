/**
 * THE ONE-SHOT CAPABILITY — the production form of the mechanism E6 measured.
 *
 * WHAT IT IS FOR. Something in one extension realm has to reach exactly one other realm, exactly
 * once, with the service worker unable to read what passes. MV3 offers one way and only one:
 * `chrome.runtime.sendMessage` is delivered to **every** listening context — which is why
 * `background.ts` has to say "not for me" out loud — but a **reply** goes to the sender and to
 * nobody else.
 *
 * SO THE DIRECTION IS INVERTED, AND THAT IS THE WHOLE DESIGN. The holder never sends. It arms a
 * capability and says so; the service worker carries a nonce and a field name, which are not
 * secrets; the other realm comes and asks; the holder answers it directly. Whatever is being handed
 * over crosses exactly one boundary, as a reply, at the last possible moment.
 *
 * WHAT A CAPABILITY CARRIES depends on which way the page's values are living:
 *   - **E6** — a value held in the offscreen document, released to a content script.
 *   - **A release authorisation** — a reference and a target, once the vault is where the page is.
 *     Nothing secret, and the capability is what makes the write one-shot and document-bound.
 *   - **A question for the vault** — text a reasoner returned, carried down to be compared against
 *     values that never come up.
 * One authority, one set of refusals, three payloads. A second capability system would be a second
 * set of rules about when something may be handed over, which is the last thing to have two of.
 *
 * WHAT A CAPABILITY IS BOUND TO — all of it, every time:
 *   - the tab, the frame and the **document identity** the browser attests for the asker;
 *   - the exact target the value was approved for;
 *   - a deadline;
 *   - one use.
 *
 * CONSUMED ON ANY ATTEMPT THAT NAMES IT. A nonce that is presented is spent, whether or not it is
 * then released. That is deliberate and it is the difference between a capability and a password: a
 * caller who has the nonce but the wrong document does not get to try again with the right one, and
 * a caller who guesses does not get to learn which part of the guess was wrong by retrying.
 *
 * THE ORDER OF THE CHECKS IS PART OF THE CONTRACT. Consume, then expiry, then identity, then target.
 * Expiry before identity so a stale capability cannot be probed for whose document it named.
 *
 * NOTHING HERE TOUCHES `chrome.*`. The caller passes the browser's attestation in as plain data, so
 * every refusal below is testable in Node — which is the point, because these refusals are the
 * security property and a security property proven only by a browser run is proven once.
 */

/** Who the browser says is asking. `null` anywhere means the browser did not attest it. */
export interface AttestedAsker {
  readonly tabId: number | null;
  readonly frameId: number | null;
  readonly documentId: string | null;
}

/** The document a capability is armed for. Every field is required: a partial binding is no binding. */
export interface ReleaseBinding {
  readonly tabId: number;
  readonly frameId: number;
  readonly documentId: string;
}

export const RELEASE_REFUSAL_CODES = [
  /** No such capability, or it has already been presented once. */
  "UNKNOWN_OR_CONSUMED_NONCE",
  "NONCE_EXPIRED",
  /** The browser attests a different tab, frame or document than the one this capability named. */
  "SENDER_DOCUMENT_MISMATCH",
  /** The right document asking for the wrong field. */
  "TARGET_MISMATCH",
] as const;

export type ReleaseRefusalCode = (typeof RELEASE_REFUSAL_CODES)[number];

export type Redemption<T> =
  | { readonly released: true; readonly payload: T; readonly target: string }
  | { readonly released: false; readonly refused: ReleaseRefusalCode };

export interface ReleaseAuthorityDeps {
  readonly now?: () => number;
  readonly newNonce?: () => string;
}

export interface ReleaseAuthority<T = string> {
  /**
   * Arm one capability. Returns the nonce, which is safe to route: it names a capability, it is not
   * a secret, and on its own it releases nothing.
   */
  arm(binding: ReleaseBinding, target: string, payload: T, ttlMs: number): string;
  /** Present a capability. Spends it either way. */
  redeem(nonce: string, target: string, asker: AttestedAsker): Redemption<T>;
  /** How many capabilities are outstanding. Sizes only — never contents. */
  armedCount(): number;
  /** Drop every outstanding capability. Called when a run ends, however it ends. */
  revokeAll(): number;
}

interface ArmedCapability<T> extends ReleaseBinding {
  readonly target: string;
  readonly payload: T;
  readonly expiresAt: number;
}

const sameDocument = (a: ReleaseBinding, asker: AttestedAsker): boolean =>
  asker.tabId === a.tabId && asker.frameId === a.frameId && asker.documentId === a.documentId;

export function createReleaseAuthority<T = string>(deps: ReleaseAuthorityDeps = {}): ReleaseAuthority<T> {
  const now = deps.now ?? (() => Date.now());
  const newNonce = deps.newNonce ?? (() => globalThis.crypto.randomUUID());
  const armed = new Map<string, ArmedCapability<T>>();

  return {
    arm(binding, target, payload, ttlMs) {
      const nonce = newNonce();
      armed.set(nonce, { ...binding, target, payload, expiresAt: now() + ttlMs });
      return nonce;
    },

    redeem(nonce, target, asker) {
      const capability = armed.get(nonce);
      if (capability === undefined) return { released: false, refused: "UNKNOWN_OR_CONSUMED_NONCE" };
      // Spent before anything else is looked at, so no refusal below leaves a second chance behind.
      armed.delete(nonce);
      if (now() >= capability.expiresAt) return { released: false, refused: "NONCE_EXPIRED" };
      if (!sameDocument(capability, asker)) return { released: false, refused: "SENDER_DOCUMENT_MISMATCH" };
      if (capability.target !== target) return { released: false, refused: "TARGET_MISMATCH" };
      return { released: true, payload: capability.payload, target: capability.target };
    },

    armedCount: () => armed.size,

    revokeAll() {
      const outstanding = armed.size;
      armed.clear();
      return outstanding;
    },
  };
}
