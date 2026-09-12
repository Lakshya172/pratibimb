# QG-03a-C3b — decision record

## Verdict

**C3b = NOT ATTRIBUTED TO LETTERBOX CONVENTION** — measured 2026-09-12 on workstation 2, 6 cells,
120 samples, **no inference run**.

| | |
|---|---|
| **C3b** | **COMPLETE.** C3's retained raw outputs, digest-verified, decoded once, inverted two ways |
| **Attribution** | the label/raster inverse convention **does not explain** C3's degradation |
| **QG-03a-C3** | **INCONCLUSIVE** — unchanged; C3b removed a candidate cause, it did not create a pass |
| **QG-03a-C** | **CONDITIONAL** — unchanged |
| **Retraining** | **NOT JUSTIFIED.** Not performed; no weights were loaded |
| **Detector** | **UNADOPTED**, threshold **0.55**, artifact `ba6d9e93…` untouched |

## The evidence, in the order that matters

1. **The decisive observation: the two most collapsed cells have an inversion delta of exactly
   zero.** At 1920×1080 and 2560×1600 the capture scales to integer content (640×360 and 640×400),
   so `computeLetterbox` and `rasterLetterbox` are the *same transform*, and both paths produce
   byte-identical boxes — yet a3 scores mAP@0.5 **0.0617** and a4 **0.0040** against controls at
   0.599–0.661. A transform that is provably identical cannot be the cause of a difference. No
   threshold was needed to reach this.
2. **Where the conventions differ most, the effect is negligible.** a2 (2880×1443 at DPR 1.5) carries
   the largest delta, **1.998 CSS px**, and switching to the raster inverse moves mAP@0.5 by
   **+0.0011** — roughly 0.2% of its −0.54 gap to the controls.
3. **No gap closed**, in either view, for any off-grid cell.
4. **The scale pattern is untouched by the switch**: 1.50 → 0.599, 1.60 → 0.661, 1.98 → 0.665/0.676,
   3.00 → 0.061/0.062, 4.00 → 0.004 CSS px per model px.

The delta is bounded at 1.998 CSS px across all 120 samples, consistent with the ≤1.33 CSS px
arithmetic offset recorded in C and the per-axis anisotropy the raster convention introduces
(a2: 4.5 vs 4.495327; a1: 1.975 vs 1.975309; b1: 1.5 vs 1.498829).

## Incidental finding, explicitly not a recommendation

Where the conventions differ on real UI content the raster inverse is marginally better (a1 +0.0117
mAP, +0.0126 recall, +0.0104 grounding, 5 more matched; a2 +0.0011) and marginally worse on b1
(−0.0003 mAP). Mixed and tiny. **This is not a reason to change `computeLetterbox`**: the model
predicts in the space its labels were written in, the contract warns that changing the inverse moves
every emitted detection, and a ~0.01 mAP wobble on synthetic data does not justify touching a frozen
coordinate transform. Recorded so nobody has to re-measure it.

## What this means for QG-03a-C

The candidate cause C3 raised is **eliminated**. The §6 label/raster mismatch remains exactly what
`docs/architecture/preprocessing-contract.md` §6 and QG-03a-C already concluded — **bounded,
metric-neutral, end-to-end cancelling, recorded technical debt** — and there is now direct
measurement on the real artifact, at off-grid geometries, saying the inverse convention is not
producing wrong coordinates.

**What is still open is not C's subject:** the detector is **scale-fragile beyond roughly 2 CSS px
per model px**. That belongs to adoption items 11/14 and capture policy.

So closing QG-03a-C is now a **judgement call the owner can make on the evidence**, rather than a
measurement gap:

- **Option 1 — close C as CONDITIONAL-resolved**, on the grounds that the mismatch is measured
  harmless in production geometry (C2 worst case, B2/B3-1 at production capture sizes, and C3b's
  direct attribution), with §6 kept as standing debt to bundle with any future training change.
- **Option 2 — keep C CONDITIONAL** until a training revision happens anyway, since the one
  remaining unknown (the effect on training *dynamics*) can only be measured by retraining, which is
  not justified on its own.

Either way **no retraining is justified by C3 or C3b**, and neither closes QG-03a.

## What is NOT done

- No inference, no session, no weights loaded; the harness contains no ORT import at all.
- No retraining, relabelling, threshold, evaluator or CLIPPED change.
- C3's retained raw outputs were read and digest-verified, never regenerated or replaced.
- `artifacts/datasets/`, `artifacts/gates/`, the frozen QG-05 dataset and the consumed held-out split
  were never read or written.
- No new numeric tolerance; C3's criterion was not restated or reinterpreted; C3 is still
  INCONCLUSIVE.

## Follow-ups

| id | item |
|---|---|
| **QG-03a-C closure** | owner decision between Option 1 and Option 2 above. No further measurement is required for the convention question |
| **detector scale fragility** | collapse beyond ~2 CSS px per model px — adoption items 11/14 and capture policy, not QG-03a-C |
| ~~QG-03a-C3b~~ | **done.** The convention is exonerated; C3c (scale-controlled cells) is no longer needed to answer *this* question |
