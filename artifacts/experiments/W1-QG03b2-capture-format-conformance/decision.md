---
id: W1-QG03b2-decision
spike: QG-03b-2
verdict: ACCEPT
date: 2026-09-12
decided_by: pratibimb-architect + browser-engineer + ml-engineer + performance-engineer + privacy-security-engineer + evaluation-qa-engineer
---

# QG-03b-2 decision — ACCEPT

## Verdict, per browser × format

Never averaged across either axis.

| | PNG | JPEG q95 | JPEG q62 | WebP lossless | WebP lossy q62 |
|---|---|---|---|---|---|
| **Chromium 151** (wasm + webgpu, headful + headless) | **ACCEPT** | **ACCEPT** | **ACCEPT** | ACCEPT ¹ | ACCEPT ¹ |
| **Firefox 155.0.1** (wasm + webgpu, headful + headless) | **ACCEPT** | **ACCEPT** | **ACCEPT** | ACCEPT ¹ | ACCEPT ¹ |

¹ WebP is **not a capture format** — `captureVisibleTab` cannot produce it. Accepted as
evidence for the future T2 egress-verification path, not as a T1 capture claim.

**Every format decoded BITWISE IDENTICALLY to the reference. Max absolute difference: 0.**
Geometry exact everywhere. No harness errors. Windows only; **Firefox on Linux remains
`UNKNOWN`**.

## The pre-registered bound was never needed

H1 registered **max 2 / mean 0.2** per channel for lossy formats, on the reasoning that
ITU-T T.83 allows a compliant JPEG decoder a peak IDCT error of 1. The measured value is
**0**: Pillow and both browsers use libjpeg-turbo and libwebp with the same defaults, so
there is no decoder variance to bound.

The bound stays in the contract anyway. A different browser build or a different Pillow could
reintroduce variance, and the test would then say so rather than silently re-baselining.

**Colour management was isolated and is not involved** — `colorSpaceConversion: "none"`
changed nothing on any fixture in any cell.

## What changed in the product, and why

**`preprocessToTensor` now refuses a non-opaque frame** (`FRAME_NOT_OPAQUE`).

A canvas stores premultiplied colour and `getImageData` un-premultiplies it. That round trip
is not invertible below alpha 255. Measured: **15/255** per channel for PNG in Chromium,
**27/255** in Firefox, **31/255** for WebP, which premultiplies a second time during decode.

**Neither browser can be configured out of it.** `premultiplyAlpha: "none"` recovers WebP to
the PNG level in Chromium and is **ignored outright by Firefox** — the same pattern QG-03b
measured for `imageSmoothingQuality`. That is what makes a guard the right answer rather than
a decode option.

Captures are opaque, so this never fires in production. The guard exists because the
alternative is a tensor that looks entirely normal and is wrong by up to 31 levels, from
which the detector would return confident boxes. The check is folded into the existing
RGBA→RGB pass and costs nothing measurable.

## Two results kept apart that could easily have been merged

| | compares | result |
|---|---|---|
| **conformance** | browser vs the reference decode of **the same bytes** | **100%, exact counts, worst CSS Δ ~1e-03 px** |
| **compression sensitivity** | an encoding vs the **lossless** frame | jpeg-q95 96–98%, **jpeg-q62 91–92%**, webp-lossy 92% |

An earlier aggregation combined them and reported *"jpeg-q62 91% MISS"*, which reads as a
browser defect and is nothing of the kind. **Losing 8–9% of detections at q62 is the detector
minding compression** — a robustness property belonging to QG-03a, not a preprocessing fault.

## Recommendation: capture as PNG

Evidence-backed, and not what a photographic-compression intuition suggests. On **9 of 9**
fixtures PNG is **smaller** than JPEG q62 — 1.86× and 2.01× on the two real UI frames, up to
27.9× on text-heavy content. UI screenshots are flat colour, sharp edges and text, which is
the content PNG is good at and JPEG is bad at.

So for this workload JPEG is **larger, slower to decode (13–16 ms against 8–13 ms), and
loses 8–9% of detections.** It offers nothing.

JPEG stays supported and is measured conformant, so nothing breaks if it is used. Pinning the
adapter to PNG is recorded as **QG-03b-2c** rather than done here — it is a capture-policy
change, not a conformance one.

## What this decision does NOT do

- ❌ **Promote QG-03.** Still **`CONDITIONAL`**. One row of a twenty-cell matrix, and
  **Firefox WebGPU headless remains `REJECT`**.
- ❌ **Adopt the detector.** `model-registry.md` **unchanged**. Adoption items 11 and 14
  (acceptable metrics, usable grounding) are untouched.
- ❌ **Retrain, or change architecture, stride, capacity, thresholds or training data.**
- ❌ **Touch the threshold methodology.** The frozen DEV-only rule (max F1(recall, grounding),
  0.55, test split not reopened) is unchanged.
- ❌ **Reopen QG-03b.** PNG is re-verified as a regression check and is unchanged.
- ❌ **Close the training label/raster inconsistency** (QG-03b-1). Still open, still needs a
  retrain, still should be bundled with QG-03a.
- ❌ **Say anything about Firefox on Linux, progressive JPEG, ICC-tagged captures, or a frame
  from Chrome's own encoder** — the fixtures are Pillow-encoded.

## Implications for QG-03a

QG-03a's scope **grows**, and this experiment is why:

1. **Resampler robustness** — the original QG-03a item.
2. **Compression robustness** — new. At JPEG q62 the detector loses 8–9% of detections
   against the lossless frame. If capture is ever JPEG, that is a direct accuracy cost.
   *(If QG-03b-2c pins capture to PNG, this item drops to low priority — the cheapest fix to
   a robustness problem is not needing the robustness.)*
3. **The label/raster inconsistency** (QG-03b-1) — bundle it, since a retrain is required
   either way and doing it twice wastes the baseline re-freeze.

All three want the **same** change: retrain with augmentation, on the existing rendered
dataset, preserving train/dev/test separation. **Not started here**, per the brief.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| QG-03b-2a | Does a frame from **Chrome's own** JPEG encoder decode identically? Fixtures here are Pillow-encoded. | **p1** | completeness of the capture story |
| QG-03b-2c | Pin the capture format to **PNG** in the adapter, given the size/latency/accuracy evidence | **p1** | capture policy; would de-prioritise compression robustness |
| QG-03b-2b | Progressive JPEG and ICC-tagged captures — absent from the fixture set | p2 | robustness of the conformance claim |
| QG-03b-2d | `CaptureFrame.format` permits `"webp"` no adapter can produce — narrow the type, or keep it for T2? | p2 | type/adapter consistency |

## Registry effect

- `agentos/registry/feasibility-matrix.md` — **EDITED**, the UI element detector row's
  preprocessing note extended to cover all capture formats. **No cell verdict changed.**
- `agentos/registry/model-registry.md` — **UNCHANGED.**
- `docs/architecture/preprocessing-contract.md` — **EXTENDED** with §7 (capture formats) and
  §8 (the opacity requirement).
- `packages/perception/src/preprocess.ts` — `FRAME_NOT_OPAQUE` guard added.
- `packages/perception/src/failure.ts` — one new error code.
- `packages/perception/src/letterbox.ts`, `docs/architecture/coordinate-contract.md`,
  `docs/security/security-invariants.md`, `artifacts/adr/ADR-0001/` — **UNCHANGED.**
