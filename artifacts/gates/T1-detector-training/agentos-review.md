---
id: T1-detector-training-agentos-review
workstream: T1 UIElementDetector option B — training and evaluation
date: 2026-09-10
branch: feature/t1-detector-head-training
---

# T1 detector training — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `ml-engineer` — L2, blocking on model adoption (QG-03)

**Status: `CONDITIONAL_PASS` on the pipeline. The detector is NOT adopted and the registry
is unchanged.**

### Target formulation

**PASS, after two measured corrections.** The initial formulation was internally
inconsistent: assignment marked every cell inside a box positive while the decode confined
a cell's predicted centre to its own cell. 76% of objects span more than one cell, so most
positives were structurally unfittable. Distance-to-edges fixed it.

Every ground truth gets at least one positive cell. The textbook inside-centre rule drops
~10 px objects entirely because such a box often contains no cell centre — and the failure
is silent: loss falls, training looks healthy, and small classes are simply absent.

Assignment is smallest-object-first, so a checkbox inside a card keeps the contested cell.

### Loss

**PASS.** Focal over all cells because the balance is ~6400 anchors to ~19 objects; plain
BCE converges to "predict nothing", which looks like a broken pipeline while being a
correct optimum of the wrong objective. Box loss is IoU rather than L1 because L1 weights a
5 px error on a 200 px button the same as on a 10 px checkbox, and IoU is what QG-05 scores.

### Class and box semantics

**PASS.** Class order is load-bearing — the index *is* the output channel offset — and is
asserted equal to the TypeScript `UI_CLASSES` by test, along with input size and pad value.

### Overfit test

**PASS, and it is the most valuable artefact here.** It failed twice and both failures were
real defects rather than budget problems. Criteria were fixed in advance and never
adjusted; when 5 of 6 passed, the sixth was reached by extending the budget, not by
lowering the bar.

### Evaluation methodology

**CONDITIONAL.** The split discipline held: dev swept, test scored once, never swept.

**But the pre-registered selection rule was wrong**, and this review records that rather
than quietly replacing it. *"Max mAP@0.5 on dev"* selects the lowest threshold, because mAP
is nearly flat across thresholds while grounding accuracy varies by an order of magnitude.
The resulting operating point emits about 317 predictions per image against about 19 real
elements.

**No threshold was re-picked after test was seen.** That is the entire point of
pre-registration, and re-selecting afterwards would have been threshold-fishing whatever
the justification.

**RAISED — the corrected rule must be pre-registered before test is looked at again.**
Something like *maximise F1*, or *maximise grounding subject to recall ≥ 0.90*, chosen on
dev.

### Leakage prevention

**PASS.** Splits are seeded with large per-split offsets so they cannot draw the same
sample; the evaluator additionally detects leakage by content fingerprint, since renaming a
copied sample is the form leakage actually takes.

**RAISED — synthetic performance is not real-world performance.** Every sample is stamped
`SYNTHETIC`. The dossier's evidence source is ScreenSpot-v2 plus 300 self-labelled screens,
and neither exists.

**QG-03 is NOT satisfied: no browser/backend matrix has been run.** Adoption items 9, 11,
12 and 13 are outstanding.

---

## `browser-engineer` — L2

**Status: `CONDITIONAL_PASS`.**

| Obligation | Finding |
|---|---|
| Tensor layout | **PASS.** `[1, 3, 640, 640]` NCHW; output `[1, 12, 6400]` verified against the frozen contract. |
| Contract unchanged | **PASS.** Stride 16 to 8 moved the anchor count 1600 to 6400 and required **no** TypeScript change, because `A` is read from the tensor dims. |
| Letterbox handling | **PASS.** Training pads with 114/255 exactly as `HEAD_CONTRACT` declares, asserted by test. Un-pad happens before un-scale in both directions. |
| ORT compatibility | **PARTIAL.** Verified with Python `onnxruntime` 1.20.1 on CPU: shape correct, max absolute difference 5.6e-03, class channels 1.7e-05 relative. |
| **Runtime loading in a browser** | **NOT DONE.** ORT **Web** wasm/webgpu has not been exercised at all. |
| Latency and memory | **NOT MEASURED.** |

**RAISED — the export false alarm is worth remembering.** `torch.onnx.export` restores the
module's original training mode on exit, and the wrapper it was handed defaulted to
`training=True`; the reference then ran with BatchNorm on batch statistics and reported a
40.4 divergence. The artifact was correct. A verification that is wrong in the alarming
direction costs more than one that is merely absent, because the obvious response is to
distrust a good artifact.

