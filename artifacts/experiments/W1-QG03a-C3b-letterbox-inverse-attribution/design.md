# QG-03a-C3b — design note (written before any re-inversion was computed)

> **PRE-REGISTRATION.** Fixed before analysis. C3b changes **one operation** and nothing else.
> **No inference is run.** No model session is created; the harness never imports ONNX Runtime.

## The one variable

C3 produced a degradation at large captures that it could not attribute, because capture size moves
two things at once: the label/raster offset and the object scale in model space. C3b isolates the
first by re-inverting the **already-retained raw outputs** two ways and comparing both against the
same DOM ground truth.

| | path A — continuous (current production) | path B — raster-consistent |
|---|---|---|
| source | `computeLetterbox(captureSize, 640)` | `rasterLetterbox(captureSize, 640, padValue)` |
| scale | **uniform** `min(640/w, 640/h)` | **per axis**: `capW / resizedW`, `capH / resizedH` |
| pads | **real-valued** `(640 − w·scale) / 2` | **integer** `floor((640 − resized) / 2)` |
| inverse | `modelToCapture`: `(x − padX) / scale` | `(x − padLeft) · capW / resizedW`, likewise in y |
| clip | `clipToContent` to `[padX, padX + contentW]` | to `[padLeft, padLeft + resizedW]`, likewise in y |

Path B is the transform that matches **where the pixels actually landed**, and it is exactly the
change `docs/architecture/preprocessing-contract.md` §6 prescribes for the labels: *"css_box_to_model
must scale by nw/cap_w and nh/cap_h, not by the uniform s"*. Path A is what production does today,
because the model predicts in the space its **labels** were written in.

Both paths use the **shipped** geometry functions to derive their numbers; path B composes
`rasterLetterbox`'s own integer outputs rather than re-deriving them, so C3b cannot drift from the
shipped rasteriser.

## Held byte-identical between A and B

Everything except the inverse: the same retained `.f32` raw outputs (digest-verified against the C3
logs before use), the same `decodeHeadOutput` and its NMS, the same detection set and emission
order, the same score floor 0.25 and the same frozen 0.55 operating point, the same capture→CSS
scale `viewportCss.w / captureSize.w`, the same sealed per-cell datasets, the same DOM ground truth,
the same frozen evaluator, the same seeds and metadata.

**What is forbidden here, and is absent from the harness:** any ORT import, any session, any
re-inference, any re-render, any re-decode of PNGs, any write under `artifacts/datasets/` or
`artifacts/gates/`, any change to the model, the threshold, the evaluator or the C3 evidence.

## What is measured

Per cell, per view (`op055` primary, `shipped` secondary), for **both** inversions:

- element mAP@0.5, element recall, grounding accuracy — from the frozen evaluator;
- matched count, minimum matched IoU, worst matched CSS displacement — the C3 matcher, reused;
- the **inversion delta**: for every detection, the CSS displacement between its path-A and path-B
  box. This bounds the largest effect the convention can possibly have, independently of any metric.

## Classification rule, fixed in advance

C3b is attribution, not acceptance. It cannot produce a C3 PASS and does not restate C3's criterion.

- **ATTRIBUTED TO LETTERBOX CONVENTION** — switching to path B **closes** the A-versus-control gaps
  C3 measured: the off-grid cells reach the control band on mAP@0.5, ceiling-relative recall and
  grounding.
- **NOT ATTRIBUTED TO LETTERBOX CONVENTION** — path B leaves those gaps in the same direction and of
  the same order, and the per-detection inversion delta is bounded by the arithmetic label/raster
  offset, so the convention is structurally incapable of producing the observed collapse.
- **INCONCLUSIVE** — anything else: a partial closure, a sign change, or a comparison compromised by
  missing or inconsistent evidence.

No new numeric tolerance is introduced. The discriminator is **whether the gap closes**, reported
with the exact numbers on both sides, plus the inversion delta as the physical bound.

## Scale diagnostic, carried over

CSS px per model px is recorded per cell for both paths. C3 found the degradation tracked it
monotonically (1.50, 1.60, 1.98 healthy; 3.00, 3.00, 4.00 collapsed) with a2/a3 matched at 3.00. If
that pattern survives both inversions unchanged, scale remains the live explanation and the
convention does not.

## Expected result

Stated so it can be wrong: the two inversions should differ by **at most a couple of CSS px** —
bounded by the same arithmetic that gives the ≤1.33 CSS px label/raster offset — which cannot move
mAP@0.5 by the ~0.6 C3 observed. The prediction is therefore **NOT ATTRIBUTED**. If path B instead
closes the gaps, that is a genuine surprise and becomes an owner decision, not a retrain trigger.

## What gets committed

The records and the harness, plus `logs/c3b-<cell>.json` and `logs/metrics.json`. No raw tensors are
re-emitted: C3b reads C3's retained dumps and writes only summaries and per-detection deltas.
