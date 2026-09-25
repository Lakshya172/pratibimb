# QG-03 — which input decides the WASM correctness cell? · DECISION RECORD

> **Status: OWNER DECISION REQUIRED.** Recorded 2026-09-25 (M7.3). This record changes nothing: no
> threshold, no statistic, no gate status, no verdict. QG-03 is **not** marked passed for any model,
> and `PP-OCRv5_mobile_det` remains **`REJECTED FOR V1`** — on text-region geometry, which this
> question does not touch.

## The two results

Same pinned model (`PP-OCRv5_mobile_det @ 0d63e78e`, reconstructed ONNX `d9056b16…`), same runtime
pairing (ORT Web 1.29.0 `wasm`, one thread, pinned binary `db816fad…` against native `onnxruntime`
1.29.0 CPU), same frozen statistic — **exact output count, and relative error of `sumAbs` ≤ 2e-2**:

| input | relErr(sumAbs) | max \|web − native\| | output range | under the frozen bound |
|---|---|---|---|---|
| **synthetic** — S-04a-1's `x[i] = ((i·37) mod 255)/255`, 640×640 | **4.12e-02** | 1.8e-07 | 8.9e-08 … 1.5e-06 | **fails** |
| **realistic** — the M7 fixture screenshot, 640×1024 (S-04a-1a) | **4.23e-06** | 2.3e-04 | 0 … 1 | **passes** |

**Why they differ.** The synthetic input contains no text, so a text-segmentation model outputs
"no text" everywhere: every value sits between 1e-7 and 1.5e-6, deep in the sigmoid's tail. There the
relative error of a sum of tiny values is dominated by the exponential amplifying a small logit
difference — S-04a-1 measured 0.29 % at the logit level becoming 4.12 % after the sigmoid — while the
largest absolute disagreement is 1.8e-07. On a real page the output is a genuine probability map, and
web and native agree to 4.2e-06 relative. Both measurements are correct; they measure the runtime in
different numerical regimes.

## The exact wording that has to be interpreted

- **QG-03** (`agentos/gates/README.md`): *"Each cell records all four values: session loads, **p50 on
  the fixed fixture**, peak heap, **correctness vs known-good reference**."* · *"**The WASM columns
  pass.** A model that fails them is not shipped whatever it does on WebGPU."*
- **Benchmark contract, Rule 3** (`docs/testing/benchmark-contract.md`): *"Output correctness against
  a known-good reference."* Gating rules FROZEN: *"A model that fails the WASM columns is not
  shipped."*
- **Model adoption, step 4** (`agentos/workflows/model-adoption.md`): *"p50 latency on the FIXED
  fixture … output correctness vs a known-good reference."*
- **S-04a-1** (`W1-S04a1-four-model-residency`): a four-model **residency spike** whose correctness
  check used the synthetic input, and which filed *"S-04a-1a — validate `ocr_det` … with realistic
  text-bearing input … p1 … QG-03, correctness sign-off"* as a follow-up.

**None of these names the input for the correctness value.** QG-03 names *the fixed fixture* for p50
and *a known-good reference* for correctness, and leaves the correctness input implicit.

## Precedent, stated as fact rather than as an argument

The one feasibility row the repository has completed — the T1 UI head in
`agentos/registry/feasibility-matrix.md` — defined `CORRECT` as *"element-wise agreement with a Python
reference inside a **pre-registered** criterion"*, measured on **real fixture images** (45
fixture/encoding pairs across 8 cells), with its own statistic (class channels 1e-4, box channels
0.25 model px). S-04a-1's `sumAbs` criterion was set for a spike across four different models, not
as a QG-03 cell for this one.

## The readings that are possible

| | reading | consequence for a text detector |
|---|---|---|
| **A** | The correctness cell is measured on the **fixed, realistic fixture** — the same input as p50. The synthetic input is spike data, recorded but not deciding. | Matches the completed T1 precedent. On this reading PP-OCRv5's WASM cell would pass — which changes nothing, because it is rejected on geometry. |
| **B** | **Both** must pass: the realistic fixture **and** the synthetic input. | The most conservative. For a segmentation model it means the text-free saturated regime must also meet a relative bound on tiny sums, which S-04a-1's own analysis attributes to conditioning, not to a runtime fault. |
| **C** | S-04a-1's **synthetic** input is the frozen authority. | Treats a residency spike's input as the gate's input. Runs against S-04a-1's own record, which deferred correctness sign-off to S-04a-1a and QG-03. |

RE-1 already requires every **realistic** input to pass (G5) and records the synthetic result, and it
states explicitly that QG-03's column remains the gate owner's. **RE-1 does not answer this question,
and this record does not either.**

## What the owner must decide

1. **Which reading — A, B or C — governs QG-03's WASM correctness cell** for models whose output is a
   probability map (segmentation / text-region detectors).
2. **Which statistic that cell uses** for such a model: S-04a-1's `sumAbs` relative bound, an
   element-wise pre-registered bound as the T1 row used, or both. The 2e-2 bound itself is not in
   question here and is not changed.
3. Whether the decision applies to **all future candidates** from M8 onwards (the natural scope).

| Field | Value |
|---|---|
| **Decision** | ☐ A ☐ B ☐ C ☐ other: ____ |
| **Statistic** | ☐ sumAbs ≤ 2e-2 ☐ element-wise, pre-registered per model ☐ both |
| **Approved by** | _pending_ |
| **Date** | _pending_ |

This must be decided **before** an M8 candidate reaches QG-03 (RE-1 step 7). It does not block the M8
inventory, the development screen or the held-out RE-1 evaluation, all of which already require the
realistic inputs to pass.
