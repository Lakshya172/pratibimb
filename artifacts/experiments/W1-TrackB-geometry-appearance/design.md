---
id: W1-TrackB-geometry-appearance-design
title: "Track B — geometry vs appearance attribution: PRE-REGISTRATION"
status: pre-registered (NOT EXECUTED)
date: 2026-09-12
workstation: 1 (LAPTOP-6E14K34L)
depends_on: PR #52 (spike/w1-detector-precision-scale) — NOT MERGED
---

# Track B — separating geometry from appearance

> **PRE-REGISTRATION ONLY. NOTHING HAS BEEN SCORED.** This is written *before* any cell is
> rendered, so the result can disagree with it. Execution is **BLOCKED** on PR #52 landing —
> see "Dependency", which is a governance gate, not an engineering one.

## The question W-1 arm B left open

Arm B (workstation 2, PR #52) established that **scale degrades the detector** with the ground
truth held byte-identical: recall peaks at **1.75** CSS px per model px and falls to **0.0163**
at 4.00. It closed two doors — the **emptiness control was exonerated** (tiling the frame
reproduces the collapse to within 0.0375 recall), and **H-S1 (stride-8) is NOT SUPPORTED** as the
mechanism.

What it could not say is *why*, because a natural scale change moves two things at once:

| | changes with scale |
|---|---|
| **geometry** | each object's extent in model pixels shrinks |
| **appearance** | the frame is downsampled, so edges, strokes and glyphs lose detail |

Arm B's own strongest hint is that geometry alone is **not** sufficient: recall varies by
**0.839** *within* a fixed 8–16 model-px band — at least one whole stride-8 cell. Objects of the
same model-space extent behave completely differently depending on how they got there. That is
evidence against a pure-geometry account, and it is why this experiment exists.

## Hypotheses — none assumed

| id | statement |
|---|---|
| **H-GEOMETRY** | The loss is primarily explained by reduced object extent in model space |
| **H-APPEARANCE** | The loss is primarily explained by visual detail lost to downsampling |
| **H-MIXED** | Neither isolated factor sufficiently explains the observed behaviour |

## The design — three families over one substrate

Arm B's substrate is reused **exactly**: one fixed **960x640 CSS content block** at the viewport
origin, inside an `overflow:hidden` iframe so its internal layout cannot reflow. Labels come from
the rendered document via `getBoundingClientRect`, never from the generator. The block always
fits, so every annotation is `VISIBLE` and the CLIPPED ceiling is **1.0**.

Only the *capture* path differs between families. The insight that makes this cheap: the browser
can be asked to **rasterise natively at the smaller size** by lowering the device scale factor,
which produces reduced extent with **no resampling at all**.

| family | viewport (CSS) | DPR | capture px | object extent | detail |
|---|---|---|---|---|---|
| **NAT(k)** — natural | k x 640 wide | 1 | k x 640 | **/k** | **degraded** (downsampled to 640) |
| **GEOM(k)** — geometry only | k x 640 wide | **1/k** | 640 | **/k** | **sharp** (native raster, no resize) |
| **APPR(k)** — appearance only | 960 wide (the k=1.5 baseline) | 1 | 960 | **unchanged** | **degraded** (640/k round trip) |

- **NAT(k)** is arm B's existing cell, unchanged.
- **GEOM(k)** shares NAT(k)'s viewport and content, so its **CSS annotations and its model-space
  extents are identical to NAT(k)'s**. The pair differs in exactly one thing: whether the pixels
  were resampled. This is the decisive comparison.
- **APPR(k)** holds extent at the healthy baseline and destroys detail by a deterministic
  downsample-to-`round(640/k)`-then-upsample-back-to-640 round trip, in image space, with a fixed
  kernel. Its **ground truth is byte-identical across all k**, exactly as arm B's was.

### Cells — 24

k in **{1.00, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00}** x 3 families = **24 cells**. The k
values bracket arm B's measured peak (1.75) and its collapse (4.00). Samples per cell and the
seed policy are inherited from arm B unchanged. **No factorial expansion beyond this.**

### Recorded per cell, exactly

Source viewport (CSS), device scale factor, capture size in px, any downsample target and the
upsample back, the resampling kernel, effective object extent in model px (recomputed, never
assumed), CSS px per model px, letterbox geometry, dataset identity, frame digest.

## Locked before scoring

| | |
|---|---|
| dataset | `t1-ui-rendered@4bbc57de`, **dev split only** |
| model | `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`, 302,960 B |
| runtime | ORT **1.29.0**, wasm, `numThreads 1`, proxy false; pin `db816fad...` |
| evaluator | PR #52's `w1-guards.mjs` at `043618a`, **unmodified** |
| operating point | **0.55**, unchanged |
| decode | the shipped `decodeHeadOutput`, per-class NMS **0.50** — the production decode, **not V1** |
| input geometry | 640x640 letterbox, `padValue` unchanged |

**V0 is used, deliberately.** Track B asks what scale does to *the detector as it ships*. Running
it under an unadopted candidate decode would answer a question about V1 instead.

## Metrics

mAP@0.5 · recall · grounding · **matched-IoU p10, p25 and median** · normalised displacement ·
predictions per screen. Existing evaluator definitions only.

**The earlier defective min-IoU statistic is not used**, and no metric will be added after seeing
results. Stratification, where the existing evaluator already supports it: by object size band,
by condition, and by false-positive category.

## Interpretation rules — fixed in advance

Let the degradation of a family at k be its drop from that family's own k = 1.00 cell, in the
primary metric (recall).

| observation | conclusion |
|---|---|
| GEOM(k) tracks NAT(k) across k, and APPR(k) stays near baseline | **H-GEOMETRY SUPPORTED** |
| GEOM(k) stays near baseline while NAT(k) collapses, and APPR(k) collapses like NAT(k) | **H-APPEARANCE SUPPORTED** |
| Neither GEOM nor APPR alone reproduces most of NAT's collapse | **H-MIXED** — interaction; neither sufficient |
| Families disagree in direction, or the k = 1.00 cells disagree | **INCONCLUSIVE** — design fault, not a finding |

"Reproduces most of" is fixed here as **at least 70% of NAT's degradation at the same k**, so the
threshold cannot be chosen after the fact. A family reproducing between 30% and 70% is reported
as a **partial contribution**, not as the mechanism.

## Sanity checks that must pass, or the run is void

1. The three families' **k = 1.00 cells must agree** — they are the same picture by construction.
2. **GEOM(k) and NAT(k) must carry identical CSS annotations** at every k.
3. **APPR(k)'s annotations must be byte-identical across all k.**
4. Recomputed model-space extent must equal the pre-registered value for every cell.
5. The CLIPPED ceiling must be **1.0** in every cell.

## What this experiment cannot do

- **It cannot produce a deployment limit.** The ~2.0 CSS px per model px region is **not** a
  capture policy, a minimum capture size, or a maximum scale, and no such number will be
  published from it. Capture policy is a separate product decision with its own gate.
- **It cannot say anything about real websites.** Synthetic content, this project's own generator.
- **It cannot justify retraining.** Attribution is not a capability failure.
- **It cannot close adoption item 11**, which is a real-data question.

## Not changed by this experiment

Production decoder, threshold, model weights, `PROVISIONAL_THRESHOLDS`, the frozen TEST split
(never opened), the model registry, and every privacy and egress invariant.

## Dependency — why this is not yet executed

The governed harness (`w1-guards.mjs`, `render-arm-b.mjs`, `decode-w1-png.py`, and the metric and
taxonomy definitions) exists **only in PR #52**, which is open and unmerged. That harness is
self-contained — it imports nothing from `packages/` — so rebuilding Track B on `main` would mean
**reimplementing the evaluator**, producing exactly the divergent duplicate this project should
not have.

**Status: OWNER MERGE REQUIRED on PR #52.** It is `MERGEABLE`, `CLEAN`, 9/9 checks green, and no
blocking defect was found in the landing audit. Once it lands, this design runs against it
unmodified.
