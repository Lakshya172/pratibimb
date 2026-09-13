# E4 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Verdict: PASS on attempt 2** (attempt 1 FAILED; both kept)

| Criterion | Attempt 1 (`e4-scanner-1`) | Attempt 2 (`e4-scanner-2`) |
|---|---|---|
| In-scope positives detected, own class only | 1,700 / 1,800 — **FAIL** | **1,800 / 1,800** |
| False positives | 0 / 480 | **0 / 480** |
| Empty-canary detections | 0 | **0** |
| Arrival and SHA-256 integrity | 2,520 / 2,520 | **2,520 / 2,520** |
| Blind spots confirmed undetected | 240 / 240 | **240 / 240** |

## What the PASS licenses

The instrument may measure product egress, **only**:
- byte-identical, checked by SHA-256
- with its blind spots stated
- with a live sentinel leak in every run
- after re-validation in the cell of use (the MV3 offscreen document)

## What it does not license

- Any statement about PratiBimb's privacy. No product component was involved.
- Any statement about browser-originated egress. This cell is Node → loopback.

## Standing rule

A scanner change needs a new `SCANNER_VERSION`, a fresh seed block and a full E4 re-run. No earlier
PASS carries over to changed code.
