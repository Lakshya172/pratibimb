# Detector operating-point selection — FROZEN RULE

> **Status: FROZEN 2026-09-11. Derived from the DEV split only. Not yet applied to any
> held-out split.**
> Evidence: [`qg03-dev-threshold-analysis.json`](../../artifacts/gates/T1-detector-training/qg03-dev-threshold-analysis.json)
> Supersedes, but does not erase, the rule recorded in
> [`qg05-detector-evaluation.json`](../../artifacts/gates/T1-detector-training/qg05-detector-evaluation.json).

---

## 0. Why this document exists

A detector emits a confidence per box. Something has to decide which boxes survive, and
that decision is not a detail — at threshold 0.05 the T1 head emits **296 boxes per screen**
for roughly **19 real controls**, and at 0.55 it emits **27**. Same weights, same pixels,
same mAP. The threshold is most of what "the detector's output" means in practice.

The rule that made that decision was chosen badly. This document says exactly how, fixes
it, and freezes the replacement **before** the next held-out evaluation, so the replacement
cannot be accused of having been fitted to the answer.

---

## 1. The old rule, and why it was a methodological defect

> **`max mAP@0.5 on DEV`** — selected threshold **0.05**.

It is tempting to describe this as "too permissive". That is not the defect. The defect is
that **the rule optimised a quantity which is, by construction, almost independent of the
thing it was choosing.**

Average precision is a **ranking** metric. It integrates precision over the recall curve
obtained by sweeping the *ranking*, not the emit threshold. Lowering the emit threshold
appends low-confidence boxes to the **tail** of that ranking, where recall is already
saturated, so they barely move the area beneath it.

Measured on dev, across the plateau where mAP is within 0.001 of its maximum:

| | range across the mAP plateau |
|---|---|
| **mAP@0.5** — the quantity being maximised | **0.0004** |
| grounding accuracy — the quantity that decides usability | **0.1430** |
| predictions emitted | **3,391 → 11,845** |

**A rule maximising a quantity that varies by 0.0004 cannot express a preference between
operating points that differ by 3.5× in usable precision.** It landed on whichever end of
the plateau the tie-break happened to favour, and the tie-break favoured *more* boxes.

This is why the held-out grounding accuracy came back at **0.0547**. That figure is
correct, it was correctly obtained, and it is not withdrawn — but it describes an operating
point selected by a rule that could not see the axis it was moving along.

> **The old result stays published.** Deleting it would remove the evidence that the defect
> happened, and the defect is the more useful finding.

---

## 2. The frozen rule

> **Select the threshold maximising `F1(element recall, grounding accuracy)` on the DEV
> split. Ties, and only exact ties, break to the HIGHER threshold.**
>
> Grid: `0.05 … 0.90` in steps of `0.05`.
> The selected threshold **must be interior to the grid**; a maximum sitting on a grid
> boundary means the grid chose, not the rule, and the grid must be extended and the
> selection re-run.

### Why these two terms and no others

Both are figures **the dossier already requires** for the visual-context metric (benchmark
contract, Rule 2: *element mAP@0.5, element recall, grounding accuracy*). Grounding
accuracy is defined by the evaluator as *the fraction of predictions that land on the right
element* — that is precision. So the rule is the harmonic mean of the recall and the
precision the project already reports.

- **It invents no metric.** A rule needing a metric that appears nowhere else would be a
  rule invented to produce an answer.
- **It introduces no arbitrary constant.** The obvious alternative — *"maximise recall
  subject to grounding ≥ X"* — requires choosing X, and there is no evidence for any
  particular X. A constant chosen without evidence is the same defect in a new place.
- **Both terms move.** This is the property the old rule lacked, and it is the whole point.

### Why ties break upward

Fewer predictions is the safer failure for a detector feeding a fusion stage that pairs
visual boxes against DOM nodes at IoU 0.5. Surplus boxes do not vanish: they become
`UNRESOLVED` visual-only elements that a planner must then reason about. The DOM-only floor
is a known, safe degradation; a flood of unresolved boxes is not.

---

## 3. What the rule selects on DEV

| threshold | mAP@0.5 | recall | grounding | **F1** | preds/screen |
|---|---|---|---|---|---|
| 0.05 *(old rule)* | 0.7954 | 0.9167 | 0.0576 | 0.1083 | 296.1 |
| 0.25 *(shipped `PROVISIONAL_THRESHOLDS.score`)* | 0.7935 | 0.9126 | 0.2533 | 0.3965 | 67.0 |
| 0.50 | 0.7241 | 0.8535 | 0.5239 | 0.6493 | 30.3 |
| **0.55 — selected** | **0.6949** | **0.8159** | **0.5678** | **0.6696** | **26.7** |
| 0.60 | 0.6237 | 0.7648 | 0.5890 | 0.6655 | 24.1 |
| 0.70 | 0.5324 | 0.6640 | 0.6517 | 0.6578 | 18.9 |

Interior maximum: **yes**.

### The selection is not sharp, and saying so is part of the result

F1 is within 0.01 of its maximum at **0.55, 0.60 and 0.65**, on **40 dev screens**. That
band is not resolvable at this dev size. **0.55 should be read as "somewhere in that band",
not as a tuned value.** Quoting it to two decimals as though it were precisely determined
would overstate the evidence — the rule is what is frozen, not the number it currently
returns, and re-running it on a larger dev set may well move the number inside that band.

---

## 4. What has NOT been done

