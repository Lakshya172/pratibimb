# Decision — M7.3 one redaction geometry

| Field | Value |
|---|---|
| **Verdict** | **PASS** — the canonical geometry reproduces the pre-registered RE-1 geometry exactly (90/90 masks and verdicts), and it is the only implementation |
| **Status** | **EXPERIMENTALLY VERIFIED** equivalence · product masking path **NOT YET VERIFIED** (none exists) · QG-03 input **OWNER DECISION REQUIRED** |
| **Date** | 2026-09-25 |
| **Workstation** | W1 (`LAPTOP-6E14K34L`) |

## What this authorises

- **Starting M8's candidate inventory.** Three of its five preconditions are met: canonical geometry
  exists (1), scorer and product geometry agree (2), and PP-OCRv5 remains historically rejected (4).
  The other two are **not** met: the QG-03 WASM interpretation (3) is still open, and no new
  candidate is identified yet (5). The inventory can begin; a candidate cannot reach QG-03 until (3)
  is decided.
- **Citing RE-1 as judging exactly what the product would redact.** Same code, same rectangles.

## What this does not authorise

- Any claim that visual text is protected today. No detector is adopted and nothing applies the mask.
- Wiring a region detector to `TextFinding` as it stands — its `piiClass: null` would mean "not
  sensitive" for text nobody read. That seam must change first, with the candidate that needs it.
- Optimising the merge without the golden test passing unchanged.
- Re-submitting PP-OCRv5 under RE-1.

## Open

1. **QG-03's WASM correctness input** — `docs/testing/qg03-wasm-correctness-decision.md`, readings A/B/C
   and the statistic. Blocks QG-03 for any M8 candidate; does not block the inventory, the development
   screen or the held-out evaluation.
2. **The `TextFinding` seam** for region-only producers — deferred to integration.
3. **Merge cost** — cubic in the worst case, measured up to 26 ms at ~300 boxes on W1.
4. **Adjacent-glyph overlaps in the held-out truth** — 135 pairs, ≤ 2.06 px, a measurement property
   of Chrome's ink extents; recorded, not repaired, and verdict-neutral under RE-1.
