# M4 Part C — local text perception: the audit, and why nothing was integrated

> **Answer up front: a licence-verified, revision-pinned local OCR path already exists in this
> repository's registry, and it is blocked by a FROZEN rule the repository wrote before this
> milestone.** `PP-OCRv5_mobile_det` fails its own stated correctness criterion on WASM, and WASM is
> the only backend the extension runs. Nothing was downloaded, nothing was integrated, and no
> threshold was moved to make it look adoptable.

## 1 · Is there already an OCR/text substrate?

**In the registry, yes. In code, no.**

`agentos/registry/model-registry.md` names the role `OCRProvider` → *PP-OCRv5-mobile via
`paddle2onnx`*, Apache-2.0, ONNX Runtime Web, status `PINNED-UNVERIFIED`.

`packages/perception` has **no** text detector, no OCR adapter, no recogniser, no text class and no
`TextRegion` type. `UI_CLASSES` is eight interactable classes; `Detection` is a box, a label from
that list, and a score. Searching the tree for `ocr|tesseract|paddle|text.detect|character
recognition` returns registry rows, feasibility records and experiment prose — **not one line of
implementation**.

So there is a named role and a measured feasibility row, and there is nothing to call.

## 2 · Is there an existing approved local runtime?

**Yes, and it is already running.** ONNX Runtime Web **1.29.0**, WASM, `numThreads = 1`, loaded
through ADR-0001's `installVerifiedOrtRuntime` → `createPinnedInferenceSession`, with the WASM
binary re-hashed against `db816fad…a44dea` before any session exists. The offscreen perception realm
creates one session per document today. A second model would use the same factory in the same realm.

**No new runtime is needed for OCR.** That is the one part of this question with an unambiguously
good answer.

## 3 · Is there an existing pinned model/artifact?

Revisions were pinned and measured by
[`W1-S04a-1`](../W1-S04a1-four-model-residency/README.md):

| | revision | weights | heap | solo peak | load | inference |
|---|---|---|---|---|---|---|
| `PP-OCRv5_mobile_det` | `0d63e78e` | 4.60 MB | 23.1 MB | 69.2 MB | 474 ms | **234 ms** |
| `PP-OCRv5_mobile_rec` | `682f2053` | 15.79 MB | 62.9 MB | 62.9 MB | 527 ms | **79 ms** |

**The artifacts are not present on W1.** `artifacts/models/` contains `t1-ui-head` and nothing else;
weights are gitignored and never committed. Both rows are still `PINNED-UNVERIFIED` in the registry —
*"Revision not yet pinned to a hash. Feasibility not tested."* — which is now out of date in the
model's favour and has not been promoted, because promotion needs QG-03.

## 4 · Licence and provenance

**Apache-2.0**, verified on 2026-09-09 by reading the model-card front-matter **at the pinned
revision** via `huggingface.co/<repo>/raw/<revision>/README.md`. Neither repository carries a
separate `LICENSE` file, and the record says so rather than claiming more: the in-repo declaration
at the revision is the strongest available evidence.

That is genuinely better provenance than the UI detector's option A, which is licence-excluded.

## 5 · Client CPU and memory cost — measured, not projected

From the same residency experiment, marginal cost of adding each model to a realm that already has
the others:

| added | resident | marginal |
|---|---|---|
| + `ocr_det` (2nd model) | 23.1 MB | **+7.1 MB** |
| + `ocr_rec` (3rd model) | 80.4 MB | **+57.3 MB** |

Against the product's current per-reading budget (capture 38–52 ms, decode 11–22, preprocess 32–71,
inference 45–103, **total 138–248 ms**), adding both OCR stages would add **~313 ms of inference per
frame** and **~1 s of one-time load** — roughly tripling the cost of looking at a page. That is a
real number and it is not disqualifying on its own; it is recorded so the decision is made with it
rather than around it.

## 6 · Can it execute entirely in the perception realm?

