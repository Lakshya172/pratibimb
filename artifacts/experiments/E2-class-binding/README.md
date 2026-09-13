# E2 — class binding

> **Result: PASS, with one validity caveat and two coverage gaps stated up front.**
>
> Against a table pre-registered at commit `277e136`, before the classifier and binder existed:
> - 0 adversarial accepts, 0 legitimate refusals
> - 34 / 34 binding outcomes exact (decision and cause)
> - 27 / 27 classifier cases, 4 / 4 issuance cases
> - the SENSITIVE residual routed to a human grant
>
> **Caveat:** the same engineer wrote the cases and the rules in the same session, so the rules were
> written knowing the cases. The commit order stops expectations being fitted to the code; it does
> **not** stop the code being fitted to the expectations. This PASS shows the rules separate *these*
> cases. It does not show they generalise, and a held-out table written by someone else is the real test.

- **Date:** 2026-09-13 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Node v26.4.0, pure
  functions, no network, no browser, no model, no values
- **Log:** [`logs/e2.json`](logs/e2.json) · **Mutation log:** [`logs/e2-mutation.json`](logs/e2-mutation.json) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

A deterministic classifier over what a content script may read, plus a binder that checks the class,
origin, document, single use, class×origin grant and per-use human grant:
- refuses every adversarial mapping,
- accepts every legitimate demo mapping,
- routes every SENSITIVE page-controlled spoof to a human.

## Environment

- **Classifier (`harness/binder.mjs`)**
  - Signals: autocomplete tokens, input type, keyword tables over `name` and label, and a qualifier list for names that are not the applicant's own (father's, company, first, user, …).
  - **More than one signal, or any signal naming something else → `UNKNOWN`.** No signal → `FREE_TEXT` for a textarea, `UNKNOWN` otherwise.
- **Binder**, ordered and fail-closed:
  1. stale view
  2. document changed (reload / navigation)
  3. unknown target
  4. unknown or malformed token
  5. CRITICAL token
  6. OTP field
  7. ambiguous field
  8. class mismatch
  9. origin mismatch
  10. consumed
  11. class×origin grant
  12. SENSITIVE per-use grant (same ref, same field fingerprint, same origin, unused, unexpired)
- **Issuance:** CRITICAL and unknown classes are never tokenised.
- **Policy under test (PROPOSED):** PHONE, NAME, DOB are PERSONAL · AADHAAR is SENSITIVE · OTP is CRITICAL. Owner decisions D-C and D-D are **not** taken.

## Expected result

Pre-registered in `harness/cases.mjs` (`277e136`), unchanged when run (verified with `git diff`).

**PASS criterion:**
- 0 adversarial accepts
- 0 legitimate refusals
- every legitimate field classified as expected
- every ambiguous field → `UNKNOWN`
- every SENSITIVE residual → `NEEDS_HUMAN_GRANT`
- issuance exact

Exact cause matches are reported but were not part of the criterion.

## Actual result

| | Result |
|---|---|
| Classifier: legitimate (18), ambiguous (7), residual (2) | **27 / 27** as expected |
| Binding: legitimate (9), adversarial (23), residual (2) | **34 / 34 exact** (decision and cause) |
| Adversarial accepts | **0** |
| Legitimate refusals | **0** |
| SENSITIVE residual routed to a human | **1 / 1** |
| Issuance (PHONE, AADHAAR issued; OTP, unknown class refused) | **4 / 4** |

**Adversarial cases covered:**
- PHONE → free text; AADHAAR → Feedback; NAME → PHONE field
- invented token; a raw value in place of a token
- wrong origin; different port; subdomain; cross-origin iframe
- reused token; reused, expired or wrong-field use-grant
- stale view; reload; navigation
- ambiguous "Contact"
- AADHAAR without grant; PHONE without class grant; grant for another origin
- a CRITICAL token in use; PHONE into an OTP field; unknown target

**The PERSONAL residual is accepted by design and recorded as such:** a page labelling a field "Mobile
number" receives the phone the user granted for that origin.

**Recording slip:** the pre-registration commit message says "36 binding cases". The file defines
**34**, and the harness counts from the file.

### Mutation check — do the rules carry weight?

`harness/mutate-e2.mjs` disables one rule at a time: **19 mutations, 17 killed, 2 survived.**

| Survived | Why | What it means |
|---|---|---|
| **B5**: binder would type a CRITICAL token | The only case exercising it sends an OTP token at an OTP field, so the next rule (`CRITICAL_FIELD`) returns the same decision, NEEDS_USER, with a different cause. The criterion gates on decisions, so the cause change passed | **Coverage gap.** No case sends a CRITICAL token at a non-OTP field |
| **B7**: binder would guess an ambiguous field | An `UNKNOWN` field still fails the class-match rule, so the action is still refused, as REFUSE instead of NEEDS_USER | **Defence in depth.** Safe either way, but the table cannot tell "ask the user" from "refuse the plan" |

Neither survivor produces an unsafe accept. Both show the table is weaker than a 34/34 headline suggests.

## Conclusion

1. **On this table, class binding separates legitimate from adversarial mappings with no guessing**,
   and routes the one spoof it cannot see through (SENSITIVE) to a human. The fallback architecture —
   a human-confirmed field map — is **not needed on this evidence**.
2. **That is weaker evidence than it looks.** The rules and the table share an author and a session,
   and the mutation check found two rules the table does not isolate.
3. **Before this informs the production binder:**
   - a **held-out table written by someone else** (W1, or the owner);
   - an **addendum**, pre-registered before it runs, adding (a) a CRITICAL token aimed at a non-OTP
     field and (b) exact-cause gating for the ambiguous-field case;
   - owner decisions D-C and D-D.

## Reproducibility

```bash
node artifacts/experiments/E2-class-binding/harness/run-e2.mjs      # exits 0 on PASS
node artifacts/experiments/E2-class-binding/harness/mutate-e2.mjs   # restores every file it mutates
```

Deterministic; no network. The log records LF-normalised SHA-256 of the cases, binder and runner.
