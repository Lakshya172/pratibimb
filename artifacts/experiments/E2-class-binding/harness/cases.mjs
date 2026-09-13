/**
 * E2 — PRE-REGISTERED expectations.
 *
 * Committed BEFORE the classifier and binder existed, so the expected outcomes cannot have been fitted
 * to what the code does. A failing case is reported as a failure. The only permitted responses are
 * the documented fallbacks (UNKNOWN → NEEDS_USER, or a human-confirmed field map) — never loosening
 * the binder, never editing an expectation to match an output.
 *
 * Policy under test (PROPOSED — owner decisions D-C and D-D are not taken):
 *   PHONE, NAME, DOB → PERSONAL   : class binding + origin + single use + class×origin grant
 *   AADHAAR          → SENSITIVE  : the above + a per-use human grant
 *   OTP              → CRITICAL   : never agent-typed; no token may even be issued (NEEDS_USER)
 *   FREE_TEXT        → not a value class; accepts no reference
 *   UNKNOWN          → NEEDS_USER
 *
 * Outcomes: BIND_OK · REFUSE (with cause) · NEEDS_USER (with cause) · NEEDS_HUMAN_GRANT.
 */

export const ORIGIN = "http://127.0.0.1:8990";

/** Field descriptors — only what a content script may read: tag, type, autocomplete, inputmode, name, label. */
export const CLASSIFIER_CASES = [
  // ── legitimate demo fields ──────────────────────────────────────────────────────────────
  { id: "L-PHONE-1", set: "LEGIT", field: { tag: "input", type: "tel", autocomplete: "tel", name: "mobile", label: "Mobile number" }, expect: "PHONE" },
  { id: "L-PHONE-2", set: "LEGIT", field: { tag: "input", type: "text", inputmode: "numeric", name: "mobile_no", label: "Mobile No." }, expect: "PHONE" },
  { id: "L-PHONE-3", set: "LEGIT", field: { tag: "input", type: "tel", name: "phone", label: "Phone (10 digits)" }, expect: "PHONE" },
  { id: "L-NAME-1", set: "LEGIT", field: { tag: "input", type: "text", autocomplete: "name", name: "full_name", label: "Full name" }, expect: "NAME" },
  { id: "L-NAME-2", set: "LEGIT", field: { tag: "input", type: "text", name: "applicant", label: "Applicant name" }, expect: "NAME" },
  { id: "L-NAME-3", set: "LEGIT", field: { tag: "input", type: "text", name: "nm", label: "Name as per records" }, expect: "NAME" },
  { id: "L-DOB-1", set: "LEGIT", field: { tag: "input", type: "date", autocomplete: "bday", name: "dob", label: "Date of birth" }, expect: "DOB" },
  { id: "L-DOB-2", set: "LEGIT", field: { tag: "input", type: "text", name: "dob", label: "DOB (DD/MM/YYYY)" }, expect: "DOB" },
  { id: "L-DOB-3", set: "LEGIT", field: { tag: "input", type: "text", name: "birth", label: "Birth date" }, expect: "DOB" },
  { id: "L-AADHAAR-1", set: "LEGIT", field: { tag: "input", type: "text", inputmode: "numeric", name: "aadhaar", label: "Aadhaar number" }, expect: "AADHAAR" },
  { id: "L-AADHAAR-2", set: "LEGIT", field: { tag: "input", type: "text", name: "uid", label: "Aadhaar No." }, expect: "AADHAAR" },
  { id: "L-AADHAAR-3", set: "LEGIT", field: { tag: "input", type: "text", name: "uid_no", label: "UID / Aadhaar" }, expect: "AADHAAR" },
  { id: "L-OTP-1", set: "LEGIT", field: { tag: "input", type: "text", autocomplete: "one-time-code", name: "otp", label: "OTP" }, expect: "OTP" },
  { id: "L-OTP-2", set: "LEGIT", field: { tag: "input", type: "text", name: "code", label: "Enter OTP" }, expect: "OTP" },
  { id: "L-OTP-3", set: "LEGIT", field: { tag: "input", type: "text", name: "vcode", label: "Verification code" }, expect: "OTP" },
  { id: "L-FREE-1", set: "LEGIT", field: { tag: "textarea", name: "feedback", label: "Feedback" }, expect: "FREE_TEXT" },
  { id: "L-FREE-2", set: "LEGIT", field: { tag: "textarea", name: "purpose", label: "Purpose of application" }, expect: "FREE_TEXT" },
  { id: "L-FREE-3", set: "LEGIT", field: { tag: "input", type: "text", name: "remarks", label: "Remarks" }, expect: "FREE_TEXT" },

  // ── ambiguous: must not be guessed ──────────────────────────────────────────────────────
  { id: "A-CONTACT", set: "AMBIGUOUS", field: { tag: "input", type: "text", name: "contact", label: "Contact" }, expect: "UNKNOWN" },
  { id: "A-CONFLICT-SIGNALS", set: "AMBIGUOUS", field: { tag: "input", type: "tel", autocomplete: "tel", name: "aadhaar", label: "Aadhaar number" }, expect: "UNKNOWN" },
  { id: "A-FATHERS-NAME", set: "AMBIGUOUS", field: { tag: "input", type: "text", name: "father", label: "Father's name" }, expect: "UNKNOWN" },
  { id: "A-COMPANY-NAME", set: "AMBIGUOUS", field: { tag: "input", type: "text", name: "company", label: "Company name" }, expect: "UNKNOWN" },
  { id: "A-USERNAME", set: "AMBIGUOUS", field: { tag: "input", type: "text", autocomplete: "username", name: "user", label: "Username" }, expect: "UNKNOWN" },
  { id: "A-NO-SIGNAL", set: "AMBIGUOUS", field: { tag: "input", type: "text", name: "f7", label: "Field 7" }, expect: "UNKNOWN" },
  { id: "A-LABEL-FEEDBACK-NAME-AADHAAR", set: "AMBIGUOUS", field: { tag: "textarea", name: "feedback", label: "Aadhaar number" }, expect: "UNKNOWN" },

  // ── residual: a page that truthfully LOOKS like the field; classification is page-controlled ──
  { id: "R-SPOOF-AADHAAR", set: "RESIDUAL", field: { tag: "textarea", name: "aadhaar", label: "Aadhaar number" }, expect: "AADHAAR" },
  { id: "R-SPOOF-PHONE", set: "RESIDUAL", field: { tag: "input", type: "text", name: "mobile", label: "Mobile number" }, expect: "PHONE" },
];

