# W-1 — design / pre-registration

> **Locked before any score was produced.** Every variant, scale level, seed, metric,
> comparison and stop rule below was written and committed **before the first inference ran**.
> Nothing here was chosen after looking at a result.

**Synthetic evidence.** W-1 **cannot** close adoption item 11, **cannot** establish a
production capture limit, and **cannot** justify retraining by itself.

---

## 1. Question

Two questions that share one infrastructure, and one answer each:

- **Arm A.** How much of the detector's precision / grounding problem is recoverable **in
  post-processing alone**, with no retrain, no weight change and no shipped-code change?
- **Arm B.** Is the C4 collapse **driven by object scale in model space**, measured with scale
  as the only intended varying quantity?

## 2. Hypotheses, both falsifiable

| | |
|---|---|
| **H-A1** | A material part of the false-positive population at 0.55 is **duplicate** and therefore removable by a better suppression rule, so grounding rises without a proportionate recall loss |
| **H-A0** | Variants move grounding negligibly, or only by trading recall away one-for-one — in which case precision is a model/data property, not a decode property |
| **H-B1** | Metrics degrade **monotonically as CSS px per model px rises** (objects shrink in model space), with the identical annotation set held fixed |
| **H-B0** | Metrics stay stable under scale control — which would **contradict** the scale explanation and send the C4 question elsewhere |
| **H-S1 (stride-8)** | Small model-space objects are hard for a stride-8 head. **This is a hypothesis, not a finding.** The design can contradict it: if degradation is flat in scale, or if it does not concentrate in the objects that are smallest in model px, H-S1 is not supported |

## 3. Held fixed across everything

| | |
|---|---|
| Model | `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`, 302,960 B, **unmodified** |
| Runtime | ORT Web **1.29.0**, WASM EP in Node, `numThreads = 1`, `proxy = false` — the deterministic path B2 and C3 used |
| Operating point | **0.55**, fixed. **No sweep, on any split** |
| Emit floor | **0.25**, the shipped `PROVISIONAL_THRESHOLDS.score`, **unchanged** |
| Evaluator | the **frozen** `@pratibimb/evaluation`, CLIPPED definition untouched |
| Coordinates | the shipped `computeLetterbox` / `projectToCapture` — the production continuous inverse, as QG-03a-C resolved |
| Machine | **workstation 2**, Node only. No WebGPU, no NVIDIA, no workstation 1 |

**Never touched:** `artifacts/datasets/`, `artifacts/gates/`, the consumed held-out test split,
the regression baseline, the model registry, `packages/*/src/`, and
`PROVISIONAL_THRESHOLDS.score`.

## 4. Arm A — dataset

The analysis must run on the **existing dev split**, and that data is **not present on
workstation 2** (`artifacts/datasets/` is gitignored and was never committed). It is, however,
**reproducible by construction**: `tools/dataset/build-dataset.mjs` is deterministic — fixed
seed `20260910`, fixed per-split offsets, fixed `createdAt`, local `mulberry32` — and QG-05
gate criterion 1 states *"same version + seed ⇒ identical manifest hash"*.

So W-1 **regenerates** `t1-ui-rendered@1.0.0` with the **unchanged** script and **requires the
manifest hash to equal `4bbc57de`**. That hash is the project's own identity rule for this
dataset; if it matches, this is that dataset. **If it does not match, Arm A stops** and reports
the mismatch rather than proceeding on a lookalike.

Pre-registered consequences, recorded now rather than discovered later:

- The **frames are re-rendered**, and the dataset hash covers geometry and annotations, **not
  pixels**. A different Chromium build can therefore produce slightly different pixels, so
  Arm A's **absolute** figures may not reproduce the published dev numbers exactly. **Arm A's
  claim is a comparison between variants on one shared set of frames**, where frame provenance
  cancels. The baseline variant's figures are reported beside the published ones as a
  reproduction check, and any gap is reported, not explained away.
- Regenerating requires rendering **all 200 samples**, because the hash covers all three
  splits. **The test split is rendered and never opened**: the harness refuses if any sample
  whose `split !== "dev"` reaches inference, evaluation or a log — the same discipline
  `tools/detector/qg03-dev-analysis.mjs` already applies.
- Output goes to the **harness's own `generated/` directory**, never to `artifacts/datasets/`.

