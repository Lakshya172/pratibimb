---
id: W1-QG03b-agentos-review
workstream: QG-03b — letterbox reconciliation and preprocessing conformance
date: 2026-09-11
branch: feature/qg03b-letterbox-conformance
---

# QG-03b — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author.
> **Not a transcript of independent agents** and not presented as one.

---

## `pratibimb-architect` — L1

**Status: `PASS`.**

### Is the contract actually authoritative now?

**PASS.** The decisive move was checking whether the dossier specifies preprocessing at all
— it does not, and that was *verified by search* rather than assumed. Naming the authority
explicitly (the trained artifact, because the weights encode the rasterisation) is what makes
the rest of the reasoning auditable. A document claiming "the dossier requires X" when it
does not is worse than no document.

`docs/architecture/preprocessing-contract.md` determines the bytes: rounding rule, tap
window, coefficient quantisation, pass order, padding allocation, fill value, channel order,
normalisation, layout. **Two implementers reading it cannot now diverge**, which is precisely
the failure it replaces.

### Two letterboxes — is that a smell?

**Reviewed specifically, and no.** `computeLetterbox` (continuous) and `rasterLetterbox`
(integer) look like duplication and are not: one is a coordinate transform, the other a
rasterisation rule, and *you cannot draw two-thirds of a row of pixels*. The model predicts
in the space its labels used, so unifying them would move every emitted box.

The risk is that a future reader "tidies" them together. That risk is now a **failing test**
plus §4 of the contract. Correct handling.

### Boundaries

**PASS.** Entirely T1. No T2, no D3, no D4, no server. `preprocess.ts` takes *decoded pixels*
and has no canvas, DOM or filesystem dependency, so the package stays pure and the
`trainingBoundary` rule is untouched. **No new runtime dependency** — the resampler is
written out rather than pulled in, which was an explicit constraint.

### Registry discipline

**PASS.** `feasibility-matrix.md` annotated; `model-registry.md` untouched; the QG-03 README
amended with a resolution note that **preserves the original measurement verbatim**. The
decision states all three and the diff shows all three.

---

## `ml-engineer` — L2, blocking on whether a retrain is required

**Status: `PASS`. Retraining is NOT required by this work.**

### Is the authority argument sound?

**Yes.** The weights encode the training rasterisation. The alternative — changing Python to
match the browser — has nothing to write down, because canvas `drawImage` has no
specification and the two engines were measured disagreeing with each other. So the
direction is forced, not chosen for convenience.

### Is the artifact still valid?

**Yes, and this is the load-bearing conclusion.** `data.py` is unchanged. The trained model
sees exactly the tensors it was trained to see. The browser now produces those tensors
bit-for-bit. Detection agreement went 74%/66% → **100% with exact counts**, worst CSS delta
**1.10e-03 px**.

### The defect that was found but not asked about

**Correctly surfaced and correctly not fixed.** The training pipeline labels by the
continuous rule and rasterises by the integer one — **84 of 200 samples, up to 0.667 model
px**, invisible to the loss, to mAP@0.5 and to the micro-overfit gate because a sub-pixel
constant offset is far inside IoU 0.5.

Two things are right about the handling:

1. **It is not presented as producing wrong coordinates today.** It cancels end to end
   provided inference rasterises as training did, which it now does. Overstating it would
   have been easy and wrong.
2. **The expected benefit of fixing it is stated as unmeasured.** The contract says so
   explicitly rather than implying a gain. Fixing it costs a retrain and a baseline
   re-freeze; bundling it with QG-03a is the right call.

### Threshold methodology

**PASS — untouched, and deliberately kept separate.** The frozen DEV-only rule (max
F1(recall, grounding), 0.55, not applied to the consumed test split) is unchanged. No
threshold was re-picked, and the test split was not reopened. Preprocessing correctness and
threshold quality are different questions and the PR does not conflate them.

### Remaining ML blocker

**QG-03a is untouched.** `augmentation: "none"` — the model has still only ever seen one
resampler's output. Byte-exactness makes the production path *correct*; it does not make the
model *robust*. Adoption items 11 and 14 are unaffected.

