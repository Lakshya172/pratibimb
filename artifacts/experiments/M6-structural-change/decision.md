# Decision — M6 structural change signal

| Field | Value |
|---|---|
| **Verdict** | **PASS** — all gates; degraded-route regression 72/72 with the signal live |
| **Status** | **CONDITIONAL** — §6's structural signal is implemented for node, attribute, text and document-geometry change; **per-element resize is not** |
| **Date** | 2026-09-24 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chromium 1243 (`chrome-win64`), headed |

## What this authorises

**Citing constitution §6's structural signal as implemented, with the exception named.** It exists,
it runs in a real browser, it is event-driven, and it costs 2 ms to ask and nothing to keep.

**Treating a moved page as a reason to refuse.** `OBSERVATION_STALE` is a real refusal on the one
existing freshness path, not a warning and not a log line.

## What this does not authorise

- **Any capture.** The signal has no route to one, and ADR-0009's policy is untouched.
- **Calling §6 fully implemented.** Per-element resize is not observed — see below.
- **Any scheduler, poll, dHash or safety net.** None was built and none is implied.
- **Any accuracy or perception claim.** The detector, the tiers and the capture route are untouched.

## Open, and stated rather than hidden

### 1. Per-element resize is not observed

§6 names *"ResizeObserver on tracked elements"*; this observes `document.documentElement` only.

Re-targeting the observer at the measured set on each observation would re-enumerate that set on
every mutation — polling by another name — and a `ResizeObserver` fires an initial callback for
every newly observed element, which would make each observation instantly stale against itself.
Both are real obstacles, neither was measured, and inventing a mitigation would have been tuning
against an unmeasured problem.

**Consequence:** an element that resizes without changing any watched attribute, any node or the
document's own geometry does not move the sequence. The graph's boxes would be stale and nothing
would say so. Closing this needs a measurement, and probably an owner-visible decision about the
cost, which is why it is recorded rather than attempted.

### 2. The refusal path has never fired in a real browser

`OBSERVATION_STALE` has eight unit tests and zero browser occurrences: the fixture is static enough
that the sequence does not move between the refresh reading and the dispatch, which is exactly what
the 72/72 run shows (`structurallyCurrent: true` twice). The check is therefore **implemented and
unexercised in situ** — a fixture that mutates during the window would exercise it, and none exists.

### 3. The window the check closes is narrow, by construction

The machine already re-observes before acting, so the structural check guards only the interval
between that reading and the dispatch. That is a real interval — nothing else covers it, and the hit
test checks a point rather than the graph — but it is small. The larger question, whether a plan
built on an observation the page has since left should be re-planned rather than re-validated, is
**not answered here**: it would need a re-plan loop, which is a decision and a scope of its own.

In the normal run the page *does* move between the first observation and the refresh — the
re-hydration writes into the page — so structural staleness relative to the *planning* observation
is the common case, not the exception. That is why the witness compares against the refresh
reading and not the planning one, and why enforcing it against the planning reading would have
broken the loop rather than protected it.

### 4. `ChangeGate` is still unwired

Its `STRUCTURAL` branch is the right home for this signal on the day something needs debouncing, and
nothing does. Wiring it now would have been code written to make a contract look implemented. It
keeps its ADR-0010 §7 disposition: future infrastructure, zero production callers.

### 5. `apps/extension` is still outside the typecheck graph

Measured: a probe tsconfig over `host-lib`, `host` and `e6` reports **81 errors, every one a missing
`chrome` name or namespace** and none of any other kind. Closing it needs `@types/chrome`, which is
a dependency decision under `AGENTS.md` §4.6, and WXT's generated types live under a git-ignored
directory. Recorded and enforced instead: `coverageBoundary.test.ts` requires every extension source
file to be on one of two lists, so a new file forces the decision.

**`page-surface-dom.ts` — the only file in the product containing a `MutationObserver` — is on the
build-only list.** Its types are checked by nothing. That is worth knowing about the file this
milestone added the observers to.

### 6. My own error, recorded

The previous milestone's report claimed the test suite had passed on a syntactically invalid file.
It had not: it failed 58 of 77 test files, and the exit code I read came from the `tail` I had piped
the run into. Reproduced deliberately this milestone — vitest does reject that file. The claim was
wrong and the invocation was mine.

### 7. Everything earlier milestones left open is still open

The refused literal insert, no human-facing grant surface for the value approval, the undecided
lifetimes, `E6_ARM`/`E6_RELEASE` as a value-release stub, the attribution epsilon, Chrome's
unscheduled capture quota on the degraded route, and every detector number remaining `CONDITIONAL`.

## The next technical milestone

**Visual-text / model selection**, as its own evidence-driven workstream — unchanged by this
milestone and not started in it. `PP-OCRv5_mobile_det` must move from 4.12e-02 to under 2e-02 on
WASM under realistic input, which the original S-04a-1 record names as the validation never done, or
be recorded `REJECTED` and replaced. A model-adoption exercise with QG-03 attached; it should not
start with a download.
