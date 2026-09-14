/**
 * The class and tier model, and the rule that decides what happens when two signals disagree.
 *
 * The classes and tiers are not invented here. They are the confidentiality classes frozen in
 * `docs/security/security-invariants.md` ("Confidentiality classes") narrowed to the four
 * tokenisable classes plus OTP that this prototype scope covers, and the treatment column of that
 * table is what `TIER_OF` encodes:
 *
 * - **CRITICAL** (OTP) — masked, **never tokenised for server reference**, never re-hydrated without
 *   explicit per-use confirmation.
 * - **SENSITIVE** (Aadhaar) — masked and tokenised, re-hydrated at execution.
 * - **PERSONAL** (name, phone, DOB) — masked and tokenised, re-hydrated at execution.
 *
 * PROTECTION RANKING — WHY DISAGREEMENT RESOLVES UPWARD, ALWAYS.
 *
 * Two signals can disagree about one value: a field labelled "Mobile number" holding twelve digits
 * that pass the Verhoeff checksum, for instance. The frozen union rule is "recall is prioritised over
 * precision, because over-masking is free and under-masking is fatal", so the more protective class
 * wins and there is deliberately no path that lowers a class. Over-protecting costs a token the
 * server cannot use; under-protecting puts an Aadhaar number on the wire.
 *
 * The ordering below is by treatment, not by intuition: CRITICAL outranks SENSITIVE outranks
 * PERSONAL, and inside PERSONAL a stronger identifier outranks a weaker one.
 */

/** The prototype's class scope. Deliberately narrow; see the package README. */
export type PiiClass = "PHONE" | "AADHAAR" | "DOB" | "NAME" | "OTP" | "UNKNOWN";

/** What a *field* can be classified as. `FREE_TEXT` is a field property, never a value class. */
export type FieldClass = PiiClass | "FREE_TEXT";

export type Tier = "CRITICAL" | "SENSITIVE" | "PERSONAL" | "PUBLIC";

export const PII_CLASSES: readonly PiiClass[] = ["OTP", "AADHAAR", "PHONE", "DOB", "NAME", "UNKNOWN"];

/**
 * Class → treatment tier. **PROPOSED**, exactly as E2 recorded it: owner decisions D-C and D-D are
 * not taken, so this table is a proposal the code applies, not an approved policy.
 */
export const TIER_OF: Readonly<Record<PiiClass, Tier>> = {
  OTP: "CRITICAL",
  AADHAAR: "SENSITIVE",
  PHONE: "PERSONAL",
  DOB: "PERSONAL",
  NAME: "PERSONAL",
  UNKNOWN: "PUBLIC",
};

/**
 * Classes that may receive an opaque reference.
 *
 * OTP is absent because CRITICAL values are never tokenised (INV — confidentiality classes), and
 * UNKNOWN is absent because a class nobody established is not a class to hand the server a handle to.
 */
export const TOKENISABLE_CLASSES: readonly PiiClass[] = ["AADHAAR", "PHONE", "DOB", "NAME"];

export const isTokenisable = (cls: PiiClass): boolean => TOKENISABLE_CLASSES.includes(cls);

/**
 * Protection rank. Higher is more protective; disagreement resolves to the maximum, never the minimum.
 *
 * There is intentionally no inverse operation in this module: nothing can pick the *less* protective
 * of two classes, so a downgrade cannot be written by accident.
 */
const RANK: Readonly<Record<PiiClass, number>> = {
  UNKNOWN: 0,
  NAME: 1,
  DOB: 2,
  PHONE: 3,
  AADHAAR: 4,
  OTP: 5,
};

export const protectionRank = (cls: PiiClass): number => RANK[cls];

/** The more protective of two classes. Equal classes return themselves. */
export const mostProtective = (a: PiiClass, b: PiiClass): PiiClass => (RANK[b] > RANK[a] ? b : a);

/** The more protective class across any number of signals. No signals at all is `UNKNOWN`. */
export const mostProtectiveOf = (classes: readonly PiiClass[]): PiiClass =>
  classes.reduce<PiiClass>((winner, cls) => mostProtective(winner, cls), "UNKNOWN");

/** A field class narrowed to a value class. `FREE_TEXT` carries no value claim, so it is UNKNOWN. */
export const asPiiClass = (cls: FieldClass): PiiClass => (cls === "FREE_TEXT" ? "UNKNOWN" : cls);
