# QG-03a-C3b — continuous versus raster-consistent inverse, on the same raw outputs

> **PRE-REGISTERED, results below.** An **attribution** experiment, not an acceptance one. It cannot
> produce a C3 PASS, does not restate C3's criterion, and invents no threshold.
>
> **No inference was run.** C3b re-inverts the **raw outputs C3 already retained**; the harness never
> imports ONNX Runtime and creates no session. The model, the threshold, the evaluator, the frozen
> QG-05 dataset and the consumed held-out split are untouched.
>
> Machine: **workstation 2**, Node only. No WebGPU, no NVIDIA, no workstation 1.

## The question

C3 measured a collapse at large captures but could not attribute it: capture size moves the
label/raster offset **and** the object scale in model space together. C3b changes exactly one
operation — the **inverse letterbox** — on identical inputs, and asks whether the convention
explains the coordinate behaviour.

| | path A — continuous (production today) | path B — raster-consistent |
|---|---|---|
| scale | uniform `min(640/w, 640/h)` | per axis: `capW/resizedW`, `capH/resizedH` |
| pads | real `(640 − w·scale)/2` | integer `floor((640 − resized)/2)` |
| rationale | the space the model's **labels** were written in | where the **pixels** actually landed (contract §6) |

Method, classification rule and the full list of what is held byte-identical: [design.md](design.md).

## Hypothesis

**H1 (NOT ATTRIBUTED).** The two inversions differ by at most a couple of CSS px — the same
arithmetic that bounds the label/raster offset at ≤1.33 CSS px — which cannot move mAP@0.5 by the
~0.6 C3 observed. The gaps to the controls survive the switch.

**H0 (ATTRIBUTED).** Path B closes the off-grid gaps, which would mean production is inverting in
the wrong space at those geometries.

## Environment

| | |
|---|---|
| Machine | **workstation 2** (`LAPTOP-SRCINK2B`), Node v26.4.0, no browser, no ORT |
| Input | C3's retained raw outputs: **6 cells × 20 samples**, 36 MB, each digest-verified against `logs/c3-<cell>.json` before use |
| Model | `ba6d9e93…` — identity carried from the C3 logs; **no weights were loaded** |
| Geometry | the shipped `computeLetterbox`, `rasterLetterbox`, `modelToCapture`, `clipToContent` from `@pratibimb/perception` dist |
| Decode | the shipped `decodeHeadOutput` (0.25 floor, per-class greedy NMS at IoU 0.5, cap 300), run once per sample and shared by both paths |
| Evaluator | the **frozen** `@pratibimb/evaluation` evaluator, CLIPPED definition untouched |

## Expected result

Recorded in [design.md](design.md) **before** the run, so it could be contradicted: the two inverses
should differ by at most a couple of CSS px — the same arithmetic that bounds the label/raster offset
at ≤1.33 CSS px — which cannot move mAP@0.5 by the ~0.6 C3 observed. The pre-registered expectation
was therefore **NOT ATTRIBUTED**, with the explicit note that if path B closed the gaps instead, that
would be a genuine surprise and an owner decision rather than a retrain trigger.

The measurement below agrees with that expectation, and it is worth being plain about why that is not
self-confirmation: the decisive evidence is a **zero** inversion delta in the collapsed cells, which
is an arithmetic fact about the two transforms at those geometries, not a judgement call.

## Actual result

**MEASURED 2026-09-12. C3b = NOT ATTRIBUTED TO LETTERBOX CONVENTION.** 120 samples, 6 cells, the
same digest-verified raw outputs, decoded once, inverted two ways. No inference.

### The inversion delta — the physical bound on what the convention can do

| cell | capture | DPR | CSS px per model px | raster content | per-axis scales | worst A→B | median |
|---|---|---|---|---|---|---|---|
| b1 | 960×640 | 1 | 1.50 | 640×427, pad 106 | 1.5 / 1.498829 | 0.999 px | 0.740 |
| b2 | 1024×640 | 1 | 1.60 | 640×400, pad 120 | 1.6 / 1.6 | **0** | **0** |
| a1 | 1264×800 | 1 | 1.98 | 640×405, pad 117 | 1.975 / 1.975309 | 1.048 px | 0.979 |
| a3 | 1920×1080 | 1 | 3.00 | 640×360, pad 140 | 3 / 3 | **0** | **0** |
| a2 | 2880×1443 | 1.5 | 3.00 | 640×321, pad 159 | 4.5 / 4.495327 | **1.998 px** | 1.647 |
| a4 | 2560×1600 | 1 | 4.00 | 640×400, pad 120 | 4 / 4 | **0** | **0** |

