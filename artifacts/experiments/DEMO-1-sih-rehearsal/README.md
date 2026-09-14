# DEMO-1 — the SIH demo, rehearsed until it is boring

> **W2 evidence, 2026-09-15.** Not a new capability. This section turns the existing implementation
> into something a presenter can run in front of judges without hoping.

- **Workstation:** **W2** (`LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, 16 cores, Windows 11 10.0.26200) ·
  **Node** v26.4.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12** · **GPU not used** (llama.cpp CPU x64, deliberately)
- **Log:** [`logs/w2-cft153-sih-rehearsal.json`](logs/w2-cft153-sih-rehearsal.json) ·
  **Verdict:** [`decision.md`](decision.md)
- **Presenter material:** [`presenter-runbook.md`](../../../docs/demo/presenter-runbook.md) ·
  [`judge-cheat-sheet.md`](../../../docs/demo/judge-cheat-sheet.md)

## The question

Not *"does the system work"* — LOOP-1 and LOOP-2 answered that. The question here is narrower and
more practical: **can a judge sit down at W2 and understand the privacy boundary within five
minutes, and will the demo do the same thing every time it is run?**

**What would falsify it:** an act that behaves differently between rehearsals; a reset that leaves
state behind; a UI that claims a path the run did not take; any value appearing in a pane, a ledger,
a refusal or an artifact that is supposed to be free of them.

## The three acts

Declared as data in `apps/demo/src/demoScript.ts`, so the buttons, the runner and the tests read one
definition. An act chooses **which reasoner answers and at what address**, and nothing else — no
security layer beneath can tell which act is running, and no branch asks.

| Act | Reasoner | Address | Expected |
|---|---|---|---|
| **SUCCESS** | local Qwen2.5-0.5B | `127.0.0.1:8978` | `DONE` · `CONFIRMED` · 1 rehydration · 5 raw click events |
| **REFUSAL** | a service answering with a value the client holds | `127.0.0.1:8979` | `REFUSED` · **0 rehydrations · 0 clicks** · no fallback |
| **OUTAGE** | nothing listening | `127.0.0.1:8989` | `DONE` · `CONFIRMED` · via the deterministic planner |

The honest and hostile fronts listen **at the same time** on different ports, so a presenter moves
between acts without restarting anything and no process holds a mode that could drift out of step
with the UI.

**The outage is a real refused connection.** The resulting `ERR_CONNECTION_REFUSED` is *asserted as
evidence*: a clean console there would mean the third act had quietly become a simulation.

## Actual result

**PASS** — 5 rounds, 15 acts, **no unexpected failures**.

| Run | Success | Refusal | Fallback | Unexpected | Total |
|---|---|---|---|---|---|
| 1 | `CONFIRMED` | `LEAKAGE_BLOCKED` | `CONFIRMED_VIA_FALLBACK` | no | 1 509 ms |
| 2 | `CONFIRMED` | `LEAKAGE_BLOCKED` | `CONFIRMED_VIA_FALLBACK` | no | 663 ms |
| 3 | `CONFIRMED` | `LEAKAGE_BLOCKED` | `CONFIRMED_VIA_FALLBACK` | no | 598 ms |
| 4 | `CONFIRMED` | `LEAKAGE_BLOCKED` | `CONFIRMED_VIA_FALLBACK` | no | 563 ms |
| 5 | `CONFIRMED` | `LEAKAGE_BLOCKED` | `CONFIRMED_VIA_FALLBACK` | no | 553 ms |

### What left the device

| | |
|---|---|
| Bytes | **2 679** |
| References present | `<PII:AADHAAR:1>` `<PII:DOB:1>` `<PII:NAME:1>` `<PII:PHONE:1>` |
| Vault values present | **0 of 5** |
| Client digest | `26d7c09f78e318eb…` |
| Receiving service's digest | `26d7c09f78e318eb…` |
| Agreed, **live in the page** | **yes** |

The digest comparison is now visible **in pane 5 during the demo**, not only in a Node runner
afterwards. The receiving service reports what it got in a response header; the client records the
claim beside its own digest and shows whether they agree.

**That header is not a security control, and the code says so twice.** The guarantee is unchanged and
rests where it always did: the bytes that were scanned are the bytes that were sent, one string
produced once. The receipt is read *after* the send, gates nothing, and a hostile service could put
any string in it. What it adds is a second party's arithmetic — evidence in the cooperative case,
and recorded as a claim rather than a verdict.

### Demo rehearsal measurements — **not benchmark results**

| | |
|---|---|
| Model ready from cold | **~1.0 s** |
| Success act | 1 074 ms cold, then 471–550 ms |
| Whole round, three acts and resets | 553–1 509 ms |
| `llama-server.exe` | 558 MB · `node.exe` 126 MB · GPU unused |

Five rounds, one machine, one fixture, one quantisation, CPU only. These exist so a presenter can
tell a slow model from a broken one. **No statistical generalisation is claimed.**

## What this section changed, and what it did not

**Changed:** the demo runner, the reset flow, the act definitions, the judge-facing presentation, and
one additive field on the egress record. Plus the presenter's runbook and cheat sheet.

**Not changed:** `packages/privacy`, `packages/perception`, `packages/extension-transport`,
`apps/extension`, and the agent's permit, confirmation and guarded-act path. `EXECUTABLE_ACTIONS`
remains `["click"]`. No new capability, no new authority, no weakened gate.

## Three defects this section found in the existing demo

1. **The `local model` checkbox was dead UI.** It was in the header and nothing read it, so ticking it
   silently ran the deterministic planner — a control that implied a path which was not exercised.
   It is gone; the acts now name their reasoner and their address.
2. **The footer and pane 5 were still claiming "no model, no network client" and "no egress client
   exists in this phase"**, both untrue since LOOP-2. A demo that understates is still a demo that
   misstates.
3. **`sweep` threw on a cyclic object.** Mid-demo that would have taken out the evidence pane, and a
   caller catching the throw would have been one line from reporting a leak check as clean *because
   it could not run*. It now prunes cycles and reports that it did.

A fourth, found by running it: `--rehearse 3` silently rehearsed once, because the argument parser
rejected a flag in first position.

## What this does not establish

- **Not a benchmark.** Five rounds, one machine, one fixture, one goal, CPU only.
- **Not production readiness.** Synthetic data, one loopback destination, no TLS, no authentication.
- **Not general PII recall.** Five synthetic values on one fixture.
- **Not extension end-to-end.** Nothing ran through the extension — see `decision.md`.
- **Not a claim about the model.** `MODEL_PATH = EXPERIMENTAL`; `FALLBACK_PATH = VERIFIED`.

## Reproducibility

```bash
npm run typecheck
CHROME_PATH="C:\Users\OMEN\cft\chrome.exe" npm run demo -- --rehearse 5
```

To present: `CHROME_PATH=… npm run demo:present`, then the runbook.
