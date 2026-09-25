# QG-03 — which input decides the WASM correctness cell? · DECISION RECORD

> **Status: APPROVED — OPTION A.** Decided 2026-09-25 by the repository owner, **Ronit Saha**
> (`ronitsaha11`). The decision is recorded in [§0](#0-owner-decision--approved-option-a); the
> question as it was put to the owner (M7.3) follows unchanged below it.
>
> **For the text-region model adoption cell, the realistic fixed text-bearing fixture governs the
> WASM correctness check.** Statistic: relative `sumAbs` error. Threshold: **≤ 2e-2**. Both
> unchanged.
>
> This decision changes no threshold, no statistic and no verdict. QG-03 is **not** marked passed for
> any model, and `PP-OCRv5_mobile_det` remains **`REJECTED FOR V1`** — on text-region geometry, which
> this question never touched.

## 0. Owner decision — APPROVED, OPTION A

| Field | Value |
|---|---|
| **Decision** | **APPROVED** |
| **Option** | **A** — the fixed, realistic fixture decides the correctness cell; the synthetic input is recorded but does not decide |
| **Scope** | **The QG-03 WASM correctness cell for a text-region model** — every text-region candidate from M8 onwards. Not generalised to any other model class; no other gate definition is rewritten |
| **Deciding input** | the **realistic, fixed, text-bearing fixture** — the same fixed fixture the cell's p50 is measured on, named with its hash in the candidate's QG-03 artifact |
| **Statistic** | **relative `sumAbs` error** vs native `onnxruntime` of the same version — the frozen S-04a-1 rule, **unchanged**, including its exact output-count check |
| **Threshold** | **≤ 2e-2** — unchanged |
| **Approved by** | **Ronit Saha** (`ronitsaha11`), repository owner |
| **Date** | **2026-09-25** |

The owner's reasoning, as given: the synthetic input contains no meaningful text signal and produces
near-zero outputs, which makes the relative statistic non-representative for this model's intended
input domain.

### What happens to the synthetic S-04a-1 result

It stays exactly as recorded — **4.12e-02, over the bound** — and so does the realistic result,
**4.23e-06, within it**. Neither is erased, re-labelled or re-run. The synthetic measurement is not
*wrong*: it is a correct measurement of the runtime in the saturated, text-free regime, and it
remains reproducible from the M7.1 harness.

Its role from here is **reference, regression and diagnostic evidence**:

- **reference** — it reproduces S-04a-1's own number for the same model and runtime pairing, which is
  what showed the M7.1 reconstruction was faithful;
- **regression** — a later runtime or conversion that moves it is a change worth explaining;
- **diagnostic** — it documents how a segmentation output behaves in the sigmoid's tail, where a
  relative bound on tiny sums is dominated by conditioning rather than by runtime disagreement.

It is **not** the deciding QG-03 correctness cell for a text-region adoption decision.

### What this does and does not unblock

**Unblocked:** QG-03's WASM correctness cell now has a defined input for text-region candidates, so
precondition 3 of M8 is met. A future text-region candidate must satisfy **all** of:

1. realistic-input WASM correctness — relative `sumAbs` ≤ 2e-2 on the fixed realistic fixture (this
   record);
2. RE-1's redaction criteria, G1–G6 and the set-size floor, on the held-out set, as pre-registered in
   [`redaction-evaluation.md`](../perception/redaction-evaluation.md) — whose G5 separately requires
   the same rule on **every** realistic input;
3. deterministic behaviour (RE-1 G4);
4. privacy-safe output — no field capable of holding a character sequence (RE-1 G6);
5. every other QG-03 and model-adoption requirement — pin, licence at the pinned revision, all four
   feasibility cells, coexistence and teardown, benchmark artifact, review, owner decision.

**Not unblocked:** adoption. Passing the realistic WASM criterion makes a candidate's correctness
cell pass; it does not make the candidate adopted, does not pass QG-03, and does not substitute for
any other item above. The adoption gate remains separate.

**Not reopened:** `PP-OCRv5_mobile_det` stays **`REJECTED FOR V1`**. Under this reading its WASM cell
would pass, which changes nothing — its rejection rests on localisation, not on the runtime — and it
is not re-submitted under RE-1.

---

*The record below is the question as put to the owner on 2026-09-25 (M7.3), unchanged.*

## The two results

Same pinned model (`PP-OCRv5_mobile_det @ 0d63e78e`, reconstructed ONNX `d9056b16…`), same runtime
pairing (ORT Web 1.29.0 `wasm`, one thread, pinned binary `db816fad…` against native `onnxruntime`
1.29.0 CPU), same frozen statistic — **exact output count, and relative error of `sumAbs` ≤ 2e-2**:

| input | relErr(sumAbs) | max \|web − native\| | output range | under the frozen bound |
|---|---|---|---|---|
| **synthetic** — S-04a-1's `x[i] = ((i·37) mod 255)/255`, 640×640 | **4.12e-02** | 1.8e-07 | 8.9e-08 … 1.5e-06 | **fails** |
| **realistic** — the M7 fixture screenshot, 640×1024 (S-04a-1a) | **4.23e-06** | 2.3e-04 | 0 … 1 | **passes** |

**Why they differ.** The synthetic input contains no text, so a text-segmentation model outputs
"no text" everywhere: every value sits between 1e-7 and 1.5e-6, deep in the sigmoid's tail. There the
relative error of a sum of tiny values is dominated by the exponential amplifying a small logit
difference — S-04a-1 measured 0.29 % at the logit level becoming 4.12 % after the sigmoid — while the
largest absolute disagreement is 1.8e-07. On a real page the output is a genuine probability map, and
web and native agree to 4.2e-06 relative. Both measurements are correct; they measure the runtime in
different numerical regimes.

## The exact wording that has to be interpreted

- **QG-03** (`agentos/gates/README.md`): *"Each cell records all four values: session loads, **p50 on
  the fixed fixture**, peak heap, **correctness vs known-good reference**."* · *"**The WASM columns
  pass.** A model that fails them is not shipped whatever it does on WebGPU."*
- **Benchmark contract, Rule 3** (`docs/testing/benchmark-contract.md`): *"Output correctness against
  a known-good reference."* Gating rules FROZEN: *"A model that fails the WASM columns is not
  shipped."*
- **Model adoption, step 4** (`agentos/workflows/model-adoption.md`): *"p50 latency on the FIXED
  fixture … output correctness vs a known-good reference."*
- **S-04a-1** (`W1-S04a1-four-model-residency`): a four-model **residency spike** whose correctness
  check used the synthetic input, and which filed *"S-04a-1a — validate `ocr_det` … with realistic
  text-bearing input … p1 … QG-03, correctness sign-off"* as a follow-up.

**None of these names the input for the correctness value.** QG-03 names *the fixed fixture* for p50
and *a known-good reference* for correctness, and leaves the correctness input implicit.

## Precedent, stated as fact rather than as an argument

The one feasibility row the repository has completed — the T1 UI head in
`agentos/registry/feasibility-matrix.md` — defined `CORRECT` as *"element-wise agreement with a Python
reference inside a **pre-registered** criterion"*, measured on **real fixture images** (45
fixture/encoding pairs across 8 cells), with its own statistic (class channels 1e-4, box channels
0.25 model px). S-04a-1's `sumAbs` criterion was set for a spike across four different models, not
as a QG-03 cell for this one.

