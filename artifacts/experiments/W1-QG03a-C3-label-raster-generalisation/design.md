# QG-03a-C3 — design note (written before any sample was generated or scored)

> **PRE-REGISTRATION.** Everything below was fixed before the first render. Nothing in it may be
> changed after seeing a number. C3 **measures**; it trains nothing and tunes nothing.

## The one question

QG-03a-C established that the training pipeline labels by the **continuous** letterbox
(`targets.py`) while it rasterises by the **integer** one (`data.py`), so the model learned a small
**geometry-dependent nuisance mapping** instead of an identity. In production it cancels, because
inference rasterises as training did (`rasterLetterbox`) and inverts in the space the labels were
written in (`computeLetterbox`, preprocessing-contract §4).

C stayed CONDITIONAL on one unknown, stated then as unmeasurable: **the model was absent**, so
nobody could tell whether that learned mapping generalises to capture sizes outside the training
grid, where the label/raster offset differs (arithmetically up to **1.3333 CSS px**).

**The model now exists.** C3 asks exactly that, and nothing else:

> Does the learned nuisance mapping hold at capture sizes the model never saw?

## What C3 is not

- Not a retrain, not a relabel, not a threshold change, not an evaluator change.
- Not a hardware experiment: deterministic **WASM in Node** only. No WebGPU, no NVIDIA, no
  workstation 1. Backend arithmetic equivalence is already established by B2/B3-1 (at most 2.1e-3
  model px between WASM, WebGPU and native CPU), so it is not re-measured here.
- Not held-out evidence. C3 builds its **own** dataset; the consumed QG-05 split is never read.

## Component reuse

| component | source | role in C3 |
|---|---|---|
| `makeSpec(id, seed)` + `specToHtml` | `@pratibimb/evaluation` (committed, compiled) | the same deterministic generator that produced the training set |
| DOM-derived labels via `window.__measure()` | the procedure in `tools/dataset/build-dataset.mjs` | labels are read from the rendered document, never emitted by the code that emits the CSS |
| `sealDataset` / `validateDataset` | `@pratibimb/evaluation` | a C3 dataset that cannot pass label validation is not evidence |
| `preprocessToTensor` (contains `rasterLetterbox`) | `@pratibimb/perception` dist | the shipped preprocessing, unmodified |
| `decodeHeadOutput` then NMS then `projectToCapture` | `@pratibimb/perception` dist | the shipped decode, unmodified |
| `evaluate(...)` | `@pratibimb/evaluation` dist | the **frozen** evaluator, unmodified, including its CLIPPED definition |
| PIL decode to RGBA | `tools/detector` convention | PNG decode, proven bitwise-equal to browser decode in QG-03b / QG-03b-2 |

**Deliberately NOT reused:** C2's analytic worst case. C2 fed the evaluator *pixel-true boxes
inverted by the continuous transform* — a model-free upper bound. C3 feeds it **the model's actual
predictions**, which is the thing C2 could not do.

## The cells, fixed in advance

Six cells, 20 samples each, 120 renders. **The same 20 generator seeds are used in every cell**
(`20260912 + i`, `i` in 0..19), so cell A1 sample *i* and cell B1 sample *i* come from the same
spec and the cells are **paired by seed**. The rendered layout still differs between cells, because
placement depends on the viewport — so the pairing is "same generator seed", not "same pixels".
Without that pairing, any A-versus-B metric difference could be sample variation rather than
geometry.

| cell | CSS viewport | DPR | capture size | why this cell |
|---|---|---|---|---|
| **C3-A1** | 1264x800 | 1 | 1264x800 | the real production capture size of the QG-03b-2a fixtures; off the training grid |
| **C3-A2** | 1920x962 | 1.5 | 2880x1443 | the geometry carrying the worst recorded label/raster offset (1.3333 CSS px), and the only DPR other than 1 |
| **C3-A3** | 1920x1080 | 1 | 1920x1080 | a common desktop size, far outside the grid |
| **C3-A4** | 2560x1600 | 1 | 2560x1600 | the largest size QG-03a measured preprocessing cost for |
| **C3-B1** | 960x640 | 1 | 960x640 | **control, on the training grid** — the worst *training* offset, 0.667 model px |
| **C3-B2** | 1024x640 | 1 | 1024x640 | **control, on the training grid** — a zero-offset geometry |

The training grid is `widths {960, 1024, 1152, 1280}` by `heights {600, 640, 720, 800}` at DPR 1
(`renderSpec.ts`). Every C3-A size lies outside it.

The generator's own viewport choice is **overridden** with the cell's size, so the layout is laid
out *for* that viewport and rendered *at* it. Spec content is otherwise untouched.

### Placeholder splits, and why they exist

