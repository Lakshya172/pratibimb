/**
 * Normalisation for comparison — the shared vocabulary of "is this the same secret, written
 * differently?".
 *
 * The frozen verifier sequence asks for exactly this at step 5: "exact + fuzzy match against vault
 * contents (normalised n-grams, whitespace-insensitive, tolerant of OCR confusions such as 0/O and
 * 1/l)". A leak check that only catches a byte-for-byte repeat is a leak check an attacker walks
 * around by inserting a hyphen.
 *
 * These functions take secrets as arguments and must therefore never log, throw with, or return
 * anything derived from them beyond a boolean (INV-21). They are pure and allocate short-lived
 * strings only.
 */

/** Letters that are routinely confused with digits, folded towards the digit. */
const CONFUSIONS: Readonly<Record<string, string>> = { o: "0", O: "0", l: "1", I: "1", i: "1", S: "5", s: "5" };

/**
 * Digits as an attacker would read them back: confusions folded, everything else dropped.
 *
 * A number written with a country code and hyphens, and the same number with letters standing in for
 * digits, both reduce to the digit string the vault holds. No example is written out here: a
 * synthetic demo value in a source comment is still a value in the source (SECURITY.md §2), and the
 * test suite is where those live.
 */
export function digitFold(raw: string): string {
  let out = "";
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else {
      const folded = CONFUSIONS[ch];
      if (folded !== undefined) out += folded;
    }
  }
  return out;
}

/** Text as an attacker would read it back: case-insensitive, punctuation and spacing removed. */
export const textFold = (raw: string): string => raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Does `candidate` contain `secret`, under either folding?
 *
 * Containment rather than equality, because a sentence with the number embedded in it — "my number
 * is <the number>" — leaks exactly as much as the number alone. The digit comparison only runs when
 * the secret is mostly digits, so a two-letter
 * name cannot collide with an unrelated number.
 *
 * Returns a boolean and nothing else — never the match, the offset, or the secret.
 */
export function containsSecret(candidate: string, secret: string): boolean {
  const secretDigits = digitFold(secret);
  const secretText = textFold(secret);

  if (secretDigits.length >= 4) {
    if (digitFold(candidate).includes(secretDigits)) return true;
  }
  if (secretText.length >= 4) {
    if (textFold(candidate).includes(secretText)) return true;
  }
  return false;
}
