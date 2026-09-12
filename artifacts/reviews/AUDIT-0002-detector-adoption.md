---
id: AUDIT-0002
title: "T1 UI element detector — adoption-bar audit, items 9 / 11 / 12 / 13 / 14"
status: recorded
date: 2026-09-12
label: FACT (recorded evidence) / INFERENCE (assessment) / UNKNOWN (absent evidence)
---

# AUDIT-0002 — detector adoption bar, items 9 / 11 / 12 / 13 / 14

## Question

`artifacts/gates/T1-detector-training/README.md` records a 14-item adoption bar and reports
items **9, 11, 12 and 13** as outstanding, with **14** deferred to its review. Those statuses
were written on 2026-09-10. A good deal has been measured since. **Which of them can be closed
on evidence that already exists, which need new data, which need new experiments, which need a
new detector revision, and which need an owner decision?**

## Method

Read-only. No experiment was run, nothing was retrained, no threshold, model, evaluator,
dataset or gate artifact was touched, and no held-out split was opened. Sources read:
`artifacts/gates/T1-detector-training/` (README and `agentos-review.md`),
`artifacts/gates/QG-05-t1-evaluation/`, `artifacts/gates/T1-detector-fusion/`,
`agentos/registry/model-registry.md`, `agentos/registry/feasibility-matrix.md`,
`agentos/workflows/model-adoption.md`, `docs/testing/benchmark-contract.md`,
`docs/testing/threshold-selection.md`, `docs/architecture/preprocessing-contract.md`,
`docs/adr/ADR-0002-t1-capture-format-policy.md`, and the QG-03 / QG-03a / QG-03b experiment
records including C3 and C3b.

**This audit recommends. It closes nothing.** Item statuses live in the gate record, which is
frozen evidence; moving one is an owner decision.

---

## 1. The bar, as recorded, and what the evidence now says

| # | Requirement | Gate record (2026-09-10) | This audit |
|---|---|---|---|
| 9 | QG-03 backend feasibility | **NOT DONE** — "no browser/backend matrix has been run" | **STALE — the work is done, one cell short.** Recommend `CONDITIONAL`, not PASS |
| 11 | Acceptable detector metrics | **FAIL** — grounding accuracy 0.055 | **STILL FAIL, and the figure is not the whole problem.** Needs data that does not exist |
| 12 | Browser correctness verified | **NOT DONE** — "only Python `onnxruntime` CPU" | **STALE — satisfied, and then some.** Recommend PASS |
| 13 | Memory / latency characterized | **NOT DONE** | **PARTLY DONE.** Latency and WASM heap measured; **teardown/coexistence is UNKNOWN** |
| 14 | AgentOS reviews PASS | "see `agentos-review.md`" | **`CONDITIONAL_PASS` on the pipeline**, as that review says. Not a clean PASS |

### Item 9 — QG-03 backend feasibility

**FACT.** The feasibility row for `pratibimb-t1-ui-head @ ba6d9e93695b` is filled for three of
four required columns: Chrome WebGPU `ACCEPT`, Chrome WASM `ACCEPT`, Firefox WebGPU
`CONDITIONAL` (Firefox 155.0.1 on Windows — headful `ACCEPT`, **headless `REJECT`**, no GPU
adapter at release defaults, 3/3 reproducible, and headless is the cell CI hits), Firefox WASM
**(Linux) `UNKNOWN`**. All four of the workflow's required per-cell fields — load, p50, peak
heap, correctness — are recorded for the eight measured Windows cells. On top of that:
QG-03b closed the preprocessing blocker, QG-03b-2 and QG-03b-2a settled capture-format
conformance, QG-03a-B2 measured real backend noise, and QG-03a-B3-1 measured all of it inside
the real MV3 extension on workstation 1.

**INFERENCE.** "No browser/backend matrix has been run" is simply out of date. But item 9
cannot be called PASS either, because `model-adoption.md` blocking rule 1 is explicit: *"no
model enters the build until its row is complete across all four combinations"*, and the
fourth column is **Firefox WASM on Linux**, which no Linux environment has ever run. Firefox
WASM on *Windows* passes (33–36 ms p50, correct, deterministic, 3/3 in both display modes) and
is **a different cell**.

**Recommendation: `CONDITIONAL`, with the gap named** — Firefox WASM on Linux unmeasured, and
Firefox WebGPU headless `REJECT` on Windows. Needs **one environment**, not new science. It is
the same Linux gap that already blocks B-02-1 and S-02a.

