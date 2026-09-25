# Decision — M8 visual-text candidate inventory

| Field | Value |
|---|---|
| **Verdict** | **Inventory recorded.** 21 candidates plus one excluded class screened: **3 ELIGIBLE FOR SCREENING** (conditional), **7 DEFERRED**, **4 BLOCKED**, **6 REJECTED**, **1 HISTORICAL REJECTED CANDIDATE** |
| **Eligible for screening** | **TR-01** `PP-OCRv4_mobile_det` · **TR-02** `PP-OCRv3_mobile_det` · **TR-08** docTR `db_mobilenet_v3_large` (OnnxTR export) — **in no order** |
| **Status** | inventory **COMPLETE** · every candidate's RE-1 result, WASM correctness and W1 cost **NOT YET VERIFIED** · adoption **not in scope** |
| **Date** | 2026-09-25 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |
| **Downloads** | **none** — metadata only |

## Purpose

To find which text-region detectors are **legitimate enough to deserve a separate evaluation**:
real, pinned, licensed, reproducible, structurally unable to emit text, and able to run in the
existing perception realm. It is not model selection, not evaluation, not adoption and not OCR.

The pipeline a candidate must fit, unchanged:

```
raw pixels (perception realm)
  → local text-region detector → boxes + scores (+ region metadata)
  → local privacy policy — visual-only text: fully redacted, unread, fail-closed
  → canonical redaction geometry (packages/privacy/src/redactionGeometry.ts)
  → sanitised context
```

A detector whose output cannot carry a character is preferred **by construction**, not by accuracy.
Better recognition accuracy is not a reason to prefer anything here.

## Hard filters

A candidate proceeds only if all ten hold. A hard security, licence or provenance failure ends the
row; apparent accuracy never rescues it.

| # | filter | how it was applied |
|---|---|---|
| F1 | detector-only or otherwise privacy-safe output | output type has no field able to hold a character sequence |
| F2 | no mandatory plaintext recognition | the artifact runs without a recogniser |
| F3 | verifiable licence | read at the pinned revision; a missing, copyleft or use-restricted licence fails |
| F4 | exact revision | an immutable commit plus a content hash for the weights |
| F5 | reproducible artifact | acquisition reproducible and the source's documentation self-consistent; a contradiction fails |
| F6 | conversion / runtime story | a known route to ONNX and ORT Web; unproven routes are `COND` |
| F7 | size acceptable for browser use | the screen in `candidate-matrix.md`: ≤ 21.16 MB pass · ≤ 105 MB conditional (owner) · above that fail |
| F8 | fits the local perception architecture | runs in the perception realm, pixels in, tensors out |
| F9 | fits the canonical redaction geometry | emits rectangles or quadrilaterals `redactionMask` accepts |
| F10 | fits frozen RE-1 | its output can be scored by the RE-1 scorer without changing RE-1 |

F9 and F10 are structural checks, not predictions: nothing here says any candidate would pass RE-1.

## Dependencies this inventory does not change

- **RE-1** — [`redaction-evaluation.md`](../../../docs/perception/redaction-evaluation.md), pre-registered.
  G1–G6, the thresholds, the held-out set (6 pages, 20 sensitive strings, 306 sensitive glyphs,
  43 non-sensitive strings, 5 fonts, 11–30 px), the ground truth and the canonical geometry are
  untouched. Every future candidate is judged by the same criteria and the same code.
- **QG-03** — for text-region models, WASM correctness is decided on the **fixed realistic
  text-bearing fixture**, relative `sumAbs` ≤ 2e-2 with the exact output-count check
  ([`qg03-wasm-correctness-decision.md`](../../../docs/testing/qg03-wasm-correctness-decision.md),
  Option A). **Not run here**, for any candidate. Passing it is not adoption.
- **`PP-OCRv5_mobile_det`** stays **`REJECTED FOR V1`**. It appears only as TR-00, a historical
  rejected candidate: not re-evaluated, not scored under RE-1, not counted as viable.

## The no-download rule