The delta is bounded at **1.998 CSS px**, exactly as the arithmetic predicts. And it is **exactly
zero** on b2, a3 and a4, because those captures scale to integer content (1024×640 → 640×400,
1920×1080 → 640×360, 2560×1600 → 640×400): at those geometries the continuous and raster letterboxes
**are the same transform**.

### Metrics under each inverse, at the 0.55 operating point

| cell | mAP@0.5 continuous → raster | recall | grounding | matched |
|---|---|---|---|---|
| b1 | 0.5993 → 0.5991 (−0.0003) | 0.7633 → 0.7633 | 0.4933 → 0.4933 | 258 → 258 |
| b2 | 0.6610 → 0.6610 (**0**) | 0.7853 → 0.7853 | 0.5645 → 0.5645 | 267 → 267 |
| a1 | 0.6647 → **0.6764** (+0.0117) | 0.7714 → 0.7839 | 0.6396 → 0.6500 | 307 → 312 |
| a3 | 0.0617 → 0.0617 (**0**) | 0.1935 → 0.1935 | 0.2593 → 0.2593 | 77 → 77 |
| a2 | 0.0608 → 0.0619 (+0.0011) | 0.1533 → 0.1583 | 0.2490 → 0.2571 | 61 → 63 |
| a4 | 0.0040 → 0.0040 (**0**) | 0.0101 → 0.0101 | 0.0310 → 0.0310 | 4 → 4 |

### Why this settles the attribution

1. **The two most collapsed cells have a zero inversion delta.** a3 (mAP 0.0617) and a4 (0.0040) are
   inverted *identically* by both conventions, so the convention cannot be causing their collapse.
   This alone is decisive, and it needed no threshold.
2. **Where the delta is largest, the effect is negligible.** a2 carries the full 2.0 CSS px and gains
   **+0.0011 mAP** — about 0.2% of its −0.54 gap to the controls.
3. **No gap closed.** Every off-grid cell stays below the control band under both inverses, in both
   views.
4. **The scale pattern survives untouched**: ascending CSS px per model px → 1.50: 0.599, 1.60: 0.661,
   1.98: 0.665/0.676, 3.00: 0.061/0.062, 4.00: 0.004.

### Incidental, and not a production recommendation

The raster inverse is very slightly *better* where the two differ on real UI content (a1 +0.0117 mAP,
+0.0126 recall, +0.0104 grounding, 5 more matches; a2 +0.0011) and very slightly *worse* on b1
(−0.0003). The effect is mixed and tiny, it is **not** a reason to change `computeLetterbox`, and the
contract's warning stands: changing it would move every detection the detector emits.

## Conclusion

**The label/raster convention does not explain C3's degradation.** The §6 mismatch stays what the
contract already called it — **recorded technical debt, not a production defect** — and
**retraining remains unjustified**; none was performed, and no weights were even loaded.

What remains open is the **scale** behaviour: the detector collapses beyond roughly 2 CSS px per
model px. That is not QG-03a-C's subject. **QG-03a-C stays `CONDITIONAL`**, and C3 stays
**INCONCLUSIVE** — C3b removed one candidate cause, it did not turn C3 into a pass.

## Reproducibility

```bash
# prerequisites: npm ci && npm run typecheck; C3's retained raw outputs present under
# artifacts/experiments/W1-QG03a-C3-label-raster-generalisation/harness/generated/<cell>/raw/
node artifacts/experiments/W1-QG03a-C3b-letterbox-inverse-attribution/harness/reinvert-c3b.mjs
```

The harness refuses rather than guessing: a missing or digest-mismatched raw output, a model hash or
ORT record that differs from C3's, an incomplete cell, a wrong tensor length, a non-finite value, a
decode refusal, or any attempt to write under `artifacts/datasets/` or `artifacts/gates/`. It exits
non-zero on any of those, and it contains no ORT import at all.

## Files

| path | purpose |
|---|---|
| `design.md` | the pre-registration: the two inverses, what is held identical, the classification rule |
| `decision.md` | the verdict and the per-cell numbers |
| `harness/reinvert-c3b.mjs` | loads C3's raw outputs, decodes once, inverts both ways, scores both |
| `logs/c3b-<cell>.json` · `logs/metrics.json` | per-cell records and the comparison |
