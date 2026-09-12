# Track B — decision record

## Verdict

**H-GEOMETRY SUPPORTED**, by the rule frozen in [design.md](design.md) before any cell was
scored. **Measured 2026-09-12 on workstation 1. SYNTHETIC DEV evidence.**

| | |
|---|---|
| **H-GEOMETRY** | **SUPPORTED.** Geometry alone reproduces **72.8%** of NAT's recall degradation, clearing the frozen 70% bar |
| **H-APPEARANCE** | **NOT SUPPORTED as sufficient** — but it is **not negligible**: appearance alone reproduces **56.5%** |
| **H-MIXED** | **NOT SUPPORTED** by the frozen rule, because geometry did clear the bar |
| **H-S1 (stride-8)** | untouched. Still **NOT SUPPORTED**, still not isolated |
| **Detector** | **UNADOPTED.** V1 not used anywhere in Track B, not shipped, not approved |
| **Capture policy** | **NONE.** No scale limit, minimum capture size or deployment boundary is stated or implied |

**The most useful result is not the classification.** It is that geometry and appearance produce
**qualitatively different failures**, which a share number cannot express — see below.

## The two failure modes are different

| | geometry (NAT, GEOM) | appearance (APPR) |
|---|---|---|
| recall 1.5 → 4.0 | **0.853 → 0.013** (collapse) | 0.746 → 0.300 (gradual) |
| predictions/screen | **27.1 → 5.5** — the detector goes **silent** | 33.8 → **34.5** — it keeps firing |
| spurious FP | 99 → 74 | **222 → 431** |
| total FP | 279 → 105 | **447 → 598** |
| onset | **abrupt**, between k=2.5 (0.64) and k=3.0 (0.21) | steady from the start |

Shrinking an object makes the detector **stop emitting**. Blurring it makes the detector **emit at
nothing**. Those are not the same failure at different magnitudes, and reporting only
"72.8% vs 56.5%" would have hidden it.

It is also why the two shares **sum to 115–139%** at every degrading k. Additive causes cannot
exceed 100%; these overlap, so the isolated manipulations are not independent contributions to a
single mechanism.

## What is proven — W1

1. **Geometry is the dominant driver of the recall collapse.** GEOM(k) carries annotations and
   model-space extent **identical** to NAT(k) and differs only in whether the pixels were
   resampled, so the pair isolates appearance at matched geometry. GEOM tracks NAT's collapse
   (0.749 → 0.026) while APPR, at constant healthy extent, still retains 0.300 recall at k=4.
2. **Appearance is a real, substantial secondary effect**, not noise: it costs 0.446 of recall on
   its own, and it is where nearly all of the false-positive growth lives.
3. **Chromium's fractional device scale factor produces a genuinely native raster**, not an
   internal downsample — measured by [probe-dpr.mjs](harness/probe-dpr.mjs): the DPR capture
   differs from every downsample of the DPR-1 capture (26–46% of pixels, maxAbs > 100). Without
   this, the GEOM family would have been NAT with extra steps.
4. **Arm B replicates on independent hardware.** The W1 NAT curve matches the W2 arm-B curve to
   within **±0.0033** — one annotation in 307 — and is **exactly equal at four of eight** k.

## What is NOT proven

1. **Nothing about real websites.** 20 synthetic screens per cell, this project's own generator.
2. **No mechanism.** *Which* property of small objects defeats the detector is not isolated.
   Geometry is where the failure lives; why remains open. **H-S1 is still not supported and still
   not excluded.**
3. **No boundary.** Eight chosen points, not a search for where behaviour changes. The abrupt
   onset between 2.5 and 3.0 is **bracketed, not located**, and "supported up to X" would be
   invented.
4. **GEOM is not a detail-preserving control in the absolute sense.** It is the *best appearance
   obtainable at that extent*; small native text is itself mushy. "Full detail at reduced extent"
   is not physically available, so some appearance loss sits unavoidably inside GEOM — which, if
   anything, means geometry's share here is **overstated** rather than understated.
5. **Nothing about other backends, browsers, realms or machines.** One deterministic wasm path.

## Deviations from the pre-registration, both decided before scoring

1. **The k grid is arm B's**, {1.50 … 4.00}, not the pre-registered {1.00 … 4.00}. The content
   block is 960 CSS px wide, so every k below 1.5 clips it and breaks sanity check 5. Those cells
   are impossible, not merely awkward. The substitution makes NAT arm B's own cells exactly, which
   is why the replication above is even available.
2. **Sanity check 1 is NOT SATISFIABLE** as written. It required the three families to agree at
   the baseline, which holds only at k=1.00. At k=1.50 they genuinely differ (NAT 0.853, GEOM
   0.749, APPR 0.746). Reporting it as "passed" would have been false. The frozen rule measures
   each family's drop from **its own** baseline, so it never depended on that equality; check 1b
   was added to cover what check 1 was actually guarding — that no family starts collapsed.

**One analysis choice was not pre-registered:** restricting the share means to cells where NAT
actually degrades (`degNAT > 0.05`), because below that the ratio divides by roughly zero and
returns 445%. Sensitivity was checked and the conclusion does not depend on it: thresholds of
0.05, 0.10 and 0.20 all give **72.8% / 56.5%**, and restricting to k ≥ 3.0 gives **81.7% / 45.5%**.
Geometry clears the bar under every variant; appearance clears it under none.

## A result that was not expected, and is worth recording

At the mild end, **downsampling beats native small rasterisation**: NAT(1.5) recall **0.853** vs
GEOM(1.5) **0.749**, on identical content at identical model-space extent. The pre-registration
assumed GEOM would be the upper bound. It is not. Whatever antialiasing the downsample performs is
worth about 0.10 of recall to this detector at k=1.5 — the opposite of the design's expectation.

## Not changed

Production decoder, threshold (0.55), `PROVISIONAL_THRESHOLDS` (0.25), model weights, the frozen
TEST split (never opened), the model registry, and every privacy and egress invariant. V1 is not
used anywhere in Track B. No retraining. No capture policy.

## Follow-ups

| id | item |
|---|---|
| **Track B-2** | locate the onset between k=2.5 and k=3.0, *if* a boundary is ever needed. It is **not** needed for adoption and should not be run to manufacture a deployment number |
| **QG-03a item 11** | unchanged and still gating: this is synthetic, and W-A is at step 0 |
| **H-S1** | still not supported, still not isolated. Track B does not close it |
