---
id: W1-B02
title: "B-02 — how to independently establish that an outbound request occurred"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# B-02 — Invariant E observation

## Hypothesis

S-01b established that Playwright's `context.route()` cannot see or block egress from an MV3
offscreen document — the context `docs/architecture/constitution.md` §5 assigns payload
assembly to. That left **B-02** open: *what mechanism can this project actually trust?*

The question is not "which is easiest to wire into CI". It is **which produces the strongest
defensible evidence**, given that the claim being defended is the one the whole submission
rests on.

Five sub-questions, from the blocker:

| | Question |
|---|---|
| **A** | Did an outbound request actually occur? |
| **B** | Did it originate through the intended egress path? |
| **C** | Are unauthorised requests detectable? |
| **D** | Did a *blocked* request genuinely not reach the network? |
| **E** | Do the transmitted bytes equal the verifier-approved artifact? |

**Hypothesis:** no single mechanism answers all five, and the honest answer is a
*combination* — one that can enforce inside the browser, and one that can adjudicate from
outside it.

## Environment

Full detail in [`environment.json`](environment.json).

| Field | Value |
|---|---|
| Machine | Workstation 2 — AMD Ryzen AI 7 350 / Radeon 860M, Windows 11 10.0.26200 |
| Automation | **Playwright 1.63.0**, channel `msedge`, headful |
| Browser | **Microsoft Edge 152.0.4191.66** (branded, stable) |
| CDP | raw CDP over Node's built-in `WebSocket`, `--remote-debugging-port=9444` |
| Context under test | **MV3 offscreen document** |
| Collector | `http://127.0.0.1:8902` — loopback only, ground truth |

**Why Edge:** S-01b measured that branded Chrome 152 silently ignores `--load-extension`
while branded Edge 152 honours it. Edge is the only branded browser on this workstation that
can load the unpacked extension at all, and Playwright's own Chromium could not be executed
here. **This is a constraint on the measurement, not a recommendation to test on Edge.**

## Method

A throwaway MV3 extension whose offscreen document contains three senders, modelling the
shapes that matter without being product code:

| Sender | Models |
|---|---|
| `egressSend()` | **the single egress module.** Hashes the exact bytes it is about to send and declares that hash plus a correlation id on the request |
| `rogueSend()` | **an unauthorised sender that bypassed the egress module.** Declares nothing — what a component calling `fetch()` directly looks like on the wire |
| `tamperSend()` | **the payload-pin failure.** Declares the hash of the verified artifact, then sends *different bytes* |

Four mechanisms were evaluated against a ground truth none of them control:

- **M1** — Playwright `context.route()` + `context.on("request")`
- **M2** — raw **CDP `Fetch.enable` attached to the offscreen target**
- **M3** — the **independent loopback collector**, which recomputes SHA-256 over the bytes it
  actually received
- **M5** — the **extension's own audit log** (self-report)

Five cases: three observation scenarios, then the same authorised send with M1 enforcing, and
with M2 enforcing.

## Expected result

M1 was expected to remain blind (S-01b). M2 was expected to see the target, since CDP already
reported it. **Whether M2 could *block*, and whether M3 could distinguish an unauthorised
sender from an authorised one, were genuinely open.**

## Actual result — FACT

### Observation and enforcement

| Case | M1 Playwright | M2 CDP (offscreen) | M3 collector — what actually arrived |
|---|---|---|---|
| **A** authorised egress | observed 0 | **observed 1** | arrived · declared hash present · **hash matches bytes** |
| **B** unauthorised sender | observed 0 | **observed 1** | arrived · **no declared hash, no correlation id** |
| **C** tampered bytes | observed 0 | **observed 1** | arrived · declared hash present · **HASH DOES NOT MATCH** |
| **D** M1 enforcing (abort all) | observed 0, **blocked 0** | observed 1 | **STILL ARRIVED** |
| **E** M2 enforcing (`Fetch.failRequest`) | observed 0 | observed 1, **blocked 1** | **NOTHING ARRIVED** |

Three findings, each independently load-bearing:

