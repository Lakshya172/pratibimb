# E2 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Verdict: PASS on the pre-registered criterion — with a
validity caveat that limits what it can be used for**

| Criterion (pre-registered `277e136`) | Result |
|---|---|
| Adversarial accepts | **0 / 23** |
| Legitimate refusals | **0 / 9** |
| Legitimate fields classified as expected | **18 / 18** |
| Ambiguous fields → UNKNOWN | **7 / 7** |
| SENSITIVE residual → human grant | **1 / 1** |
| Issuance | **4 / 4** |

| Limit | Consequence |
|---|---|
| Rules and cases share an author and a session | Not evidence of generalisation |
| Mutation check: 17 of 19 killed; B5 (CRITICAL token) and B7 (ambiguous field) survive | Two rules are not isolated by the table; neither survivor is an unsafe accept |
| Owner decisions D-C and D-D not taken | The tier policy tested is PROPOSED |

## Decisions

- **The human-confirmed field map fallback is not triggered.**
- **E2 does not license a production binder yet.** That needs:
  - a held-out table written by someone other than the harness author;
  - a pre-registered addendum closing B5 and B7;
  - D-C and D-D.