**RAISED — predictions must come from the artifact.** The first run measured the torch
model while shipping ONNX. Fixed; the evaluator now scores what would actually load.

---

## `privacy-security-engineer` — L1, standing veto

**Status: `PASS` for this change. Veto not waived; none sought.**

| Check | Finding |
|---|---|
| No new egress in the shipped path | **PASS.** Nothing was added to `packages/perception`; the G5 source scan is unchanged and still passes. |
| Training kept out of the runtime | **PASS, and now enforced.** `tools/` may read from `packages/`; `packages/` may never read from `tools/`. Asserted by test, together with a check that no package `src/` imports `node:fs`, `node:path` or `node:child_process`. |
| No runtime model download | **PASS.** The artifact is produced locally and is never fetched. |
| Model weights not committed | **PASS**, and the guard that enforces it was repaired — see below. |
| T2 untouched | **PASS.** No D3/D4, no GLiNER, no redaction, no vault, no handoff construction. |

**RAISED — the boundary failure this prevents is gradual.** Someone needs a preprocessing
constant that already exists in the trainer, so they import it; now the shipped package
depends on a module that reads files; then that module needs a URL — and the G5 scan never
fires because the offending code is not in `packages/`. The pad value and class list are
duplicated across the language boundary **deliberately**, guarded by a contract test rather
than removed by a shared import, because the import is the thing that would breach the
boundary.

**RAISED — a governance guard was found broken and repaired.** `verify-repo` reported
"banned file type committed" for a locally-trained `.onnx` in an **ignored** directory — a
file that was not committed and could not be. The first fix was **wrong and the negative
control caught it**: routing everything through `--exclude-standard` silenced the false
positive but made the banned-suffix check permanently dead, since `.gitignore` carries a
global `*.onnx`. Now split into tracked-only (banned artefacts) and tracked-plus-unignored
(secret patterns), with three verified controls. Strictly stronger than before, not merely
quieter.

**QG-04 remains UNSIGNED. B-02 remains OPEN.**

---

## `performance-engineer` — L2

**Status: `PASS` on what was measured; most of the interesting figures are absent and said
to be.**

| Figure | Value |
|---|---|
| Parameters | 61,468 |
| Artifact | 302,960 bytes (0.30 MB) |
| Training | 2085 s CPU, 4000 steps, batch 4 |
| **Inference latency** | **NOT MEASURED** |
| **Peak heap / GPU** | **NOT MEASURED** |

**RAISED — 0.30 MB against option A's ~12 MB.** That is a genuine advantage for a
lightweight on-device tier, but it is a size claim, not a performance claim, and no latency
number exists to pair with it.

**RAISED — stride 8 quadrupled the anchor count while the trunk got smaller.** Compute is
concentrated in the 80x80 feature map rather than in parameters. Whether that trade is
right for the browser is a question only the ORT Web matrix can answer, and it has not run.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

**Observation — the gate did its job by failing.** Two real bugs, neither of which would
have been visible in a loss curve, and one of which (stride 16) had been *predicted* by the
earlier QG-05 baseline work and was then measured here.

**Observation — the size story inverted.** After the stride-8 fix, recall by size is tiny
0.903, small 0.979, medium 0.964, **large 0.905**. Large objects are now marginally the
worst, which contradicts the assumption the head was originally designed around. Worth
carrying forward rather than filing as noise.

**RAISED — `button` is the dominant failure mode**: worst AP (0.4993), worst recall
(0.8168), and a third of all false positives, on the most common class. Next iteration
should target precision, not capacity — recall is 0.92 and precision is the bottleneck by
two orders of magnitude, which is a postprocessing and threshold problem before it is a
model-size problem.

**RAISED — the regression benchmark pins the pipeline, not just the score.** Model
revision, artifact hash, dataset hash, preprocessing, postprocessing, threshold and its
rule. A metric compared across a changed pipeline is not a comparison.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

Terminology audited: no D3/D4 anywhere in the new code or documentation. T1 is used
throughout for the UI detector and its fusion.

**No ADR required.** The tensor contract was not changed — stride and anchor count are
implementation detail beneath a contract that reads `A` dynamically. Option B is the
dossier's own week-3 plan.

**The honest outcome is that the pipeline is proven and the detector is not adopted.**
Training converging is not a reason to change the registry, and the adoption bar has four
outstanding items. `MODEL_ASSET_UNAVAILABLE` and the DOM-only floor remain correct.