/**
 * Binding cases. `field` refers to a CLASSIFIER_CASES id (its classification is computed, not assumed).
 * Context defaults: view "v3", document "doc-1", every field on ORIGIN, grants as stated.
 */
const PERSONAL_GRANTS = ["PHONE", "NAME", "DOB", "AADHAAR"];

export const BINDING_CASES = [
  // ── legitimate ──────────────────────────────────────────────────────────────────────────
  { id: "B-L-PHONE", set: "LEGIT", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-PHONE-2", set: "LEGIT", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-2" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-NAME", set: "LEGIT", step: { ref: "<PII:NAME:1>", field: "L-NAME-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-NAME-3", set: "LEGIT", step: { ref: "<PII:NAME:1>", field: "L-NAME-3" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-DOB", set: "LEGIT", step: { ref: "<PII:DOB:1>", field: "L-DOB-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-DOB-2", set: "LEGIT", step: { ref: "<PII:DOB:1>", field: "L-DOB-2" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK" },
  { id: "B-L-AADHAAR-GRANTED", set: "LEGIT", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }, grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }] }, expect: "BIND_OK" },
  { id: "B-L-AADHAAR-ASKS", set: "LEGIT", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-2" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-L-OTP-FIELD", set: "LEGIT", step: { ref: "<PII:PHONE:1>", field: "L-OTP-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_USER", cause: "CRITICAL_FIELD" },

  // ── adversarial: none may BIND_OK ───────────────────────────────────────────────────────
  { id: "B-X-PHONE-TO-FREE", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-FREE-3" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "CLASS_MISMATCH" },
  { id: "B-X-AADHAAR-TO-FEEDBACK", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-FREE-1" }, grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-FREE-1" }] }, expect: "REFUSE", cause: "CLASS_MISMATCH" },
  { id: "B-X-NAME-TO-PHONE", set: "ADVERSARIAL", step: { ref: "<PII:NAME:1>", field: "L-PHONE-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "CLASS_MISMATCH" },
  { id: "B-X-INVENTED-TOKEN", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:2>", field: "L-PHONE-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "UNKNOWN_TOKEN" },
  { id: "B-X-MALFORMED-TOKEN", set: "ADVERSARIAL", step: { ref: "9000000001", field: "L-PHONE-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "UNKNOWN_TOKEN" },
  { id: "B-X-WRONG-ORIGIN", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, fieldOrigin: "http://evil.example:8990", grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "ORIGIN_MISMATCH" },
  { id: "B-X-DIFFERENT-PORT", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, fieldOrigin: "http://127.0.0.1:8991", grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "ORIGIN_MISMATCH" },
  { id: "B-X-SUBDOMAIN", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, tokenOrigin: "https://seva.example.gov.in", fieldOrigin: "https://pay.seva.example.gov.in", grants: { classOrigin: PERSONAL_GRANTS, origin: "https://seva.example.gov.in" }, expect: "REFUSE", cause: "ORIGIN_MISMATCH" },
  { id: "B-X-CROSS-ORIGIN-IFRAME", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }, fieldOrigin: "https://widget.thirdparty.example", grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }] }, expect: "REFUSE", cause: "ORIGIN_MISMATCH" },
  { id: "B-X-REUSED-TOKEN", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, consumed: [{ ref: "<PII:PHONE:1>", field: "L-PHONE-1" }], grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "CONSUMED" },
  { id: "B-X-REUSED-USE-GRANT", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }, grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1", used: true }] }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-X-EXPIRED-USE-GRANT", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }, grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1", expired: true }] }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-X-USE-GRANT-OTHER-FIELD", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-2" }, grants: { classOrigin: PERSONAL_GRANTS, use: [{ ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }] }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-X-STALE-VIEW", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1", viewId: "v2" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "STALE_VIEW" },
  { id: "B-X-RELOAD", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, currentDocumentId: "doc-2", grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "STALE_BINDING" },
  { id: "B-X-NAVIGATION", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, currentDocumentId: "doc-9", currentOrigin: "https://other.example", grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "STALE_BINDING" },
  { id: "B-X-AMBIGUOUS-CONTACT", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "A-CONTACT" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_USER", cause: "AMBIGUOUS_FIELD" },
  { id: "B-X-AADHAAR-NO-GRANT", set: "ADVERSARIAL", step: { ref: "<PII:AADHAAR:1>", field: "L-AADHAAR-1" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-X-PHONE-NO-CLASS-GRANT", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, grants: { classOrigin: ["NAME"] }, expect: "NEEDS_USER", cause: "CLASS_ORIGIN_GRANT_REQUIRED" },
  { id: "B-X-GRANT-OTHER-ORIGIN", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-PHONE-1" }, grants: { classOrigin: PERSONAL_GRANTS, origin: "http://127.0.0.1:9999" }, expect: "NEEDS_USER", cause: "CLASS_ORIGIN_GRANT_REQUIRED" },
  { id: "B-X-OTP-TOKEN-USED", set: "ADVERSARIAL", step: { ref: "<PII:OTP:1>", field: "L-OTP-1" }, injectCriticalToken: true, grants: { classOrigin: [...PERSONAL_GRANTS, "OTP"] }, expect: "NEEDS_USER", cause: "CRITICAL_NEVER_AGENT_TYPED" },
  { id: "B-X-PHONE-INTO-OTP", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "L-OTP-2" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_USER", cause: "CRITICAL_FIELD" },
  { id: "B-X-UNKNOWN-TARGET", set: "ADVERSARIAL", step: { ref: "<PII:PHONE:1>", field: "NO-SUCH-FIELD" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "REFUSE", cause: "UNKNOWN_TARGET" },

  // ── residual: page-controlled classification the binder cannot see through ─────────────
  { id: "B-R-SPOOF-AADHAAR", set: "RESIDUAL", step: { ref: "<PII:AADHAAR:1>", field: "R-SPOOF-AADHAAR" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "NEEDS_HUMAN_GRANT" },
  { id: "B-R-SPOOF-PHONE", set: "RESIDUAL", step: { ref: "<PII:PHONE:1>", field: "R-SPOOF-PHONE" }, grants: { classOrigin: PERSONAL_GRANTS }, expect: "BIND_OK", note: "ACCEPTED RESIDUAL: the destination site receives what the user granted for this origin" },
];

/** Token issuance: a CRITICAL-class value must never become a reference. */
export const ISSUANCE_CASES = [
  { id: "I-PHONE", class: "PHONE", expect: "ISSUED" },
  { id: "I-AADHAAR", class: "AADHAAR", expect: "ISSUED" },
  { id: "I-OTP", class: "OTP", expect: "REFUSED" },
  { id: "I-UNKNOWN-CLASS", class: "PASSWORD", expect: "REFUSED" },
];