**No weights were downloaded, converted or run.** No runtime was installed, `package.json` was not
touched, and nothing entered the extension. Research used metadata endpoints and small text files
only (method in [`provenance-notes.md`](provenance-notes.md)). A download happens only in a later,
owner-approved milestone, and its bytes must match the hashes recorded here.

## What qualifies a candidate for the next phase

1. Disposition **ELIGIBLE FOR SCREENING** here.
2. The **owner selects** it for acquisition.
3. Its **conditions are met by owner decision**:
   - **TR-01 / TR-02:** approval of `paddle2onnx` as measurement-only tooling for this candidate.
     M7.1's approval was scoped to M7.1. Also the owner's acknowledgement that the candidate shares
     TR-00's family and, by inference, its graph. Evaluating it does not revisit TR-00.
   - **TR-08:** either approval of measurement-only PyTorch + `python-doctr` to reproduce the ONNX
     export, or explicit acceptance of the hash-pinned third-party export as the artifact of record.
     Also acceptance that the weights' training data is undocumented.
4. **Reproducible acquisition** matching `provenance-notes.md`, recorded before any result.

Then, in order and without collapsing steps: the development screen (can reject, cannot accept) →
the held-out RE-1 evaluation, once → the realistic WASM cell and the rest of QG-03 → the owner's
adoption decision → integration.

## Owner decisions this inventory surfaces

| # | decision | affects |
|---|---|---|
| D1 | which eligible candidate or candidates to acquire first | TR-01, TR-02, TR-08 |
| D2 | measurement-only tooling: `paddle2onnx` (again), and/or PyTorch + `python-doctr` | TR-01/02, TR-08 |
| D3 | whether the hash-pinned OnnxTR export may stand as the artifact of record | TR-08 |
| D4 | a detector size budget above 21.16 MB, if any — which would make the DEFERRED size rows reconsiderable | TR-03, TR-09, TR-10, TR-11, TR-15 |
| D5 | a position on training-data terms for weights trained on research datasets | TR-12, TR-13, TR-15; TR-08 by absence |

## Preconditions for integrating any candidate — recorded, not solved

1. **The `TextFinding` seam — PRECONDITION FOR CANDIDATE INTEGRATION.** It was designed for a
   reading producer: `length` counts characters a region-only detector never has, and `piiClass:
   null` would declare unread text safe. The seam must gain an explicit "unread, therefore
   sensitive" form that stays fail-closed. It changes **only after** a real candidate is selected
   (blocking rule 4), and not here.
2. **The frozen `OCRProvider` interface and its pinned default.** Constitution §3 shapes
   `OCRProvider` as *"image region in → text + boxes out"*. §8 pins `PP-OCRv5-mobile via
   paddle2onnx`, and replacing it needs a feasibility row, a benchmark and an ADR. A detector-only
   producer and a replacement default are **ADR matters at integration**.
3. **No product path applies the mask to pixels.** The canonical geometry exists; applying it
   belongs to integration.
4. **Input scale.** TR-08 takes a fixed 1024×1024 input. INFERENCE: a 1280×720 frame's 11 px text
   arrives at about 8.8 px. To be measured, not assumed.

## What this does not authorise

- Downloading, converting or running any candidate.
- Calling any candidate adopted, verified or preferred, or ranking them.
- Any change to RE-1, the held-out set, the ground truth, the canonical geometry, QG-03's decision,
  `TextFinding`, the extension, the manifest, permissions, egress or capture.
- Any OCR or plaintext path, a second vault, classifier or redaction path, a cloud or remote-vision
  service, or a new action.

## Security audit

Nothing in the product changed. The commit adds four Markdown files under `artifacts/experiments/`.
It adds no product code, dependency, permission, model weight, egress path, action type, capture
route or privacy-boundary change. The realm split stands: **service worker = control plane ·
perception = pixel owner · content privacy = secret owner · reasoner = untrusted · egress = single
authority.**

## Next milestone

**M8.1 — owner selection and reproducible acquisition of a screening candidate.** It begins only
after the owner answers D1–D3 for at least one eligible candidate. Its scope is acquisition matching
this inventory's hashes, a recorded conversion if one is needed, and the development screen under
RE-1. It excludes the held-out evaluation until the development screen is recorded, and it excludes
any integration.
