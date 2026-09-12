# QG-03a-C3 — does the learned label/raster mapping generalise off the training grid?

> **PRE-REGISTERED, NOT YET MEASURED.** This README was written before any sample was generated or
> scored. The hypothesis, the cells, the seeds, the inference path, the metrics, the operating
> points, the CLIPPED handling and the comparator rule are fixed in
> [design.md](design.md). **Nothing here may be cited as a result** until the "Actual result"
> section below is filled in by a completed run.
>
> C3 is **measurement only**: no retraining, no relabelling, no threshold change, no evaluator
> change, and the detector artifact is untouched. Retraining is **not** approved.
>
> Machine: **workstation 2**, deterministic **WASM in Node**. This is a geometry experiment, so no
> WebGPU, no NVIDIA and no workstation-1 dependency. That is a deliberate scope choice, not a
> coverage claim.

## Why C3 exists

QG-03a-C is `CONDITIONAL`. The pipeline labels by the **continuous** letterbox (`targets.py`) and
rasterises by the **integer** one (`data.py`), so 84 of 200 training samples carry a label/raster
offset of up to 0.667 model px, and the model learned a **geometry-dependent nuisance mapping**
rather than an identity (preprocessing-contract §6).

C's own criterion was met — worst-case mAP@0.5, recall and grounding all 1.000 on train and dev,
minimum IoU 0.869 — but C stayed CONDITIONAL on an unknown it could not resolve: **the model was
absent**, so nobody could tell what happens at capture sizes outside the training grid, where the
offset reaches **1.3333 CSS px** arithmetically.

The artifact now exists and has been run (B2, B3-1). C3 resolves that single unknown, and claims
nothing else.

## Hypothesis

**H1.** The learned nuisance mapping is not grid-specific: at capture sizes the model never saw,
the shipped path still lands boxes on their elements, leaving mAP@0.5, element recall and grounding
no worse than at training sizes, with minimum matched IoU well above 0.5.

**H0 (what would refute it).** At non-training sizes the model's boxes drift by roughly the
label/raster offset for that geometry — visible as degraded grounding or recall, or a minimum IoU
approaching 0.5, against paired training-size controls.

## Acceptance criterion — the approved one, unchanged

> *"The mismatch is harmless if the worst case leaves mAP@0.5, element recall and grounding
> unchanged, and IoU stays well above 0.5 for the smallest controls."*

Decided **relative to the paired controls**, by the comparator rule in design.md. **No new numeric
tolerance is invented**; anything the criterion cannot decide is escalated as
**INCONCLUSIVE / DECISION REQUIRED**.

## Environment

