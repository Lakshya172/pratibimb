---
id: W1-QG03b-letterbox-conformance
title: "QG-03b — reconciling the two letterboxes"
status: recorded
date: 2026-09-11
label: FACT (observations) / INFERENCE (assessment)
verdict: ACCEPT
workstation: 1 (LAPTOP-6E14K34L)
---

# QG-03b — one preprocessing contract, implemented twice, checked byte for byte

> QG-03 ended `CONDITIONAL` on one blocker: the browser and the Python reference produced
> different tensors from the same screenshot, and **16–34% of detections changed** as a
> result. This is that blocker.
>
> **Result: `ACCEPT`. Every stage now matches byte for byte in all 8 browser cells, and
> detection agreement goes from 74%/66% to 100% with exact counts. No retraining is
> required.**

## Hypothesis

Pre-registered, before any browser was launched:

> **H1.** The divergence is in the **resampling kernel**, not in the geometry — canvas
> `drawImage` and PIL `BILINEAR` are different filters, and the padding disagreement is a
> second, smaller effect.
>
> **H2.** PIL's `BILINEAR` is **exactly reproducible** in JavaScript, because its algorithm
> is fully specified — a separable support-scaled triangle filter with 22-bit fixed-point
> coefficients — whereas canvas scaling is implementation-defined.
>
> **H3.** If H2 holds, the browser can be made to match the trainer and **no retrain is
> needed**, because the weights encode the training rasterisation and the training
> rasterisation is unchanged.
>
> **H4.** PNG decoding agrees between browsers and PIL, so the divergence begins at the
> resize. *(Stated as an expectation precisely because it had never been checked — QG-03
> compared only final tensors, where a decode difference is indistinguishable.)*

## Expected result

- **Expected:** H1–H4 to hold; a hand-written resampler to be slower than canvas.
- **Not expected, and flagged where it happened:** that the **training pipeline is itself
  internally inconsistent** — `data.py` places pixels by one rule and `targets.py` labels
  them by another, on 42% of the training set. That was not the question being asked.
- **Expected to fail:** the Firefox WebGPU headless cell, which has no GPU adapter (QG-03).
  It did — and still returned complete conformance results, because preprocessing is a CPU
  question and the probe was written to keep the two independent.

## Environment

Workstation 1, Windows 11 build 26200, Intel Core 7 240H. Unbranded Chromium
**151.0.7922.34**, Firefox **155.0.1** release. Pillow **12.3.0**, ORT Web **1.29.0**.
Model `ba6d9e93695b`, unchanged. **Linux not used; Firefox on Linux remains `UNKNOWN`.**

## Actual result

Sections 1–6. **8/8 cells conformant; detection agreement 100%; no retrain required.**

## Conclusion

`ACCEPT`. See [`decision.md`](decision.md).

---

## 1. What the dossier says about preprocessing

**Nothing.**

v4.0 names *"capture + downscale"* as a pipeline stage with an 18 ms projected budget, and
*"~12 MB at 640 px"* for a candidate model. It contains **no** resize rule, padding rule,
interpolation kernel, rounding convention, channel order or normalisation.

**FACT.** Searched for `letterbox`, `resize`, `downscale`, `bilinear`, `interpolat`,
`preprocess`, `normali[sz]`, `NCHW`, `RGB`, `aspect`, `pad`. The only hits are the pipeline
stage name and the model size.

So the authority for this contract **cannot** come from the dossier, and §3 explains where
it does come from instead. That is recorded rather than assumed, because "the dossier
requires X" is a claim this project checks.

---

## 2. The two implementations, and a third thing nobody had noticed

| | rule | governs |
|---|---|---|
| **CONTINUOUS** — `computeLetterbox` (`letterbox.ts`), `letterbox_params` (`targets.py`) | `pad = (S − dim·s) / 2`, real | the coordinate transform, and **the training labels** |
| **PIL_PASTE** — `letterbox_image` (`data.py`) | `n = max(1, round(dim·s))`, `pad = (S − n) // 2`, integer | **the pixels the model learned from** |

Enumerated over 23 source sizes ([`geometry-comparison.json`](geometry-comparison.json)):

- **16 of 23 agree exactly.** 1024×640 — the canonical capture size — is one of them, which
  is part of why this went unnoticed.