## 5. Arm A — the four variants, and nothing else

Exactly four. No combinatorial sweep, no extra IoU values, no tuning.

| id | variant | definition | why this one |
|---|---|---|---|
| **V0** | shipped baseline | floor 0.25, **per-class** greedy NMS at **IoU > 0.50**, cap 300 | the thing that ships; the reference every other number is read against |
| **V1** | tighter per-class NMS | identical, **IoU > 0.30** | the one-parameter change that attacks duplicates most directly |
| **V2** | cross-class NMS | identical to V0 but suppression **ignores the class label** | duplicates at 0.55 are partly the same control emitted under two labels; per-class NMS cannot see those |
| **V3** | containment suppression | V0, plus: drop a lower-scoring same-class box whose **intersection over its own area > 0.80** against a kept box | greedy IoU NMS **cannot** suppress a small box nested inside a large one — IoU stays low while one box is entirely inside the other. That is the geometric shape of a nested duplicate |

**V0 is computed twice** — once by the shipped `decodeHeadOutput`, once by the harness replica
configured as V0 — and the two must be **identical in count, class, box and score**. If they
differ the harness **refuses**, because a variant comparison whose baseline is not the shipped
behaviour measures nothing.

## 6. Arm B — scale control

Scale is isolated by **holding the rendered content and its annotations byte-identical** and
changing only the viewport the content sits in.

Because the letterbox is width-dominant for every cell below, **CSS px per model px = viewport
width ÷ 640** exactly. DPR cancels out of that ratio (C3 measured this: 1920 at DPR 1 and 1920
at DPR 1.5 both gave 3.00), so DPR is fixed at 1 and the ratio is driven by width alone.

The content is one **fixed 960 × 640 CSS block anchored at the origin**, rendered in an iframe
so its internal layout cannot reflow. Every element therefore has the **same CSS box at every
level**, and since the block always fits inside the viewport, **every annotation is `VISIBLE`
at every level — clipping is removed as a confound entirely and the recall ceiling is 1.0.**

| cell | viewport | CSS px per model px | content |
|---|---|---|---|
| `s150` | 960 × 640 | **1.50** | 1 block |
| `s175` | 1120 × 747 | **1.75** | 1 block |
| `s200` | 1280 × 853 | **2.00** | 1 block |
| `s225` | 1440 × 960 | **2.25** | 1 block |
| `s250` | 1600 × 1067 | **2.50** | 1 block |
| `s300` | 1920 × 1280 | **3.00** | 1 block |
| `s350` | 2240 × 1493 | **3.50** | 1 block |
| `s400` | 2560 × 1707 | **4.00** | 1 block |
| `t300` | 1920 × 1280 | **3.00** | **tiled to fill** — control |
| `t400` | 2560 × 1707 | **4.00** | **tiled to fill** — control |

**The tiling control exists because the manipulation has one unavoidable side effect:** holding
content fixed while the viewport grows means the frame gets **emptier**. `t300` / `t400` repeat
the same content tiled to fill the frame, so object scale is unchanged but emptiness is not. If
the tiled cells differ materially from their single-block twins, **emptiness is a confound and
Arm B is INCONCLUSIVE** rather than attributed.

**Samples and seeds.** 20 seeds per cell, shared across cells so the comparison is **paired**:
`seed(i) = 20260913 + i` for `i` in `0..19`, spec id `w1-seed-<i padded to 4>`. 8 scale cells +
2 controls = **200 samples**. Every sample is reported; none may be dropped after the fact.

**Splits.** Every Arm B sample is `dev`. Two never-rendered placeholder samples per cell satisfy
the frozen validator's refusal of an empty split (`EMPTY_SPLIT`), exactly as C3 recorded; they
are never rendered, decoded, inferred or evaluated. **No test split is created.**

## 7. Metrics, and why each one is informative

Recorded for every Arm A variant and every Arm B cell:

