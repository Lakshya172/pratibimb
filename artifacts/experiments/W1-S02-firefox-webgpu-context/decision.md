---
id: W1-S02-decision
spike: S-02
verdict: NOT RUN — BLOCKED
date: 2026-09-07
decided_by: nobody — there is nothing to decide yet
---

# S-02 decision — there is none

**S-02 has not been executed. This file exists so that nobody mistakes the absence of a
decision record for an oversight, and so that the experiment directory is well-formed.**

| Field | Value |
|---|---|
| Verdict | **none** |
| Feasibility matrix status | **`UNKNOWN`** — unchanged |
| Blocker | **B-01** — Firefox is not installed on any workstation available to the project |
| Gate | **QG-01 not opened** for S-02 |

## Why there is no verdict

`agentos/workflows/spike.md` requires a verdict of `FACT` or `still UNKNOWN` — *"never
'probably works'"*. There is no measurement, so the only honest value is `UNKNOWN`.

S-01 measured Chrome. It does not transfer: Firefox implements no `chrome.offscreen` API,
uses wgpu rather than Dawn, and ships WebGPU on a different schedule per platform. See
`README.md` in this directory.

## What is decided

Only this, and it is a process decision rather than a technical one:

1. **S-02 will not be approximated.** No emulation, no inference from the Chrome result, no
   "Firefox 141 shipped WebGPU so it presumably works in an event page". The dossier's own
   figures are quoted from a document and are labelled `INFERENCE` for exactly this reason.
2. **Downstream implementation does not start while S-02 is open**, per the project's own
   gating rule. This is recorded rather than quietly relaxed.
3. **The accept/reject criteria are pre-registered** in `README.md`, before any data
   exists, so they cannot be fitted to the outcome.

## What unblocks it

Install Firefox. The protocol, the criteria and the harness plan are already written; the
spike is a same-day task once a browser exists. Two cells are needed, not one — Firefox on
Windows and **Firefox on Linux**, the latter being the configuration the risk register
rates **High**.