---

## `browser-engineer` — L2

**Status: `PASS`.**

### Was the browser pixel pipeline actually measured?

**Yes, and stage-isolated.** The critical design decision is decoding **at native size** —
the canvas then performs no resampling, so what comes back is the decoder's output and
nothing else. That makes "PNG decode is byte-identical to PIL" a real finding rather than an
assumption, and it had never been checked: QG-03 compared only final tensors, where a decode
difference is invisible.

### Canvas

**PASS, and the control is what makes the conclusion defensible.** The old path was run on
the *same decoded pixels in the same run*, at both quality settings. Results:

- Canvas matched the reference on **exactly two fixtures** — a 640×640 source and a 1×1
  upscale to flat colour. **Both are cases where nothing is actually resampled.**
- Worst pixel divergence **99** (Chromium) and **148** (Firefox) out of 255.
- **Firefox's low and high figures are bit-identical** — `imageSmoothingQuality` is ignored
  outright, confirmed independently here after being observed in QG-03.

That is sufficient to conclude canvas is the wrong primitive, rather than a mis-tuned one.

### The reimplementation

**PASS.** The subtle parts are the ones most likely to be got wrong and they are called out
in the source: `floor` not `round` despite the `+ 0.5` (a C truncation inside a cast); the
filter *widening* with the reduction factor, so PIL's "bilinear" downscale is not a 2-tap
sample; horizontal pass first, observable because each pass quantises to 8 bits.

All three were verified by negative control, not by inspection.

### Cross-browser discipline

**PASS.** Eight cells, never merged. **Firefox WebGPU headless stays `REJECT`** and was
reconfirmed 3/3 — not quietly dropped because this experiment happened to pass there on the
CPU path. Firefox on Linux untouched and still `UNKNOWN`.

### One design decision worth crediting

The probe originally wrapped conformance and inference in a single `try`. That would have
made the Firefox WebGPU headless cell discard its conformance data on an ORT failure —
losing the measurement the experiment exists for, in the one cell most likely to fail.
Separating them was the right fix and the cell returned complete data.

---

## `performance-engineer` — L2

**Status: `CONDITIONAL_PASS`.**

### Does the fix violate the lightweight constraint?

**It did, and that was caught rather than shipped.** The first implementation cost **48.7 ms
p50** on a 1152×800 frame — **2.7× the dossier's 18 ms budget for capture + downscale**.

After two changes: **17.3–24 ms p50** across all eight cells.

Both changes are **exact, not approximating**:

1. `clip8` by reciprocal multiply — the divisor is `2^22`, so the reciprocal is exact in
   IEEE-754 and `| 0` truncates, which equals floor for a non-negative accumulator.
2. Row-wise accumulation in the vertical pass, taps in the outer loop — the naive ordering
   strides `srcW · 3` bytes per tap and misses cache on every access.

**Both were re-verified against the byte-for-byte suite.** A faster path that changed one
output byte would be a regression wearing an optimisation's clothes.

### The honest reading of the figure

**At budget on Chromium (19–20 ms), 20–30% over on Firefox (21–24 ms).** Reported as a
measurement, not a pass. PNG decoding (9–20 ms) is timed **separately**, correctly — the
capture consumer pays it either way and folding it in would overstate this module's cost.

### Why CONDITIONAL

Preprocessing is not free and now sits at the budget line. The dossier's 18 ms was for
"capture + downscale" *together*, so the real end-to-end figure is decode + preprocess =
**28–44 ms**, which is over. That is recorded as **QG-03b-3** rather than optimised
speculatively — the brief said characterise, and the end-to-end budget has not been assembled
yet. But it should not be described as comfortably inside anything.

### Memory

No new allocation of consequence: two intermediate RGB buffers and one Float64 row
accumulator. Nothing approaching the 26.4 MB ORT arena.

---

## `privacy-security-engineer` — L1, blocking

**Status: `PASS`.**

