# QG-03a-B3-1 — decision record

## Verdict

**HARNESS IMPLEMENTED AND VALIDATED. EXPERIMENT NOT STARTED.**

Three statements, deliberately kept apart:

| | |
|---|---|
| **Harness implementation** | **COMPLETE and TESTED.** 21 unit tests; both fail-closed paths exercised by a real failure; and an end-to-end run of all four MV3 cells plus the native reference on workstation 2 |
| **B3-1 experiment** | **NOT STARTED.** No cell has been measured on **workstation 1**, and only workstation 1 can produce B3-1 evidence |
| **Workstation 1 acceptance** | **NOT SATISFIED.** It needs the workstation-1 run, and B1 approval for the criterion it would be judged against |

## What was decided

1. **The criterion is not changed.** The numbers (≥ 95% matched at IoU 0.5, |count Δ| ≤ 2,
   ≤ 2.0 CSS px) come from QG-03b-2, where they were pre-registered as an **identical-input
   detector-equivalence** criterion. B2 proposed reusing them for **backend-noise robustness**,
   with zero true failures, at the measured difference. The harness measures exactly that and
   records it as **CANDIDATE: QG-03a-B1 ARCHITECT APPROVAL REQUIRED**.
2. **The realm is part of the cell.** `ortRuntime.ts` says inference runs in a dedicated worker;
   QG-03 and QG-03b-2a ran ORT in the offscreen document. Rather than pick one, both are cells
   (`--realm=document`, `--realm=worker`) and no result transfers between them. This is stricter
   than the pre-registered coverage, never weaker. On workstation 2 the two realms turned out
   **bitwise identical**, which is a reason to keep measuring the distinction, not to drop it.
3. **Native ORT 1.29.0 CPU is the reference**, and the reference script now refuses any other
   version (exit 3) and any output that is not `[1, 12, 6400]` and finite (exit 4). QG-03b-2a's
   reference was Python ORT 1.20.1, one of the reasons its workstation-1 numbers cannot close
   QG-03a-B.
4. **Both fixture readings are reported.** B4 (`gradients-edges` = STRESS-ONLY) is proposed, not
   approved, so the analysis reports the criterion on all 20 fixtures **and** on the 18 UI
   fixtures, flags a failure at the real difference for escalation, and never drops a fixture.
5. **Workstation 2 cannot stand in for workstation 1.** Its runs are labelled
   `DEVELOPMENT / NON-W1 EVIDENCE` and written under `logs/development-<machine>/` by the harness
   itself rather than by convention.

## What the development run established, and what it did not

**Established (workstation 2, Chrome for Testing 153.0.8010.12, AMD `rdna-3`):** the exact
artifact runs through the production ORT pin, the production session factory and the shipped
decode and NMS **inside the real MV3 extension**, in both the offscreen document and its dedicated
worker; the backend is proved by counted GPU submits (180 on each WebGPU cell, 0 on each WASM cell
with the hook confirmed installed) and the adapter is identified; the input tensor is identical
across all five cells and equal to the committed reference digests on 20 of 20 fixtures; and
against the native reference every pair gives **0 survivor swaps, 0 true failures, count change 0
and worst displacement ≤ 0.0028 CSS px**, meeting the candidate criterion on every fixture in both
views. The WASM-vs-WebGPU figures reproduce B2's page-context numbers exactly (2.136e-3 box,
1.761e-5 class).

**Not established:** anything about B3-1. These are workstation-2 cells on an AMD adapter. They
say nothing about Intel, NVIDIA, Linux or Firefox, and they do not reduce what B3-1 must measure.

**Recorded as an environment limitation:** workstation 2's Playwright browser directory is
unusable (side-by-side failure; `npx playwright install chromium` fails on a download timeout),
while the same Chrome for Testing bytes extracted elsewhere launch normally. The cells ran via
`CHROME_PATH`. No branded-browser fallback was added, because branded Chrome ignores
`--load-extension` and the run would silently not be the cell it claimed to be.

## What is NOT done

- No NMS, decoder, threshold, preprocessing or model change. The model was not regenerated,
  retrained, modified or committed.
- The 20 fixtures were not regenerated; they are read and hash-verified on every run.
- The held-out split, the model registry and the detector's adoption status are untouched. The
  detector stays **UNADOPTED** at the frozen 0.55 operating point.
- No security change: ADR-0001, the CSP builder, `connect-src`, the ORT pin, the egress verifier,
  B-02 and QG-04 are as they were. The harness is loopback-only and is not product code.
- No status was promoted: **B1 approval pending, B2 PASS (workstation 2), B3-1 NOT STARTED, B4
  proposed, QG-03a-B CONDITIONAL, QG-03a-C CONDITIONAL, QG-03a OPEN, QG-03 CONDITIONAL.**

## Follow-ups

| id | item |
|---|---|
| QG-03a-B1 | the architect approves (or amends) the criterion, and B4's fixture scope |
| QG-03a-B3-1 | run the four cells on **workstation 1** and record the evidence |
| B3-1-env | workstation 2's Playwright browser directory is broken; repair it if that machine is ever to host an extension cell without `CHROME_PATH` |
| B3-1-dumps | the workstation-1 run's raw `.f32` dumps are gitignored; the operator must archive them, since losing them is exactly what made QG-03b-2a unauditable |