| metric | why it is informative here |
|---|---|
| **mAP@0.5** | the contract's figure — but nearly **threshold-invariant**, so it is reported and **never used to choose anything**. That property is what broke the old selection rule |
| **element recall** | the cost side of any suppression change: a variant that raises grounding by deleting true positives must be visible as a recall fall |
| **grounding accuracy** | `TP / all predictions` — **per-prediction precision**, the quantity item 11 actually failed on |
| **predictions per screen** and **total predictions** | the most diagnostic single number for a precision-limited detector; 296/screen against ~19 real controls is what 0.055 *was* |
| **FP taxonomy** — duplicate / classConfusion / localization / spurious | says **which** failure a variant removed. The definitions are taken **verbatim** from `tools/detector/qg03-dev-analysis.mjs` so the numbers are comparable to the published ones: *duplicate* = same class, IoU ≥ 0.5, but the ground truth was already claimed; *classConfusion* = IoU ≥ 0.5 against a **different** class; *localization* = same class, 0.3 ≤ IoU < 0.5; *spurious* = everything else |
| **FN taxonomy** — noOverlapAtAll / overlappedWrongClass / overlappedPoorLocalization | distinguishes "never saw it" from "saw it, boxed it badly" — the difference between a detection failure and a regression failure |

Arm B additionally records, because C3 proved the obvious statistics uninformative:

| metric | why |
|---|---|
| **full matched-IoU distribution** — min, p10, p25, **median**, p75, max | C3's `minMatchedIou` was **pinned just above 0.5 by construction**, because the matcher gates there. The **median and the lower tail** are what move, and they are reported as a distribution rather than as one order statistic |
| **displacement normalised by target size** — centre offset ÷ √(w·h) of the ground-truth box | C3's raw worst displacement was **dominated by large elements matching loosely** (134–144 CSS px on the training-size controls themselves). Normalising makes a 2 px error on a 16 px checkbox and a 2 px error on a 200 px banner comparable, which is the comparison scale fragility is about |
| **recall by model-space object size** | the direct test of **H-S1**: if stride-8 is implicated, the loss must concentrate in the objects that are **smallest in model px**, not spread evenly |

## 8. Comparison method

- **Arm A.** V1, V2, V3 each read **against V0 on the same frames and the same raw outputs** —
  one inference pass per sample, decoded four ways, so every difference is the decode rule and
  nothing else. Absolute deltas are reported. **No "substantial" threshold is defined here**:
  the numbers go to the owner, who decides.
- **Arm B.** Cells compared **pairwise by seed** against `s150` (the lowest scale, inside the
  training band), with the annotation set identical across cells. Monotonicity in scale is
  reported as an observation, not assumed.
- **Both.** Every sample is reported. Nothing is excluded after measurement.

## 9. Stop rules, fixed in advance

The harness **refuses and exits non-zero** if: the regenerated dataset hash is not `4bbc57de`;
the model hash or ORT version differs; V0's replica does not match the shipped decode exactly;
any sample with `split !== "dev"` reaches inference, evaluation or a log; a tensor has the wrong
shape or a non-finite value; the shipped decode refuses; `PROVISIONAL_THRESHOLDS.score !== 0.25`;
a write is attempted under `artifacts/datasets/`, `artifacts/gates/` or `artifacts/models/`; or
any Arm B cell is missing a sample.

## 10. Interpretation rules, fixed in advance

**Arm A** — reported as absolute changes in grounding, recall and the FP taxonomy at 0.55.
**No numeric definition of "substantial" is set by this experiment.** The owner reads the
deltas. What the harness *may* state is the direction: whether a variant removed duplicates,
and what it cost in recall.

**Arm B**

- Degradation **monotone in CSS px per model px**, concentrated in the smallest model-space
  objects, with the tiled controls agreeing with their twins → **scale is implicated**, and
  H-S1 is *supported* (not proven — stride is one of several scale-dependent mechanisms).
- Metrics **stable** across levels → **H-B1 is contradicted**; scale is not the driver and C4
  must look elsewhere.
- Degradation present but **not ordered by scale**, or the **tiled controls disagree** with
  their twins → **INCONCLUSIVE**, confound named.

**Neither arm may:** define a production capture limit, restate a C4 verdict as closed, justify
a retrain, change the shipped decode, or be described as real-world evidence.

## 11. What a result here does and does not unlock

**Unlocks:** a defensible choice between an inference/post-processing path and a model-revision
path; the scale attribution C4 is waiting on; and the viewport range W-A's collection matrix
must span.

**Does not unlock:** adoption item 11 (needs real data and owner decisions D1–D10), a capture
policy, a threshold change, or adoption.