## The readings that are possible

| | reading | consequence for a text detector |
|---|---|---|
| **A** | The correctness cell is measured on the **fixed, realistic fixture** — the same input as p50. The synthetic input is spike data, recorded but not deciding. | Matches the completed T1 precedent. On this reading PP-OCRv5's WASM cell would pass — which changes nothing, because it is rejected on geometry. |
| **B** | **Both** must pass: the realistic fixture **and** the synthetic input. | The most conservative. For a segmentation model it means the text-free saturated regime must also meet a relative bound on tiny sums, which S-04a-1's own analysis attributes to conditioning, not to a runtime fault. |
| **C** | S-04a-1's **synthetic** input is the frozen authority. | Treats a residency spike's input as the gate's input. Runs against S-04a-1's own record, which deferred correctness sign-off to S-04a-1a and QG-03. |

RE-1 already requires every **realistic** input to pass (G5) and records the synthetic result, and it
states explicitly that QG-03's column remains the gate owner's. **RE-1 does not answer this question,
and this record does not either.**

## What the owner must decide

1. **Which reading — A, B or C — governs QG-03's WASM correctness cell** for models whose output is a
   probability map (segmentation / text-region detectors).
2. **Which statistic that cell uses** for such a model: S-04a-1's `sumAbs` relative bound, an
   element-wise pre-registered bound as the T1 row used, or both. The 2e-2 bound itself is not in
   question here and is not changed.
3. Whether the decision applies to **all future candidates** from M8 onwards (the natural scope).

| Field | Value |
|---|---|
| **Decision** | ☒ A ☐ B ☐ C ☐ other: ____ — see §0 |
| **Statistic** | ☒ sumAbs ≤ 2e-2 ☐ element-wise, pre-registered per model ☐ both — see §0 |
| **Approved by** | Ronit Saha (`ronitsaha11`) — see §0 |
| **Date** | 2026-09-25 |

This must be decided **before** an M8 candidate reaches QG-03 (RE-1 step 7). It does not block the M8
inventory, the development screen or the held-out RE-1 evaluation, all of which already require the
realistic inputs to pass. *(Decided — §0. On scope, question 3: the owner limited the decision to
text-region models, narrower than the "segmentation / text-region" framing of question 1.)*
