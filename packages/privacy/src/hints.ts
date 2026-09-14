/**
 * Hints — "the mechanism that makes the design work. It preserves the *type* while destroying the
 * *content*: ten characters, numeric, field role `tel`." (`docs/architecture/manifest-schema.md`.)
 *
 * A hint exists so the server can still reason — validate a length, choose a keyboard, lay out a
 * form — without being told anything it could use to reconstruct the value.
 *
 * THE RULE THIS FILE ENFORCES: a hint is built from the value's **shape**, never from its
 * characters. `len` and `kind` are derived by counting and by testing membership; no substring, no
 * prefix, no suffix, no masked rendering of the value is produced here, because a masked rendering
 * is a substring with a costume on (`9000-XXX-001` tells an attacker six digits).
 *
 * `len` is in the frozen contract, and it is worth being honest about what it gives away: for a
 * class with a fixed width — a ten-digit phone, a twelve-digit Aadhaar — the length is implied by
 * the class and tells an attacker nothing new. For a name it is a weak signal about the value, and
 * the contract still asks for it, so it is emitted and stated here rather than quietly dropped.
 */
import { type PiiClass } from "./classes.js";

/** The representation kind a server needs in order to lay out and validate a field. */
export type HintKind = "numeric" | "alpha" | "alphanumeric" | "date";

export interface Hint {
  readonly len: number;
  readonly kind: HintKind;
  /** The field's role, where one is known: `tel`, `bday`, `name`. Never the field's contents. */
  readonly field_role?: string;
}

const kindOf = (piiClass: PiiClass, value: string): HintKind => {
  if (piiClass === "DOB") return "date";
  if (/^[0-9\s-]+$/.test(value)) return "numeric";
  if (/^[\p{L}\s.'-]+$/u.test(value)) return "alpha";
  return "alphanumeric";
};

/**
 * Build the hint for a value that is about to be replaced by a token.
 *
 * Takes the value only to measure it. Nothing derived from the characters themselves is kept, and
 * the returned object is frozen so a later stage cannot decorate it with "just a prefix".
 */
export function hintFor(piiClass: PiiClass, value: string, fieldRole?: string): Hint {
  const trimmed = value.trim();
  const base = { len: trimmed.length, kind: kindOf(piiClass, trimmed) };
  return Object.freeze(fieldRole ? { ...base, field_role: fieldRole } : base);
}

/**
 * The field role a hint may carry, taken from what the page declares about the field.
 *
 * Autocomplete first because it is the page's own machine-readable statement of intent; the input
 * type second. Anything else is omitted rather than invented.
 */
export function fieldRoleOf(field: { readonly autocomplete?: string; readonly type?: string }): string | undefined {
  const autocomplete = (field.autocomplete ?? "").trim().toLowerCase();
  if (autocomplete) return autocomplete;
  const type = (field.type ?? "").trim().toLowerCase();
  return type === "" || type === "text" ? undefined : type;
}
