# M9 — adoption review: the detector-only text-region contract

> **W1 only, 2026-09-30. An architecture and adoption decision, not an implementation.** Owner
> authority: Ronit Saha — both TR-01 `PP-OCRv4_mobile_det` and TR-02 `PP-OCRv3_mobile_det` enter an
> adoption review. No model is integrated. No product file is changed. No candidate is ranked.
>
> **Result:** ADR-0011 is **PROPOSED**. It defines a detector-only `TextRegionDetector` role (with
> `OCRProvider` kept but left with no implementation), a fail-closed `TextFinding` in which unread
> regions cannot be declared safe, and the adoption boundary. Both candidates meet every
> prerequisite that can be met **before** integration. The recommended owner decision is **C — both
> eligible, one pinned default of the owner's choosing.** **Product visual-only PII protection:
> NOT VERIFIED.**

| document | answers |
|---|---|
| [`protocol.md`](protocol.md) | how M9 was conducted, and what it may not do |
| [`provider-contract.md`](provider-contract.md) | Part B (Option A vs B, recommendation) · Part D (geometry integration; blockers G-1 to G-4) |
| [`textfinding-semantics.md`](textfinding-semantics.md) | Part C — the fail-closed representation, executed by 14 tests |
| [`privacy-review.md`](privacy-review.md) | Part E — P1–P10 mapped to invariants and the threat model |
| [`lifecycle.md`](lifecycle.md) | Parts F, G, H — lifecycle, resources, the Firefox correction |
| [`candidate-review.md`](candidate-review.md) | Part I — the neutral record of both candidates |
| [`decision.md`](decision.md) | Parts J, K, M — remaining gates, the masking gap and its proof design, the owner decision |
| [`adr-0011.md`](adr-0011.md) → [`docs/adr/ADR-0011-…`](../../../docs/adr/ADR-0011-text-region-detector-contract.md) | Part L |
| `contract/text-region-contract.mjs` + `tests/browser/support/m9-text-region-contract.test.mjs` | the **test-only** reference model of the proposed contract |

## Part A — the current path, from source

```
CONTENT REALM (page)          ── secret owner ──────────────────────────────────────────────┐
  page-surface-dom.ts   measures ONLY  a, button, input, select, textarea, label, [role]   │
                        → DomMeasurement { selector, role, name, rect }   (a <canvas> or an     │
                          unrolled <img> is never measured)                                 │
  page-privacy-boundary VALUE_BEARING fields → classify → tokens; the VAULT holds values (M2) │
                                                                                              │
SERVICE WORKER                ── control plane ─────────────────────────────────────────────┤
  gesture → activeTab → tabCapture.getMediaStreamId → opaque handle (a string, not pixels)  │ ADR-0009
                                                                                              │
OFFSCREEN DOCUMENT            ── PERCEPTION REALM, pixel owner ─────────────────────────────┤
  getUserMedia(handle) → ImageCapture.grabFrame → ImageBitmap → rgbaFrom → RGBA              │
  geometryFrom(measurement, w, h) → CaptureGeometry (refuses CAPTURE_DIMENSION_MISMATCH)      │
  UI head: preprocessToTensor → pinned ORT session (t1-ui-head, wasm, lazy, 1/document)      │
           → Detection[] (8 UI classes, no text class) → toVisualDetections (CSS px)          │
  text tier: perceiveText(null) → "TEXT_PERCEPTION_UNAVAILABLE"      ◄── the seam, NO MODEL  │
  fuse(graph, visual) → SanitizedElement[] + sourceBySelector                                 │
  → PerceptionSummary { counts, codes, geometry, timings, text: {available:false} }          │
    ══ REALM BOUNDARY: no pixel-bearing type, no string from the page's rendering ══        │
                                                                                              │
PRIVACY (@pratibimb/privacy, remote-privacy-boundary)                                         │
  sanitize → buildHandoffDraft → verifyHandoff → VerifiedHandoff (manifest, tokens only)      │
  redactionGeometry.ts: redactionMask / failClosedMask — IMPLEMENTED, CALLED BY NOTHING       │
                                                                                              │
EGRESS (packages/egress/src/guard.ts) — the single egress authority ───────────────────────┘
  verified → loopback → declared tokens only → value-aware residual scan → digest → send
  body = ONE JSON STRING (manifest + goal) → reasoner (localModel.ts)          NO FRAME IS SENT
```

