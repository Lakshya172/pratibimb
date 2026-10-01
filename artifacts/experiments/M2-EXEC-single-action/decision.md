# Decision — M2-EXEC single action

| Field | Value |
|---|---|
| **Verdict** | **PASS** — 50/50 warm, 50/50 cold, 5/5 negative control caught |
| **Status** | **EXPERIMENTALLY VERIFIED** on W1. Not PROVEN. |
| **Date** | 2026-09-22 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed, extension loaded |
| **Evidence** | `logs/w1-cft153-dispatch-stress-{warm,cold,control}.json` |

## The question this was opened to answer

[`M2-page-value-boundary/decision.md`](../M2-page-value-boundary/decision.md) §1: ten raw events at
the submit button on one run in five, against one dispatch, one delivery id and zero refusals. The
record named a harness artefact as the likely explanation and refused to call it a finding.

## What was established

**Reproduction frequency before the fix: 0 in 130 acts.** 100 SUCCESS acts in the focused harness
(50 warm, 50 cold), and 30 acts across ten full runs of the M2 evidence runner. Not once did the
isolated world fire twice, ask twice, or run twice.

**Root cause: the measurement, demonstrated rather than argued.** The negative control dispatches one
extra pointer sequence at the button from the page's own world, and the run then records:

```
fixtureEvents 10   firesStarted 1   dispatchRequests 1   refusals []   releases 1   writes 1   CONFIRMED
```

That is the M2 symptom, field for field. It is reachable with **exactly one** extension action. The
M2 harness asserted an action count using a counter of events arriving at a button, and those are
different quantities — so ten entries never distinguished "the extension clicked twice" from "two
things clicked once". The harness was not short of a run; it was short of an instrument.

**The three ways the extension could have done it are each independently impossible, and each is now
tested against the number of real dispatches rather than against a refusal code:**

| | Why not | Test |
|---|---|---|
| A second logical dispatch | `createTransportCycle` spends `acted` on the attempt; `createExtensionPorts` builds one cycle per run; the machine calls `guardedAct` once; the permit is consumed on redemption | `pageAgent.test.ts`, `coreTransport.test.ts` |
| A second transport delivery | a delivery id is single-use and a cycle dispatches once, both consumed by any attempt that names them | `pageAgent.test.ts` — refusal **and** `page.fired` |
| A second agent in one document | two agents would each hold their own cycles and neither would see the other's dispatch — so the **router** refuses a second port for an attested document, and that port is never addressed | `swRouter.test.ts` |

The third is the one that could not have been closed inside an agent, because neither agent knows the
other exists. It is closed one layer up, and the content script now also counts its own instances:
**1, in all 130 acts.**

## What this authorises

Reading the extension's action count from the extension. `firesStarted` is measured in the world that
constructs and dispatches the events; everything else — the cycle report, the worker's port
recording, the page's own witness — is corroboration from a different vantage point. The M2 evidence
runner now carries all four, and seven new checks (42 → 49).

## What this does not authorise

- Any exactly-once claim under conditions not exercised: a browser under heavy load, a page that
  moves its own controls, a second extension, a second machine.
- Any statement about **which** non-extension cause produced the extra five events on the original M2
  run. That record was overwritten before it could be analysed and `isTrusted` was not recorded at
  the time. A real pointer interaction with the headed window is the obvious candidate and remains a
  guess; it is recorded now, so the next occurrence will not need one.
- Any relaxation of the status vocabulary. This is **EXPERIMENTALLY VERIFIED**; a second independent
  reproduction is what would make it PROVEN.

## Open, and stated rather than hidden

### 1. `E6_CLICK` is a second click path in a production build

`apps/extension/host/content.ts` still serves E6's `E6_CLICK`, which dispatches a full pointer
sequence at any selector with **no permit, no hit test and no plan validation**. It is reachable only
from this extension's own service worker, and only through the test-only `__host.toTab` hook, so no
page and no plan can reach it — but it is a dispatch path outside the audited one, and it is kept
because `artifacts/experiments/E6-mv3-dispatch/harness/run-e6.mjs` is historical evidence that must
stay reproducible. It is now **counted**: `e6Clicks` is read in both harnesses and asserted to be 0
in every act. Retiring it behind a build flag is the obvious next step and is not taken here.

### 2. The attribution epsilon is a judgement

Two milliseconds, for clock coarsening between the page's main world and the content script's
isolated world. It is far narrower than the gap between two real sequences and far wider than the
0–0.8 ms the fires actually took, so it has slack in both directions — but it is a constant chosen
from 100 observations on one machine, not a derived bound.

### 3. The invariant is measured, not enforced at a new layer

Nothing was added to the execution boundary. The existing architecture already spends the permit on
redemption, latches the cycle in the core realm, latches the cycle in the page realm, consumes the
delivery id, and builds one cycle per run — five layers, all pre-existing, all now tested against the
count of real dispatches. Adding a sixth would have meant new global state whose lifecycle nobody had
reason to reason about, which the brief warned against and which the evidence does not call for.

### 4. Everything M2 left open is still open

Items 2–5 of [`M2-page-value-boundary/decision.md`](../M2-page-value-boundary/decision.md) — the
refused literal insert, the missing human-facing grant surface, `apps/extension` outside the
typecheck graph, and the undecided lifetimes — are untouched by this work.
