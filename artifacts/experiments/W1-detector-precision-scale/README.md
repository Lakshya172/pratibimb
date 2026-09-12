# W-1 — detector precision recovery and scale attribution

> **PRE-REGISTERED, results below.** [design.md](design.md) was committed **before the first
> inference ran**; every variant, scale level, seed, metric and stop rule comes from it.
>
> **SYNTHETIC evidence.** W-1 **cannot** close adoption item 11, **cannot** establish a
> production capture limit, and **cannot** justify retraining by itself. The detector artifact,
> the operating point 0.55, the shipped `PROVISIONAL_THRESHOLDS` (score 0.25), the frozen
> evaluator, the consumed held-out test split, `artifacts/datasets/` and `artifacts/gates/` are
> all **unchanged**. No variant is adopted.
>
> Machine: **workstation 2**, Node only. No WebGPU, no NVIDIA, no workstation 1.

## Hypothesis

**Arm A.** H-A1 — a material part of the false-positive population at 0.55 is **duplicate**,
and therefore removable in post-processing without a proportionate recall loss. H-A0 — the
variants move grounding negligibly, making precision a model property.

**Arm B.** H-B1 — metrics degrade as **CSS px per model px** rises, with the annotation set
held identical. H-B0 — metrics stay stable, contradicting the scale explanation.

**H-S1 (stride-8)** — small model-space objects are hard for a stride-8 head. Carried as a
hypothesis the design had to be able to **contradict**, not as a finding.

## Environment

| | |
|---|---|
| Machine | **workstation 2** (`LAPTOP-SRCINK2B`), Node v26.4.0 |
| Model | `ba6d9e93…`, 302,960 B, hash-verified at load, **never modified** |
| Runtime | ORT Web **1.29.0**, WASM EP in Node, `numThreads = 1`, `proxy = false` — the deterministic path B2 and C3 used |
| Render | Chrome for Testing 153.0.8010.12 via Playwright, DPR 1 |
| Decode | Pillow 12.3.0 → RGBA, dev samples only |
| Evaluator | the **frozen** `@pratibimb/evaluation`, CLIPPED definition untouched |
| Operating point | **0.55**, fixed. No sweep on any split |

**Arm A's dataset is the pinned dev split, and that is proved rather than asserted.** The
original `artifacts/datasets/` is gitignored and absent from this machine, so W-1 regenerates
`t1-ui-rendered@1.0.0` with the **unchanged** `tools/dataset/build-dataset.mjs` and requires the
manifest hash to equal **`4bbc57de`**. It does — with **40 dev samples and 744 evaluatable
annotations**, both matching the published figures. Frames are re-rendered, so absolute numbers
are close rather than identical to the published ones; the variant comparison shares one set of
frames, so that cancels.

## Expected result

From design.md, before the run: arm A was expected to show duplicates as a removable family;
arm B was expected to show ordered degradation; **H-S1 was expected to be testable and possibly
wrong**. The design stated explicitly that a flat scale series would contradict H-B1, and that
H-S1 must not be called confirmed unless the measurements support it.

## Actual result

**MEASURED 2026-09-12 on workstation 2.** Arm A: 40 dev samples, one inference pass each,
decoded four ways. Arm B: 10 cells × 20 seeds = **200 samples**, every one reported.

### Arm A — the precision problem is largely a post-processing problem

V0 reproduces the published dev baseline: mAP **0.6947** (published 0.6949), recall **0.8159**
(0.81586), grounding **0.5716** (0.5678), **26.55** predictions/screen (26.725), clipping ceiling
**0.943548** (0.9435). The V0 replica reproduced the shipped `decodeHeadOutput` **exactly on
40/40 samples**, so the baseline is the shipped behaviour and not an approximation of it.

| variant | mAP@0.5 | recall | grounding | preds/screen | FP | dup | cc | loc | spur |
|---|---|---|---|---|---|---|---|---|---|
| **V0** shipped, per-class NMS 0.50 | 0.6947 | 0.8159 | 0.5716 | 26.55 | 455 | **160** | 58 | 138 | 99 |
| **V1** per-class NMS 0.30 | **0.7123** | 0.8038 | **0.7311** | 20.45 | **220** | **12** | 51 | 86 | 71 |
| **V2** cross-class NMS 0.50 | 0.6891 | 0.8078 | 0.5829 | 25.77 | 430 | 158 | **36** | 138 | 98 |
| **V3** containment IoS > 0.80 | 0.6961 | 0.8159 | 0.5803 | 26.15 | 439 | 150 | 58 | 135 | 96 |