### Item 11 — acceptable detector metrics

**FACT.** Held-out figures, threshold 0.05 under the old selection rule: element mAP@0.5
**0.7955**, element recall **0.9229**, grounding accuracy **0.0547**. On **dev** at the
frozen rule's operating point 0.55: mAP 0.6949, recall 0.8159, grounding **0.5678**, F1
0.6696, 26.7 predictions per screen versus 296.1 at 0.05.

**FACT.** The 0.055 figure is a *threshold artefact*, diagnosed and documented in
`docs/testing/threshold-selection.md`: the old rule maximised mAP@0.5, which is almost flat
across thresholds (range < 0.01 within the plateau while grounding's range is more than ten
times that), so the rule *could not see the axis it was moving along* and selected the lowest
threshold on the grid. The replacement rule — maximise `F1(element recall, grounding
accuracy)` on dev — is **frozen** and deliberately **has not been applied to a held-out
split**.

**FACT, and this is the binding constraint.** Three separate things stand between today and a
defensible item 11:

1. **No unread split exists.** The test split was already read once under the old rule, so it
   is no longer fully held out. Applying the new rule to it would produce a figure whose
   honest provenance is *"the second look at a consumed split"* — and it would sit in the
   report looking like a first look.
2. **The required evidence source does not exist.** `docs/testing/benchmark-contract.md`
   Rule 2 names it exactly: *ScreenSpot-v2 web subset plus 300 self-labelled Indian government
   and banking screens, including scanned-document pages where the DOM is empty*, reported
   **twice — on clean frames and on redacted frames**. QG-05's own gate README states plainly
   that **neither exists**, and that everything measured so far is **synthetic**.
3. **The evaluator has a known recall ceiling of 94.4%** on dev, because a `CLIPPED`
   annotation is scored against its full CSS box: 51 clipped annotations, median visible
   fraction 0.368, and for 42 of them IoU ≥ 0.5 against their own label is **arithmetically
   unreachable by any detector**. That definition is frozen, and changing it changes the
   metric — which must not happen while a held-out figure is being interpreted.

**INFERENCE.** Item 11 therefore **cannot be closed by any amount of re-scoring**, and
**C3/C4 cannot substitute** — those are synthetic renders produced to probe geometry and
scale, not a real-UI grounding benchmark, and C3's own record says its numbers are synthetic.
Item 11 needs **real data**, then a **first** application of the frozen rule to an **unread**
split. The redacted half additionally needs T2, which does not exist.

**Recommendation: item 11 stays `FAIL`.** It is the gating item, and it is a **data** problem
before it is a model problem.

### Item 12 — browser correctness verified

**FACT.** The exact artifact has been verified against a native reference in Chromium 151 and
Firefox 155 across WASM and WebGPU, headful and headless — element-wise agreement inside a
pre-registered criterion (class 1e-4, box 0.25 model px; worst observed 5.6e-06 and 1.6e-03),
bitwise-identical repeated inference, 3/3. QG-03a-B2 then measured it under real backend noise
through the shipped decode and NMS. QG-03a-B3-1 re-verified the model **inside every realm** of
the real MV3 extension, against native ORT 1.29.0 CPU, in four independent cells — 100% matched
at IoU 0.5, count change 0, 0 survivor swaps, 0 true failures, worst displacement **0.002893
CSS px** against a 2.0 px bound, the two realms bitwise identical, backend proved by counted
`GPUQueue.submit` (180 WebGPU, 0 WASM). Preprocessing is bitwise identical to the Python
reference in all cells after the `roundHalfEven` fix.

**INFERENCE.** "Only Python `onnxruntime` CPU" is no longer true by a wide margin. This is the
best-evidenced item on the bar.

**Recommendation: PASS.** Scope it honestly: **Windows**, Chromium 151 / Chrome for Testing
151, Firefox 155.0.1; **Linux is UNKNOWN**; Firefox WebGPU headless does not acquire an
adapter, which is a feasibility fact (item 9) rather than a correctness failure.

### Item 13 — memory / latency characterized

**FACT — latency.** p50 on the fixed fixture, workstation 1: Chromium WASM 41.0 ms headful /
28.2 ms headless; Chromium WebGPU 11.6 / 10.9 ms; Firefox WASM 33.0 / 36.0 ms; Firefox WebGPU
headful 100 ms (8.6× slower than Chromium WebGPU, and slower than its own WASM backend);
Firefox WebGPU headless did not load.

