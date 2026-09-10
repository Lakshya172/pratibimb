/**
 * Fail-closed states for the perception tier.
 *
 * The rule this file encodes: **where evidence is unavailable, perception produces an
 * explicit typed state — never a guessed coordinate and never a fabricated observation.**
 *
 * This is not defensive programming for its own sake. Every code below names a situation
 * in which the honest answer is "I do not know where that is", and in every one of them
 * the tempting alternative is a plausible-looking number. A plausible-looking number is
 * worse than an error, because it travels: it reaches the manifest, the server plans an
 * action against it, and the executor clicks somewhere real that nobody chose.
 */

export type PerceptionErrorCode =
  /** The capture mechanism did not produce a frame. */
  | "CAPTURE_FAILED"
  /**
   * The browser refused this capture because its own rate quota was exceeded.
   *
   * Distinct from `CAPTURE_FAILED` on measured grounds, not stylistic ones. W1-S05-rate
   * established that on Chromium this state is **recoverable, self-identifying and
   * short-lived** — the browser names the quota in its error text, and the next capture
   * succeeded after ~1.15 s in both runs. `CAPTURE_FAILED` carries no such promise; a
   * restricted URL or a torn-down tab will not fix itself.
   *
   * A scheduler must be able to tell "wait and this will work" from "this will not work",
   * and collapsing both into one code destroys exactly that distinction.
   *
   * **The adapter does not act on this.** It does not retry, back off, sleep or queue. It
   * reports the state and the refresh scheduler decides — see `capture.ts`.
   */
  | "CAPTURE_THROTTLED"
  /** Capture dimensions cannot describe the viewport with one scale factor. */
  | "CAPTURE_DIMENSION_MISMATCH"
  /** A transform was requested from geometry that does not determine one. */
  | "COORDINATE_TRANSFORM_AMBIGUOUS"
  /** Work was attempted against a frame that is no longer current. */
  | "STALE_FRAME"
  /** A visual claim was attempted about an element outside the captured frame. */
  | "ELEMENT_OUTSIDE_CAPTURE"
  /** No implementation is registered for a detector role. */
  | "DETECTOR_UNAVAILABLE"
  /** The chosen backend is not supported for this detector on this browser. */
  | "DETECTOR_BACKEND_UNSUPPORTED"
  /** A detector returned something that does not satisfy its output contract. */
  | "MODEL_OUTPUT_MALFORMED"
  /** A pinned model asset is absent, or its bytes do not match the registry. */
  | "MODEL_ASSET_UNAVAILABLE"
  /** Provenance could not be established for a perceived element. */
  | "PROVENANCE_UNAVAILABLE";

export class PerceptionError extends Error {
  override readonly name = "PerceptionError";
  constructor(
    message: string,
    readonly code: PerceptionErrorCode,
    // `override` is required: Error already declares `cause`. Keeping the underlying error
    // attached matters - "the detector was unavailable" is far more actionable with the
    // runtime's own message than without it.
    override readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * A result that is either a value or a typed refusal.
 *
 * Used where refusal is an ordinary, expected outcome that the caller must handle — a
 * detector being unavailable on this browser, say — rather than an exceptional one. Where
 * refusal indicates the caller has already made a mistake, `PerceptionError` is thrown
 * instead: an ambiguous transform is not a value anyone should be handling politely.
 */
export type Perceived<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: PerceptionErrorCode; readonly detail: string };

export const ok = <T>(value: T): Perceived<T> => ({ ok: true, value });

export const refuse = <T>(code: PerceptionErrorCode, detail: string): Perceived<T> => ({
  ok: false,
  code,
  detail,
});
