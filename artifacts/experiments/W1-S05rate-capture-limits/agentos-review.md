---
id: W1-S05-rate-agentos-review
experiment: W1-S05rate-capture-limits
date: 2026-09-10
branch: feature/s05-rate-capture-limits
---

# W1-S05-rate — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `browser-engineer` — L2, owns execution context

**Status: `PASS`.**

| Obligation | Finding |
|---|---|
| Contexts are the ones the constitution names | **PASS.** Chromium MV3 **service worker** and Firefox MV2 **background script** — the contexts the real adapter runs in. |
| Browser divergence measured, never inferred | **PASS, and it mattered.** Chromium enforces a hard reproducible quota; Firefox showed none at or below 10 Hz. Neither result was generalised to the other. |
| Null results recorded | **PASS.** Firefox's clean sweep is recorded as *"no limit observed within the tested envelope"*, not as *"no limit exists"*. |

**RAISED — a cadence tuned on Firefox would be throttled on Chromium.** The floor must come
from the stricter engine. This is now encoded in `DEFAULT_CHANGE_POLICY` with the reasoning
attached, not left to whoever next edits the constant.

**RAISED — `activeTab` is the cell we could not reach and the one the dossier warns about.**
It grants capture only after a user gesture on the extension action. If PratiBimb ships
under `activeTab` rather than a host permission, the envelope must be re-measured. That is
the single largest reason this is `CONDITIONAL`.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

| Obligation | Finding |
|---|---|
| Bounded, reproducible schedules | **PASS.** Every attempt count is a constant. No unbounded stress loop exists in the harness. |
| Repetition sufficient to separate signal from noise | **PASS.** The ladder runs 3× per run, Chromium ×2 runs → 6 observations per rung. The 1 Hz and 2 Hz cells were 12/12 in **all six**. |
| No flaky CI test manufactured | **PASS.** Extension loading needs a headed browser and the timing is machine-sensitive. Recorded as a limitation; the CI-side tests assert the **contract**, never the rate. |

**Observation — the first run was invalid, and that is the most valuable thing in this
experiment.** It reported 0% success at every frequency including a single isolated capture.
Reduced to a success rate it said *"captureVisibleTab does not work"*. 212 of 304 failures
were a **permission** error. The A–F cause discrimination caught a wrong published
conclusion on the first execution, which is the entire justification for the rule.

---

## `performance-engineer` — L2

**Status: `PASS`.**

| Obligation | Finding |
|---|---|
| No number quoted without measurement | **PASS.** Every figure traces to `results/*.json`. |
| Constants distinguished from evidence | **PASS.** The source states which of the four change-detection constants is bounded by this experiment (**one**) and which remain policy (**three**). |

**RAISED — the measured envelope does not constrain the dossier's design.** The tier table
budgets ~8 captures per 10-step task. At the safe cadence that needs ≥4 s spread across a
whole task, against a ceiling of ~1.7 captures/sec. **There is roughly two orders of
magnitude of headroom**, and the T0 change gate's job of saying "no" ~92 times out of ~100
is what keeps it there. The design was right to separate capture count from evaluation
count.

**RAISED — requesting more does not deliver more.** At 10 Hz Chromium still delivered only
~2.6 successes/sec while refusing two thirds of calls. Any future "capture faster under
load" instinct is answered: it does not work, and it burns the budget.

---

## `privacy-security-engineer` — L1, standing veto

**Status: `PASS` for this change. Veto not waived; none sought.**

| Check | Finding |
|---|---|
| No new outbound network capability in the adapter | **PASS.** The production diff adds one string-matching predicate and one error code. The G5 source scan still passes: no `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `EventSource` in `packages/perception`. |
| No fabricated observation on failure | **PASS.** A refused capture returns no frame at all — the `Perceived` union has no value on the refusal branch. Tests assert a throttled refresh does not relabel the previous frame as current. |
| Fail-closed preserved | **PASS.** Unrecognised errors classify as `CAPTURE_FAILED`, the code that promises nothing. |
| ADR-0001 untouched | **PASS.** No CSP, manifest, egress or security-policy change. |
| Harness egress | The spike harness posts to **loopback only** (`127.0.0.1:8940`) and is throwaway code under `artifacts/experiments/`. It is not production code and does not ship. |

**RAISED — the harness requested `<all_urls>`, and production must not inherit that.**
`<all_urls>` was used because Chrome requires it or `activeTab` for `captureVisibleTab`, and
`activeTab` cannot be driven from a harness. It is a **spike-only** permission. PratiBimb's
production manifest is unwritten, and the trust boundary argues for `activeTab`. **That
choice is now known to be un-benchmarked**, which is a requirement handed to whoever writes
that manifest, not a decision taken here.

**QG-04 remains UNSIGNED. B-02 remains OPEN.**

---

## `ml-engineer` — L2

**Status: `PASS`. Not engaged.**

No model was downloaded, run, adopted or registered. No registry status changed. The
experiment required no inference, as expected. `UIElementDetector` remains
`DETECTOR_UNAVAILABLE` / the DOM-only floor.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

Scope held: one question, answered, plus the minimum production change its evidence
justifies. No retry, backoff, queueing or dropped-frame policy was added — the separation
the brief asked to preserve is preserved, and the adapter still reports while the scheduler
decides.

**No ADR is required.** Nothing here deviates from the dossier. The dossier already states
capture is *"neither free nor unrestricted — rate-limited, particularly under `activeTab`"*;
this experiment measures how much, and the change-detection constant moves **toward** the
dossier's position rather than away from it.

**Classification `CONDITIONAL` is the honest ceiling.** `ACCEPT` would require the
`activeTab` cell, and the dossier singles out that exact cell as the more restrictive one.
Upgrading on the strength of a clean Chromium result would be upgrading on intuition.
