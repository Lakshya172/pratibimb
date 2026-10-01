# PRIV-0 — verdict

**Date:** 2026-09-14 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Chrome for Testing
153.0.8010.12 · **Verdict: PASS** — reconstruction evidence, not historical Phase 0 evidence.

| Criterion | Result |
|---|---|
| Real page observed, sanitized by the shipped build | **yes** |
| Verified handoff produced | **yes** |
| NAME, PHONE, AADHAAR, DOB tokenised | **4 / 4** |
| OTP masked, never tokenised | **yes** |
| Values held locally in the memory-only vault | **4** |
| Any value in the handoff or ledger (exact or normalised) | **none** |
| Unit suite | **126 tests, all passing** |
| Mutation check | **12 mutations · 12 killed · 0 survivors** |

> Updated by the security foundation review (2026-09-14, W2). The first campaign recorded P09 — the
> binder's `CONSUMED` check — as a layered survivor. That was wrong: `bind()` is a question a caller
> may ask without spending, so the vault's guard cannot answer for it. Three focused tests now
> exercise the binder's own consumed-state invariant, and the mutation is killed. No source behaviour
> changed. See the [experiment record](README.md#mutation-check--do-the-guards-carry-weight).

## What this licenses

- Building the next section — server client, deterministic planner, plan validation, orchestrator,
  human grant UI, rehydration into a page, Planning View — **on top of this package**, rather than
  alongside a second privacy path.
- Citing the sanitizer, the vault, the verifier, the binder and the literal-echo refusal as
  implemented and unit-tested **on W2**.

## What it does not license

- Any claim of a working agent loop. There is no planner, orchestrator, grant UI or click here.
- Any claim about network egress. There is no egress client; the ledger records intent, and
  INV-01/INV-02 remain SPEC.
- Any claim of production vault security, general PII recall, or non-inferability.
- Any claim that the original Phase 0 implementation was recovered. It was not.

## Status unchanged by this run

B-02 OPEN · QG-04 unsigned · detector UNADOPTED · E1 and E9 not run · W-A gate CLOSED · MV3 host
experimental · ADR-0005…0008 PROPOSED · permit TTL unresolved · `EXECUTABLE_ACTIONS` remains
`["click"]` and no TYPE action exists.

## Owner decisions still open

- **D-C / D-D** (the tier policy E2 recorded as PROPOSED): PHONE, NAME, DOB as PERSONAL and AADHAAR
  as SENSITIVE is applied by this code as a proposal, not as approved policy.
- Whether the class×origin grant and the per-use human grant are the right two levels for V1.
- Whether `len` belongs in a hint for free-form classes such as NAME, where it is a weak signal about
  the value rather than about the class.
