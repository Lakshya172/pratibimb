---
id: W1-QG03a-t1-production-robustness
title: "QG-03a — T1 production-path robustness"
status: recorded
date: 2026-09-11
label: FACT (observations) / INFERENCE (assessment)
verdict: OPEN — A PASS (after one fix), B OPEN, C CONDITIONAL
workstation: 2 (LAPTOP-SRCINK2B)
---

# QG-03a — is the real PNG-based T1 path robust enough?

> The production path under ADR-0002 is `captureVisibleTab({format:"png"})` → PNG validation
> → browser decode → authoritative preprocessing → T1 detector → decode/NMS → DOM/vision
> fusion. JPEG is not on it and is not reopened here. WebP belongs to T2 egress and is not
> touched.
>
> QG-03a is three independent questions. They are reported separately and **not** merged
> into one score.

| | question | verdict |
|---|---|---|
| **A** | Does the browser raster equal the training raster, for any capture size? | **PASS**, after fixing one real defect (**QG-03a-A1**). Windows only. |
| **B** | How stable is decode/NMS under inference noise? | **OPEN.** Mechanism localised; the consequence is model-dependent. |
| **C** | Does the label ↔ raster mismatch matter? | **CONDITIONAL.** Bounded and metric-neutral; no retrain justified on its own. |

**QG-03a overall: OPEN. QG-03 remains CONDITIONAL. The detector remains UNADOPTED. The
threshold stays at 0.55. The model registry is unchanged.**

## Environment

Workstation 2 (`LAPTOP-SRCINK2B`, ENV-0002), Windows 11 build 26200, AMD Ryzen AI 7 350.
Node 26.4.0, Python 3.12.10, Pillow 12.3.0, numpy 2.5.3. Chrome 153.0.8010.36 and Firefox
155.0.1 are the **installed** browsers, each on a plain `http://127.0.0.1` page with a
throwaway profile, headful, no flags. This is **not an extension context**; those cells are
QG-03b's, on workstation 1. Base commit `3d97284`. Full detail is in
[environment.json](environment.json).

**No model was run.** `t1-ui-head.onnx` is gitignored and absent here, and QG-03a forbids
regenerating it. Every detector-side result uses constructed head outputs fed to the
**shipped** `decodeHeadOutput`. **The held-out test split was never evaluated.**

## Expected result

These were stated before measuring. Each investigation below repeats its own hypothesis and
acceptance criterion.
- **A:** the shipped raster is bitwise equal to the Pillow reference everywhere, because QG-03b
  had shown that on 15 fixtures.
- **B:** the QG-03b-2a sensitivity is reproducible through the shipped decode and traceable to
  NMS ordering.
- **C:** the label/raster offset is bounded, sub-pixel and metric-neutral at IoU 0.5.

## Actual result

- **A** was **not** bitwise everywhere. A real defect (QG-03a-A1, exact-half rounding) broke
  6 of 40 fixtures identically in Node, Chrome and Firefox. After the fix, all three runtimes
  are 40/40.
- **B** reproduced, and was localised to hard NMS discontinuity. Its real-model magnitude is
  unmeasurable here.
- **C** matched the expectation.

The details follow, per investigation.

---

## A — resampler / preprocessing robustness

**HYPOTHESIS.** The shipped `preprocessToTensor` reproduces the Pillow reference, which
`data.py` rasterised the training set with, byte for byte, for every capture size. Browser
PNG decode is bitwise.

**METHOD.**
1. `harness/qg03a_reference.py` builds the reference with the **unmodified**
   `make_image` and `pil_stages` from `tools/detector/qg03b_fixtures.py`.
   - That module imports torch via `head.py`, and torch is absent here. A stub supplies
     the two constants those functions read.
   - Regenerating the 13 historical QG-03b fixtures reproduced **13/13 committed digests**,
     which proves the stub changes nothing.
