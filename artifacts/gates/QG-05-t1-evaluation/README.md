# QG-05 — T1 visual-context evaluation harness

> **Two things are gated here and they are deliberately NOT collapsed:**
>
> | | Status |
> |---|---|
> | **A. QG-05 infrastructure readiness (T1 visual-context slice)** | **PASS** |
> | **B. Actual T1 detector performance** | **UNKNOWN — no admissible detector exists** |
>
> The evaluator can be complete while detector performance is unknown. Reporting them as
> one number is how a harness's own baseline becomes a model's accuracy.

---

## Scope — what QG-05 asks for, and what this covers

QG-05 is the **whole** evaluation harness: *"all five scored metrics plus task success
after privacy"*. This implements **one slice**.

| Scored metric | Weight | Covered here |
|---|---|---|
| **Visual context** — element mAP@0.5, element recall, grounding accuracy | 25% | **YES**, on clean frames |
| PII detection — per-class precision/recall/F1, decoy set | 20% | No — needs T2 |
| Redaction — residual leakage, over-redaction ratio, block rate | 20% | No — needs T2 |
| Client resources — peak heap, GPU, CPU, tier firing | 20% | No — needs a running tier |
| Latency — stage-wise p50/p95 per backend | 15% | No — nothing to time |
| Task success after privacy | not in rubric | No — needs the executor |

**The gate as a whole is NOT claimed as passed.** Visual context is also required *"twice:
on clean frames and on redacted frames"*; the redacted half needs T2 and does not exist.

The dossier's evidence source for this metric is *"ScreenSpot-v2 web subset plus 300
self-labelled Indian government and banking screens"*. **Neither exists.** The synthetic
generator required by QG-05 (*"the synthetic generator produces ground-truth boxes"*) is
implemented; the **decoy generator is not**, because decoys are a PII-precision instrument
and belong to T2.

---

## A. Infrastructure readiness — gate table

| # | Criterion | Result | Basis |
|---|---|---|---|
| 1 | Reproducible dataset | **PASS** | Same version + seed ⇒ identical manifest hash. Local `mulberry32`, written out so a dependency bump cannot change the data. |
| 2 | Valid labels, fail-closed | **PASS** | Unknown class, non-finite or non-positive geometry, duplicate ids, and visibility contradicting geometry are all refused. |
| 3 | Deterministic evaluator | **PASS** | Identical inputs ⇒ identical output; shuffling predictions does not move the metric. |
| 4 | The exact metrics | **PASS** | Element mAP@0.5 (all-point interpolated), element recall, grounding accuracy. No substitutes. |
| 5 | Validated baselines | **PASS** | Perfect 1.0, empty 0.0, shifted degrades monotonically, class-swap caught, malformed rejected. |
| 6 | Threshold methodology | **PASS** | `sweepThreshold` on **dev**; test split never used for tuning, enforced by content-fingerprint leakage detection. |
| 7 | Coordinate/letterbox correctness | **PASS** | Full chain re-tested through the evaluator's IoU at all six DPR/zoom configurations. |
| 8 | Browser/runtime metadata | **PASS** | Every result records dataset name, version, hash, split, model id, revision, backend, browser, preprocessing. |
| 9 | Malformed-input failure | **PASS** | Rejections are counted and reported, never silently dropped. |
| 10 | Evidence reproducibility | **PASS** | Dataset hash recorded in every result; drift refuses evaluation. |

**Measured — Chromium, real fixture, 12 DOM-derived annotations (9 visible, 1 clipped, 2 off-screen):**

```
labels valid              : true
detector                  : MODEL_ASSET_UNAVAILABLE
BASELINE perfect          : mAP@0.5=1.0000 recall=1.0000 grounding=1.0000
BASELINE empty            : mAP@0.5=0.0000 recall=0.0000 grounding=NaN
BASELINE shift 10px       : mAP@0.5=0.6667 recall=0.7000
BASELINE shift 400px      : mAP@0.5=0.0000 recall=0.0000
off-screen excluded       : 2 of 12
```

### Reading those numbers correctly

**They are evaluator baselines, not detector performance.** The perfect baseline copies the
ground truth; 1.0 is arithmetic, not achievement. Its `modelId` is literally
`BASELINE-perfect-passthrough (NOT A DETECTOR)`.

**The 10px shift is the most informative row.** Recall falls to 0.70 — 3 of 10 evaluatable
elements drop below IoU 0.5 from a mere 10 px. That is correct and predictable: for a box
of width *w* shifted by *dx*, IoU is *(w−dx)/(w+dx)*, so a 16 px checkbox at 10 px offset
scores 0.23 while a 130 px button scores 0.86. **The metric is size-sensitive**, which
means small controls will dominate any future detector's failures.

**Empty grounding accuracy is `NaN`, not 0.** Nothing was predicted, so *"what fraction of
predictions were correct"* has no answer. Reporting 0 would claim every prediction was
wrong — a different and false statement.

**Off-screen elements are excluded, not counted as misses.** No detector can see them;
counting them would penalise a perfect detector for the laws of optics. The exclusion count
is reported so it is visible rather than assumed.

| Browser | Status |
|---|---|
| Chromium | **PASS**, 0 findings |
| Firefox | **CI only** — Playwright's browser CDN returns HTTP 400 on the Windows workstation (`agentos/blockers.md`) |

---

## B. Actual detector performance — **UNKNOWN**

There is no admissible T1 detector. `UIElementDetector` refuses with
`MODEL_ASSET_UNAVAILABLE`, and that refusal is asserted by this gate.

| Option | Status |
|---|---|
| A — OmniParser `icon_detect_v3` | **licence-excluded**; re-exports declare no licence |
| B — our own head | **untrained**; its inference path and tensor contract exist |
| C — DOM-only floor | **the shipped configuration** |

**No detector performance figure exists, and none may be quoted from this harness.** Before
any candidate becomes the T1 detector it must carry: licence, source, revision, artifact
hash and size, architecture and tensor-contract compatibility, preprocessing and
postprocessing definitions, browser/backend feasibility per QG-03, and reproducibility —
then be evaluated on the **held-out test split** with thresholds chosen on **dev**.

**The model registry is unchanged.** Building an evaluator is not grounds to register a
model.

---

## Splits and the tuning discipline

| Split | Role |
|---|---|
| **train** | Never used for tuning or claims. Reserved for a future trained head. |
| **dev** | **Threshold selection only.** `sweepThreshold` runs here. |
| **test** | **Final claims only.** Never used to choose a threshold. |

Leakage is detected two ways: by sample id, and by **content fingerprint** — because
renaming a sample while copying it verbatim is the form leakage actually takes in practice.
An empty split is refused outright: a missing held-out split turns every reported number
into a tuning artefact.

---

## Reproducing

```bash
npm ci
npm run typecheck                                     # the gate runs the COMPILED packages
node tests/browser/qg05/run-qg05.mjs                  # Chromium
node tests/browser/qg05/run-qg05.mjs --browser=firefox
npx vitest run packages/evaluation                    # 85 unit tests
```