| Invariant | Result |
|---|---|
| ADR-0001 preserved | **PASS** — untouched; the harness *uses* the shipped pin module |
| G5 | **PASS** — `preprocess.ts` imports no `node:fs`, no network, no canvas; it takes decoded pixels |
| No new dependency | **PASS** — the resampler is written out rather than pulled in. This was an explicit constraint and it is the one a "just add a resize library" instinct would have broken |
| No network path | **PASS** — no fetch anywhere in the new module; harness `connect-src` pinned to loopback |
| No runtime model download | **PASS** — model inlined; unchanged from QG-03 |
| No arbitrary WASM, no `eval` | **PASS** — none added |
| No server, no T2, no D3/D4 | **PASS** — absent entirely |
| Secrets, PII, weights in git | **PASS** — `verify-repo` 0 failures, 0 warnings; ~100 MB of reference dumps gitignored |
| QG-04 | **UNSIGNED**, unchanged |
| B-02 | **OPEN**, unchanged |

### One note

The committed evidence is **digests only** — no pixel dumps, no model. The CI-capable test
regenerates fixtures from a seed, so the byte-level guard runs without shipping any binary.
That is the right shape for a repository that bans large binaries.

---

## `evaluation-qa-engineer` — L2

**Status: `PASS`.**

### Do the guards fire?

**Three negative controls, all fired, each naming the correct stage:**

| mutation | reported |
|---|---|
| `PRECISION_BITS` 22 → 21 | `RESIZE diverges — the resampling kernel disagrees with PIL` |
| `floor` → `round` on the pad offset | `PADDING diverges — placement or fill byte disagrees` |
| vertical pass before horizontal | `RESIZE diverges` |

Restoring the file returned the suite to green. **The stage attribution works**, which is the
whole point — QG-03 could only report that tensors differed.

### Does the suite cover what the brief asked?

fractional resize ✅ · integer resize ✅ · odd padding ✅ · symmetric/asymmetric padding ✅ ·
interpolation ✅ · RGB/RGBA conversion ✅ · normalisation ✅ · channel ordering ✅ · tensor
shape ✅ · deterministic preprocessing ✅ · Python/browser equivalence ✅.

Plus two the brief did not name and which matter: **`Math.round` vs Python `round()`** on
every fixture extent (they differ on exact `.5`, and the test fails rather than the tensor
shifting a row), and a guard that **`computeLetterbox` is not unified** with the rasteriser.

### Will it catch the *same kind* of silent disagreement again?

**Yes, and that was the explicit requirement.** A test asserting "both produce 640×640" would
have passed throughout the original defect. These compare bytes, stage by stage, and the
CI-capable half runs with no generated files so it cannot skip where it matters.

### Two test-quality defects, self-inflicted and fixed

1. `expect()` inside million-iteration loops made two tests exceed the default 5 s timeout —
   a **timeout masquerading as a determinism failure**. Replaced with plain loops and one
   assertion.
2. A float32 tensor value compared against a float64 literal at 12 decimal places. That was a
   test bug, not a finding, and is now compared via `Math.fround`.

Both were caught by running under the real `npm run verify` budget rather than a generous
local one.

### Discipline

**The already-consumed test split was not reopened. No threshold was re-picked. No QG-03
cell verdict was promoted.** The one gate status that changed is the preprocessing blocker,
and QG-03 itself remains `CONDITIONAL`.

---

## Summary

| Agent | Verdict |
|---|---|
| `pratibimb-architect` | `PASS` |
| `ml-engineer` | `PASS` — **no retrain required** |
| `browser-engineer` | `PASS` |
| `performance-engineer` | `CONDITIONAL_PASS` — at budget on Chromium, over on Firefox; decode + preprocess together exceeds it |
| `privacy-security-engineer` | `PASS` |
| `evaluation-qa-engineer` | `PASS` |

**No agent recommends retraining in this task. No agent recommends adopting the detector.**
The remaining adoption blockers are unchanged: **QG-03a** (resampler robustness) and items
11/14 (acceptable metrics, usable grounding).