2. The reference also builds 27 hostile fixtures:
   - exact-half extents;
   - one-pixel padding asymmetry;
   - 4000×100 and 100×4000 strips, 1×640, 7×3;
   - upscales;
   - real capture sizes up to 3840×2160;
   - text-like strokes, one-pixel diagonals, Nyquist checkerboards, and tiny controls flush
     with each edge.
3. `run-a-raster.mjs` compares the shipped rasteriser with Pillow stage by stage in Node,
   and names the first stage that diverges.
4. `run-a-browser.mjs` does the same after a **native** PNG decode (`createImageBitmap` →
   canvas → `getImageData`, as the QG-03b probe does) in Chrome and Firefox.

**BASELINE.** QG-03b: bitwise on 15 fixtures, none of which was an exact-half size.

**ACCEPTANCE CRITERION.** Bitwise identity at every stage (decoded, resized, letterboxed,
tensor) on every fixture, in every runtime. No tolerance: the contract defines the bytes.

**RESULT.**

| | Node | Chrome 153 | Firefox 155 |
|---|---|---|---|
| before the fix | 34/40 | 34/40 | 34/40 |
| **after the fix** | **40/40** | **40/40** | **40/40** |

**All 6 failures were the same defect, QG-03a-A1.**

- **The cause.** The resized extent is `round(dim · s)`. `data.py` uses **Python's**
  `round()`, which sends an exact .5 to the **even** neighbour. The shipped code used
  `Math.round`, which sends it **up**. The two disagree whenever `dim · s` lands on exactly
  .5 with an even lower neighbour.
- **Where it happens on real capture sizes.**

  | capture | training extent | shipped extent | bytes differing |
  |---|---|---|---|
  | 1280×641 | 320 | 321 | 4.2% |
  | 1280×721 | 360 | 361 | 25.7% |
  | 1024×644 | 402 | 403 | 21.3% |
  | 2560×1442 | 360 | 361 | 4.5% |
  | 641×1280 | 320 | 321 (width) | 4.9% |

  - Worst letterboxed byte difference: **189**.
  - The two exact-half sizes where both rules agree (1024×652, 1280×3) passed.
  - Every other hostile fixture, and browser decode everywhere, was already bitwise.
- **Why nothing caught it.** None of the 16 training sizes lands on .5, and the old guard
  only enumerated fixture sizes.
- **How common.** Across 1000–2000 × 500–1300 CSS viewports, only 0.01–0.05% of capture
  sizes hit it at each DPR. They concentrate on very common widths, though: at width 1280,
  about half of all heights.
- **The fix.** `rasterLetterbox` now rounds half to even (`roundHalfEven`), exactly as
  `data.py` does. Non-tie sizes are provably unchanged: the other 34 fixtures, the 16
  training sizes and the existing conformance suite all pass.

**Coordinate contract (A3).** 36 geometries: 6 viewports × DPR {1, 1.5, 2} × zoom
{100%, 125%}, with Chromium's zoom-into-DPR semantics recorded as such. All 36 are accepted.
The CSS → capture → model → capture → CSS round trip is exact to at most **3.4e-13 CSS px**.
The zoom field is never used as a multiplier (`coordinates.ts`). Stale-frame and off-screen
semantics stay enforced by the existing `fusionFreshness` and observation suites, which pass
unchanged.

**Cost, measured after the fix.**

| runtime | 1264×800 | 1920×1080 | 2560×1600 |
|---|---|---|---|
| Node, median of 7 | 14.5 ms | 21.0 ms | 38.0 ms |

The browser figures in [metrics.json](metrics.json) are **single cold runs**, including
JIT warm-up: at 1264×800, Chrome took 50.4 ms and Firefox 17 ms to preprocess. They are not
medians and are not comparable to the Node medians. The dossier's 18 ms
"capture + downscale" is a **projected** budget. Preprocessing alone meets it at 1264×800 in
Node and exceeds it at larger sizes. QG-03b-3 remains open.

**CONCLUSION.** A **PASS**, after the fix, on Windows workstation 2 (Node, Chrome 153,
Firefox 155; page context). Linux is **UNKNOWN**. Identical tensors imply identical detector
input, so preprocessing contributes **no** detector-output difference on a given backend.