- **7 disagree**, worst **0.667 model px** (960×640).
- **3 produce asymmetric padding** under PIL_PASTE. The continuous convention *cannot*
  express asymmetric padding, because it never rounds.

### The finding that was not being looked for

**Both conventions are used by the same training run.** PIL_PASTE places the pixels;
CONTINUOUS places the labels that describe them.

| | |
|---|---|
| training samples affected | **84 of 200 — 42%** |
| offsets present | 0.222, 0.333, 0.500, **0.667** model px |
| visible to the loss, mAP@0.5, or the micro-overfit gate? | **no** — a sub-pixel constant offset is far inside an IoU 0.5 match |

The model learned a small geometry-dependent nuisance mapping instead of an identity. **It
cancels end to end** provided inference rasterises exactly as training did — which, after
this work, it does. So it is not currently producing wrong coordinates. It is still a defect,
and closing it requires a retrain. Recorded in
[`preprocessing-contract.md` §6](../../../docs/architecture/preprocessing-contract.md) with
the exact code change and its consequences. **Not closed here.**

---

## 3. Where the divergence actually begins

Four stages, compared in order, first divergence reported. **All 8 cells, 15 fixtures, 3 runs.**

| stage | isolates | result |
|---|---|---|
| **decoded** | browser PNG decode vs PIL decode | ✅ **byte-identical, every cell** |
| **resized** | the resampling kernel | ✅ byte-identical |
| **letterboxed** | padding placement and fill | ✅ byte-identical |
| **tensor** | channel order and `/255` | ✅ byte-identical |

**H4 confirmed: PNG decoding was never the problem.** Worth stating, because it was never
checked — and a decode difference would have made every later diagnosis wrong.

**H1 confirmed: the kernel was the problem.** With the kernel fixed, the geometry followed.

---

## 4. Canvas cannot do this, and that is not an implementation detail

The old path was kept as a **control**, run on the same decoded pixels in the same run:

| browser | canvas matched PIL on | worst pixel Δ (0–255) | values differing | honours `imageSmoothingQuality` |
|---|---|---|---|---|
| Chromium | `square-exact`, `tiny-1px` | **99** | 33.8% | **yes** |
| Firefox | `square-exact`, `tiny-1px` | **148** | 31.5% | **no** |

**Canvas matched the reference only on the two fixtures where nothing is actually
resampled** — a 640×640 source, and a 1×1 source upscaled to a single flat colour. On every
fixture that involves a real resize, it diverges.

The two browsers do not agree with each other either. Firefox's `low` and `high` figures are
**bit-identical**: the quality hint is ignored outright.

> **INFERENCE.** Canvas `drawImage` scaling has no specification to conform to. It is the
> wrong primitive for producing a model tensor, and no amount of tuning makes it the right
> one. `preprocess.ts` therefore implements PIL's algorithm directly.

---

## 5. The matrix

| browser | backend | display | decode | resize | pad | tensor | preprocess p50 | PNG decode p50 | detection agreement |
|---|---|---|---|---|---|---|---|---|---|
| Chromium 151 | wasm | headful | ✅ | ✅ | ✅ | ✅ | 19.2 ms | 15.9 ms | **100%** (control 74%) |
| Chromium 151 | wasm | headless | ✅ | ✅ | ✅ | ✅ | 19.8 ms | 10.5 ms | **100%** |
| Chromium 151 | webgpu | headful | ✅ | ✅ | ✅ | ✅ | 19.1 ms | 9.9 ms | **100%** |
| Chromium 151 | webgpu | headless | ✅ | ✅ | ✅ | ✅ | 20.0 ms | 19.5 ms | **100%** |
| Firefox 155.0.1 | wasm | headful | ✅ | ✅ | ✅ | ✅ | 24.0 ms | 11.0 ms | **100%** (control 66%) |
| Firefox 155.0.1 | wasm | headless | ✅ | ✅ | ✅ | ✅ | 21.0 ms | 11.0 ms | **100%** |
| Firefox 155.0.1 | webgpu | headful | ✅ | ✅ | ✅ | ✅ | 22.0 ms | 9.0 ms | **100%** |
| Firefox 155.0.1 | webgpu | headless | ✅ | ✅ | ✅ | ✅ | 22.0 ms | 10.0 ms | **n/a — no GPU adapter** |

15 fixtures × 3 runs per cell. Latency on the largest fixture, 1152×800.

