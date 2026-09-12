---
id: WA-item11-decision
workstream: W-A — real-UI evaluation data for detector adoption item 11
verdict: NOT RUN — DESIGN PRE-REGISTERED, APPROVAL REQUIRED
date: 2026-09-12
decided_by: pratibimb-architect (L1 — recommends; the human decides)
---

# W-A decision record — there is no verdict

**There is no verdict, because nothing was measured.** This file exists so the repository's
convention holds for a directory that deliberately contains no result, and so the absence is
recorded explicitly rather than inferred from a missing file.

| | |
|---|---|
| **W-A** | **NOT RUN.** Design pre-registered; no screen collected, no annotation made, no split sealed |
| **Adoption item 11** | **FAIL** — unchanged |
| **Detector** | **UNADOPTED**, artifact `ba6d9e93…` unchanged, threshold **0.55** unchanged, shipped constant **0.25** unchanged |
| **Evaluator** | **frozen and untouched**, CLIPPED definition included |
| **Consumed held-out split** | **closed forever.** Not reused, not re-scored, never described as independent |
| **Retraining** | **not authorised, not justified, not performed** |
| **Approvals** | **none.** Ten decisions (D1–D10) are listed in `design.md` §11 and **none was self-approved** |

## What the design establishes, on repository evidence

1. **Item 11 is a data-and-governance problem, not a model problem** — on the evidence
   available today. The evaluator already admits both real sources, so **no evaluator change is
   required**; no threshold change is required; and **no retrain is justified** until a real
   figure exists to justify it.
2. **The gate has no number behind it.** *"Acceptable detector metrics"* is qualitative, and
   the benchmark contract sets a numeric target for PII recall only. Until the owner fixes
   what *acceptable* means, **item 11 cannot pass or fail on any figure** — it can only be
   argued about, which is the failure mode pre-registration exists to prevent.
3. **The redacted half of item 11 cannot be produced at all today**, because it needs T2. That
   is independent of how much data is collected.
4. **Real data breaks an assumption the current leakage guard relies on.** The guard is correct
   for synthetic renders and insufficient for real pages; the fix belongs in dataset
   construction, not in the frozen evaluator.

## What must happen before this directory may contain a result

In order, with the first as a hard gate:

1. The **privacy and licensing approvals** (D5, D10). **No real screen may be captured before
   them** — a collection run cannot be made compliant after the frames exist.
2. **D2**, the numeric meaning of *acceptable*, recorded **before** the test split is sealed.
3. The remaining decisions D1, D3, D4, D6, D7, D8, and D9 only if §8 triggers it.
4. The sequence in `design.md` §12, which has not started. **Current status: step 0.**

## Scope — what this record does NOT do

It does not collect, label, seal, train, evaluate or adopt. It does not change the model, the
threshold, the evaluator, the CLIPPED definition, the consumed split, the feasibility matrix or
any adoption item status. It makes **no legal claim** about any data source, and it **invents no
acceptance threshold and no capture-size limit**.
