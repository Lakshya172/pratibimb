/**
 * Deterministic validators — the D2 channel of the frozen redaction union: "pattern plus checksum.
 * Verhoeff and Luhn kill the false positives regex alone creates."
 *
 * Every function here is pure, synchronous, and decides from the value alone. No model, no network,
 * no heuristics that drift between runs. A validator answers one question — "is this value, as
 * written, a well-formed instance of this class?" — and nothing else: it does not decide policy, and
 * a `false` never means "safe to transmit", only "not an instance of this class".
 *
 * SCOPE, STATED RATHER THAN IMPLIED. The prototype scope is PHONE, AADHAAR, DOB, NAME and OTP. Luhn,
 * PAN, IFSC and GSTIN are named in the frozen union table and are **not implemented here**, because
 * no class in this scope needs them and unused validation surface is a liability, not a feature.
 *
 * NOTHING IN THIS FILE LOGS, THROWS WITH, OR RETURNS THE VALUE IT WAS GIVEN (INV-21).
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Verhoeff — the Aadhaar checksum
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Dihedral group D5 multiplication table. */
const D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** Permutation table, applied by position. */
const P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * The Verhoeff check over a digit string, checksum digit included.
 *
 * Standard algorithm, unmodified. **It is not adjusted to make any particular demo value pass**: a
 * checksum that is relaxed until the fixture is happy is not a checksum.
 */
export function verhoeffValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const digit = Number(reversed[i]);
    const row = P[i % 8] as readonly number[];
    const permuted = row[digit] as number;
    c = (D[c] as readonly number[])[permuted] as number;
  }
  return c === 0;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Spaces and hyphens are presentation, not identity. Nothing else is stripped. */
const digitsOnly = (raw: string): string => raw.replace(/[\s-]/g, "");

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Aadhaar
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Twelve digits, not starting 0 or 1 (UIDAI does not issue those), and a valid Verhoeff checksum.
 *
 * The checksum is what makes this a detector rather than a twelve-digit-number finder.
 */
export function isAadhaarNumber(raw: string): boolean {
  const value = digitsOnly(raw);
  if (!/^[2-9][0-9]{11}$/.test(value)) return false;
  return verhoeffValid(value);
}

/** Canonical form: digits only. Returns `null` when the value is not a valid Aadhaar number. */
export const normaliseAadhaar = (raw: string): string | null =>
  isAadhaarNumber(raw) ? digitsOnly(raw) : null;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Indian mobile number
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Ten digits beginning 6–9, with an optional `+91`, `0091` or leading `0` trunk prefix.
 *
 * The leading-digit rule is the whole check: Indian mobile ranges start 6, 7, 8 or 9, so a
 * ten-digit string starting 5 is not one, and a twelve-digit Aadhaar number is not one either.
 */
export function normaliseIndianMobile(raw: string): string | null {
  const value = digitsOnly(raw).replace(/^(?:\+?91|0091|0)/, "");
  return /^[6-9][0-9]{9}$/.test(value) ? value : null;
}

export const isIndianMobile = (raw: string): boolean => normaliseIndianMobile(raw) !== null;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Date of birth
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * An ISO `YYYY-MM-DD` calendar date inside a plausible birth window.
 *
 * The round-trip through `Date` is what rejects 2026-02-30: a calendar-shaped string is not a
 * calendar date. The window (1900-01-01 to the reference day) is deterministic given `today`, which
 * is injected so a test is not a function of when it runs.
 */
export function isDateOfBirth(raw: string, today: Date = new Date()): boolean {
  const value = raw.trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // Reject 2026-02-30 and friends: Date would have rolled them over.
  if (parsed.toISOString().slice(0, 10) !== value) return false;
  const earliest = Date.UTC(1900, 0, 1);
  return parsed.getTime() >= earliest && parsed.getTime() <= today.getTime();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Name and OTP
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A demo-safe person-name shape: two to four whitespace-separated words of letters.
 *
 * **This is not name recognition.** Real name detection is the D3 semantic channel (GLiNER), which
 * this prototype does not include; a list of words that look like a name is all this is, and it will
 * both miss real names and accept things that are not names. It exists so the fixture's NAME field
 * has a deterministic detector, and the package README says so plainly.
 */
export function isDemoSafeName(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 3 || value.length > 60) return false;
  const words = value.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^\p{Lu}\p{L}{1,}$/u.test(word));
}

/** Four to eight digits. Shape only — an OTP is recognised by its field far more reliably. */
export const isOtpShaped = (raw: string): boolean => /^[0-9]{4,8}$/.test(raw.trim());
