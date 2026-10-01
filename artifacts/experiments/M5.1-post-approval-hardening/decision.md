# Decision — M5.1 post-approval hardening

| Field | Value |
|---|---|
| **Verdict** | **PASS** — all automated gates; real-route regression in `REAL-ROUTE.md` |
| **Status** | **ARCHITECTURALLY APPROVED** (ADR-0009, owner, 2026-09-24) · **EXPERIMENTALLY VERIFIED** for the lifecycle and both regressions · **NOT** a readiness claim |
| **Date** | 2026-09-24 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Cell** | Chrome for Testing 153.0.8010.12, headed |

## What this authorises

**Citing ADR-0009 as settled.** The capture-architecture question is closed: gesture-authorised tab
capture is the product path, the owner approved it, the constitution says so, and the prohibitions
are enforced where a reader can check them rather than remembered.

**Treating re-authorisation as product behaviour.** A grant belongs to a page. Navigation ends it.
The side panel says so in one sentence. None of that is a defect queue.

## What this does not authorise

- **Production readiness.** Ruled out by the owner in the approval itself.
- **Any accuracy claim.** The detector was not touched and remains `CONDITIONAL`.
- **Any visual text capability.** None exists.
- **Resolving the §6 conflict below.** It is recorded, not decided.

## Open, and stated rather than hidden

### 1. `constitution.md` §6 and the approved capture policy disagree

§6 is FROZEN and describes three change signals, two of which take captures: **bounded dHash
polling** over enumerated dynamic regions, and a **low-rate full-frame dHash safety net**. The
capture policy approved in ADR-0009 forbids polling and autonomous capture.

- Structural (MutationObserver): needs no capture — compatible.
- Visual (enumerated same-origin `<canvas>`/`<video>`): a content script can read those directly, so
  probably compatible — **unverified**, and nobody has tried.
- **Full-frame safety net: cannot exist as described.** It is a capture with no person behind it.

**This is a genuine conflict between a FROZEN section and an APPROVED ADR, and this milestone does
not resolve it.** Resolving it means either amending §6 or narrowing ADR-0009, and both are owner
decisions. Nothing depends on it today because no scheduler exists — which is exactly why it should
be settled before one is built, not after.

### 2. `frameHash` is obsolete on the product path and still exported

It hashes encoded bytes; a live frame has none, so it throws. That is the right failure — hashing an
absent buffer would make a change gate report "unchanged" forever — but it means the package exports
a function the product cannot use. Left in place, unwired, and documented rather than deleted,
because the scheduler that would need *a* frame hash does not exist yet and the shape it needs is
not yet known.

### 3. One commit bundled more than it should have

`ab06a39` carries the ADR approval, the constitution amendment, the capture-policy document, the
lifecycle code and the side-panel line together. The brief asked for small reversible commits and
this one is four changes. History was not rewritten to fix it, per the standing instruction; it is
recorded here instead.

### 4. The gesture cost is now measured in operator time, not just in principle

Across M4 and M5.1, waits for a human click ran from **16 s to 299 s**, and one regression run
**timed out at 420 s** and had to be relaunched. For a demonstration that is a presenter pausing;
for a benchmark harness it is a hard limit on how much real-route evidence can be gathered. Every
real-route number in this repository costs a person's attention, which is the honest reason there
are three acts of it and not thirty.

### 5. The lifecycle's document binding has unit coverage and one browser run

Binding on first use, `DOCUMENT_CHANGED`, and the revocation reasons are covered by eighteen unit
tests with the browser faked. In a real browser the path is exercised only as far as the regression
run below reaches — and Chrome's own revocation fires first in practice, so the authority's binding
is a second line that has not been *observed* catching anything.

### 6. Everything earlier milestones left open is still open

The refused literal insert, no human-facing grant surface for the *value* approval (distinct from
the capture one added here), `apps/extension` outside the typecheck graph, the undecided lifetimes,
`E6_ARM`/`E6_RELEASE` as a value-release stub, the attribution epsilon, and Chrome's unscheduled
capture quota on the degraded route.

## The next technical milestone

**Model selection for visual text, as its own evidence-driven workstream.** The architecture is
already the right shape and the interface already exists: a region detector needs no vault, produces
no string, and plugs into `TextFinding` unchanged. What is missing is one measurement —
`PP-OCRv5_mobile_det` moving from 4.12e-02 to under 2e-02 on WASM under realistic input, which the
original S-04a-1 record names as the validation never done — or a `REJECTED` entry and a different
candidate. That is a model-adoption exercise with QG-03 attached, and it should not start with a
download.