### Detection, the production question

Same PNG → browser decode → shipped preprocessing → ORT → shipped decode → CSS boxes,
against the Python reference boxes:

| | detections | matched @ IoU 0.5 | agreement | worst CSS Δ |
|---|---|---|---|---|
| **shipped path** | **exact count, both frames** | 50/50 and 53/53 | **100%** | **1.10e-03 px** |
| canvas control, Chromium | 53 vs 50, 58 vs 53 | 42 and 39 | 74% | **98.1 px** |
| canvas control, Firefox | — | — | 66% | **145.0 px** |

A worst-case CSS coordinate difference of **1.1 thousandths of a pixel** against **98–145 px**.

---

## 6. Performance

The lightweight constraint applies to preprocessing too, and the first implementation did
not meet it.

| | p50 |
|---|---|
| first implementation | **48.7 ms** |
| after two changes | **17.3–24 ms** |

Two changes, both exact rather than approximating:

1. **`clip8` by reciprocal multiply.** The divisor is `2^22`, so multiplying by its
   reciprocal is exact in IEEE-754 — only the exponent changes — and `| 0` then truncates,
   which equals floor because a triangle filter never produces a negative accumulator.
2. **Row-wise accumulation in the vertical pass.** The obvious ordering strides by
   `srcW · 3` bytes per tap and misses cache on every access. Accumulating a whole output
   row with taps in the outer loop makes reads and writes sequential. Worth about a third.

**Against the dossier's projected 18 ms for "capture + downscale": at the budget on
Chromium, ~20–30% over on Firefox.** Stated as a measurement, not a pass — and PNG decoding
(9–20 ms) is timed **separately**, because the capture consumer pays it either way.

> Both optimisations were verified against the byte-for-byte conformance suite. A faster
> preprocessing path that changed one output byte would be a regression, not an optimisation.

---

## 7. Guards, and proof that they fire

Three negative controls were run against the conformance suite, each naming the stage it
should:

| mutation | expected | observed |
|---|---|---|
| `PRECISION_BITS` 22 → 21 | resize diverges | **`RESIZE diverges — the resampling kernel disagrees with PIL`** |
| `floor` → `round` on the pad offset | padding diverges | **`PADDING diverges — placement or fill byte disagrees`** |
| vertical pass before horizontal | resize diverges | **`RESIZE diverges`** |

All three failed the suite; restoring the file returned it to green. The third is the
subtlest — pass order is observable only because each pass quantises to 8 bits.

The CI-capable half **regenerates the fixture images from a seed in TypeScript** and compares
SHA-256 against the committed Python digests, so the byte-level guard runs with no large
files and does not skip. That also makes generator agreement a tested property: if the two
image constructions drift, the `decoded` digest fails first and says so.

---

## 8. What this does NOT establish

- ❌ **QG-03 is not promoted.** It stays `CONDITIONAL`: one row of a twenty-cell matrix, and
  **Firefox WebGPU headless remains `REJECT`** — reconfirmed 3/3 here.
- ❌ **The detector is NOT adopted.** The registry is unchanged. This closes a correctness
  blocker; adoption items 11 and 14 (acceptable metrics, usable grounding) are untouched.
- ❌ **No accuracy claim.** 100% agreement means the browser reproduces the Python path, not
  that the Python path is any good.
- ❌ **Firefox on Linux remains `UNKNOWN`.**
- ❌ **The training-pipeline label/pixel offset is NOT fixed.** §2 and the contract §6.
- ❌ **Nothing about non-PNG capture formats.** `captureVisibleTab` can return JPEG or WebP;
  only PNG was measured.

## 9. Open questions raised

| # | Question | Status | Blocks |
|---|---|---|---|
| QG-03b-1 | Close the label/pixel offset in the training pipeline — requires a retrain | `UNKNOWN` | bundle with QG-03a |
| QG-03b-2 | Does conformance hold for **JPEG and WebP** captures, where decoding is lossy and may differ per browser? | `UNKNOWN` | production capture formats |
| QG-03b-3 | Preprocessing is 19–24 ms against an 18 ms budget. Is a WASM or SIMD implementation warranted? | `UNKNOWN` | latency budget |
| QG-03b-4 | Pillow is now a dependency of the **contract**, not just the trainer. What happens when it changes its resampler? | `UNKNOWN` | contract stability |
