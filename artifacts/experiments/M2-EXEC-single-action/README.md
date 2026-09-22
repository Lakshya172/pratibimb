# M2-EXEC — one approved task, one browser action

> **W1 evidence, 2026-09-22.** M2 left one thing open: on the first of five runs, the fixture
> recorded **ten** raw events at the submit button where five were expected, while the transport
> recorded one dispatch, one delivery id and zero refusals. The M2 record called a harness
> measurement artefact the "best explanation" and said, in the same sentence, that this was a
> hypothesis and not a finding.
>
> **It is now a finding.** The symptom was reproduced deliberately — ten events at the button, one
> fire, one release, one write, zero refusals — by letting something other than the extension click
> the button. What the M2 harness measured was *events arriving at a button*; what it reported was
> *actions the extension performed*. Those are different quantities, and ten of the first is
> reachable with exactly one of the second.

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runner:** [`tests/browser/extension/run-dispatch-stress.mjs`](../../../tests/browser/extension/run-dispatch-stress.mjs)
- **Logs:** [`logs/w1-cft153-dispatch-stress-warm.json`](logs/w1-cft153-dispatch-stress-warm.json) ·
  [`-cold.json`](logs/w1-cft153-dispatch-stress-cold.json) ·
  [`-control.json`](logs/w1-cft153-dispatch-stress-control.json) ·
  **Verdict:** [`decision.md`](decision.md)
- **Predecessor:** [`M2-page-value-boundary`](../M2-page-value-boundary/README.md), whose open item
  §1 this closes. Nothing about the value boundary is changed here.

## Hypothesis

Five things could produce a doubled record at a button, and the M2 harness could not tell them apart:

| | | measured where |
|---|---|---|
| **A** | two logical dispatches — the core realm asked twice | the cycle report |
| **B** | two transport deliveries — the worker carried one ask twice | the worker's port recording |
| **C** | two browser actions — the isolated world fired twice | **the page agent's own fire counter** |
| **D** | two observations of one — the page recorded one event twice | event OBJECT identity, in a `WeakSet` |
| **E** | an event from outside — a real user click, or another extension | `isTrusted`, and clock attribution |

**What would falsify the single-action claim:** any run where the isolated world reports more than
one fire, more than one dispatch request, more than one content-script instance, or an event at the
button that falls inside no fire's window.

## Expected result

1. Every run reports **one** fire started, one fire completed, one dispatch request, zero agent
   refusals and one content-script instance.
2. The page's own witness sees **five** untrusted events, **zero** trusted ones, zero events falling
   outside a fire's window, and no event object recorded twice.
3. The page registers its own six listeners on the button once, and the fixture's own counter agrees
   with the witness at five.
4. Exactly one release and one local write; the field matches the registered number; the page is
   submitted and the result verified.
5. **The negative control breaks every one of those runs**, and names the extra events as ones the
   extension did not cause.

## What was built

**The extension now counts its own actions, at the point of action.** `createPageAgent` records
every `fire()` on both sides of the call, with the cycle id, the delivery id, the element it went to,
and when the events were **constructed** as well as dispatched. A DISPATCH reply says a dispatch was
*answered*; only this says how many were *performed*. It is read out through a test-only
`DISPATCH_AUDIT` message whose reply has no field that could hold a page value.

**An independent witness in the page's main world**
([`single-action-probe.mjs`](../../../tests/browser/extension/single-action-probe.mjs)), installed by
the harness before any page script runs, recording per event: `isTrusted`, the event object's
identity in a `WeakSet`, and an absolute time on the page's own clock. It also counts the listeners
the page registers on the button, because "the page's own script ran twice" is hypothesis D's other
shape. It calls no `preventDefault`, no `stopPropagation`, and changes nothing.

The fixture is **not modified**, and the existing five-event expectation is **not loosened**.

## Environment

| | |
|---|---|
| Page | the same synthetic fixture at `http://127.0.0.1:8975/fixture/`, unchanged |
| Act | SUCCESS only: the full product loop, real model, real approval, real capability, real click |
| WARM | one browser, one tab, 50 iterations, a fresh document each time |
| COLD | **a fresh browser and a fresh profile per iteration**, acting in the profile's first document |
| CONTROL | WARM, plus a real second pointer sequence at the button after the act, from the page's own world |