Against V0: **V1 grounding +0.1595** at a recall cost of **0.0121**, removing **148 of 160
duplicates** and 235 of 455 false positives; V2 **+0.0114** (its effect is on class confusion,
58 → 36); V3 **+0.0087** at **zero** recall cost. **No definition of "substantial" is set here** —
the absolute deltas are the deliverable.

### Arm B — scale is implicated, with the ground truth held identical

**307 drawn objects per seed set, byte-identical across all eight scale cells, every one
`VISIBLE`, clipping ceiling 1.0.** The harness refuses if that ever stops holding.

| cell | CSS px/model px | mAP@0.5 | recall | grounding | preds/screen | matched IoU median | matched IoU p10 | norm. disp. median |
|---|---|---|---|---|---|---|---|---|
| s150 | 1.50 | 0.6404 | 0.8534 | 0.4843 | 27.05 | 0.8004 | 0.6002 | 0.1228 |
| **s175** | **1.75** | **0.7876** | **0.8925** | 0.6213 | 22.05 | 0.7705 | 0.5978 | 0.1150 |
| s200 | 2.00 | 0.7234 | 0.8697 | **0.6372** | 20.95 | 0.7879 | 0.5946 | 0.1244 |
| s225 | 2.25 | 0.6462 | 0.8143 | 0.6083 | 20.55 | 0.7079 | 0.5622 | 0.1597 |
| s250 | 2.50 | 0.4685 | 0.6450 | 0.5425 | 18.25 | 0.6530 | 0.5339 | 0.1788 |
| s300 | 3.00 | 0.0781 | 0.2052 | 0.2739 | 11.50 | 0.6193 | 0.5269 | 0.1472 |
| s350 | 3.50 | 0.0064 | 0.0261 | 0.0544 | 7.35 | 0.6372 | 0.5281 | 0.1465 |
| s400 | 4.00 | 0.0035 | 0.0163 | 0.0459 | 5.45 | 0.5532 | 0.5000 | 0.0950 |

Recall **peaks at 1.75** and then falls **monotonically** to 4.00. Matched-IoU median falls
**0.80 → 0.55** and its 10th percentile compresses onto the matcher's 0.5 gate — localisation
quality degrades alongside detection, which C3's `minMatchedIou` could not show because the
matcher pins that statistic by construction.

**The emptiness control is exonerated.** Tiling the same content to fill the frame reproduces
the collapse: `t300` vs `s300` recall **−0.0375**, `t400` vs `s400` **−0.0049**, against a
collapse of **0.65** recall from s150 to s300. Predictions scale with content (44.4/screen at
t300 vs 11.5 at s300), as expected for 4× the controls.

### The stride-8 hypothesis is NOT supported as the mechanism

Two reads, and they agree.

**Paired** — follow the **same 262 objects** s150 found, across cells: recall 1.000, 0.943,
0.931, 0.878, 0.721, 0.229, 0.031, 0.019. No population confound: identical objects throughout.

**By model-space band** — recall inside the fixed **8–16 model px** band, which is *at least one
whole stride-8 cell*: 0.724, 0.853, 0.884, 0.849, 0.786, **0.293**, **0.046**, **0.071**. A
spread of **0.839 inside one band**. A pure extent account keys only on size in model px and
therefore predicts similar recall for similar extent; the data contradicts that. The caveat is
recorded: band membership is not the same object set from cell to cell, which is exactly why
the paired read is reported beside it.

So **scale is implicated and extent-relative-to-stride is not shown to be the mechanism.** The
untested alternative is appearance loss under downsampling — a control rendered at a third of
its size loses border, text and contrast detail, not merely extent. **W-1 does not isolate
that**, and does not claim to.

## Conclusion