- **The rule has NOT been applied to the test split.** Deliberately.

  The test split has already been read once, under the old rule. It is therefore no longer
  fully held out. Applying a newly frozen rule to it would produce a figure whose honest
  provenance is *"the second look at a consumed split"*, and that figure would sit in the
  report looking exactly like a first look.

  **The evaluation that uses this rule needs a split that has not been read.** That is the
  next data task, not a scoring task.

- **`PROVISIONAL_THRESHOLDS.score` in `uiDetectorHead.ts` is unchanged at 0.25.** It stays
  provisional and stays where it is until a rule-selected threshold exists from an unread
  split. Changing the shipped constant to a dev-derived number would quietly convert a
  tuning artefact into a product default.

- **No per-class thresholds.** The dev evidence below shows a single global threshold trades
  small-control recall against textbox precision, and per-class thresholds are the obvious
  response. They are **not** adopted: eight thresholds fitted on 40 dev screens is a fitting
  exercise, not a measurement. Recorded as an open question with its own evidence
  requirement.

---

## 5. Two evaluation defects this analysis exposed

### 5.1 The recall ceiling is 94.4%, not 100%

The dataset labels each annotation `VISIBLE`, `CLIPPED` or `OFFSCREEN`. The evaluator
excludes only `OFFSCREEN`. A `CLIPPED` control is scored against its **full CSS box** —
the box the DOM reports — while the model can only see the part inside the frame.

Measured on dev: **51 clipped annotations**, visible-area fraction **median 0.368, maximum
0.790**. For **42 of the 51**, the visible fraction is below 0.5, so **IoU ≥ 0.5 against
their own label is arithmetically unreachable by any detector.**

| | |
|---|---|
| Recall on `CLIPPED` (threshold 0.05) | **3/51 = 0.059** |
| Recall on non-clipped | 679/693 = 0.980 |
| Achievable recall ceiling over the evaluatable dev set | **94.4%** |

This was found by asking why the clipped bucket barely moved with the threshold (0.059 →
0.039) while every other breakdown moved a lot. **A model failure would have moved.**

**Consequence:** any reported element recall must be read against 94.4%, not 1.0. The fix
is an evaluator decision — score `CLIPPED` elements against their visible extent, or
exclude them the way `OFFSCREEN` is excluded — and **it changes the metric definition, so
it must not be made while a held-out figure is being interpreted.** It is recorded here and
deferred.

### 5.2 The shipped decode and the evaluation disagree about the operating point

`PROVISIONAL_THRESHOLDS.score` is **0.25**. The QG-05 evaluation reported at **0.05**. The
same weights therefore behave differently depending on which code path reads them, and
neither number came from the other. Both are now visible in the same table above; neither
is changed here.

---

## 6. Where the problem actually is

The brief for this work asked whether the dominant problem is thresholds/postprocessing or
capacity. The dev failure taxonomy answers it — every false positive classified into
exactly one bucket, most specific first:

| threshold | preds/screen | duplicate | class confusion | localization | spurious |
|---|---|---|---|---|---|
| 0.05 | 296.1 | 259 (2%) | 2,543 (23%) | 594 (5%) | **7,767 (70%)** |
| 0.25 | 67.0 | 196 (10%) | 652 (33%) | 275 (14%) | 879 (44%) |
| 0.55 | 26.7 | 137 (30%) | 56 (12%) | **163 (35%)** | 106 (23%) |

**At the incumbent operating point, 70% of false positives overlap nothing at all.** That
is threshold policy, not capacity — the model already ranks these below every real
detection, and the rule was keeping them anyway. Class confusion collapses from 2,543 to 56
across the same move, so it too was low-confidence noise rather than a representational
failure.

Once the threshold is sensible, the remaining false positives are **localization (35%)** and
**duplicates (30%)** — both postprocessing-shaped:

- **Duplicates survive per-class NMS at IoU 0.5** because NMS suppresses at *the same*
  threshold the evaluator matches at. Two boxes at IoU 0.45 both survive NMS and only one
  can match. **The NMS IoU and the matching IoU should not be the same number**, and
  currently they are, deliberately, to agree with fusion's threshold.
- **Localization** — same class, IoU in [0.3, 0.5). The box is nearly right.

Neither is answered by more parameters.

### The one thing capacity might explain — and probably does not

Per class at 0.55 (dev):

| class | gt | pred | recall | precision |
|---|---|---|---|---|
| textbox | 125 | 303 | 1.0000 | 0.4125 |
| icon | 40 | 40 | 1.0000 | 1.0000 |
| tab | 117 | 125 | 0.9145 | 0.8560 |
| select | 40 | 66 | 0.9000 | 0.5455 |
| link | 148 | 254 | 0.8851 | 0.5157 |
| **button** | 194 | 236 | **0.6753** | 0.5551 |
| **checkbox** | 40 | 19 | **0.4750** | 1.0000 |
| **radio** | 40 | 26 | **0.4500** | 0.6923 |

Checkbox and radio recall are **0.475 / 0.450** at 0.55 but **~0.9** at 0.05, and checkbox
precision at 0.55 is **1.000**. The model *finds* small controls and *ranks them low* — that
is **calibration**, not capacity. A capacity failure would miss them at every threshold, as
stride 16 did before the micro-overfit gate caught it.

> **Recommendation, stated as a recommendation and not as a finding:** do not grow the
> model. The evidence points at threshold policy, NMS, calibration and — see the QG-03
> browser result — preprocessing robustness, in that order.

---

## 7. Change control

This rule is frozen. It may be changed, but only by a document that:

1. states what the new rule is **before** any held-out figure is computed under it,
2. records why the previous rule failed, in measurable terms, as §1 does here, and
3. leaves the previous rule and the figures it produced in place.

Freezing a rule after seeing the number it produces is not freezing a rule.
