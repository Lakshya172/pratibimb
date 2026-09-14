/**
 * Classification: what is this field, what is this value, and which answer wins when they disagree.
 *
 * TWO CHANNELS, KEPT SEPARATE ON PURPOSE — they are the two that need no machine learning, and the
 * frozen union table says they "already cover most structured Indian PII, which is why they ship
 * first":
 *
 * - **D1, the field.** Autocomplete tokens, input type, and keyword tables over the field name and
 *   its label. This is the rules-and-vocabulary half, reconstructed from the E2 class-binding
 *   experiment's classifier (`artifacts/experiments/E2-class-binding/harness/binder.mjs`, W2, PASS on
 *   its pre-registered table) so that the package and that evidence say the same thing.
 * - **D2, the value.** Pattern plus checksum, from `validators.ts`.
 *
 * E2's rule about ambiguity is preserved exactly, because it is the interesting one: **more than one
 * signal, or any signal naming something else, yields `UNKNOWN`.** A field that says two things is a
 * field nobody has identified, and identifying it anyway is guessing. `UNKNOWN` fields are never
 * tokenised and never bound, so the cost of ambiguity is a refusal rather than a wrong mapping.
 *
 * WHEN THE TWO CHANNELS DISAGREE the more protective class wins (`classes.ts`). A field labelled
 * "Mobile number" holding a Verhoeff-valid twelve-digit number is treated as AADHAAR.
 *
 * OTP IS A FIELD-LEVEL DETERMINATION, and this is a deliberate limit rather than an oversight. Four
 * to eight digits describes an OTP, a PIN code, a year range and an order number equally well;
 * asserting CRITICAL from shape alone would make every short number un-tokenisable. An OTP is
 * recognised by the field it sits in — `autocomplete="one-time-code"`, or a label that says so.
 */
import {
  asPiiClass,
  mostProtective,
  type FieldClass,
  type PiiClass,
} from "./classes.js";
import { isAadhaarNumber, isDateOfBirth, isDemoSafeName, isIndianMobile } from "./validators.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D1 — the field
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What a content script may read about a field. No value, by construction. */
export interface ObservedFieldShape {
  readonly tag?: string;
  readonly type?: string;
  readonly autocomplete?: string;
  readonly name?: string;
  readonly label?: string;
}

const AUTOCOMPLETE: Readonly<Record<string, FieldClass>> = {
  tel: "PHONE",
  "tel-national": "PHONE",
  "tel-local": "PHONE",
  name: "NAME",
  bday: "DOB",
  "bday-day": "DOB",
  "bday-month": "DOB",
  "bday-year": "DOB",
  "one-time-code": "OTP",
};

/** Autocomplete tokens that name something else. Their presence forbids a class guess. */
const AUTOCOMPLETE_OTHER = new Set([
  "username",
  "email",
  "current-password",
  "new-password",
  "given-name",
  "family-name",
  "organization",
]);

const TYPE: Readonly<Record<string, FieldClass>> = { tel: "PHONE", date: "DOB" };
const TYPE_OTHER = new Set(["password", "email", "hidden"]);

/** Order does not matter: every matching class is collected, and more than one is a conflict. */
const KEYWORDS: readonly (readonly [FieldClass, RegExp])[] = [
  ["OTP", /\b(otp|one[- ]time (?:password|code)|verification code)\b/i],
  ["AADHAAR", /\b(aadhaa?r|uid(?:ai)?)\b/i],
  ["DOB", /\b(date of birth|dob|birth ?date)\b/i],
  ["PHONE", /\b(mobile|phone|telephone|contact number)\b/i],
  ["FREE_TEXT", /\b(feedback|comments?|remarks?|message|purpose|description)\b/i],
  ["NAME", /\bname\b/i],
];