| | |
|---|---|
| **Arm A** | **PRECISION IS PARTLY RECOVERABLE IN POST-PROCESSING.** A single pre-registered NMS change moves grounding **+0.1595** for **−0.0121** recall. Nothing is adopted |
| **Arm B** | **SCALE IS IMPLICATED.** Ordered degradation above 1.75 CSS px per model px, identical ground truth, emptiness exonerated |
| **H-S1** | **NOT SUPPORTED as the mechanism.** Not disproven as a contributing factor, and not isolated |
| **Adoption item 11** | **FAIL, unchanged.** Synthetic evidence cannot close it |
| **QG-03a-C4** | informed, **still OPEN**. No capture limit is stated or implied |
| **Retraining** | **not justified by this experiment**, and not performed |
| **Detector** | **UNADOPTED**; artifact, threshold 0.55 and shipped 0.25 unchanged |

The engineering consequence is narrow and worth stating plainly: at the scales the detector was
trained for, its precision problem is mostly a **decode** problem, which is cheap; beyond them,
its failure is a **capability** problem, which is not. Those are different workstreams, and
before W-1 they were one.

## Reproducibility

```bash
npm ci && npm run typecheck
# arm A — regenerate the pinned dev split (hash must be 4bbc57de) and score four decodes
node tools/dataset/build-dataset.mjs --out=artifacts/experiments/W1-detector-precision-scale/harness/generated/devset
python artifacts/experiments/W1-detector-precision-scale/harness/decode-w1-png.py
node artifacts/experiments/W1-detector-precision-scale/harness/run-arm-a.mjs
# arm B — render the scale-control set, decode, score
node artifacts/experiments/W1-detector-precision-scale/harness/render-arm-b.mjs
python artifacts/experiments/W1-detector-precision-scale/harness/decode-w1-png.py
node artifacts/experiments/W1-detector-precision-scale/harness/run-arm-b.mjs
node artifacts/experiments/W1-detector-precision-scale/harness/analyze-w1.mjs
```

The harness refuses rather than guessing: a regenerated dataset whose hash is not `4bbc57de`; a
wrong model hash or ORT version; a V0 replica that does not reproduce the shipped decode
exactly; **any sample whose split is not `dev`**; a malformed or non-finite tensor; a changed
`PROVISIONAL_THRESHOLDS`; a scale cell whose recomputed ratio is not the pre-registered one; a
scale cell whose ground truth differs from its peers; or any write under `artifacts/datasets/`,
`artifacts/gates/` or `artifacts/models/`.

`generated/` is gitignored — about **1.9 GB** of frames and RGBA dumps, all reproducible from
the recipe above.

## One design defect, found and fixed before the result was read

The first arm-B render judged visibility against the **outer viewport**, but the content sits in
an `overflow: hidden` iframe. Elements overflowing the block were reported at coordinates inside
the larger viewports and counted as ground truth that had **never been drawn** — which penalised
exactly the cells the arm was measuring, and made the ground-truth set grow with viewport size
(343 → 381 → 417 objects). It was caught by reading the paired test's object counts, not by a
failing assertion.

The fix: an element the iframe clips is **not a detection target at all**, so it is dropped
rather than mislabelled — the frozen validator's `CLIPPED`/`OFFSCREEN` semantics are judged
against the viewport, so labelling it either way would have lied to the validator. **110 of 417
elements are dropped, identically in every cell**, leaving **307** drawn objects everywhere, and
a cross-cell identity guard now refuses if the sets ever diverge. Arm B was re-rendered and
re-run from scratch afterwards; the figures above are from that run.

## Files

| path | purpose |
|---|---|
| `design.md` | the pre-registration: variants, cells, seeds, metrics, stop rules, interpretation |
| `decision.md` | the verdicts and what they do not license |
| `harness/w1-guards.mjs` | pre-registered constants, refusals, the decode replica, the taxonomy |
| `harness/run-arm-a.mjs` | dev inference once per sample, four decodes, frozen-evaluator scoring |
| `harness/render-arm-b.mjs` · `harness/decode-w1-png.py` · `harness/run-arm-b.mjs` | the scale-control set |
| `harness/analyze-w1.mjs` | applies design.md §10's interpretation rules; writes `logs/metrics.json` |
| `logs/arm-a.json` · `logs/arm-b.json` · `logs/metrics.json` | the records |
| `packages/perception/test/w1Guards.test.ts` | 26 tests over the guards and the replica |
