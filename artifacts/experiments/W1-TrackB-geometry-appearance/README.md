---
id: W1-TrackB-geometry-appearance
title: "Track B — geometry vs appearance attribution"
status: recorded
date: 2026-09-12
label: FACT (measurements) / INFERENCE (attribution)
verdict: H-GEOMETRY SUPPORTED
workstation: 1 (LAPTOP-6E14K34L)
---

# Track B — geometry vs appearance

> **EXECUTED on workstation 1, 2026-09-12. SYNTHETIC DEV evidence.**
> **H-GEOMETRY SUPPORTED** by the frozen rule: geometry alone reproduces **72.8%** of the recall
> degradation, appearance alone **56.5%**. But the shares **sum to 115–139%**, and the two produce
> **qualitatively different failures** — geometry makes the detector go *silent* (27.1 → 5.5
> predictions/screen), appearance makes it *fire at nothing* (spurious FP 222 → 431). See
> [decision.md](decision.md). **No capture policy. Detector still UNADOPTED.**

W-1 arm B proved scale degrades the detector and ruled out two explanations — frame emptiness
(exonerated by a tiling control) and stride-8 (**H-S1 NOT SUPPORTED**). It could not say *why*,
because a natural scale change moves object **geometry** and image **appearance** together.

The full design, with the locked configuration and the interpretation rules, is in
[design.md](design.md).

## Hypothesis

- **H-GEOMETRY** — the loss is primarily reduced object extent in model space.
- **H-APPEARANCE** — the loss is primarily visual detail destroyed by downsampling.
- **H-MIXED** — neither isolated factor sufficiently explains it.

None is assumed. Arm B already supplies evidence against a pure-geometry account: recall varies
by **0.839** *within* a fixed 8–16 model-px band, so extent alone does not determine the outcome.

## Expected result

Stated before running, so the outcome could disagree with it: **H-MIXED**, with appearance
carrying more of the degradation than geometry.

**It disagreed.** Geometry carried more, and cleared the frozen bar on its own. The prediction was
wrong in both parts and is left here rather than quietly revised.

## Environment

Workstation 1 (`LAPTOP-6E14K34L`), Intel Core 7 240H, Windows 11 build 26200. Dataset
`t1-ui-rendered@4bbc57de`, **dev split only**. Model `ba6d9e93…`, 302,960 B. ORT **1.29.0**, wasm,
`numThreads 1`. Evaluator: PR #52's `w1-guards.mjs` at `043618a`, unmodified. Operating point
**0.55**, shipped decode (per-class NMS 0.50) — **not V1**.

## Actual result

24 cells, 20 samples each, 480 frames, 307 annotations per cell, CLIPPED ceiling 1.0 everywhere.

| recall | k=1.5 | 1.75 | 2.0 | 2.25 | 2.5 | 3.0 | 3.5 | 4.0 |
|---|---|---|---|---|---|---|---|---|
| **NAT** | 0.853 | 0.896 | 0.870 | 0.818 | 0.642 | 0.205 | 0.026 | **0.013** |
| **GEOM** | 0.749 | 0.827 | 0.762 | 0.762 | 0.652 | 0.251 | 0.068 | **0.026** |
| **APPR** | 0.746 | 0.671 | 0.590 | 0.586 | 0.557 | 0.498 | 0.371 | **0.300** |

Mean share of NAT's degradation, over the cells where NAT actually degrades: **GEOM 72.8%**
(clears the frozen 70% bar), **APPR 56.5%** (partial contribution). Full table and the
per-k shares are in [logs/trackb-analysis.json](logs/trackb-analysis.json).

## Conclusion

**H-GEOMETRY SUPPORTED. H-APPEARANCE NOT SUPPORTED as sufficient, but substantial (56.5%).
H-MIXED NOT SUPPORTED** by the frozen rule, because geometry cleared the bar.

Read the classification together with the caveat that the shares overlap heavily and the two
failure modes are qualitatively different — the rule answers "is one of them sufficient", which
is not the same question as "is only one of them happening".

The ~2.0 CSS px per model px region remains **not** a deployment limit, **not** a minimum capture
size, and **not** a capture policy. Nothing here changes the production decoder, threshold, model
weights, the frozen TEST split, or any privacy or egress invariant.

## Reproducibility

Once PR #52 lands, the design runs against its harness unmodified. Three families over arm B's
existing substrate, distinguished only by the capture path:

| family | viewport | DPR | extent | detail |
|---|---|---|---|---|
| NAT(k) | k × 640 | 1 | /k | degraded |
| GEOM(k) | k × 640 | **1/k** | /k | **sharp** |
| APPR(k) | 960 | 1 | **unchanged** | degraded |

k ∈ {1.00, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00} — **24 cells**. GEOM(k) and NAT(k) share
annotations exactly, so the pair isolates appearance at matched geometry; APPR(k)'s annotations
are byte-identical across all k. Five sanity checks must pass or the run is void; they are listed
in [design.md](design.md).
