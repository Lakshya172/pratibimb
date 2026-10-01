# M5 Part C — a text-region detector, without recognition: the audit

> **Result: NOT YET IMPLEMENTABLE WITH APPROVED LOCAL ARTIFACTS.**
>
> The repository contains **exactly one** candidate for locating text without reading it. It is the
> detection half of the OCR role, its licence is verified at a pinned revision, and it **fails this
> repository's own frozen WASM correctness criterion** — which is the one backend the extension
> runs. Declining is not a judgement formed here; it is the default a frozen rule already sets.
>
> No model was chosen, none was downloaded, and no threshold was moved.

## What was searched, and what came back

The whole tree, for every name a text-region capability could be hiding under:

```
text detection · text region · scene text · OCR detection-only · text boxes
EAST · DBNet · CRAFT · text localization · document region · character boxes
visual text · browser text detection · canvas text detection · ONNX text detector
```

**Every hit was prose.** Registry rows, feasibility records, experiment write-ups, and M4's own
audit. There is no `TextRegion` type, no text detector, no adapter, no second candidate and no
unlisted pinned artifact anywhere in `packages/`, `apps/` or `artifacts/models/`.

The registry names **seven** model roles. One is `PINNED` — the text reasoner, `Qwen2.5-0.5B`, which
never sees a pixel. The other six are `PINNED-UNVERIFIED`. `artifacts/models/` on W1 contains
`t1-ui-head` and nothing else.

## The one candidate

`OCRProvider` detection stage — **`PP-OCRv5_mobile_det @ 0d63e78e`**.

This is exactly the capability Part C describes: it locates text and does not read it. Its output is
regions, not characters, so a seam around it would be **structurally incapable of carrying
plaintext** — no `recognizedString` field would exist to forget to remove, and §F's redaction path
would need no vault entry because there would be no literal to store.

| | |
|---|---|
| Licence | **Apache-2.0**, verified 2026-09-09 against the model card **at the pinned revision** |
| Weights | 4.60 MB · heap 23.1 MB · solo peak 69.2 MB |
| Marginal residency | **+7.1 MB** as a second model beside the UI head |
| Load | 474 ms · **Inference 234 ms** |
| Present on W1? | **No.** Weights are gitignored and were not retained after W1-S04a-1 |
| Native (CPU) | ACCEPT |
| **WASM** | ❌ **4.12e-02** against a **2e-02** bound |
| WebGPU | ACCEPT (4.96e-03) |

The criterion was fixed **before** that run — exact output count plus `sumAbs` within 2e-2, about 3×
the measured noise floor — so this is not a bar moved afterwards to exclude anything.

## Why that settles it

`agentos/workflows/model-adoption.md`, **Blocking rules — FROZEN**, rule 2:

> **A model that fails the WASM columns is not shipped, whatever it does on WebGPU.**
> The judging machine is more likely to be the WASM one.

The extension creates its ORT session with `executionProviders: ["wasm"]`. The rule is unambiguous
and it anticipated exactly this case: a model that is fine on WebGPU and not on WASM. Adopting it
would require an ADR overriding a frozen rule, and **this milestone has produced no evidence that
would justify one** — the opposite, if anything: the cost is +234 ms per frame on top of a pass that
now takes 221 ms.

W1-S04a-1b's own note is the fair reading, and it is not an argument for shipping:

> the logit analysis explains it and no evidence suggests a runtime defect — but the criterion is
> the criterion, and **validation under realistic input has not been done**.

## What was NOT done, deliberately

- **No model was selected.** There was nothing to select between; the search returned one candidate.
- **No download.** The artifacts are absent from W1 and stayed absent.
- **No threshold was moved**, on the detector or on the criterion.
- **No provenance type was added.** `dom` / `vision` / `dom+vision` are unchanged. Emitting a `text`
  source that no producer can produce would be a manifest-contract change made on behalf of a model
  that is blocked — and §G says not to.
- **No second vault, no second boundary, no second egress path.**

## What would unblock it, in the repository's own order

1. **Re-run the S-04a-1 criterion for `ocr_det` under realistic input.** The original record names
   that as the missing validation. It is a measurement, not a model decision, and it is the only
   step that could legitimately change the WASM column.
2. If it still fails: record **`REJECTED`** with the artifact, per blocking rule 5 — *"A rejected
   model is recorded as REJECTED with its artifact. It is not quietly swapped out."*
3. Only then consider whether any other text-region architecture is worth pinning. That is a
   model-adoption exercise with QG-03 attached, not a milestone task.

## The thing worth keeping from this audit

**The architecture for privacy-safe visual text is already right, and the model is the only missing
piece.** A region detector needs no vault, produces no string, crosses no realm boundary with
anything sensitive, and would let the client mark a region it cannot read as one it must redact.

That is the shape M4 argued for — *"the safest useful visual agent is one that does not need to know
a secret in order to protect it"* — and the seam built in M4 (`TextFinding`: a box, a count, a
class, and no field for characters) is the interface it would plug into unchanged.

What is missing is one number moving from 4.12e-02 to under 2e-02, on one backend, for one model.