**FACT — memory.** WASM linear memory 26.4 MB on WASM cells and 16.0 MB on WebGPU cells. The
0.30 MB model accounts for essentially none of it; JS heap is recorded separately.

**FACT — the gap.** `release()` returned **no memory in any cell** (QG-03e, `UNKNOWN`), and
`S-04` — whether three ORT sessions coexist in one WASM heap inside an offscreen document and
whether teardown reclaims memory — is `UNKNOWN`. `model-adoption.md` step 5 requires exactly
that. The dossier's client-resources metric additionally wants peak GPU memory, CPU share,
tier firing distribution and cold-versus-warm start, none of which is measured, and the
benchmark contract requires cold and warm start as **separate** figures.

**INFERENCE.** Latency and WASM-heap **characterisation** is done for one workstation; the
**lifecycle** half is not, and it is the Rule 6 landmine the dossier explicitly warns about.

**Recommendation: `PARTIAL`, not PASS.** Needs the S-04 / QG-03e experiment — a real
measurement, but a small and well-specified one, and it is **not detector-specific**: it is
needed for every model the project intends to load.

### Item 14 — AgentOS reviews PASS

**FACT.** `artifacts/gates/T1-detector-training/agentos-review.md` records
**`CONDITIONAL_PASS` on the pipeline**, with the detector not adopted and the registry
unchanged. Individual sections pass — loss formulation, class-order handling, tensor layout,
letterbox handling, the training/runtime boundary (now test-enforced), no runtime model
download, weights never committed, T2 untouched. The conditionality is the pipeline's, not a
reviewer's objection.

**INFERENCE.** Item 14 is not a clean PASS today, and it is **not independently closable**: a
review's verdict follows the evidence under review, so items 9 and 11 move first. Two things
must also reach the reviewers that post-date the review: the **C3/C3b attribution and the
QG-03a-C resolution**, and the **scale-generalisation finding QG-03a-C4**.

**Recommendation: `CONDITIONAL_PASS`, re-reviewed after items 9 and 11 move.** A review run
now would re-state what it already said.

---

## 2. Answers to the five audit questions

**Closable on existing evidence — recommendation only, owner decision required:**

- **Item 12 → PASS**, scoped to Windows / Chromium 151 / Firefox 155.
- **Item 9 → `CONDITIONAL`**, replacing a stale "NOT DONE" with the two named gaps.
- **Item 13 → `PARTIAL`**, replacing "NOT DONE" with the measured half plus the lifecycle gap.

Nothing here **passes** the bar, and no status changes in this document.

**Requires new data (not a new experiment, not a new model):**

- **Item 11.** Real evaluation data as the benchmark contract defines it, **and an unread
  split**. Both, not either.

**Requires new experiments (no new data, no retrain):**

- **Item 9** — Firefox WASM on **Linux**, one cell. Shares an environment with B-02-1 and
  S-02a.
- **Item 13** — **S-04 / QG-03e**: session coexistence and whether teardown reclaims memory.
- **Item 11's scale question** (`QG-03a-C4`) — a **scale-controlled** evaluation, which is the
  experiment C3 could not be. It **cannot** close item 11 on synthetic renders; it can
  establish where the detector's behaviour changes with object scale.

**Requires a new detector revision (retrain):**

- **Nothing on the bar requires a retrain today, and this audit does not propose one.** Two
  items would *benefit* from one and neither justifies it alone: the **§6 label/raster debt**,
  whose exact change is already written and which QG-03a-C has just resolved as
  no-demonstrated-production-defect; and **scale generalisation** (`QG-03a-C4`), where the
  honest position is that the cause is **not yet isolated** — `augmentation: "none"` and a
  stride-8 head are plausible contributors, not measured ones. **Retraining before the cause
  is isolated would be guessing**, and it would invalidate the frozen regression baseline in
  `artifacts/gates/T1-detector-training/` by construction.

**Requires an owner decision:**

1. Whether to move items 9, 12 and 13 as recommended above — they live in a **frozen gate
   record**, so an agent must not move them.