**Yes.** Same ORT factory, same offscreen document, same pinned WASM, same `OffscreenCanvas` for
preprocessing. No new realm, no new permission, no network at inference time. The frame is already
there and is already dropped at the end of the pass.

## 7 · Can its output remain inside the privacy boundary?

**Inside the perception realm, yes.** Text produced there would have exactly the lifetime the pixels
have and would leave only as a sanitized descriptor.

## 8 · Can OCR output be protected by the **existing** vault? — **No, and this is the finding**

**The vault is in the content script's isolated world.** M2 put it there deliberately, because that
is where the page's values are, and the whole milestone turned on the fact that a value cannot reach
the offscreen realm without crossing the worker.

**OCR text would be produced in the offscreen realm.** Putting it into the existing vault would mean
sending a recognised string *down* to the page realm — through the worker. That is the M1 problem
exactly, running in the other direction, and it would break the invariant M2 exists to hold.

The three ways out, none of them small, and none of them taken here:

1. **A second vault in the perception realm.** Explicitly forbidden, and rightly: two vaults is two
   redaction contracts and two things to keep correct.
2. **Move the vault to a realm that has both.** Nothing has both. The content script cannot get
   pixels; the offscreen realm cannot read the DOM.
3. **Never recognise the text at all — detect the region and redact it unread.** No string is
   produced, so no string needs a vault. See §9.

**Whatever else M4 concluded, this is the part that decides the shape of the next milestone**, and
it was not visible before the vault and the pixels were both real and in different places.

## 9 · Is OCR necessary, or would a text-region detector suffice?

For **redaction**, recognition is not necessary. A region detector locates text; masking a region
does not require reading it. That path needs `ocr_det` and **not** `ocr_rec`, produces no string at
all, and therefore sidesteps §8 entirely — the most privacy-preserving option is also the cheaper
one, which is not usually how this goes.

For **planning over visually-rendered content** — "type the reference shown on the card" — recognition
is necessary, and so is §8's unsolved question.

**The irony is measured:** the half a redaction strategy needs is the half that fails.

## The blocking rule

`agentos/workflows/model-adoption.md`, **Blocking rules — FROZEN**, rule 2:

> **A model that fails the WASM columns is not shipped, whatever it does on WebGPU.**
> The judging machine is more likely to be the WASM one.

And the measurement, from `W1-S04a-1b`, against a criterion fixed **before** the run (exact output
count + `sumAbs` within 2e-2, about 3× the measured noise floor):

| model | native | **WASM** | WebGPU |
|---|---|---|---|
| `PP-OCRv5_mobile_det` | ACCEPT | ❌ **4.12e-02** | ACCEPT (4.96e-03) |
| `PP-OCRv5_mobile_rec` | ACCEPT | ACCEPT (5.51e-06) | ACCEPT |

The detection half **fails on the only backend the extension uses**. The record's own note is that
the logit analysis explains the discrepancy and no evidence suggests a runtime defect — *"but the
criterion is the criterion, and validation under realistic input has not been done."*

## Decision

**Do not integrate a text model in M4.** Declining is the default the frozen rule already sets;
adopting would require an ADR overriding it, and this milestone has no evidence that would justify
one.

**What was built instead** is the seam: a text-perception port in the perception realm that is
**absent by default and refuses** — `TEXT_PERCEPTION_UNAVAILABLE` — in the same way
`createUiElementDetector(null)` refuses rather than returning an empty list, because an empty result
is indistinguishable from a page with no text on it. The provenance vocabulary gains `text` so the
architecture can express the distinction before anything can produce it.

**What would unblock it**, in the order the repository's own process wants:

1. Re-run S-04a-1's correctness criterion for `ocr_det` **under realistic input** rather than the
   synthetic probe, which the original record names as the missing validation.
2. If it still fails on WASM: either take the **detect-only, never-recognise** path (§9), which
   needs that same model, or record `REJECTED` with the artifact and look at the ranked fallback.
3. Resolve §8 — where a recognised string could live — **before** any recogniser is adopted, not
   after.

None of that is a model-selection exercise, and none of it should start with a download.
