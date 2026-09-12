# W-A — real-UI evaluation data for detector adoption item 11

> ## NO RESULT. NOTHING HERE MAY BE CITED AS EVIDENCE.
>
> This directory contains a **pre-registered design only**, written before any screen is
> collected, any annotation is made, or any split is sealed. There is no dataset, no
> measurement, no figure and no detector claim in it.
>
> **Nothing was collected, labelled, trained, sealed, evaluated or changed to produce it.**
> The model artifact `ba6d9e93…`, the operating point **0.55**, the shipped constant
> `PROVISIONAL_THRESHOLDS.score = 0.25`, the frozen evaluator and its **CLIPPED** definition,
> the consumed held-out split and everything under `artifacts/datasets/` and
> `artifacts/gates/` are **untouched**.

## Why this exists

Adoption item 11 — *acceptable detector metrics* — is the gating item for the T1
`UIElementDetector`, and it is **FAIL**. It is a **data** problem before it is a model
problem: every detector figure in this repository is synthetic and stamped
`provenance.kind === "SYNTHETIC"`, and the benchmark contract names a real evidence source
that does not exist.

This design fixes **what would have to be true** for a replacement figure to be legitimate,
so that the rules are on the record *before* the data exists rather than chosen once a number
is in hand.

## Hypothesis

**H1.** A legitimate item-11 replacement figure is obtainable **without retraining and without
modifying the evaluator** — the blockers are data, privacy/licensing approval and one missing
governance decision, not model capability.

**H0.** The current artifact cannot produce a usable real-world figure at any rule-selected
operating point, in which case the cause must be attributed — scale, threshold,
post-processing, capacity or data — **before** a detector revision is defined.

Neither has been tested. This document cannot test them; it only fixes how they would be.

## Environment required

| | |
|---|---|
| Design authored on | **workstation 2**, read-only. No capture, no inference, no ORT, no browser automation |
| Collection would need | Chromium and Firefox on a recorded OS/version, DPR 1 and 1.5, at least one non-100% zoom, `captureVisibleTab({format:"png"})` only (ADR-0002) |
| Evaluation would need | the existing frozen `@pratibimb/evaluation` evaluator and the unchanged artifact `ba6d9e93…`; the deterministic path used by B2/C3 is sufficient |
| **Approvals** | **privacy and licensing approvals are a hard prerequisite** — see [design.md](design.md) §11. None exists |

## The design

[design.md](design.md) — the pre-registration: dataset definition, annotation protocol, split
and leakage discipline, threshold discipline, the metric set, CLIPPED handling, the privacy and
redaction pipeline, licensing and provenance, the PASS / FAIL / INCONCLUSIVE structure, and the
approval sequence.

## Three findings that shape it

1. **The evaluator needs no change.** `SampleProvenance` already admits
   `REAL_LABELLED { source, annotator }` and `SCREENSPOT_V2 { subset, originalId }`, and
   `Sample.framePath` is optional. Item 11 is therefore **data plus governance**, with
   **zero** evaluator modification — which matters, because the evaluator is frozen.
2. **No numeric acceptance criterion for item 11 exists anywhere in this repository.** The
   bar says *"acceptable detector metrics"*; the benchmark contract gives a target only for
   PII recall (≥ 0.98) and none for visual context. Collecting data before deciding what
   *acceptable* means would produce a figure and then an argument about it. **That decision
   is an owner decision and it must precede sealing.**
3. **The existing leakage check cannot protect real data.** `assertNoLeakage` fingerprints
   geometry plus annotations, which is sufficient for synthetic renders but **will not flag
   the same real page captured twice** at a different scroll offset or viewport. Real data
   needs **page- and origin-level** split discipline, added as a dataset-construction guard
   rather than an evaluator change.

## Expected result

Recorded here so it can be contradicted by the measurement rather than adjusted to it.

**If W-A runs as designed**, the expected outcome is a **rule-selected operating point on real
dev data and a single real test figure**, with grounding accuracy **materially above 0.055 and
materially below the synthetic dev 0.5678** — the first because 0.055 is a known artefact of a
superseded selection rule, the second because real UI is harder than a 200-sample generator
built by this project. **That expectation is not a prediction of PASS**, because no numeric bar
exists yet (§11-D2).

Two specific things are expected to be *worse* than synthetic and must not be treated as
surprises: the **CLIPPED ceiling** (long government forms clip more than generated cards), and
performance on captures **wider than the 960–1280 band** the model was trained on, which is
C4's subject and not W-A's.

## Actual result

**NOT RUN.** No screen has been captured, no annotation made, no split sealed, no evaluation
performed. There is no figure in this directory and none may be quoted from it.

## Conclusion

**None, and none is possible from this document.** It is a protocol, not a measurement. Its
only claim is about itself: that the rules above were fixed before the data existed.

Item 11 remains **FAIL**. The detector remains **UNADOPTED**. What the design does establish,
on repository evidence, is that closing item 11 requires **real data plus ten recorded owner
decisions** — and **no evaluator change, no threshold change and no retrain**.

## Reproducibility

Nothing to reproduce: no harness, no data, no logs. The design is reproducible in the only
sense that matters for a pre-registration — it is committed, dated, and hash-stable, so a later
run can be checked against what was promised rather than against what was convenient.

The sources it was derived from, all read at the current `main`:

```
docs/testing/benchmark-contract.md          Rule 0, Rule 1, Rule 2
docs/testing/threshold-selection.md         the frozen rule, the consumed split, the 94.4% ceiling
docs/security/security-invariants.md        INV-04/05/21, redaction union, verifier sequence
docs/architecture/constitution.md           the three ranked detector options, the tiers
docs/architecture/preprocessing-contract.md the capture policy and §6
docs/adr/ADR-0002-t1-capture-format-policy.md  PNG-only capture
docs/dossier/PratiBimb-Engineering-Dossier-v4.0.txt  the evidence source, option C as the floor
packages/evaluation/src/{dataset,labels,evaluator}.ts  provenance, leakage, the metrics
agentos/registry/{model-registry,feasibility-matrix}.md
agentos/workflows/model-adoption.md         the blocking rules
artifacts/gates/{T1-detector-training,T1-detector-fusion,QG-05-t1-evaluation}/
artifacts/reviews/AUDIT-0002-detector-adoption.md
```

## Status

| | |
|---|---|
| Design | **PRE-REGISTERED, not approved** |
| Data | **none collected.** No real screen has been captured by this project |
| Approvals | **not sought, not granted** — see `design.md` §11 |
| Item 11 | **FAIL**, unchanged |
| Detector | **UNADOPTED**, artifact unchanged, threshold 0.55 unchanged |
