# Track B — decision record

## Verdict

**NO VERDICT. The experiment has not been run.**

This record exists so the absence is explicit rather than inferred from an empty directory. A
reader who wants a number should find this sentence, not a gap.

| | |
|---|---|
| **Design** | **PRE-REGISTERED** — [design.md](design.md), locked before any cell is rendered |
| **Execution** | **NOT STARTED.** No frame rendered, no inference run, no metric computed |
| **H-GEOMETRY** | **INCONCLUSIVE** — no data |
| **H-APPEARANCE** | **INCONCLUSIVE** — no data |
| **H-MIXED** | **INCONCLUSIVE** — no data |

## What was decided

1. **The design is fixed before scoring**, including the interpretation rules and the "reproduces
   most of" threshold (70%), so neither can be chosen after seeing results.
2. **The shipped decode is the subject**, not V1. Track B asks what scale does to the detector as
   it ships; running it under an unadopted candidate would answer a different question.
3. **The experiment builds on PR #52's harness unmodified** rather than on a reimplementation.
   That harness is self-contained — it imports nothing from `packages/` — so a `main`-based
   rebuild would duplicate the evaluator and the two copies would drift.
4. **Five sanity checks can void the run** before any result is read, including that the three
   families' k = 1.00 cells must agree and that GEOM(k) and NAT(k) must carry identical
   annotations. A design that cannot be voided cannot be trusted.

## Why it is blocked

The governed harness exists only in **PR #52** (`spike/w1-detector-precision-scale`), which is
open and unmerged. The landing audit found it `MERGEABLE`, `CLEAN` and 9/9 checks green, with **no
blocking CI, review or governance defect**.

**Status: OWNER MERGE REQUIRED.** PR #52 comes from a third party's fork, and the repository
workflow is that the owner performs merges. No merge was performed and none was simulated.

## What is NOT claimed

- No mechanism for the scale collapse. Arm B's finding stands as *scale is implicated*, and
  **H-S1 (stride-8) remains NOT SUPPORTED** — not disproven, not isolated.
- **No deployment limit.** The ~2.0 CSS px per model px region is not a capture policy, a minimum
  capture size, or a maximum scale.
- No claim about real websites, task completion, or adoption item 11.

## Not changed

Production decoder, threshold, model weights, `PROVISIONAL_THRESHOLDS`, the frozen TEST split
(never opened), the model registry, the detector's **UNADOPTED** status, and every privacy and
egress invariant.

## Follow-up

| id | item |
|---|---|
| **PR #52** | owner merge — the only thing blocking execution |
| **Track B run** | execute [design.md](design.md) unmodified once #52 lands; 24 cells, DEV only |