COLD exists because the symptom was seen on **the first run of the harness**, in a window that had
just opened. No number of warm iterations re-tests that state; repeating a state a bug does not live
in is not reproduction, however many times it is repeated.

## Actual result

### 100 runs, WARM and COLD

**PASS — 50/50 warm, 50/50 cold.** Every histogram is a single bucket:

```
firesStarted     {"1": 50}      contentInstances  {"1": 50}
probeUntrusted   {"5": 50}      listenersOnSubmit {"6": 50}      (5 recorder + 1 handler)
probeTrusted     {"0": 50}      objectSeenTwice   {"0": 50}
fixtureEvents    {"5": 50}      unattributed      {"0": 50}
releases         {"1": 50}      writes            {"1": 50}      verify {"CONFIRMED": 50}
```

One approved task produced one logical dispatch, one transport delivery, one fire, and one
five-event sequence — in all 100 runs, warm and cold, with no exception and no near miss.

### The negative control — the symptom, on purpose

**PASS — 5/5 runs caught.** With one extra sequence dispatched at the button by the page itself:

```
fixtureEvents {"10": 5}   firesStarted {"1": 5}   unattributed {"5": 5}   releases {"1": 5}
```

**That is the M2 symptom, reproduced exactly:** ten raw events at `#submit`, one dispatch, zero
refusals, one release, one write, the page submitted and verified. The old instrument would have
reported it identically to a genuine double dispatch. The new one names it in one field —
`unattributed = 5`, five events this extension did not cause — and the run fails.

A sweep of green runs is worth exactly what the instrument's ability to come back red is worth, which
is why this control is part of the evidence rather than a note about it.

### What the timings say

`prepareMs` (constructing five events and checking their coordinates) ran **0–0.4 ms**; `dispatchMs`
(firing them) **0.1–0.8 ms**. That gap is why attribution anchors on construction: a `MouseEvent`'s
`timeStamp` is fixed when it is built, so all five carry a time from *before* the first
`dispatchEvent`. The first fifty-run sweep found this the hard way — one run in fifty spent long
enough between the two that a window anchored at dispatch called the extension's own click an event
the extension did not cause. That was a defect in the new instrument, found by the sweep and fixed
before the evidence here was taken.

### On every `npm test`

Nine more tests in
[`pageAgent.test.ts`](../../../packages/extension-transport/test/pageAgent.test.ts) and one in
[`swRouter.test.ts`](../../../packages/extension-transport/test/swRouter.test.ts) hold the invariant
in Node. Every one of them asserts the **number of real dispatches**, not only the refusal code — a
refusal that still fired would be exactly the bug the symptom looked like, and a code alone cannot
rule it out. The router test covers the one structural way a document could fire twice: two page
agents in one document, neither of which can see the other's dispatch. The second port is never
accepted and never addressed.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1** — 100 SUCCESS acts in the focused harness, warm and cold, plus 30
acts across ten full three-act runs of the M2 evidence runner, plus a negative control that
reproduces the symptom on demand.

**The root cause is the measurement, and it is specific.** The loop harness asserted the extension's
action count using a counter that cannot attribute an event to a cause. Ten entries in that counter
were, and remain, compatible with several different worlds; the harness treated one number as though
it answered a question it cannot answer. That is a defect in the harness, not an absence of
information — and the control demonstrates it rather than arguing it.

**Not proven, and not claimed.** One machine, one browser cell, one synthetic fixture. **No claim
that the browser action is exactly-once under conditions not exercised here** — a browser under heavy
load, a page that moves its own controls, or a second extension were not tested. **No claim about
which non-extension cause produced the extra five events on the original M2 run**: that record was
overwritten before it could be analysed, and `isTrusted` — the one field that would have settled it —
was not recorded at the time. It is recorded now. **No claim of production readiness.**

## Reproducibility

```bash
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-dispatch-stress.mjs --runs 50
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-dispatch-stress.mjs --cold --runs 50
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-dispatch-stress.mjs --negative-control --runs 5
```

The runner refuses rather than guessing if `CHROME_PATH` is unset or the host is not built, starts
and stops the reasoner service itself, and takes its workstation identity from
`tests/browser/support/workstation.mjs`, so a run on another machine writes its own evidence file and
cannot overwrite this one.
