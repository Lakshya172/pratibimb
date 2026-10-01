# M9 — adoption review protocol

> **Owner authority:** Ronit Saha, 2026-09-30. TR-01 `PP-OCRv4_mobile_det` and TR-02
> `PP-OCRv3_mobile_det` enter M9, an **adoption review**. It produces an architecture and adoption
> decision, not an implementation. No ranking, no "best".

## What M9 may and may not do

| may | may not |
|---|---|
| read every relevant product source file and every M8.1 / M8.2 / M8.2a record | change `apps/`, `packages/*/src`, worker messaging, capture, permissions, egress, actions, the demo UI, or the canonical geometry |
| write documents, the ADR, and decision records | add either model to the bundle, add OCR or recognition, or apply pixel masks |
| write an **isolated, test-only** reference model of the proposed contract, when a type or semantics decision needs executing to be trusted | let anything in the product import that model |

The reference model is `contract/text-region-contract.mjs`, tested by
`tests/browser/support/m9-text-region-contract.test.mjs`. It is used because Part C's fail-closed
cases are safer executed than described. It is a behavioural oracle for the integration milestone,
not an implementation.

## Method

1. **Inventory from source, not memory.** Every claim about the current product cites the file that
   establishes it (README §Current path).
2. **Reuse existing vocabulary.** The contract extends `DetectorRole`, `Detector`, `Admissibility`,
   `DetectorRegistry`, `TextFinding` and the canonical geometry. It does not invent parallel
   abstractions.
3. **Evidence by reference.** Candidate facts are quoted from M8.1, M8.2 and M8.2a records with
   their paths. Nothing is re-measured and no number is created.
4. **Mismatches are blockers, not corrections.** Where what was screened differs from what the
   product would do, the difference is recorded as an adoption blocker that needs re-screening. It
   is never silently reconciled.
5. **No new threshold.** Where a decision needs a number the repository does not have (a detector
   timeout, a memory budget), it is marked **OWNER DECISION REQUIRED**, never filled in.
6. **Neutral candidate record.** The same fields for both candidates, with no weights, scores or
   ordering.

## Outputs

`README.md` (current path, summary) · `provider-contract.md` (Parts B, D) ·
`textfinding-semantics.md` (C) · `privacy-review.md` (E) · `lifecycle.md` (F, G, H) ·
`candidate-review.md` (I) · `decision.md` (J, K, M) · `adr-0011.md` → `docs/adr/ADR-0011-…` (L).
