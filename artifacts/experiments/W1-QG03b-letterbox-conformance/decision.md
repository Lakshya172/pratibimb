---
id: W1-QG03b-decision
spike: QG-03b
verdict: ACCEPT
date: 2026-09-11
decided_by: pratibimb-architect + ml-engineer + browser-engineer + performance-engineer + privacy-security-engineer + evaluation-qa-engineer
---

# QG-03b decision — ACCEPT

## Verdict

**ACCEPT (outcome A of the three the brief defined).** The Python reference path and the
real browser PNG inference path now produce **byte-identical tensors** — not "equivalent
within a tolerance", and not "close enough that the detections look right". Every stage,
every fixture, every cell.

| | |
|---|---|
| Cells conformant | **8 of 8** |
| Fixtures per cell | 15 × 3 runs |
| Stages compared | decoded, resized, letterboxed, tensor |
| Tensor agreement | **bitwise identical** |
| Detection agreement | **100%**, exact counts, worst CSS Δ **1.10e-03 px** |
| Previously | Chromium 74–84%, Firefox 66–78%, worst CSS Δ **98–145 px** |

Outcome **B** was not taken, and it is worth saying why: B would have required a bounded,
irreducible browser difference. There isn't one. The difference was reducible to zero, and
settling for "bounded and probably fine" would have been exactly the move the brief warned
against.

## Root cause

**Not a bug in either implementation.** `letterbox.ts` specified the *geometry* of the fit
and nothing else — no resize rule, no rounding rule, no interpolation kernel, no padding
allocation, no channel order. Two competent implementers read it and produced different
pixels. **A contract that does not determine the bytes is not a contract.**

The divergence was in the **resampling kernel**. PIL's `BILINEAR` is not a 2-tap bilinear
sample when downscaling — the filter widens with the reduction factor. Canvas `drawImage`
is implementation-defined, and the two browsers do not agree with each other either.

**PNG decoding was never involved** — byte-identical in every cell. That had never been
checked, and a decode difference would have invalidated every other diagnosis.

## Authority, and why no retrain is required

The dossier specifies **nothing** about preprocessing — verified, not assumed. So the
authority is derived from **the trained artifact**: the weights encode the rasterisation
they were trained on, which was PIL's.

That makes the direction of the fix a question of cost, and it is not close:

| | |
|---|---|
| browser reproduces PIL | specified arithmetic, a few hundred lines. **No retrain.** |
| Python adopts canvas | **nothing to write down** — canvas has no specification, and differs per browser. Invalidates the artifact. |

So PIL's algorithm is reproduced exactly in `preprocess.ts`, including its 22-bit
fixed-point coefficients, and the contract is written down in
`docs/architecture/preprocessing-contract.md`.

**RETRAINING IS NOT REQUIRED BY THIS WORK.** The artifact is unchanged and still valid.

## The defect this uncovered, which is NOT fixed

The training pipeline is **internally inconsistent**: `data.py` places pixels by the raster
rule, `targets.py` labels them by the continuous rule. **84 of 200 samples (42%)** carry an
offset up to **0.667 model px**, invisible to the loss, to mAP@0.5 and to the micro-overfit
gate.

It **cancels end to end** provided inference rasterises as training did — which it now does.
So it is not producing wrong coordinates today. It is still a defect, because the model's
correctness rests on a coincidence rather than a contract.

**Closing it requires a retrain**, and per the brief that is not started here. The exact code
change and its four consequences are written out in the contract, §6. **It is not worth a
retrain on its own** — the offset already cancels — and should be bundled with QG-03a.

## What this decision does

- ✅ **Closes the QG-03 preprocessing blocker.** Production PNG → tensor now matches the
  reference exactly.
- ✅ **Establishes one authoritative contract**, written down, with the rounding, kernel,
  padding allocation and channel order all specified to the byte.
- ✅ **Adds a conformance suite that names the first diverging stage**, proven by three
  negative controls, and CI-capable without large fixtures.
- ✅ **Records the training-pipeline offset** with its measured exposure and its exact fix.

## What this decision does NOT do

- ❌ **Promote QG-03.** It remains **`CONDITIONAL`**. The cell-specific verdicts stand
  unchanged, including **Firefox WebGPU headless `REJECT`** — reconfirmed 3/3 here.
- ❌ **Adopt the detector.** `model-registry.md` **unchanged**. This closes a correctness
  blocker, not an accuracy one; items 11 and 14 are untouched.
- ❌ **Retrain, or change architecture, stride, capacity, or thresholds.**
- ❌ **Touch the threshold methodology.** The frozen DEV-only rule — max F1(recall,
  grounding), threshold 0.55, not applied to the consumed test split — is unchanged.
  Preprocessing correctness and threshold quality are separate questions and are kept so.
- ❌ **Change `computeLetterbox`.** It stays continuous, because the model predicts in the
  space its labels used. A test now fails if someone "unifies" the two.
- ❌ **Say anything about Firefox on Linux, or about JPEG/WebP captures.**

## Recommendation

1. **Do not retrain for the offset alone.** Bundle QG-03b-1 with QG-03a's resampler
   robustness work, and re-freeze the regression baseline deliberately in that change.
2. **QG-03b-2 next if capture format is not settled** — `captureVisibleTab` can return JPEG
   or WebP, decoding is lossy, and only PNG was measured.
3. **Do not treat 19–24 ms preprocessing as free.** It sits at the dossier's 18 ms budget on
   Chromium and 20–30% over on Firefox. Optimise only if the end-to-end budget demands it;
   any change must stay byte-exact.
4. **Treat Pillow as a dependency of the contract.** If it changes its resampler, the
   conformance suite fails — that is intended, and the coefficients are written out in the
   contract so the change can be evaluated rather than absorbed.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| QG-03b-1 | Close the label/pixel offset in the training pipeline (needs a retrain) | **p1** | bundle with QG-03a |
| QG-03b-2 | Conformance for **JPEG/WebP** captures, where decoding is lossy | **p1** | production capture formats |
| QG-03b-3 | Preprocessing 19–24 ms against an 18 ms budget — WASM/SIMD warranted? | p2 | latency budget |
| QG-03b-4 | Pillow is now a contract dependency; behaviour on a resampler change | p2 | contract stability |

## Registry effect

- `agentos/registry/feasibility-matrix.md` — **EDITED**, UI element detector row annotated:
  the preprocessing blocker is closed, the cell verdicts are unchanged.
- `agentos/registry/model-registry.md` — **UNCHANGED.**
- `docs/architecture/preprocessing-contract.md` — **NEW**, authoritative.
- `docs/architecture/coordinate-contract.md`, `docs/security/security-invariants.md`,
  `artifacts/adr/ADR-0001/` — **UNCHANGED.**
- `packages/perception/src/letterbox.ts` — **UNCHANGED**, deliberately, and now guarded.

> The matrix annotation is the only registry change in this PR, and it is visible in the diff.
