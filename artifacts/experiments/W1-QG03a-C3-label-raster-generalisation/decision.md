# QG-03a-C3 — decision record

## Verdict

**C3 = INCONCLUSIVE / DECISION REQUIRED** — measured 2026-09-12 on workstation 2, all six cells,
120 samples, nothing dropped.

| | |
|---|---|
| **C3 measurement** | **COMPLETE.** 6 cells x 20 samples, exact artifact, shipped path, frozen evaluator |
| **C3 verdict** | **INCONCLUSIVE / DECISION REQUIRED** — see why below |
| **QG-03a-C** | **CONDITIONAL** — unchanged |
| **Retraining** | **NOT JUSTIFIED by this result**, and not performed. Still not approved |
| **Detector** | **UNADOPTED**, threshold **0.55**, artifact `ba6d9e93…` untouched |
| **QG-03a / QG-03** | **OPEN / CONDITIONAL** — unchanged |

## Why INCONCLUSIVE, precisely

Not because a number landed near a boundary. Because **the pre-registered design cannot attribute
the effect it measured**. Changing the capture size changes two things at once:

1. the label/raster offset (what C3 is about) — at most **1.33 CSS px**, and
2. the object scale in model space (what C3 accidentally varied) — from **1.50 to 4.00 CSS px per
   model px**.

The measured degradation tracks (2), monotonically. The decisive internal control is **a2 versus
a3**: capture 2880x1443 at DPR 1.5 versus 1920x1080 at DPR 1 — different sizes, different DPR,
different label/raster offsets — but the **same 3.00 CSS px per model px**, and near-identical
scores (mAP@0.5 0.0608 vs 0.0617; recall 0.153 vs 0.193). A sub-1.33 CSS px label offset cannot
move mAP@0.5 from 0.66 to 0.004; a 14 CSS px control shrinking from ~9 to ~3.5 model px, below the
stride-8 feature cell, can.

By the pre-registered comparator rule this is also **not a PASS**: three of the four A cells are
worse than the worst control on mAP, ceiling-relative recall and grounding. It is **not a FAIL**
either: no minimum matched IoU fell to 0.5 or below, and no metric collapsed to zero on the cells at
training-like scale. So it escalates, as the rule says it must.

## What the result does establish

**At a capture size off the training grid but at training-like scale, the learned nuisance mapping
holds.** Cell `a1` (1264x800 — the production capture size of the QG-03b-2a fixtures) scores
**better** than both controls on mAP@0.5 (0.6647 vs 0.5993/0.6610) and grounding (0.6396 vs
0.4933/0.5645), with ceiling-relative recall 0.021 lower. Being off the grid is not, by itself,
harmful.

## Two harness metrics did not work, and are recorded as such

`minMatchedIou` and `worstMatchedDispCss` are computed over pairs the matcher already gated at
IoU >= 0.5. The minimum is therefore pinned just above 0.5 by construction (0.5008-0.5823 across
every cell, controls included), and the worst displacement is dominated by large elements matching
loosely — **134-144 CSS px on the training-size controls themselves**. Neither statistic is
comparable to C2's 0.681 model px and 0.869 IoU, which measured label-versus-pixel geometry rather
than prediction-versus-label error.

Consequence: the approved criterion's clause *"IoU stays well above 0.5 for the smallest controls"*
**could not be evaluated** by this harness. No replacement statistic was invented, because inventing
one is exactly what the governance rules forbid. A future attribution test should measure the IoU
distribution of *matched* pairs, or displacement relative to element size, and pre-register it.

## What is NOT done

- No retraining, no relabelling, no threshold change, no per-class thresholds, no sweep.
- The evaluator is untouched, **including the CLIPPED definition**; its ceiling (0.926-0.962 per
  cell) is reported and recall is read against it.
- The consumed QG-05 held-out split, the 200-sample training dataset and everything under
  `artifacts/datasets/` and `artifacts/gates/` were never read or written.
- The detector artifact, the registry and adoption status are unchanged.
- No numeric acceptance tolerance was invented, and the approved criterion was not modified.
- No sample was dropped after the fact, and the cell list was fixed before the first render.

## Recommended owner decision

1. **Do not retrain on this evidence.** It does not show the §6 convention causing a
   production-visible failure, and the §6 relabel would not change the scale behaviour.
2. **Approve one of the two attribution designs** if QG-03a-C is to be closed on measurement rather
   than on judgement:
   - **C3b (cheapest, no new inference):** re-invert the **already-dumped** raw outputs with the
     **raster** transform instead of the continuous one, on the same frames, and compare which
     agrees better with the DOM labels. This isolates the convention exactly, because everything
     else is held byte-identical.
   - **C3c (scale-controlled):** capture sizes off the training grid chosen so CSS-px-per-model-px
     stays training-like (~1.5-2.0) while the label/raster offset varies, with the IoU statistic
     pre-registered properly.
3. **Separately, note a product-relevant finding that is not C's business:** the detector is
   **scale-fragile** beyond ~2 CSS px per model px. That belongs to adoption items 11/14 and to
   capture-policy work, not to QG-03a-C, and it is recorded here only because C3 measured it.

## Follow-ups

**Update 2026-09-12 — C3b answered the attribution question.** The retained raw outputs were
re-inverted with the raster-consistent transform, on identical inputs and with no inference:
**NOT ATTRIBUTED TO LETTERBOX CONVENTION**. The two most collapsed cells (1920x1080, 2560x1600) have
an inversion delta of **exactly zero**, because at those geometries the continuous and raster
letterboxes are the same transform; where the delta is largest (1.998 CSS px) the switch moves
mAP@0.5 by +0.0011. The convention is eliminated as the cause, and **retraining stays unjustified**.
Evidence: `../W1-QG03a-C3b-letterbox-inverse-attribution/`.

| id | item |
|---|---|
| ~~**QG-03a-C3b**~~ | **DONE 2026-09-12 — NOT ATTRIBUTED.** See `../W1-QG03a-C3b-letterbox-inverse-attribution/decision.md` |
| ~~**QG-03a-C3c**~~ | **no longer needed for the convention question**, which C3b settled. A scale-controlled set would now be measuring scale, which is not QG-03a-C business |
| ~~**QG-03a-C**~~ | **DECIDED 2026-09-12 (owner decision, ronitsaha11) — `RESOLVED / CONDITIONAL-RESOLVED`** on C3b's attribution plus the standing §6 debt record. The geometry concern is closed as **no demonstrated production defect**; the mismatch is **not fixed**, stays technical debt, and **QG-03a stays `OPEN`**. This document's verdict (`INCONCLUSIVE / DECISION REQUIRED`) is **unchanged** |
| **detector scale fragility** | collapse beyond ~2 CSS px per model px — for adoption items 11/14, not for C |
