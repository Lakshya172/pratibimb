/**
 * Package-internal access, and the honest statement of what it is worth.
 *
 * Recovering a stored value is a capability exactly one caller may have: the binding boundary, after
 * every check in `bind.ts` has passed. If `reveal` were a public method on the vault, "just read the
 * value here" would be one keystroke away at every future call site, and that shortcut is how a
 * privacy boundary becomes decorative.
 *
 * So the vault's reveal path hangs off a module-private symbol. This module is not exported from the
 * package (`exports` lists `.` only), so nothing outside can import the symbol and nothing outside
 * can call the method it keys.
 *
 * ITS LIMIT, stated the way ADR-0005, ADR-0007 and ADR-0008 state theirs: this is a same-realm
 * integrity boundary, not a capability system. It makes an accidental bypass impossible and a
 * deliberate one unwritable by mistake. Code running inside this realm that is determined to reach
 * the value can still do so, and the adversaries this prototype names — a page in another JavaScript
 * world, a server that can only send JSON — cannot.
 */

/** Keys the vault's only value-returning method. Never exported from `index.ts`. */
export const REVEAL: unique symbol = Symbol("pratibimb.privacy.reveal");