/** A "name" that is not the applicant's own full name. */
const NAME_QUALIFIER =
  /\b(father'?s?|mother'?s?|spouse'?s?|guardian'?s?|nominee'?s?|company|organi[sz]ation|business|file|user|display|first|last|middle)\b/i;

const signalsFrom = (text: string | undefined): Set<FieldClass | "OTHER"> => {
  const out = new Set<FieldClass | "OTHER">();
  if (!text) return out;
  const normalised = String(text).replace(/[_-]+/g, " ");
  for (const [cls, pattern] of KEYWORDS) {
    if (!pattern.test(normalised)) continue;
    if (cls === "NAME" && NAME_QUALIFIER.test(normalised)) {
      out.add("OTHER");
      continue;
    }
    out.add(cls);
  }
  return out;
};

/**
 * D1. Returns PHONE | NAME | DOB | AADHAAR | OTP | FREE_TEXT | UNKNOWN, and never guesses.
 *
 * Reconstructed from E2's classifier, rule for rule.
 */
export function classifyField(field: ObservedFieldShape): FieldClass {
  const signals = new Set<FieldClass | "OTHER">();

  const autocomplete = (field.autocomplete ?? "").trim().toLowerCase();
  if (autocomplete) {
    const known = AUTOCOMPLETE[autocomplete];
    if (known) signals.add(known);
    else if (AUTOCOMPLETE_OTHER.has(autocomplete)) signals.add("OTHER");
  }

  const type = (field.type ?? "").toLowerCase();
  const knownType = TYPE[type];
  if (knownType) signals.add(knownType);
  else if (TYPE_OTHER.has(type)) signals.add("OTHER");

  for (const signal of signalsFrom(field.name)) signals.add(signal);
  for (const signal of signalsFrom(field.label)) signals.add(signal);

  if (signals.has("OTHER")) return "UNKNOWN";
  if (signals.size === 1) return [...signals][0] as FieldClass;
  if (signals.size > 1) return "UNKNOWN";
  return field.tag === "textarea" ? "FREE_TEXT" : "UNKNOWN";
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D2 — the value
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * D2. Pattern plus checksum over the value alone.
 *
 * Every class that matches is collected and the most protective wins, so a value that is both
 * plausible-as-X and valid-as-Y resolves upward rather than to whichever test ran first.
 */
export function classifyValue(raw: string, today: Date = new Date()): PiiClass {
  const value = raw.trim();
  if (value === "") return "UNKNOWN";
  const matches: PiiClass[] = [];
  if (isAadhaarNumber(value)) matches.push("AADHAAR");
  if (isIndianMobile(value)) matches.push("PHONE");
  if (isDateOfBirth(value, today)) matches.push("DOB");
  if (isDemoSafeName(value)) matches.push("NAME");
  return matches.reduce<PiiClass>((winner, cls) => mostProtective(winner, cls), "UNKNOWN");
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The combined answer
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface ObservedField extends ObservedFieldShape {
  /** Stable identity of the element, as perception reports it. */
  readonly id: string;
  /** The local value. It never leaves this process except into the vault. */
  readonly value: string;
  /** The page origin the field belongs to. */
  readonly origin?: string;
}

export interface Classification {
  readonly fieldClass: FieldClass;
  readonly valueClass: PiiClass;
  /** What the value is treated as. Never less protective than either channel. */
  readonly effective: PiiClass;
  /** True when the two channels named different classes and the protective rule decided it. */
  readonly disagreement: boolean;
}

/**
 * The classification the sanitizer acts on.
 *
 * `effective` is the maximum of the two channels under the protection ranking. There is no branch
 * here that can lower it, which is the property the disagreement test pins.
 */
export function classifyObserved(field: ObservedField, today: Date = new Date()): Classification {
  const fieldClass = classifyField(field);
  const valueClass = classifyValue(field.value, today);
  const fieldAsValue = asPiiClass(fieldClass);
  const effective = mostProtective(fieldAsValue, valueClass);
  return {
    fieldClass,
    valueClass,
    effective,
    disagreement: fieldAsValue !== "UNKNOWN" && valueClass !== "UNKNOWN" && fieldAsValue !== valueClass,
  };
}