---

## B — inference noise and NMS ordering stability

**HYPOTHESIS.** The QG-03b-2a sensitivity (a 1e-07 perturbation moving a box 47 CSS px) is a
property of the decode, and it can be localised to one mechanism.

**METHOD.** `run-b-nms.mjs`, all through the **shipped** `decodeHeadOutput`:
- **B1**, a minimal pair: two same-class 140×40 boxes, IoU 0.556, with scores 0.9 and 0.9 + δ.
- **B2**, each candidate mechanism isolated in its own construction.
- **B3**, a realistic dense scene: 24 controls, a stride-8 head with 6,400 anchors and graded
  near-duplicate predictions. It is run under iid relative output noise from 1e-9 to 1e-4,
  in float64 and float32, over 5 scenes × 20 trials each. Results are measured both with the
  historical QG-03b-2a matcher and with grounding properties: recall, and whether the click
  point stays inside the element.

**BASELINE.** QG-03b-2a saturation control: 1e-8 → 0 px; 1e-7 → 47.4 px.

**ACCEPTANCE CRITERION.** The pre-registered detector bound: ≥ 95% matched at IoU 0.5, a
count change of at most 2, and worst displacement ≤ 2.0 CSS px. **The dossier specifies no
noise-robustness criterion. That gap is recorded, not filled** (see Conclusion).

**RESULT.**

- **The mechanism: hard greedy NMS is discontinuous.** In every isolated construction the
  outcome flips at the **smallest representable** perturbation. The six mechanisms are:
  - a score near-tie between two overlapping boxes;
  - IoU sitting exactly at 0.5;
  - near-equal class scores;
  - the 0.25 emit floor;
  - the 300-detection cap;
  - a suppression cascade.

  An exact tie is deterministic, resolved by anchor index. A difference of 1e-9 swaps the
  survivor: 80 CSS px in the pair.
- **The historical control had two measurement artefacts.**
  1. It perturbed through float32 `(1 + noise)`, so its 1e-8 row changed **nothing**.
     Float32 absorbs any change below its rounding step, which is 5.96e-9 at 0.9. The
     "1e-8 → 0 px" row is not evidence of a stability margin.
  2. Its "displacement" counts a survivor **swap** between two boxes that both still match
     at IoU ≥ 0.5.
- **Swaps stay on the element.** Across 81,127 random box pairs with IoU > 0.5, **0** had a
  centre outside the other box. The maximum centre offset was 0.379 of the side, and for
  equal boxes, IoU > 0.5 implies an offset below side/3.
- **The realistic scene, by noise level.**

  | noise | survivor swaps | pre-registered pass | worst displacement |
  |---|---|---|---|
  | ≤ 1e-6 | 0 | 100% | ≤ 0.0012 CSS px |
  | 1e-5 | 17% | 83% | 3.58 CSS px |
  | 1e-4 | 49% | 55% | 8.37 CSS px |

  Recall, click-safety and the detection count were **never** lost, at any noise level, in
  either arm.
- **Diagnostic only.** A score-weighted cluster merge stays under 0.08 CSS px at every noise
  level (8.37 → 0.077 at 1e-4). It is **not shipped and not proposed**: it changes every
  detector output and would need re-evaluation with the model.

**CONCLUSION.** B is **OPEN**.
- **What is known.** The root cause is localised: hard greedy NMS makes a discrete choice
  that is continuous nowhere at near-ties. In every constructed case the swapped survivor
  stays on the same element.
- **What is not known.** The real model's outputs, which produced 47 px on workstation 1,
  are not available here. So the real-world magnitude cannot be measured, and no production
  change is justified yet.
- **The criterion gap.** The pre-registered 2.0 CSS px bound was designed for **conformance**
  of identical inputs. Applied to noise robustness it is incompatible with hard NMS, which
  can never meet it at a near-tie. A grounding-based criterion is **proposed**, for the
  architect to decide: under noise at the measured backend level, every reference detection
  keeps a same-class match with IoU ≥ 0.5 and its centre inside the element, and the count
  changes by at most 2.

