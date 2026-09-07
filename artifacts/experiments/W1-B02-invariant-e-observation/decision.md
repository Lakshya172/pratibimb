---
id: W1-B02-decision
spike: B-02
verdict: CONDITIONAL
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer, reviewed against privacy-security-engineer and pratibimb-architect contracts (HUMAN ARCHITECT DECISION REQUIRED — see below)
---

# B-02 decision — CONDITIONAL

## Verdict

**CONDITIONAL.** A defensible mechanism exists and was measured working end to end:

> **CDP `Fetch.enable` attached to the MV3 offscreen target, for in-browser observation and
> enforcement — paired with an independent loopback collector that recomputes SHA-256 over
> the bytes it actually received, as ground truth.**

Together these answer all five sub-questions on the cell measured. **Playwright
`context.route()` answers none of them for the send path.**

| | Question | Answered by |
|---|---|---|
| A | Did a request actually occur? | **M3** (arrival), corroborated by M2 (attempt) |
| B | Through the intended egress path? | **M2** headers + **M3** provenance |
| C | Are unauthorised requests detectable? | **M3** — the rogue send arrived with no correlation id and no declared hash |
| D | Did a blocked request really not reach the network? | **M2** blocks, **M3 confirms zero arrivals** |
| E | Do transmitted bytes equal the verified artifact? | **M3** — recomputed hash caught the tampered send |

## Why CONDITIONAL and not ACCEPT

Three gaps, none of which can be closed by argument:

1. **The CI cell is unmeasured.** This ran on Windows with branded Edge, because branded
   Chrome 152 refuses `--load-extension` and Playwright's own Chromium would not execute
   here. CI is `ubuntu-latest` with Playwright's Chromium. **`UNKNOWN` — S-01b-1, and it is
   p1.**
2. **M2 has an untested target-discovery race.** A send from a target attached to *after* it
   starts would be missed. `Target.setAutoAttach` with `waitForDebuggerOnStart` is the
   standard mitigation. **That is an assertion, not a measurement.**
3. **M3's honest weakness is scope, not accuracy.** It sees only traffic aimed at itself.
   Egress to a different host is invisible to it, and closing that needs the manifest CSP
   `connect-src` pin (Invariant E mechanism 3) plus host-level containment. **The collector
   is necessary and not sufficient.**

## Security impact

**`docs/security/security-invariants.md` is untouched. Invariant E is unchanged and has not
been weakened. No assertion was relaxed. QG-04 remains unsigned.**

| # | Mechanism | Status after B-02 |
|---|---|---|
| 1 | Lint rule outside the egress module | Unaffected |
| 2 | **Interception asserting zero requests** | **Candidate vehicle identified and measured. Not adopted — needs an ADR.** |
| 3 | Manifest CSP `connect-src` | Unaffected, and **more load-bearing than previously credited** — it is what bounds M3's blind spot |
| 4 | Payload hash pin (INV-02/03) | Unaffected. B-02 shows it is **externally checkable**, which strengthens it as evidence |

One observation worth recording for the viva: **the payload pin is not only an internal
control.** Because the egress module declares the hash on the request, an outside observer
can recompute it over the received bytes and catch a mismatch — as case C did. That turns
INV-02/INV-03 from a claim into something a sceptical third party can verify.

## What this decision does NOT do

- ❌ **It does not adopt a mechanism.** Changing how a frozen invariant is enforced is an
  architectural decision reserved for the human architect and the `privacy-security-engineer`,
  and it belongs in an **ADR**, not in a spike conclusion.
- ❌ **It does not move the egress module.** Relocating the send path so a test framework can
  see it was rejected as a direction before the spike began, and nothing measured here
  changes that.
- ❌ **It does not weaken, reword or narrow Invariant E or any INV-nn.**
- ❌ **It does not redefine "no request observed" as "no request happened".** That equivalence
  is precisely the false green this spike exists to prevent, and the regression guard now
  encodes it.
- ❌ **It does not sign QG-04.**

## Recommendation to the human architect — for an ADR, not for adoption here

**Adopt M2 + M3 jointly, and require both.** The argument is that their failure modes are
independent: M2 is instrumentation *inside* the process under test, M3 adjudicates from
*outside* it. A mechanism that can only be checked by the thing it is checking is not
evidence, and the panel will ask.

Specifically, an ADR would need to settle:

1. Whether mechanism (2) becomes **"CDP-attached interception **and** an independent arrival
   assertion, both required"**, rather than a single Playwright test.
2. Whether the **absence of egress-module provenance on an arrival** (no correlation id, no
   declared hash) is itself a **fail-closed condition** — case B suggests it should be.
3. Whether the **collector's recomputed hash check** becomes a standing assertion in the
   fail-closed matrix, not just a spike artifact.
4. Whether Playwright's `context.route()` is **explicitly documented as insufficient** for
   the send path, so nobody re-derives the false green in week five.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| B-02-1 | Re-run this matrix on **`ubuntu-latest` with Playwright's own Chromium** | **p1** | QG-04 sign-off |
| B-02-2 | **ADR** adopting (or rejecting) M2 + M3 as Invariant E mechanism (2) | **p1** | QG-04 sign-off |
| ~~B-02-3~~ | ~~Close M2's target-discovery race~~ **CLOSED — see `PHASE2.md`.** The race is real (`late-attach` lost the request **10/10**, on both browsers) and `Target.setAutoAttach` + `waitForDebuggerOnStart` closes it (`BLOCKED_CONFIRMED` **10/10**). **Late attachment is now named as an unsafe implementation** — it reproduces the false green. | ✅ | — |
| ~~S-01b literal~~ | ~~Does Playwright's bundled Chromium honour `--load-extension`?~~ **ANSWERED — YES**, 15/15 runs on Chrome for Testing 153.0.8010.12, the build Playwright names for chromium v1243. **Branded Chrome 152 is the outlier, not Chromium.** Also removes the concern that phase 1 was an Edge quirk: the bundled build behaves identically, cell for cell. | ✅ | — |
| B-02-6 | **Headless is `UNKNOWN`.** Every run in both phases is headful; `chrome-headless-shell` sits behind the same failing Playwright CDN. CI runners are headless. | **p1** | QG-04 sign-off |
| B-02-4 | Promote `false-green-guard.js` into the real suite once product code and a test runner exist | p2 | — |
| B-02-5 | Bound M3's blind spot: CSP `connect-src` pin plus host-level containment for non-collector destinations | p2 | Completeness of mechanism (3) |

## Registry effect

- `agentos/blockers.md`: **B-02 stays `OPEN`.** A candidate is identified and measured; the
  decision is not made. **It is not marked RESOLVED**, because the ADR does not exist and the
  CI cell is unmeasured.
- `agentos/registry/feasibility-matrix.md`: B-02 recorded with three new `UNKNOWN` rows.
- `docs/security/security-invariants.md`: **unchanged.**
- No model cell is affected. No model was downloaded. No product code was written.