2. Whether to authorise a **real evaluation dataset** workstream (item 11's only route).
3. Whether a **capture-scale policy** is in scope at all. **No scale or capture-size bound
   exists today** — ADR-0002 is a *format* policy (PNG only) and the dossier's only capture
   constraint is an 18 ms latency budget. Creating one is a product decision; this audit
   invents none.
4. The **per-class threshold** question, already recorded as open with its own evidence
   requirement in `threshold-selection.md`, and explicitly not adopted on 40 dev screens.

---

## 3. The minimum next workstream — specification, not implementation

Two candidates are defensible and they are **not interchangeable**. The recommendation is to
run them in this order, because the first unblocks the gating item and the second is cheap
enough to run alongside.

### W-A (primary) — real-UI evaluation data and a genuinely unread split

**Why first.** Item 11 is the gating item; it is a data problem; and **no other work can close
it**. Every figure the project currently holds for the detector is synthetic, and the frozen
threshold rule is waiting on a split that has never been read.

**Pre-registration must fix, before any data is collected:** the corpus definition and its
provenance; the split policy, with the **new test split sealed and unopened**; the labelling
procedure and its inter-annotator agreement; how DOM-empty pages (scanned documents) are
handled; the licence and privacy position for every screen collected; and the **exact**
report: element mAP@0.5, element recall, grounding accuracy, at the operating point the frozen
rule selects **on the new dev split**.

**Non-negotiables, carried from existing governance:** the frozen rule is applied **once**, to
an **unread** split; the consumed split stays consumed and is not re-reported as a first look;
the **CLIPPED** definition stays frozen for the run, with the **94.4% recall ceiling reported
alongside** rather than corrected mid-interpretation; `PROVISIONAL_THRESHOLDS.score` stays
**0.25** until a rule-selected threshold exists from an unread split; and the detector artifact
stays **`ba6d9e93…`**.

**What it can and cannot produce.** It can produce the **first defensible item-11 figure**. It
**cannot** produce the redacted half of the visual-context metric, which needs T2. So even a
clean W-A leaves QG-05 partial — and that must be stated up front, not discovered at the end.

**Scale.** Order 300 real screens plus the ScreenSpot-v2 web subset, per the benchmark
contract. This is a **data-collection and labelling** workstream with real cost, a licence
question and a privacy question. It is the largest honest item on the project's critical path
and it should be scoped with the owner before a line is written.

### W-B (secondary, cheap, and strictly attribution) — scale-controlled evaluation for C4

**Why.** C3 found a monotone collapse with CSS px per model px (1.50 → ~0.60 mAP, 1.60 → ~0.66,
1.98 → ~0.66, 3.00 → ~0.06, 4.00 → ~0.004) and C3b proved the letterbox convention is not the
cause. What is **not** established is *why*, and a number that is not understood must not
become a policy.

**Pre-registration must fix:** capture geometries chosen so that **object scale in model space
is the only varying quantity**; a statistic that actually measures what C3 could not — C3's own
record states that `minMatchedIou` and `worstMatchedDispCss` were **structurally uninformative**
because the matcher gates at IoU 0.5, so a matched-pair IoU distribution, or displacement
relative to element size, must be pre-registered instead; and a stated position on the
stride-8 hypothesis (a ~14 CSS px control shrinking below one feature cell) that can be
**contradicted** by the result.

**What it can and cannot produce.** It can attribute the scale effect and tell a future
training revision what to fix. It **cannot** close item 11, **cannot** justify a retrain by
itself, and **must not** be used to derive a production capture limit — the corpus is synthetic
and was never designed to bound a policy.

### Not recommended as the next step, and why

- **Retraining** — the cause of the scale effect is not isolated, so the change to make is
  unknown; it would invalidate the frozen regression baseline; and both candidate motivations
  are explicitly unjustified on their own.
- **A capture-size policy** — that would be inventing a production limit from synthetic
  numbers, which the governance rules forbid and which W-B exists to inform.
- **Re-scoring the consumed test split** under the new rule — it would look like a first look
  and would not be one.
- **Per-class thresholds** — eight thresholds fitted on 40 dev screens is a fitting exercise,
  as `threshold-selection.md` already records.

---

## 4. Status after this audit

**Unchanged, all of it.** Detector **UNADOPTED**; `model-registry.md` untouched and its
adoption record still empty; threshold **0.55** with the shipped constant still **0.25**;
artifact `ba6d9e93…` unmodified; evaluator and its CLIPPED definition frozen; QG-05 evidence
untouched; adoption items **9, 11, 12, 13, 14** exactly as the gate record states them.
**QG-03a is `OPEN`** and **QG-03 is `CONDITIONAL`**. QG-03a-C is `RESOLVED /
CONDITIONAL-RESOLVED` by owner decision; **QG-03a-C4 is `OPEN`**.
