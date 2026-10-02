# DEMO-1 — verdict

**Date:** 2026-09-15 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Chrome for Testing
153.0.8010.12 · **Verdict: PASS** (5 rounds, 15 acts, 0 unexpected failures)

| Criterion | Result | Status |
|---|---|---|
| The demo starts from one command | `npm run demo` / `npm run demo:present` | **PROVEN** |
| Reset restores every item in `RESET_CONTRACT`, before every act | checked 15 times | **PROVEN** |
| Success act completes and the page confirms it | `CONFIRMED` ×5 | **EXPERIMENTALLY VERIFIED** |
| Refusal act executes nothing | 0 rehydrations, 0 clicks, 0 submissions ×5 | **PROVEN** |
| Refusal does not fall back into a working plan | `fellBack: false` ×5 | **PROVEN** |
| Outage act is a genuinely refused connection | `ERR_CONNECTION_REFUSED` asserted | **PROVEN** |
| Outage completes through the same gates | `CONFIRMED · FALLBACK` ×5 | **EXPERIMENTALLY VERIFIED** |
| The outbound body carries references and no vault value | 4 tokens, 0 of 5 values | **PROVEN** |
| Client and receiving service agree on the digest, visibly, in the page | `26d7c09f…` both | **PROVEN** |
| No value in the sanitized representation, ledger, plan, refusal or response | swept every act, every round | **PROVEN** |
| A human is asked, and the grant is spent | `used: true` | **PROVEN** |
| Demo reliability | 5 rounds | **PROVISIONAL — small sample** |
| Latency | rehearsal measurements | **PROVISIONAL — not a benchmark** |
| Extension end-to-end | nothing ran through the extension | **NOT PROVEN** |
| Production deployment, TLS, auth, adversarial network | — | **DEFERRED** |
| General PII recall beyond this fixture | — | **DEFERRED** |

## The two paths, unchanged from LOOP-2

```
MODEL_PATH    = EXPERIMENTAL
FALLBACK_PATH = VERIFIED
```

Nothing in this section weakened a gate to make the demo smoother. The three acts differ only in
which reasoner answers and at what address; every security layer beneath is identical in all three
and cannot tell them apart.

## Extension end-to-end: NOT PROVEN

Unchanged from LOOP-1 and LOOP-2, and deliberately not re-litigated here. `apps/demo` drives a
same-origin frame through its own `PageAdapter`; no content script, service worker, offscreen
document or side panel took part. The rehearsal ran with **no extension loaded**, and the artifact
records the path as `direct/in-process` so no screenshot can imply otherwise.

The demo UI does not claim an extension path, and the
[judge cheat sheet](../../../docs/demo/judge-cheat-sheet.md) answers the question directly if asked.

## What this licenses

- Presenting the loop on W2 as **a local model over a real loopback network**, with the outbound
  payload and both digests inspectable live.
- Describing the refusal as **the existing validator and privacy layer**, not a demo mode.
- Describing the fallback as **the same pipeline with a different author**.
- Stating the demo runs repeatably: 15 of 15 acts, no unexpected failures.

## What it does not license

- Any claim of production readiness, production egress security, or general privacy guarantees.
- Any claim of general PII recall from one fixture.
- Any benchmark-grade statement about latency or model quality from this sample.
- Any claim of full extension end-to-end.
- Any claim about Firefox, screen capture, OCR or a VLM — none is implemented.

## Owner decisions still open

Carried unchanged from LOOP-1 and LOOP-2, none of them touched by this section:

- **Model adoption.** Registry status stays `PINNED`; `ADOPTED` needs QG-03 and a benchmark.
- **The three prototype lifetimes**, plus the egress timeout — stated, not measured
  (`docs/architecture/prototype-lifetimes.md`).
- **Whether a safe literal should require its own confirmation before it is typed.**
- **D-ACT-1 / ADR-0006 §6.**
- **Extension integration**, which remains the largest gap between what is built and what is claimed.
