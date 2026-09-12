---
id: W1-TrackB-geometry-appearance
title: "Track B — geometry vs appearance attribution"
status: pre-registered (NOT EXECUTED)
date: 2026-09-12
label: PRE-REGISTRATION — no measurement exists
verdict: NOT RUN
workstation: 1 (LAPTOP-6E14K34L)
---

# Track B — geometry vs appearance

> **NOTHING HAS BEEN MEASURED.** This directory contains a pre-registration and no result.
> Any number quoted from it would be invented. Execution is **BLOCKED** on PR #52 landing.

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

Stated before running, so the outcome can disagree with it: **H-MIXED**, with appearance carrying
more of the degradation than geometry. This follows from arm B's within-band variation, and it is
a prediction rather than a finding.

## Environment

Workstation 1 (`LAPTOP-6E14K34L`), Intel Core 7 240H, Windows 11 build 26200. Dataset
`t1-ui-rendered@4bbc57de`, **dev split only**. Model `ba6d9e93…`, 302,960 B. ORT **1.29.0**, wasm,
`numThreads 1`. Evaluator: PR #52's `w1-guards.mjs` at `043618a`, unmodified. Operating point
**0.55**, shipped decode (per-class NMS 0.50) — **not V1**.

## Actual result

**NONE. The experiment has not been run.**

The governed harness lives only in **PR #52**, which is open and unmerged, and is self-contained —
it imports nothing from `packages/`. Rebuilding Track B on `main` would mean reimplementing the
evaluator and producing a divergent duplicate, which is precisely what this project should not
have. **Status: OWNER MERGE REQUIRED on PR #52** (`MERGEABLE`, `CLEAN`, 9/9 checks green, no
blocking defect found).

## Conclusion

**NOT RUN — no hypothesis is classified.** H-GEOMETRY, H-APPEARANCE and H-MIXED all remain
**INCONCLUSIVE** for want of data, not for want of a design.

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