---

## C — label ↔ rasterisation consistency

**HYPOTHESIS.** The training labels use the continuous letterbox and the pixels use the
integer raster. The resulting sub-pixel offset is bounded, and it does not move mAP@0.5,
recall or grounding.

**METHOD.** `run-c-labels.mjs`:
- **C1** reproduces the T1 training-set geometry from its deterministic render specs
  (seed 20260910, counts 120/40/40, DPR 1).
- **C2** takes the **worst case**, a model that learned the *pixels* rather than the labels:
  predictions are the pixel-true boxes, inverted by the continuous runtime transform. It
  scores them with the **shipped evaluator** on **train and dev only**. The box layouts come
  from the evaluation generator at each sample's viewport, **not** from the rendered DOM
  labels, which need the gitignored dataset.

**BASELINE.** Preprocessing-contract §6: 84/200 samples affected, offsets up to 0.667 model px.

**ACCEPTANCE CRITERION.** The mismatch is harmless if the worst case leaves mAP@0.5, element
recall and grounding unchanged, and IoU stays well above 0.5 for the smallest controls.

**RESULT.**
- **C1** reproduces **84/200** exactly: train 50, dev 18, test 16. The test figure is
  arithmetic on render sizes only. Worst per-sample offsets are 0.222, 0.5 and 0.667 model px.
- **C2** covers 2,658 boxes:
  - maximum corner offset **0.681 model px**;
  - minimum IoU **0.869**, on 8–16 model px controls. No box is under 8 px in this layout set.
  - **Worst-case mAP@0.5, recall and grounding are all 1.000, on train and dev.** They match
    the perfect control.
- **At other capture sizes.** At non-training sizes the end-to-end offset reaches 1.33 CSS px (1920×962 at DPR 1.5)
  (A3). Whether the model generalises its learned nuisance offset there is **UNKNOWN** without
  the model.

**CONCLUSION.** C is **CONDITIONAL**.
- The mismatch is real, bounded, and metric-neutral at IoU 0.5 even in the worst case.
- It **does not justify a retrain on its own**, which confirms the contract's §6 judgment
  with measurement.
- It remains technical debt. Fixing it means relabelling in raster geometry and retraining,
  and it should be bundled with the next training change.
- Its effect on training dynamics is **UNKNOWN**. Measuring that needs a retrain, which is
  out of scope here.

---

## Reproducibility

```
npm ci && npm run typecheck
python artifacts/experiments/W1-QG03a-t1-production-robustness/harness/qg03a_reference.py
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/run-a-raster.mjs --label=after
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/run-a-browser.mjs --browser=chrome  --label=after
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/run-a-browser.mjs --browser=firefox --label=after
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/run-b-nms.mjs
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/run-c-labels.mjs
node   artifacts/experiments/W1-QG03a-t1-production-robustness/harness/aggregate-qg03a.mjs
```

The "before" logs were produced at base `3d97284`, with the shipped `Math.round`, by the same
commands with `--label=before`. Committed are the scripts, `reference.json` (digests only),
`logs/` and `metrics.json`. Pixel dumps and browser profiles are gitignored. The regression
guard is `packages/perception/test/qg03aRobustness.test.ts`.

## What this does not do

- It does **not** adopt the detector, change threshold 0.55, widen any tolerance, retrain,
  or touch the held-out split.
- It does **not** alter the capture format (ADR-0002), reintroduce JPEG, touch T2, D3, D4,
  QG-04, B-02 or ADR-0001, or add any network path.
- It does **not** close the open items:
  - Firefox Linux: UNKNOWN.
  - Firefox WebGPU headless: REJECT.
  - Detector: UNADOPTED.
  - QG-04: UNSIGNED.
  - B-02: OPEN.
  - QG-05: PARTIAL.
  - Label/raster: debt.
  - NMS sensitivity: OPEN.
  - Performance: above the projected budget.
