# LOOP-2 — verdict

**Date:** 2026-09-14 · **Workstation:** W2 (`LAPTOP-SRCINK2B`) · **Cell:** Chrome for Testing
153.0.8010.12 · **Verdict: PASS** (17/17)

| Criterion | Result | Status |
|---|---|---|
| A real HTTP request reaches a model on 127.0.0.1 | yes | **PROVEN** |
| The request body carries references and **no** vault value | 4 tokens, 0 of 5 values | **PROVEN** |
| Client and server digests of the exact bytes agree | `26d7c09f…` both | **PROVEN** |
| An unverified payload cannot be sent | refused at VERIFY, nothing arrives | **PROVEN** |
| A payload containing a vault value cannot be sent | refused at LEAK_SCAN, nothing arrives | **PROVEN** |
| Model plan → validate → grant → rehydrate → guarded click → VERIFY RESULT | CONFIRMED | **EXPERIMENTALLY VERIFIED** |
| A hostile response is refused and does **not** fall back | `fellBack: false` | **PROVEN** |
| An unavailable model falls back through the same gates | CONFIRMED | **EXPERIMENTALLY VERIFIED** |
| The model can widen no capability (TYPE, eval, navigate) | every attempt refused | **PROVEN** |
| Latency p50 609 ms / p95 623 ms | 6 warm runs | **PROVISIONAL — small sample** |
| Model produces a correct plan reliably | 5/5 and 7/7 in these runs | **PROVISIONAL** |
| Extension end-to-end | nothing ran through the extension | **NOT PROVEN** |
| Production egress security, TLS, auth, adversarial network | — | **DEFERRED** |
| GPU path, larger model, other quantisations | — | **DEFERRED** |

## The two paths, named as the mission requires

```
MODEL_PATH    = EXPERIMENTAL
FALLBACK_PATH = VERIFIED
```

The model is a 0.5B instruction model that needed enum-constrained decoding and a worked example
before it planned this task correctly at all, and it has been exercised on exactly one goal. The
deterministic planner behind it has the whole of LOOP-1's evidence plus this section's. **Nothing in
the security pipeline was weakened to accommodate the model**, and the pipeline's answer to a bad
model is a refusal, not an exception.

## Extension end-to-end: NOT PROVEN

Unchanged from LOOP-1 and not re-litigated here. `apps/demo` drives a same-origin frame through its
own `PageAdapter`; no content script, service worker, offscreen document or side panel took part, and
the browser evidence ran headless with no extension loaded. Exercising the reasoner request from
inside a loaded extension would need a host-side command surface that does not exist, which is
integration work and was out of scope. The existing headed CfT 153 load smoke
([LOOP-1](../LOOP-1-server-orchestrator-planning-view/logs/w2-cft153-extension-load.json)) still
shows only that the built host loads.

## What this licenses

- Describing the reasoner boundary as **real network egress on W2**, with the payload independently
  captured and digest-matched.
- Citing the egress choke point as the **single egress module** SECURITY.md §5 is about.
- Replacing this model with another behind `ReasonerClient` without touching anything after the
  boundary.

## What it does not license

- Any claim of production deployment, production egress security, or general privacy guarantees.
- Any claim about model quality, or that these timings generalise.
- Any claim of general PII recall from one fixture.
- Any claim of extension end-to-end.

## Owner decisions still open

- **Model adoption.** The registry's `ADOPTED` status needs QG-03 and a benchmark artifact; neither
  exists. This model is recorded as `PINNED` (revision pinned, licence verified at revision, runtime
  validated) and nothing more.
- **Whether a safe literal should require its own confirmation before it is typed** — carried from
  LOOP-1.
- **D-ACT-1 / ADR-0006 §6**, and the three prototype lifetimes, both carried unchanged.
- **The egress timeout** (30 s default) joins the prototype lifetimes: stated, not measured.
