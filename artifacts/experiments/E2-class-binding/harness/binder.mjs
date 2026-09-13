/**
 * E2 experiment harness — a field classifier and a reference binder. NOT the production binder.
 *
 * Written after `cases.mjs` was committed, against those frozen expectations. Deterministic, no model,
 * no network, no browser, no values: a reference is only ever a token string, and nothing here holds
 * what a token stands for.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Classifier — D1-style rules over what a content script may read
// ─────────────────────────────────────────────────────────────────────────────────────────────

const AUTOCOMPLETE = {
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
/** Autocomplete tokens that name something else. Their presence forbids a value-class guess. */
const AUTOCOMPLETE_OTHER = new Set(["username", "email", "current-password", "new-password", "given-name", "family-name", "organization"]);
const TYPE = { tel: "PHONE", date: "DOB" };
const TYPE_OTHER = new Set(["password", "email", "hidden"]);

/** Order does not matter: every matching class is collected, and more than one is a conflict. */
const KEYWORDS = [
  ["OTP", /\b(otp|one[- ]time (?:password|code)|verification code)\b/i],
  ["AADHAAR", /\b(aadhaa?r|uid(?:ai)?)\b/i],
  ["DOB", /\b(date of birth|dob|birth ?date)\b/i],
  ["PHONE", /\b(mobile|phone|telephone|contact number)\b/i],
  ["FREE_TEXT", /\b(feedback|comments?|remarks?|message|purpose|description)\b/i],
  ["NAME", /\bname\b/i],
];
/** A "name" that is not the applicant's own full name. */
const NAME_QUALIFIER = /\b(father'?s?|mother'?s?|spouse'?s?|guardian'?s?|nominee'?s?|company|organi[sz]ation|business|file|user|display|first|last|middle)\b/i;

const signalsFrom = (text) => {
  const out = new Set();
  if (!text) return out;
  const t = String(text).replace(/[_-]+/g, " ");
  for (const [cls, re] of KEYWORDS) {
    if (!re.test(t)) continue;
    if (cls === "NAME" && NAME_QUALIFIER.test(t)) {
      out.add("OTHER");
      continue;
    }
    out.add(cls);
  }
  return out;
};

/** Returns PHONE | NAME | DOB | AADHAAR | OTP | FREE_TEXT | UNKNOWN. Never guesses between signals. */
export function classifyField(f) {
  const signals = new Set();
  const ac = (f.autocomplete || "").trim().toLowerCase();
  if (ac) {
    if (AUTOCOMPLETE[ac]) signals.add(AUTOCOMPLETE[ac]);
    else if (AUTOCOMPLETE_OTHER.has(ac)) signals.add("OTHER");
  }
  const ty = (f.type || "").toLowerCase();
  if (TYPE[ty]) signals.add(TYPE[ty]);
  else if (TYPE_OTHER.has(ty)) signals.add("OTHER");
  for (const s of signalsFrom(f.name)) signals.add(s);
  for (const s of signalsFrom(f.label)) signals.add(s);

  if (signals.has("OTHER")) return "UNKNOWN";
  if (signals.size === 1) return [...signals][0];
  if (signals.size > 1) return "UNKNOWN";
  return f.tag === "textarea" ? "FREE_TEXT" : "UNKNOWN";
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Tokens and tiers
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** PROPOSED tier table (owner decisions D-C, D-D not taken). A class absent here cannot be tokenised. */
export const TIER = { PHONE: "PERSONAL", NAME: "PERSONAL", DOB: "PERSONAL", AADHAAR: "SENSITIVE" };
const CRITICAL_CLASSES = new Set(["OTP"]);

export const newVault = () => ({ tokens: new Map(), counters: new Map() });

/** Issue a reference for a value class. CRITICAL and unknown classes are refused: no token, ever. */
export function issueToken(vault, cls, origin) {
  if (CRITICAL_CLASSES.has(cls) || !TIER[cls]) return { issued: false, cause: CRITICAL_CLASSES.has(cls) ? "CRITICAL_NOT_TOKENISED" : "UNKNOWN_CLASS" };
  const n = (vault.counters.get(cls) ?? 0) + 1;
  vault.counters.set(cls, n);
  const ref = `<PII:${cls}:${n}>`;
  vault.tokens.set(ref, { class: cls, tier: TIER[cls], origin });
  return { issued: true, ref };
}

const TOKEN_RE = /^<PII:[A-Z]+:[1-9][0-9]*>$/;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Binder
// ─────────────────────────────────────────────────────────────────────────────────────────────

const refuse = (cause) => ({ decision: "REFUSE", cause });
const needsUser = (cause) => ({ decision: "NEEDS_USER", cause });

/**
 * bind(step, ctx) — may this reference go into this field, now?
 *
 * step: { ref, targetId, viewId }
 * ctx:  { vault, view: { viewId, documentId, fields: Map(id → { accepts, origin, fingerprint }) },
 *         currentDocumentId, consumed: Set("ref|fingerprint"),
 *         classOriginGrants: Set("CLASS|origin"),
 *         useGrants: [{ ref, fingerprint, origin, expiresAt, used }], now }
 *
 * Ordered, fail-closed, and there is exactly one statement that returns BIND_OK.
 */
export function bind(step, ctx) {
  if (step.viewId !== ctx.view.viewId) return refuse("STALE_VIEW");
  if (ctx.currentDocumentId !== ctx.view.documentId) return refuse("STALE_BINDING");

  const field = ctx.view.fields.get(step.targetId);
  if (!field) return refuse("UNKNOWN_TARGET");

  if (typeof step.ref !== "string" || !TOKEN_RE.test(step.ref)) return refuse("UNKNOWN_TOKEN");
  const token = ctx.vault.tokens.get(step.ref);
  if (!token) return refuse("UNKNOWN_TOKEN");

  if (CRITICAL_CLASSES.has(token.class) || !TIER[token.class]) return needsUser("CRITICAL_NEVER_AGENT_TYPED");
  if (field.accepts === "OTP") return needsUser("CRITICAL_FIELD");
  if (field.accepts === "UNKNOWN") return needsUser("AMBIGUOUS_FIELD");
  if (field.accepts !== token.class) return refuse("CLASS_MISMATCH");
  if (field.origin !== token.origin) return refuse("ORIGIN_MISMATCH");
  if (ctx.consumed.has(`${step.ref}|${field.fingerprint}`)) return refuse("CONSUMED");
  if (!ctx.classOriginGrants.has(`${token.class}|${field.origin}`)) return needsUser("CLASS_ORIGIN_GRANT_REQUIRED");

  if (token.tier === "SENSITIVE") {
    const grant = ctx.useGrants.find(
      (g) => g.ref === step.ref && g.fingerprint === field.fingerprint && g.origin === field.origin && !g.used && ctx.now < g.expiresAt
    );
    if (!grant) return { decision: "NEEDS_HUMAN_GRANT" };
  }
  return { decision: "BIND_OK" };
}