The frozen validator refuses a dataset with an empty split (`EMPTY_SPLIT`: *"a missing held-out
split turns every reported number into a tuning artefact"*). C3's 20 measured samples are all
`dev`, so each cell additionally carries **one unrendered placeholder in `train` and one in
`test`**, seeded at 990000000+, marked in `framePath` as
`UNRENDERED-PLACEHOLDER-NEVER-EVALUATED`. This follows the precedent QG-03a set for exactly this
validator constraint. The placeholders are **never rendered, never decoded, never inferred and
never evaluated** — every stage iterates the `dev` split only — and the harness asserts that each
cell has exactly 20 `dev` samples plus exactly those two placeholders. They exist to keep the
frozen validator unmodified, which matters more than avoiding two inert rows.

## Inference path, exactly

```
PNG (rendered)
  -> PIL decode -> RGBA
  -> preprocessToTensor   (shipped; rasterLetterbox inside: round(w*scale), integer pad)
  -> ORT Web 1.29.0, WASM EP, numThreads 1, graphOptimizationLevel "all", in Node
  -> decodeHeadOutput     (shipped; score floor 0.25, per-class greedy NMS at IoU 0.5, cap 300)
  -> projectToCapture     (shipped; continuous computeLetterbox inverse)
  -> multiply by (viewportCss.w / captureSize.w) -> CSS
```

No "fixed" letterbox is substituted. Measuring current production behaviour is the point.

## Operating points, fixed in advance

Both are reported; **the primary comparison is at 0.55**, the frozen evaluation operating point.

| view | meaning |
|---|---|
| `op055` | confidence at least **0.55**, the frozen operating point (a dev-derived value inside a flat 0.55-0.65 band; not re-chosen here) |
| `shipped` | everything `decodeHeadOutput` emits, i.e. its 0.25 floor |

`PROVISIONAL_THRESHOLDS.score` stays **0.25** in shipped code. No per-class thresholds. No sweep:
a sweep is tuning, and C3 is not allowed to tune.

## Metrics, fixed in advance

From the frozen evaluator, per cell: **element mAP@0.5, element recall, grounding accuracy.**
Computed by the harness, per cell: **minimum matched IoU** and **worst matched CSS displacement**,
using the B2/B3-1 matcher (best unused same-class match at IoU at least 0.5).

Recorded per sample: id, seed, viewport, DPR, capture size, PNG digest, RGBA digest, input tensor
digest, output digest, annotation counts by visibility, and the model hash.

## CLIPPED handling — frozen, and reported

The evaluator scores a `CLIPPED` element against its **full CSS box**, which is arithmetically
unreachable when less than half the element is visible. That definition is **FROZEN and is not
touched here**. Its consequence is *reported per cell*: the count of `CLIPPED` and `OFFSCREEN`
annotations, and the **arithmetic recall ceiling** — the fraction of evaluatable annotations whose
visible area is at least half their label area. Recall is read against that ceiling, never against
1.0. The 94.4% figure in `threshold-selection.md` §5.1 belongs to the QG-05 dev split and is **not**
transplanted onto C3.

Because the ceiling depends on how much content a viewport clips, and that differs by cell, the
A-versus-B comparison is made **ceiling-relative**: a recall difference fully explained by a
different clipping ceiling is not evidence about geometry.

## Acceptance criterion — the approved one, unchanged

> *"The mismatch is harmless if the worst case leaves mAP@0.5, element recall and grounding
> unchanged, and IoU stays well above 0.5 for the smallest controls."*

Applied to C3's scope: the C3-A cells are compared against the C3-B controls; the metrics must be
unchanged (ceiling-relative), minimum IoU must stay well above 0.5, and the worst CSS displacement
is reported.

### The comparator rule, fixed in advance

"Unchanged" is decided **relative to the controls**, never against an invented tolerance. For each
C3-A cell, in each view:

- **PASS** requires that mAP@0.5, element recall, grounding accuracy and minimum matched IoU are
  each **no worse than the worst C3-B control**, and that minimum IoU stays above 0.5.
- **FAIL** is recorded only for an unambiguous breach of the approved criterion that needs no new
  number: a minimum matched IoU at or below **0.5**, or a metric collapsing to zero.
- **INCONCLUSIVE / DECISION REQUIRED** is recorded for anything in between — any degradation
  against the controls whose materiality cannot be judged without a number the criterion does not
  contain. A recall gap that is fully explained by the clipping ceiling is reported as such rather
  than counted as degradation.

This direction is deliberate: a C3-A cell scoring *better* than the controls is not a failure, and
a small drop is not silently excused either — it is escalated.

**No new numeric tolerance is invented.** If deciding PASS or FAIL requires a number the approved
criterion does not contain, the result is reported as **INCONCLUSIVE / DECISION REQUIRED** and the
owner decides. "Well above 0.5" is read as the criterion's own words; if a measured minimum IoU
lands close enough to 0.5 that the phrase stops discriminating, that is precisely the situation to
escalate rather than resolve inside a harness.

## Fail-closed guards

The harness refuses, rather than proceeding, when: the model hash or size differs; the input or
output tensor shape differs; any output is non-finite; the dataset name collides with
`t1-ui-rendered`; any path under `artifacts/datasets/` or `artifacts/gates/` would be written; a
sample's metadata is incomplete; the sealed dataset hash does not reproduce from the recipe; the
evaluator or perception dist is missing; the operating-point or score-floor constants differ from
the pre-registered values; or a cell is missing samples.

## What gets committed

Pre-registration and records (`README.md`, `design.md`, `decision.md`), the harness, the per-cell
logs and `metrics.json`. **Not committed:** rendered PNGs, RGBA dumps, raw `.f32` outputs — all
gitignored and reproducible from the recipe.
