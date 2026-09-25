# Visual text — the acceptance criteria, pre-registered

> **STATUS NOTE, appended 2026-09-25 — nothing below this note has been changed.**
> This document is the **criterion of record for `PP-OCRv5_mobile_det`**, which was evaluated under it
> and is **`REJECTED FOR V1`** (M7.1). Candidates evaluated **after** 2026-09-25 are judged instead by the
> **NEXT-CANDIDATE CRITERION**, RE-1: [`redaction-evaluation.md`](redaction-evaluation.md). RE-1 is not a
> re-reading of this document and does not re-score PP-OCRv5.

> **Status: PRE-REGISTERED, 2026-09-25. Frozen before any candidate was evaluated.**
>
> Written before the fixture's text geometry had been measured against any model output, and before
> any candidate's weights existed on W1. Every threshold below is either **quoted from an existing
> frozen rule** or **chosen here with its reason stated**. Nothing in this file may be changed after
> a result is observed; a threshold that turns out to be wrong is changed by an owner decision that
> records what was learned, not by an edit.
>
> This file is a *gate*, not a plan. It does not authorise a download, an integration or a
> dependency.

## The question

**Can PratiBimb protect visually rendered sensitive information without exposing the secret to the
reasoner?**

Not "can it read the text". Reading is the thing to avoid.

## The architecture this is a gate for

```
RAW PIXELS (offscreen realm)
  → LOCAL TEXT-REGION DETECTOR        ← boxes and scores. NO CHARACTERS.
  → LOCAL SENSITIVITY POLICY          ← which boxes must not leave
  → REDACTION REGION                  ← opaque fill, composited locally
  → SANITIZED CONTEXT                 ← what the reasoner is given
```

**A detector that never emits characters is architecturally preferred, and the preference is
structural rather than stylistic.** The perception realm owns pixels; the content realm owns
plaintext. A region detector produces nothing that would have to cross between them, so there is no
field to forget to strip, no vault entry to make, and no second redaction path. The alternative —

```
PIXELS → OCR → PLAINTEXT → worker → content vault
```

— recreates exactly the realm-boundary problem M2 exists to prevent, and is **rejected as an
architecture** independently of any model's accuracy.

**Consequence, stated in advance:** a candidate that emits characters and cannot be constrained to
emit only geometry is **not accepted on accuracy**. Its architectural problem is recorded and it is
not integrated.

## Criterion 1 — WASM correctness · **FROZEN, quoted, not re-set**

From `W1-S04a-1`, set from a measured conditioning bound before any model was judged by it:

> **exact output count + `sumAbs` within 2e-2** of the native reference.

And from `agentos/workflows/model-adoption.md`, **Blocking rules — FROZEN**, rule 2:

> **A model that fails the WASM columns is not shipped, whatever it does on WebGPU.**

The extension creates its ORT session with `executionProviders: ["wasm"]`. **This criterion is not
modified by this document and may not be modified to admit a candidate.**

## Criterion 2 — localisation · IoU ≥ 0.5 · **quoted**

`constitution.md` §7 freezes the fused element graph at **IoU > 0.5**. The same bar is reused rather
than a new one invented: for each **sensitive** ground-truth text region, at least one predicted
region must reach **IoU ≥ 0.5**.

## Criterion 3 — coverage of the secret · ≥ 0.95 containment · **chosen here, with its reason**

IoU alone is the wrong instrument for redaction. A box can score well and still leave the last two
digits of an identifier outside it.

> **≥ 95% of each sensitive region's area must be covered by the union of predicted regions.**

Chosen because redaction is an area property, not a similarity property: what matters is whether any
ink is left showing. 95% of a 14-character string is roughly two-thirds of one character at an
edge — the largest gap that cannot reveal a full glyph. It is a bar, and it is stated before any
measurement so that a result cannot be used to argue it down.

## Criterion 4 — false positives · ≤ 3× the true text area · **chosen here, with its reason**

Covering everything covers the secret. That is not detection.

> **The total predicted text area inside the visual-only region must be at most 3× the total
> ground-truth text area inside it**, and **no predicted region may cover ≥ 90% of the whole
> canvas**.

Grounded in a known failure mode rather than invented: QG-05 measured the current UI head at **3947
predictions for 202 ground-truth buttons** — roughly 20× — and M3.1 measured **20 detections inside
this fixture's canvas with a best IoU of 0.066**. A detector behaving that way must fail this
criterion, and 3× is chosen to be generous to a real text detector while still failing a flood.

## Criterion 5 — no plaintext · structural, not statistical

- The adapter's output type has **no field capable of carrying a character sequence**, checked by
  reading the type rather than by inspecting a run.
- The existing `TextFinding` seam — a box, a length, a class, and no string — is the interface. Per
  blocking rule 4, **the interface does not change to accommodate the model.**
- A run must show no page-rendered string in the worker's messages, in the reasoner's input, or in
  anything leaving the client.

## Criterion 6 — determinism

Two consecutive runs on the same fixture, same build, same machine must produce **identical**
region counts and identical boxes. A detector whose output moves between runs cannot be the basis of
a redaction decision.

## Criterion 7 — latency and memory · **recorded, and budgeted from the dossier only**

Reported per stage on W1: model load, preprocess, inference, postprocess, total, peak heap, artifact
size.

**No latency threshold is set here.** The one candidate measured 234 ms inference in `W1-S04a-1`, and
a bar set near that number would be a bar reverse-engineered from the candidate it is meant to
judge. Latency is recorded as data; if it later needs to gate, the number comes from a published
budget or an owner decision, not from this document.

Memory is subject to the existing coexistence requirement in **QG-03**: *"coexistence with the other
resident sessions is verified, and teardown reclaims memory."*

## Criterion 8 — what the fixture can and cannot establish

`tests/browser/extension/fixture/visual.html` is **one synthetic page**. It is a **gate-0 screen**:
a candidate that fails on it is rejected cheaply, and a candidate that passes has established
nothing about accuracy.

**Adoption additionally requires QG-03 in full** — all four feasibility cells, licence read at the
pinned revision, a benchmark artifact, coexistence and teardown — and a **held-out** evaluation set
that is not this fixture. Passing the screen is permission to do that work, not a substitute for it.

## The order of operations

1. Inventory. No download.
2. This file. No result yet.
3. Screen on the fixture, against the geometry the page measured of itself.
4. QG-03 in full, including the frozen WASM criterion.
5. Only then, integration — and only behind the unchanged `TextFinding` seam.

A candidate may be **REJECTED** at any step, and per blocking rule 5 it is *"recorded as REJECTED
with its artifact. It is not quietly swapped out."*