**Where the privacy boundaries sit today:**

1. **Realms.** Pixels stay in the perception realm (ADR-0009); values stay in the content realm's
   vault.
2. **The perception summary.** It carries geometry and codes only.
3. **The egress choke point.** It sends one verified string.

**What does not exist yet:**

- visual-only text perception, because the tier is `null`;
- visual-only region enumeration;
- any pixel mask;
- any frame egress.

The constitution's wire contract (*"WebP frame + redaction manifest + user goal"*) is not
implemented. The product runs in structure-only mode.

**Where ADR-0011 would insert the detector (proposed):** inside the perception realm, between the
decoded RGBA and `PerceptionSummary`:

```
visual-only regions (NEW, J5) → TextRegionDetector.detect → capture→CSS → UNREAD_REGION[]
  → planRedaction (redactionMask | failClosedMask) → opaque fill (J4) → [future: encode → egress, QG-04]
```

Only `UNREAD_REGION` geometry and codes would cross out, which is the same class of value as today.

## Hypothesis

That a product contract exists under which PratiBimb can consume detector-only visual evidence
without ever producing plaintext, compatible with the frozen geometry, invariants and realm split.
And that both candidates meet every prerequisite that can be met before integration.

**What would falsify it:** a contract that needs a text field, a class value that makes unread text
safe, a geometry mismatch, or a candidate prerequisite that fails.

## Environment

Source at `a84eaa1` (M8.2a) on W1. No model was run and no browser launched. The evidence is
M8.1 / M8.2 / M8.2a records, cited by path, and the repository's own source. The only execution is
the test-only reference model's 14 cases and the repository gates.

## Expected result

A contract recommendation, a fail-closed `TextFinding`, a lifecycle, a neutral candidate record, and
a list of the gates still between adoption and integration.

## Actual result

| question | answer |
|---|---|
| 1. product text-region contract | **Option A — `TextRegionDetector`** (boxes + scores, no text, ever). `OCRProvider` kept with no admissible implementation. ADR-0011 PROPOSED |
| 2. fail-closed `TextFinding` | discriminated union; **`UNREAD_REGION`** is always redacted and carries no class or string. The union blocks **two** hazards: `piiClass: null` ("not sensitive") **and** `"UNKNOWN"` (tier PUBLIC in `classes.ts`). Executed: 14/14 |
| 3. model lifecycle | lazy, one pinned session per offscreen document, shared arena with the UI head, sequential, reclaimed by closing the document. Timeout value is an **owner decision**; enforcement is an **unverified inference** (must be from outside the realm) |
| 4. adoption prerequisites | both candidates meet every pre-integration prerequisite. **Twelve integration gates (J1–J12) remain open**, four of them screened-vs-product mismatches (G-1 to G-4) that need re-screening |

**Found while reviewing, not assumed:**

- `UNKNOWN → PUBLIC` is a second unsafe value for unread regions.
- The fail-closed matrix's "200 ms timeout" sits below both candidates' measured inference.
- The product cannot name a visual-only region.
- Stream-frame and screenshot pixel equivalence is unmeasured.
- No frame egress exists, so no product path yet consumes a mask.

## Conclusion

| | |
|---|---|
| **PROPOSED** | ADR-0011 — contract, `TextFinding`, abstraction, lifecycle, error semantics, boundary, obligations, rollback |
| **RECOMMENDED** | owner decision **C**: both eligible behind one contract, **one pinned default of the owner's choosing** |
| **VERIFIED (by reference model only)** | the fail-closed semantics are self-consistent and executable (14/14) |
| **NOT VERIFIED** | product visual-only PII protection; any integration step; G-2/G-3/G-4 equivalences; timeout enforceability |
| **OWNER DECISION REQUIRED** | ADR-0011 §9: contract, `TextFinding`, candidate(s) and default, timeout budget, frame-egress scope, memory budget |

**Not claimed:** integration, protection, recall, production readiness, or that either candidate
is preferable.

## Reproducibility

```bash
npx vitest run tests/browser/support/m9-text-region-contract.test.mjs
```

Every other statement cites a source file or an M8.x record path.
