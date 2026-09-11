# QG-03b-2a — decision

**Classification: CONDITIONAL.**

The capture path itself is **ACCEPT everywhere**. The gate is CONDITIONAL because the
pre-registered criterion named **detector output** as primary, and on one fixture in two of
the eight cells that bound is exceeded. The cause is measured, is downstream of a
bitwise-identical tensor, and is not the capture format.

---

## The matrix

| backend | display | format | path | detector bound | verdict |
|---|---|---|---|---|---|
| wasm | headful | capture-png | ACCEPT | met | **ACCEPT** |
| wasm | headful | capture-jpeg | ACCEPT | **not met** | **CONDITIONAL** |
| wasm | headless | capture-png | ACCEPT | met | **ACCEPT** |
| wasm | headless | capture-jpeg | ACCEPT | **not met** | **CONDITIONAL** |
| webgpu | headful | capture-png | ACCEPT | met | **ACCEPT** |
| webgpu | headful | capture-jpeg | ACCEPT | met | **ACCEPT** |
| webgpu | headless | capture-png | ACCEPT | met | **ACCEPT** |
| webgpu | headless | capture-jpeg | ACCEPT | met | **ACCEPT** |

Every backend label was **observed**, not configured: the probe counts `GPUQueue.submit`
during inference. WASM cells submitted 0; WebGPU cells submitted 120. ORT falls back to
another execution provider without raising, so a configured backend is not a measured one —
QG-03 published a mislabelled cell once already.

No cell was averaged into another, and the overall verdict is the weakest cell.

## Why CONDITIONAL and not ACCEPT

The brief's ACCEPT requires that *"real Chromium JPEG bytes decode/preprocess equivalently
**and detector behavior is within the existing bound**."* On `gradients-edges`, JPEG, WASM,
the worst matched box sits **15.95 CSS px** from its reference against a pre-registered bound
of **2.0 px**.

It would be easy to call this ACCEPT on the grounds that the cause is understood and benign.
That is the same error as loosening a tolerance to obtain a pass, pointed the other way, so
the verdict stays CONDITIONAL and the condition is stated.

## Why it is not a capture-format result

Two facts settle it, and neither requires an argument:

1. **The tensor digest matches the reference bitwise on that fixture.** Decode and
   preprocessing had already agreed exactly. The capture path's entire output is identical
   on both sides, so nothing after it can be charged to the capture format.

2. **The same bytes and the same tensor gave 15.95 px on WASM and 0.002 px on WebGPU**, in
   the same browser on the same machine. A quantity that changes with the execution provider
   while the input does not is a property of inference.

[`saturation-control.json`](saturation-control.json) adds the magnitude: perturbing the
reference's *own* model output by an iid relative **1e-07** — far below the 2.6e-06 score
difference actually observed — already moves a matched box **47 CSS px**. The shipped
box decode is that sensitive.

### A hypothesis the control killed

The first reading was *"the 300-detection cap is the mechanism"*: `gradients-edges` puts
**829 anchors** over the frozen 0.55 threshold and the decode keeps 300, so the surviving set
looked like a function of the sort order over near-tied scores.

It is not that simple. `controls` emits 147 boxes, nowhere near the cap, and is just as
unstable at 1e-07. The mechanism is **NMS ordering** generally — one swapped pair changes
which box suppresses which and the change cascades — and saturation aggravates it rather
than causing it. The tidy explanation is recorded as wrong rather than quietly replaced,
because the untidy one is the one that generalises to real UI.

`gradients-edges` is also not a user interface. It is a conic gradient beside a 1px Nyquist
checkerboard, and a detector emitting 300 boxes there is saturating on noise.

### What this is

**A QG-03a input.** Box-decode stability under inference noise is a robustness property
nobody has measured deliberately. It joins resampler robustness and QG-03b-1.

It does **not** justify retraining, re-thresholding, or any change to the model registry, and
none was made.

## Conformance, and the thing it is not

Two numbers that must never be added together:

| | what it compares | result |
|---|---|---|
| **conformance** | browser vs reference decode of the **same bytes** | max abs **0**, bitwise, every cell |
| **compression sensitivity** | JPEG capture vs **PNG capture** of the same paint | max abs 104–142, mean 0.37–3.19 |

The second is not a defect and not a browser result. It is what the encoding costs, and it
belongs to QG-03a.

## Capture policy — a recommendation, not a change

Nothing here was implemented. The shipped adapter still requests PNG and was not touched.

The evidence, however, points one way. At Chromium's default quality 90, on these ten
fixtures:

- **PNG is smaller than JPEG on 9 of 10** — 1.7× to 2.9× smaller on real UI. JPEG wins only
  on `gradients-edges`, which is not a UI.
- PNG is lossless, so it carries **no compression-robustness requirement at all**.
- PNG decode is faster (median 9.7 ms vs 9.8 ms here; QG-03b-2 measured a wider gap).

So for UI screenshots the lossy format is larger, no faster, and costs accuracy. **Recommend
pinning capture to PNG** and retiring compression robustness from QG-03a's scope — the
cheapest fix to a robustness problem is not needing the robustness.

That is a product and architecture decision, not a spike's to make. Raised as **QG-03b-2c**.

## What this does not say

- It says **nothing about Firefox.** Firefox has no `captureVisibleTab` output of its own to
  test here; that would be a different question. No Firefox cell exists in the metrics.
- It says nothing about **Linux or macOS**. Windows only.
- It does **not** promote or retire any QG-03 cell verdict. Firefox WebGPU headless remains
  **REJECT**; Firefox Linux remains **UNKNOWN**.
- It does **not** adopt the detector. `model-registry.md` is unchanged.
- QG-03 remains **CONDITIONAL**.

## Follow-ups raised

| id | item |
|---|---|
| **QG-03b-2c** | pin capture to PNG — product/architecture decision, evidence above |
| **QG-03a-4** | box-decode stability under inference noise (new, from this experiment) |
| **QG-03b-2b** | progressive / ICC-tagged JPEG from sources other than our own capture |
| **QG-03b-2d** | `CaptureFrame.format` permits `"webp"`, which the API rejects outright |
