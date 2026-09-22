/**
 * WHAT A CALLER NEEDS FROM THE VAULT WHEN THE VAULT IS SOMEWHERE ELSE.
 *
 * **Nothing here is a vault, and nothing here can become one.** There is no `store`, no `[REVEAL]`,
 * and no place a value could be put. `vault.ts` remains the one implementation that holds values;
 * this file names the two much smaller things its *readers* actually use, so a reader can be given
 * something truthful when the values live in another realm.
 *
 * WHY THIS EXISTS. In the MV3 extension the page's values are read, classified and held in the
 * content script's isolated world — the only place they can be without crossing a message the
 * service worker receives. The orchestrator, the reasoner and the egress guard run in the offscreen
 * document. Those three ask the vault two kinds of question:
 *
 * 1. **"What does this reference stand for?"** — `VaultReader`. Answered entirely from descriptors,
 *    which carry a class, a tier, an origin and a target and never a value. `bind()` is built only
 *    from these, which is why binding can be decided away from the values it is about.
 * 2. **"Do you hold this string?"** — `LiteralOracle`. This one genuinely needs the values, so a
 *    reader that is not in the vault's realm has to ask across a boundary. The answer is a boolean
 *    and a class; the text is never echoed and the values are never sent.
 *
 * `Vault` satisfies both by construction, so nothing changes for a caller that holds the real thing.
 *
 * THE ONE THING A VIEW MUST NEVER DO IS ANSWER `holdsLiteral` BY GUESSING. A view with no way to ask
 * would have to answer "no", and "no" from something that cannot know is how a leak check becomes
 * decoration. `createVaultView` therefore takes its answers from somewhere real and **refuses**
 * — loudly, by throwing — when asked about a literal nobody has established an answer for.
 */
import { type PiiClass } from "./classes.js";
import { type RefDescriptor } from "./vault.js";

/** The vault's answer about a literal: a class, or nothing. Never the text. */
export type HeldLiteral = { readonly held: true; readonly piiClass: PiiClass } | { readonly held: false };

/** "Do you hold this?" — answerable only where the values are. */
export interface LiteralOracle {
  holdsLiteral(literal: string): HeldLiteral;
}

/**
 * The same question, for a caller that can wait.
 *
 * The egress guard scans the exact bytes it is about to send, and those bytes are not known until it
 * has built them — so it cannot pre-arrange an answer and must be able to ask. `Vault` satisfies
 * this too: a synchronous answer is a perfectly good thing to `await`.
 */
export interface AsyncLiteralOracle {
  holdsLiteral(literal: string): HeldLiteral | Promise<HeldLiteral>;
}

/** Everything `bind()` asks. Descriptors and identity — no values, and no way to reach one. */
export interface VaultReader {
  readonly sessionId: string;
  readonly origin: string;
  readonly isDestroyed: boolean;
  describe(ref: unknown): RefDescriptor | null;
  isConsumed(ref: string): boolean;
  consume(ref: string): boolean;
}

/** What plan validation holds: it both binds references and checks literals. */
export type VaultFacade = VaultReader & LiteralOracle;

export interface VaultViewContext {
  readonly sessionId: string;
  readonly origin: string;
  /** What the remote vault issued, as it described them. Never values. */
  readonly descriptors: readonly RefDescriptor[];
}

/**
 * A reader over references that live in another realm.
 *
 * `holdsLiteral` starts out unable to answer anything, and `learn()` is how an answer obtained from
 * the realm that actually holds the values is recorded. Asking about a literal that was never
 * established throws rather than returning `held: false`, because the difference between "I checked
 * and it is not a secret" and "I have no idea" is the entire value of the check.
 */
export interface VaultView extends VaultFacade {
  /** Record the real vault's answer for one literal. */
  learn(literal: string, answer: HeldLiteral): void;
  /** Forget everything. The remote vault's own destruction is a separate, authoritative act. */
  destroy(): void;
}

export function createVaultView(context: VaultViewContext): VaultView {
  const byRef = new Map<string, RefDescriptor>(context.descriptors.map((d) => [d.ref, d]));
  const consumed = new Set<string>(context.descriptors.filter((d) => d.consumed).map((d) => d.ref));
  const answers = new Map<string, HeldLiteral>();
  let destroyed = false;

  return {
    sessionId: context.sessionId,
    origin: context.origin,
    get isDestroyed() {
      return destroyed;
    },

    describe(ref) {
      if (destroyed || typeof ref !== "string") return null;
      const descriptor = byRef.get(ref);
      if (!descriptor) return null;
      return { ...descriptor, consumed: consumed.has(ref) };
    },

    isConsumed: (ref) => consumed.has(ref),

    consume(ref) {
      if (destroyed || !byRef.has(ref) || consumed.has(ref)) return false;
      consumed.add(ref);
      return true;
    },

    holdsLiteral(literal) {
      const answer = answers.get(literal);
      if (answer === undefined) {
        // Fail loudly. A view that shrugged would report every leak as CLEAN.
        throw new Error("vault view: no answer was established for this literal; the boundary was not asked.");
      }
      return answer;
    },

    learn(literal, answer) {
      answers.set(literal, answer);
    },

    destroy() {
      destroyed = true;
      byRef.clear();
      answers.clear();
      consumed.clear();
    },
  };
}
