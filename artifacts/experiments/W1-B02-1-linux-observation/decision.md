---
id: W1-B02-1-decision
spike: B-02-1
verdict: CONDITIONAL
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer, reviewed against privacy-security-engineer and pratibimb-architect contracts (HUMAN ARCHITECT DECISION STILL REQUIRED)
---

# B-02-1 decision — CONDITIONAL

## Verdict

**CONDITIONAL.** The B-02 model holds on Linux, headful **and** headless, **66 runs of 66**,
and the experiment produced one finding that changes how the recommendation must be worded.

| Question | Answer |
|---|---|
| Does CDP auto-attach observe offscreen egress on Linux? | **YES** — headful and headless |
| Does it genuinely block? | **YES** — `BLOCKED_CONFIRMED`, collector confirms zero arrivals |
| Does the `late-attach` race exist on Linux? | **YES** — false green 10/10 |
| Does `setAutoAttach` + `waitForDebuggerOnStart` close it? | **YES** — 10/10, both display modes |
| Does Playwright-only enforcement work? | **NO** — false green 6/6 |
| Does headless behave like headful? | **YES — identical in every cell** |
| Is the actual CI cell validated? | **NO. `UNKNOWN`.** |

## The finding that changes the wording

**CDP auto-attach does not fail closed on its own.**

With `Fetch.enable` skipped while attachment still succeeded, the mechanism reported nothing
and the payload reached the wire — `NOT_OBSERVED` + `GROUND_TRUTH_ARRIVED`, 3/3. From CDP's
side that is **indistinguishable from a clean run**. Only the independent collector caught it.

A *connection* failure is loud (`NOT_OBSERVABLE`). A *partial* failure is silent. Since
partial failures are the common kind in CI — a version skew, a timing change, a renamed
domain — this is the realistic risk, not the exotic one.

**Consequence for the ADR:** the collector is not redundancy. It is **the component that makes
the pair fail-closed**, and the ADR should say so in those terms rather than describing it as
a second opinion.

## Recommendation to the human architect — for the ADR, still not adopted here

Unchanged in substance from B-02, sharpened in three ways:

1. Mechanism (2) becomes **`Target.setAutoAttach` with `waitForDebuggerOnStart`, armed before
   the extension can create its offscreen document, AND an independent arrival assertion —
   both required, neither sufficient.**
2. **`late-attach` must be named as a forbidden implementation.** It is not a lesser option;
   it reproduces the exact false green in 10/10 runs.
3. **The suite must fail when instrumentation cannot be established.** `NOT_OBSERVABLE` must
   be a test failure, never a silent pass — and because partial failures look like silence,
   the arrival assertion is what enforces it.

## What this decision does NOT do

- ❌ Adopt a mechanism. That is still the **B-02-2 ADR**, and still the human architect's.
- ❌ Claim CI is validated. `ubuntu-latest` resolved to **`ubuntu-24.04`**; this ran on
  **Ubuntu 26.04 under WSL2**. Different release, different kernel, no GPU, no WSLg on a
  runner. **`UNKNOWN`, recorded as such.**
- ❌ Weaken, reword or narrow Invariant E or any INV-nn.
- ❌ Sign QG-04.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| B-02-1a | Run the matrix in the **real GitHub Actions cell** (`ubuntu-24.04`, hosted runner). Needs a CI job, which needs a merged PR and a maintainer. | **p1** | QG-04 sign-off |
| B-02-1b | Capture `offscreenAttachedMs` / `fetchEnabledMs` directly — key on target **type** plus a `Target.targetInfoChanged` follow-up rather than on the URL, so `instrumentationBeforeSend` is measured rather than inferred from the outcome | p2 | Confidence in the ordering claim |
| B-02-1c | Add the **partial-instrumentation-failure** case to the permanent regression suite. It is the failure mode that fails open. | **p1** | QG-04 enforcement design |

## Registry effect

- `agentos/blockers.md`: **B-02 stays `OPEN`.** Linux and headless are now measured, which
  closes two of its three gaps — **the CI cell and the ADR remain**.
- `agentos/registry/feasibility-matrix.md`: B-02-1 recorded; **B-02-1a added as `UNKNOWN`**.
- `docs/security/security-invariants.md`: **unchanged.**
- No model cell affected. No model downloaded. No product code written.
