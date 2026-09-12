---
id: W1-detector-precision-scale-decision
workstream: W-1 — detector precision recovery (arm A) and scale attribution (arm B)
verdict: ARM A — PARTLY RECOVERABLE IN POST-PROCESSING · ARM B — SCALE IMPLICATED · H-S1 NOT SUPPORTED
date: 2026-09-12
decided_by: pratibimb-architect (L1 — recommends; the human decides)
---

# W-1 — decision record

## Verdict

**Measured 2026-09-12 on workstation 2. SYNTHETIC evidence.**

| | |
|---|---|
| **Arm A** | **PRECISION IS PARTLY RECOVERABLE IN POST-PROCESSING.** V1 (per-class NMS at IoU 0.30) moves grounding **0.5716 → 0.7311 (+0.1595)** for a recall cost of **0.0121**, removing **148 of 160** duplicate false positives. mAP@0.5 also rises, **+0.0176** |
| **Arm B** | **SCALE IS IMPLICATED.** With the ground truth **byte-identical across all eight cells** (307 objects, all `VISIBLE`, ceiling 1.0), recall peaks at **1.75** CSS px per model px and falls monotonically to **0.0163** at 4.00. The emptiness control is **exonerated** |
| **H-S1 (stride-8)** | **NOT SUPPORTED as the mechanism.** Not disproven as a contributing factor, and **not isolated** |
| **Adoption item 11** | **FAIL — unchanged.** Synthetic evidence cannot close it |
| **QG-03a-C4** | informed, **still OPEN**. **No capture limit is stated or implied** |
| **Retraining** | **NOT JUSTIFIED by this experiment.** Not performed; no weights were written |
| **Detector** | **UNADOPTED.** Artifact `ba6d9e93…`, operating point 0.55 and shipped `PROVISIONAL_THRESHOLDS.score = 0.25` all unchanged. **No variant adopted** |

## What is proven

1. **The dev split used is the pinned dev split, by the project's own identity rule.** The
   regenerated manifest hash is **`4bbc57de`**, with 40 dev samples and 744 evaluatable
   annotations. This also demonstrates the dataset recipe is genuinely reproducible, which until
   now was a claim in a gate README rather than a re-executed fact.
2. **The baseline is the shipped behaviour, not an approximation.** The harness replica
   reproduced `decodeHeadOutput` **exactly on 40/40 samples**, and refuses otherwise.
3. **Duplicate false positives dominate the precision loss at 0.55, and they are removable in
   post-processing.** 160 of 455 false positives are duplicates; one pre-registered NMS change
   removes 148 of them and 235 false positives in total.
4. **Scale degrades the detector, with the ground truth held identical.** This is the thing C3
   could not establish, because C3 varied capture size and therefore varied content, scale and
   the label/raster offset together.
5. **Frame emptiness is not the cause.** Tiling the content to fill the frame reproduces the
   collapse to within 0.0375 recall, against a collapse of 0.65.
6. **Localisation degrades with scale too, not only detection.** Matched-IoU median 0.80 → 0.55,
   with the 10th percentile compressing onto the matcher's 0.5 gate.

## What is NOT proven

1. **Nothing about real-world performance.** Every number here is synthetic, and the generator
   was written by this project. Item 11 is untouched.
2. **No mechanism for the scale collapse.** Scale is implicated; *why* is not isolated. Recall
   inside the fixed 8–16 model px band — at least one whole stride-8 cell — varies by **0.839**
   across cells, so extent in model px does not by itself determine the outcome. The leading
   untested alternative is appearance loss under downsampling.
3. **No boundary.** The cells are eight chosen points, not a search for where behaviour changes,
   and the corpus is synthetic. **Any "supported up to X" statement would be invented.**
4. **No claim that V1 is the right production decode.** It was measured on 40 synthetic screens
   at one operating point. Adopting it changes the shipped decode, which is a product change with
   its own gate, and it must be measured on real data before it is believed.
5. **Nothing about other backends, browsers, realms or machines.** One deterministic path.

## Recommended owner decisions

1. **Read arm A's deltas and decide whether a decode change is worth a product workstream.** The
   numbers are +0.1595 grounding for −0.0121 recall on synthetic dev. **W-1 deliberately sets no
   threshold for "substantial".** If it is worth it, the next step is a pre-registered decode ADR
   — not an edit to `PROVISIONAL_THRESHOLDS`.
2. **Accept that the scale question is now a capability question, not a geometry question.** C4
   can stop looking for a coordinate or convention cause; QG-03a-C already resolved that, and
   W-1 adds that emptiness and stride-extent are not the explanation either.
3. **Do not retrain on this evidence.** The mechanism is unisolated, so the change to make is
   unknown, and a retrain would invalidate the frozen regression baseline by construction.
4. **Keep W-A on the critical path.** W-1 makes the detector's failure modes legible; it does not
   move item 11 by a single point.

## What is NOT done

- No retraining, no weight write, no new training split, no architecture change.
- No evaluator, CLIPPED, threshold or `PROVISIONAL_THRESHOLDS` change; no shipped-code change.
- **The consumed held-out test split was never opened.** Arm A refuses any sample whose split is
  not `dev`; arm B creates no test split as evidence, only never-rendered placeholders that exist
  solely to satisfy the frozen validator's non-empty-split rule.
- `artifacts/datasets/`, `artifacts/gates/` and `artifacts/models/` were never written; the
  regenerated dataset lives in the harness's own gitignored `generated/`.
- No adoption item status moved, no registry change, no capture policy.

## Follow-ups

| id | item |
|---|---|
| **W-1-A decision** | owner reads arm A's deltas; a decode change, if wanted, needs its own pre-registered ADR and real-data confirmation |
| **QG-03a-C4** | still **OPEN**. W-1 narrowed it: not geometry, not emptiness, not stride-extent alone. The open question is appearance loss under downsampling |
| **W-A** | unchanged and still the only route to item 11 — real data, unread split, and the ten owner decisions D1–D10 |
| **tiled/crop inference** | a candidate that W-1 makes plausible but does **not** test: returning objects to the trained scale band by cropping. Product code, N× latency, its own gate |