| | |
|---|---|
| Machine | **workstation 2** — `LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350, Windows 11 build 26200 |
| Inference | **ORT Web 1.29.0, WASM execution provider, in Node**, `numThreads = 1`, `graphOptimizationLevel "all"` |
| Model | `artifacts/models/t1-ui-head/t1-ui-head.onnx`, 302,960 B, sha256 `ba6d9e93…5179d0` — **unchanged, never committed, never regenerated** |
| Renderer | headless Chromium via Playwright, one context per sample, `deviceScaleFactor` = the cell's DPR |
| Generator | the committed `makeSpec` / `specToHtml` from `@pratibimb/evaluation`, viewport overridden per cell |
| Labels | read from the rendered DOM (`window.__measure()`), exactly as `tools/dataset/build-dataset.mjs` does |
| Evaluator | the **frozen** `@pratibimb/evaluation` evaluator, unmodified, CLIPPED definition untouched |
| Dataset | `t1-ui-c3-<cell>@1.0.0`, one sealed dataset per cell, **separate from** `t1-ui-rendered@1.0.0` (`4bbc57de`) |

## Expected result

If H1 holds: every C3-A cell matches its paired C3-B controls on all three metrics, minimum IoU
stays far above 0.5, and worst CSS displacement stays small relative to element size — which would
make the §6 mismatch harmless in production geometry as well as on the training grid.

If H0 holds: degradation concentrated in the cells whose label/raster offset differs most from the
training grid, most visibly at **C3-A2** (DPR 1.5, the worst recorded geometry).

## Actual result

**MEASURED 2026-09-12 on workstation 2. C3 = INCONCLUSIVE / DECISION REQUIRED.** 120 samples, six
cells, the exact artifact `ba6d9e93…` through the shipped path, ORT Web 1.29.0 WASM in Node, scored
by the frozen evaluator. Every cell ran; no sample was dropped.

### Per cell, at the 0.55 operating point

| cell | capture | letterbox scale | CSS px per model px | mAP@0.5 | recall | grounding | matched | ceiling |
|---|---|---|---|---|---|---|---|---|
| **b1** (training) | 960x640 | 0.667 | 1.50 | 0.5993 | 0.7633 | 0.4933 | 258/338 | 0.926 |
| **b2** (training) | 1024x640 | 0.625 | 1.60 | 0.6610 | 0.7853 | 0.5645 | 267/340 | 0.929 |
| **a1** | 1264x800 | 0.506 | 1.98 | **0.6647** | 0.7714 | **0.6396** | 307/398 | 0.960 |
| **a3** | 1920x1080 | 0.333 | 3.00 | 0.0617 | 0.1935 | 0.2593 | 77/398 | 0.962 |
| **a2** | 2880x1443 (DPR 1.5) | 0.222 | 3.00 | 0.0608 | 0.1533 | 0.2490 | 61/398 | 0.962 |
| **a4** | 2560x1600 | 0.250 | 4.00 | 0.0040 | 0.0101 | 0.0310 | 4/398 | 0.962 |

### What this shows

1. **At training-like scale the mapping holds.** `a1` (1264x800, off the grid) is **not worse** than
   the controls: higher mAP@0.5 (+0.065) and higher grounding (+0.146), with recall 0.021 lower
   ceiling-relative. So being off the training grid is, by itself, harmless.
2. **At larger captures the detector collapses** — mAP 0.66 to 0.004, recall 0.77 to 0.01.
3. **But that collapse is not attributable to the label/raster mismatch.** It tracks **CSS pixels
   per model pixel** monotonically (1.50, 1.60, 1.98 fine; 3.00, 3.00, 4.00 collapsed), and the
   decisive pair is **a2 versus a3**: different capture sizes, different DPR, different label/raster
   offsets, but the *same* 3.00 CSS px per model px — and near-identical scores (mAP 0.0608 vs
   0.0617). A 14 CSS px control is ~9 model px at 1.50 and ~3.5 model px at 4.00, below the stride-8
   feature cell. The label/raster offset in question is **at most 1.33 CSS px** and cannot move
   mAP@0.5 by 0.66.
4. **Capture size changes two things at once** — the label/raster offset *and* the object scale in
   model space — so this design, as pre-registered, **cannot separate them**. That is the honest
   reason for INCONCLUSIVE, and it is a design limitation, not a borderline number.

### Two harness metrics turned out uninformative, and are reported as such

`minMatchedIou` and `worstMatchedDispCss` are computed over pairs the matcher already gated at
IoU >= 0.5, so the minimum is pinned just above 0.5 by construction (0.5008 to 0.5823 across all
cells, controls included) and the worst displacement is dominated by large elements matching
loosely (116 to 197 CSS px, **including 134-144 px on the training-size controls**). Neither can be
compared with C2's 0.681 model px / 0.869 IoU, which measured label-versus-pixel geometry rather
than prediction-versus-label error. The approved criterion's phrase *"IoU stays well above 0.5 for
the smallest controls"* therefore **cannot be evaluated by these statistics**, and no substitute was
invented.

### Frozen CLIPPED handling

Untouched. Reported per cell: the arithmetic ceiling is **0.926-0.930** on the controls and
**0.960-0.962** on the A cells (larger viewports clip less), so recall was compared
**ceiling-relative** throughout. The 94.4% figure from `threshold-selection.md` belongs to the QG-05
dev split and was not transplanted.

## Conclusion

**C3 = INCONCLUSIVE / DECISION REQUIRED. QG-03a-C stays `CONDITIONAL`.**

Two findings, and they point in different directions, which is why no single verdict fits:

- **Positive, and genuinely new:** at a capture size off the training grid but at a training-like
  scale (`a1`, 1264x800 — the real production capture size of the QG-03b-2a fixtures), the exact
  artifact performs **no worse than on the grid**. The learned nuisance mapping is not grid-specific
  at comparable scale. That retires the narrower worry C left open.
- **Negative, and not what C3 was asking:** at 3-4 CSS px per model px the detector collapses. The
  evidence attributes that to **object scale in model space**, not to the label/raster convention —
  most clearly in the a2/a3 pair, where the same CSS-px-per-model-px gives the same scores despite
  different capture sizes, DPRs and label/raster offsets.

**Retraining is NOT justified by this result**, and none was performed. A sub-1.33 CSS px label
offset cannot explain a 0.66 drop in mAP@0.5; the §6 relabel would not fix the scale behaviour, and
nothing here shows the convention causing a production-visible failure.

**What C3 could not do** is isolate the convention, because capture size moves the offset and the
object scale together. The minimum experiment that *would* isolate it needs owner approval and is
recorded in [decision.md](decision.md): hold CSS-px-per-model-px at a training-like value while
varying the offset, and/or re-invert the **already-dumped** raw outputs with the raster transform
instead of the continuous one and see which agrees better with the DOM labels. The second costs no
new inference at all.

A C3 PASS would not have closed QG-03a-C by itself either: closure is a governance decision that
must also accept the remaining unknown — the effect on training dynamics, measurable only by a
retrain.

## Reproducibility

```bash
# prerequisites: npm ci && npm run typecheck; the model in place (hash-checked, never committed);
# an unbranded Chromium (CHROME_PATH overrides)
E=artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness

node   $E/render-c3.mjs            # render the 6 cells x 20 samples, seal + validate per cell
python $E/decode-c3-png.py         # PIL decode to RGBA, digests recorded
node   $E/run-c3.mjs               # shipped path + ORT WASM in Node + the frozen evaluator
node   $E/analyze-c3.mjs           # paired A-vs-B comparison, ceilings, verdict
```

Every stage refuses rather than guesses: model identity, tensor shapes, finiteness, dataset
separation, sample-metadata completeness, spec reproducibility, and the pre-registered constants
are all checked, and any failure exits non-zero. Rendered PNGs, RGBA dumps and raw `.f32` outputs
are gitignored; the logs, `metrics.json` and these records are committed.

## Files

| path | purpose |
|---|---|
| `design.md` | the pre-registration: cells, seeds, path, metrics, comparator rule |
| `decision.md` | the verdict record (pending until the run completes) |
| `harness/c3-guards.mjs` | the pre-registered constants and every fail-closed guard |
| `harness/render-c3.mjs` | deterministic render + DOM-derived labels + per-cell sealed datasets |
| `harness/decode-c3-png.py` | PNG to RGBA via PIL, with digests |
| `harness/run-c3.mjs` | the shipped inference path and the frozen evaluator, per cell |
| `harness/analyze-c3.mjs` | paired comparison, clipping ceilings, verdict |
| `logs/` | per-cell logs and `metrics.json` |