**Finding 1 — M1 is not merely blind, it is inert.** In case D, with a route handler
instructed to abort *every* request to the collector, Playwright blocked **zero** and the
payload reached the wire. `context.pages()` and `context.backgroundPages()` never surface the
offscreen document; CDP reports it as `type: "background_page"`. **A suite built on M1 would
report "zero outbound requests" while the payload left the machine.** This confirms and
extends S-01b: it cannot observe *and* it cannot enforce.

**Finding 2 — M2 both observes and genuinely blocks.** Attaching to the offscreen target and
enabling `Fetch` gave 1-of-1 observation in every case and, in case E, a block that the
independent collector confirms: **zero arrivals.** M2 also reads the declared hash and
correlation id off the request headers, so it can tell the authorised path from the rogue one
*before* the bytes leave.

**Finding 3 — M3 answers the two questions nothing inside the browser can answer honestly.**

- **Case B (C — unauthorised detection):** the rogue send arrived with **no correlation id
  and no declared hash**. An arrival lacking egress-module provenance is, by construction, an
  Invariant E violation — detectable without trusting any in-browser instrumentation.
- **Case C (E — byte equality):** the collector recomputed SHA-256 over the bytes it actually
  received and got **`hashMatches: false`** against the declared hash. **The payload pin was
  caught from outside the process that broke it.**

### The regression guard — 3 runs, deterministic

`harness/regression/false-green-guard.js`, verdict **PASS**:

```
{ "total": 3, "groundTruthDetected": 3, "falseGreenReproduced": 3,
  "playwrightNowSeesIt": 0, "verdict": "PASS" }
  run 1: playwright observed=0 blocked=0  |  actually arrived=1
  run 2: playwright observed=0 blocked=0  |  actually arrived=1
  run 3: playwright observed=0 blocked=0  |  actually arrived=1
```

The guard passes when the independent arrival check **detects egress that a Playwright-only
assertion reported as absent**. It fails if the ground truth ever stops detecting it — which
would mean the methodology, not the browser, has regressed.

**It deliberately does not assert that Playwright stays blind.** Pinning a third-party bug
would make the suite fail on an upstream fix. If Playwright gains offscreen coverage the
guard still passes and prints a notice to re-evaluate B-02.

## Mechanism assessment — INFERENCE

Each field is an engineering judgement resting on the FACTs above.

### M1 · Playwright `context.route()`

| | |
|---|---|
| **Trust level** | **None, for this purpose** |
| **Proves** | Nothing about the offscreen document |
| **Does not prove** | That no request occurred. Silence from M1 is not evidence of absence |
| **False positive risk** | Low |
| **False negative risk** | **Total — 3/3 and 5/5 measured.** The whole reason B-02 exists |
| **Reproducibility** | High (reliably wrong) |
| **CI suitability** | **Unsuitable alone.** Retains value for *page-context* traffic only |

### M2 · CDP `Fetch.enable` on the offscreen target

| | |
|---|---|
| **Trust level** | **High for enforcement, medium for evidence** |
| **Proves** | A request was attempted from the offscreen document; its URL, method and headers; and that a block took effect (M3 confirms zero arrivals) |
| **Does not prove** | That the browser told the truth. It is instrumentation *inside the process under test*, so it shares that process's failure modes and cannot be the sole witness for an adversarial claim |
| **False positive risk** | Low–medium: a paused request is an *attempt*, not an arrival. Counting attempts as sends over-reports |
| **False negative risk** | **Low but not zero** — bounded by target discovery. A send from a target attached to *after* it started is missed; `Target.setAutoAttach` with `waitForDebuggerOnStart` is the mitigation and is **untested here** |
| **Reproducibility** | High — 1/1 in all five cases |
| **CI suitability** | **Good**, with a caveat: raw CDP is more fragile across browser versions than Playwright's API, and this used a hand-rolled client |

### M3 · Independent loopback collector

| | |
|---|---|
| **Trust level** | **Highest available** |
| **Proves** | That bytes **reached the wire** — the only mechanism that does. Recomputing the hash proves **byte equality (E)**; absent provenance headers prove **an unauthorised path (C)** |
| **Does not prove** | Anything about requests that never reached *it*. It cannot distinguish "blocked" from "never attempted", and it sees only its own origin |
| **False positive risk** | **Very low** — an arrival is an arrival |
| **False negative risk** | **Medium, and this is the honest weakness**: traffic to a *different* host is invisible. Needs pairing with a CSP-pinned `connect-src` and DNS/proxy-level containment |
| **Reproducibility** | **Highest — 8/8 arrivals** across both runners |
| **CI suitability** | **Excellent.** No browser internals, no version coupling, ~150 lines |

