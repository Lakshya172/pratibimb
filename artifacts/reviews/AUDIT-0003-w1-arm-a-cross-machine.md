---
id: AUDIT-0003-w1-arm-a-cross-machine
title: "W-1 arm A reproduced on workstation 1 — the effect transfers, the absolute metrics do not"
status: recorded
date: 2026-09-12
label: FACT (measurements) / INFERENCE (attribution)
workstation: 1 (LAPTOP-6E14K34L)
---

# AUDIT-0003 — W-1 arm A, reproduced on a second machine

> **Synthetic DEV evidence. Experimental candidate only — not production-approved.**
> No production code, decoder, threshold, model or split was touched by this reproduction.

## Why this was run at all

W-1 arm A was measured on **workstation 2** and is carried in **open PR #52**
(`spike/w1-detector-precision-scale`, head `043618a`), which is **not merged**. Its conclusion —
that most of the detector's precision loss at the 0.55 operating point is *removable in
post-processing* — is currently the single strongest argument for a future decode change.

Every detector metric this project holds was produced on **one machine**. That is a real gap:
if the metrics were machine-sensitive, the V1 argument would be an artefact rather than a
finding, and nobody would know. Arm A is deterministic, guarded and cheap, so reproducing it on
workstation 1 costs little and tests something nothing else has tested.

**This is a reproduction, not new evidence.** It does not create a workstation-1 result where a
workstation-2 result already stands, and PR #52's numbers remain **W2 evidence**, unrelabelled.

## Method

PR #52's harness was used **verbatim and read-only**, in a detached `git worktree` at `043618a`.
Nothing was merged, nothing in `main` was modified, and the harness was not edited — had it been,
this would measure a different experiment.

```
node tools/dataset/build-dataset.mjs --out=<gen>/devset
python .../decode-w1-png.py
node .../run-arm-a.mjs
```

The harness refuses rather than guesses, and every guard passed on W1: dataset identity,
model hash, ORT version, dev-split-only, and an exact replica of the shipped `decodeHeadOutput`.

## Identity

| | workstation 2 (PR #52) | workstation 1 (this run) |
|---|---|---|
| host | `LAPTOP-SRCINK2B` | **`LAPTOP-6E14K34L`** |
| CPU | — | Intel Core 7 240H (10C/16T) |
| dataset | `t1-ui-rendered@4bbc57de` | **`4bbc57de`** — regenerated, identical |
| model | `ba6d9e93…`, 302,960 B | **identical** |
| ORT | 1.29.0, **wasm**, `numThreads 1`, proxy false | **identical** |
| split | dev, 40 samples | identical |
| shipped-decode replica | exact, 40/40 | **exact, 40/40** |
| clipped ceiling | 0.9435 (42/744 unreachable) | **0.9435** |

The dataset recipe regenerating to the same `4bbc57de` on different hardware is itself a result:
the recipe is reproducible across machines, not merely re-runnable on the machine that wrote it.

## Result 1 — the absolute metrics are NOT bitwise reproducible

| | | W2 | W1 | W1 − W2 |
|---|---|---:|---:|---:|
| **V0** | mAP@0.5 | 0.6947 | 0.6948 | +0.0001 |
| | recall | 0.8159 | 0.8145 | **−0.0013** |
| | grounding | 0.5716 | 0.5701 | **−0.0015** |
| | total FP | 455 | 457 | **+2** |
| **V1** | mAP@0.5 | 0.7123 | 0.7117 | −0.0006 |
| | recall | 0.8038 | 0.8024 | **−0.0013** |
| | grounding | 0.7311 | 0.7298 | **−0.0012** |
| | total FP | 220 | 221 | **+1** |

**Where the difference sits is the informative part.** The false-positive taxonomy is identical
on both machines for **duplicate** (160 / 12), **classConfusion** (58 / 51) and **spurious**
(99 / 71). *Every* difference is in **localization** — +2 on V0, +1 on V1.

**INFERENCE.** That is the signature of a handful of borderline boxes crossing the matcher's
IoU 0.5 gate, not of a different detector. It is consistent with what B2 and QG-03b-2a already
established about this artifact: 1,402 exact score ties, and a decode whose ordering is sensitive
to differences far below any tolerance. The cause was **not** isolated here and is not claimed.

## Result 2 — the EFFECT transfers, to four decimal places

| V1 − V0 | W2 | W1 | disagreement |
|---|---:|---:|---:|
| grounding | +0.1595 | **+0.1597** | **0.00026** |
| recall | −0.0121 | **−0.0121** | **0.00000** |
| mAP@0.5 | +0.0177 | +0.0169 | 0.00073 |
| preds/screen | −6.100 | −6.125 | 0.025 |
| total FP | −235 | −236 | 1 |
| **duplicates removed** | **148** | **148** | **0** |

The quantity the V1 argument actually rests on — a large grounding gain bought with a small
recall loss, by deleting duplicate detections — reproduces on independent hardware. The duplicate
mechanism reproduces **exactly**: 160 → 12 on both machines, 148 removed on both.

## What this changes

1. **The V1 finding is not a single-machine artefact.** Its magnitude and direction survive a
   change of CPU. That materially strengthens the case for testing V1 on approved real data.
2. **No absolute detector metric should be quoted as exact.** These figures carry roughly
   **±0.0015** of machine variance in recall and grounding, and **±2** in false-positive counts,
   before any question of real-world validity arises. A future acceptance bar written as a bare
   number (adoption item 11, decision **D2**) must either sit far from that noise or state a
   tolerance. **This is an input to that owner decision, not a proposal to change the bar.**

## What this does NOT establish

- **Nothing about real websites.** 40 synthetic screens written by this project.
- **No mechanism** for the cross-machine difference. Localization-FP is where it lands; *why* is
  not isolated, and the near-tie explanation above is inference.
- **Nothing about V2 or V3.** Both were re-run and both remain uninteresting against V0
  (grounding +0.011 and +0.009 on W1); neither is pursued.
- **No production claim.** V1 is **not** adopted, not shipped, and not approved. The shipped
  decode, the 0.55 operating point and `PROVISIONAL_THRESHOLDS.score = 0.25` are untouched.
- **Nothing about arm B.** Only arm A was reproduced.

## Provenance rule observed

PR #52's results stay **W2 evidence**. This document is a **W1 reproduction of them** and is
labelled as such. The two are not merged into one machine-independent number, and no W2 figure
has been relabelled.
