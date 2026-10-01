# M11 — decision record (in progress)

**No M11 verdict yet.**

- **Proposed decision:** [ADR-0012](../../../docs/adr/ADR-0012-production-frame-handoff.md).
- **Production frame egress:** BLOCKED (README findings F1–F11; `qg04-matrix.md`).

## Owner decisions in force (from M10)

- M10 is closed. The M10 verifier (DETECTOR_VERIFIED, 362 MiB, about 1.7 s) is test-only and is not
  placed in the product.
- No OCR model is downloaded or added. No remote reasoner, no API key, no new origin and no new
  permission.

## M11 commits

1. `docs(egress): open M11 production handoff review` — the review and the QG-04 matrix.
2. `docs(egress): define qg04 frame handoff contract` — ADR-0012 (PROPOSED).
3. `test(egress): verify attestation and fail-closed fallback` — the pure contract module and its 28
   tests; regression results in README §5–§6.

**Verdict at the end of M11: ARCHITECTURE PROPOSED; PRODUCTION FRAME EGRESS BLOCKED** (ADR-0012 §13,
B1–B7). Nothing in the product sends a frame, and the product bundle contains neither the contract
nor frame egress.