### M5 · Extension self-audit log

| | |
|---|---|
| **Trust level** | **Low as evidence, useful as a cross-check** |
| **Proves** | What the egress module *believes* it did |
| **Does not prove** | Anything adversarial. **A bypassed egress module logs nothing** — exactly what case B shows: rogue send, zero audit entries |
| **False positive risk** | Low |
| **False negative risk** | **High by construction** — it is the component under test reporting on itself |
| **Reproducibility** | High |
| **CI suitability** | As a **corroborating** signal only. Its real value is *disagreement*: M3 saw an arrival with no M5 entry ⇒ something bypassed the egress module |

### Coverage against the five sub-questions

| | M1 | M2 | M3 | M5 | **M2 + M3** |
|---|---|---|---|---|---|
| **A** request occurred | ✗ | partial (attempt) | **✓ (arrival)** | ✗ | **✓** |
| **B** through the intended path | ✗ | ✓ (headers) | ✓ (provenance) | self-reported | **✓** |
| **C** unauthorised detectable | ✗ | ✓ | **✓** | ✗ | **✓** |
| **D** blocked really didn't reach | ✗ | claims it | **✓ confirms** | ✗ | **✓** |
| **E** bytes = verified artifact | ✗ | ✓ (declared) | **✓ (recomputed)** | ✗ | **✓** |

**No single mechanism covers all five. M2 + M3 does, and their failure modes are
independent** — M2 is inside the process, M3 is outside it. That independence is the point:
if the browser lies, M3 still sees the bytes; if traffic goes somewhere M3 does not listen,
M2 still saw the attempt.

## Corrections made during the spike

- The first runner attached CDP before the offscreen document existed, so `Target.getTargets`
  found nothing. Fixed by nudging the document into existence with a warm-up call and polling
  for the target, and warm-up arrivals are filtered out of the ground truth rather than
  counted.
- `chrome-headless-shell` is unavailable here, so every case is headful. Recorded, not
  worked around.

## Conclusion

**CONDITIONAL.** A trustworthy mechanism exists and was measured working end to end:
**CDP `Fetch` on the offscreen target for in-browser enforcement, paired with an independent
loopback collector that recomputes the payload hash as ground truth.** Together they answer
all five sub-questions on this cell. **Playwright `context.route()` answers none of them for
the send path and must not be the vehicle for Invariant E mechanism (2).**

It is CONDITIONAL, not ACCEPT, for three reasons stated plainly:

1. **The CI cell is unmeasured.** This is Windows + branded Edge. CI is `ubuntu-latest` with
   Playwright's own Chromium. **`UNKNOWN` — S-01b-1.**
2. **M2's target-discovery race is untested.** `Target.setAutoAttach` with
   `waitForDebuggerOnStart` should close it; that is an assertion, not a measurement.
3. **Adopting this changes how a frozen invariant is enforced**, which is an ADR decision for
   the human architect and the `privacy-security-engineer`. **This spike proposes; it does not
   decide.**

**`docs/security/security-invariants.md` is untouched. Invariant E is unchanged and has not
been weakened. QG-04 remains unsigned.**

## Reproducibility

```bash
cd artifacts/experiments/W1-B02-invariant-e-observation/harness
npm install playwright@1.63.0
node run-b02.js                        # five-case mechanism matrix -> results.json
node regression/false-green-guard.js   # the regression guard, 3 runs, exit code is the assertion
```

Requires branded Microsoft Edge. Node ≥ 22 (built-in `WebSocket`). The harness contacts **no
external host** — everything goes to `127.0.0.1:8902`, and CDP to `127.0.0.1:9444`. Browser
profiles are created in the system temp directory and deleted after every run.

## Scope

**One machine · Windows · branded Edge 152 · Playwright 1.63.0 · MV3 offscreen document.**
Per `AGENTS.md` §5 this fills the cell it tested and no other. It says nothing about Linux,
nothing about Playwright's bundled Chromium, nothing about Firefox, and nothing about
workstation 1.
