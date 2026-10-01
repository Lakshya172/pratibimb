---
id: ADR-0011
title: "A detector-only text-region contract: TextRegionDetector, fail-closed TextFinding, and the adoption boundary for TR-01 / TR-02"
version: 1.0
status: PROPOSED — OWNER DECISION REQUIRED (§9)
owner: pratibimb-architect
proposed_by: pratibimb-architect
created: 2026-09-30
modified: 2026-09-30
supersedes: none
amends_on_approval: "docs/architecture/constitution.md §3 (interfaces: adds TextRegionDetector) and §8 (replaceable roles: its pinned default)"
related_gates: QG-03 (both candidates PASS), QG-04 (egress), RE-1
related_invariants: INV-01, INV-07, INV-21, INV-22, INV-23, INV-24, INV-25 — none weakened
evidence: artifacts/experiments/M9-adoption-review/ (and M8.1, M8.2, M8.2a)
---

# ADR-0011 — A detector-only text-region contract

> **STATUS: PROPOSED.** Nothing here is implemented, and the product is unchanged. This ADR records
> a proposed contract and an adoption boundary; it is not an integration. It becomes effective
> only on the owner's decision in §9. **Product visual-only PII protection remains NOT VERIFIED.**

## 1. Context

- The constitution §3 (FROZEN) defines `OCRProvider` as *"image region in → text + boxes out"*,
  and §8 pins *"PP-OCRv5-mobile via paddle2onnx"*. That detector is **REJECTED FOR V1** (M7.1),
  and its recogniser is rejected for this role.
- The owner-directed v1 policy (`docs/perception/visual-only-text-policy.md`) is: **a text region
  in a visual-only area is fully redacted, unread.** OCR is not used.
- Two detector-only candidates now pass QG-03 and RE-1:
  - TR-01 `PP-OCRv4_mobile_det`: M8.2 PASS.
  - TR-02 `PP-OCRv3_mobile_det`: M8.2a PASS, after M8.2's single silent launch was shown to be a
    harness confound.
- The seam `TextFinding` (`apps/extension/host-lib/text-perception.ts`) was written for a
  **reading** producer. For a detector, both `piiClass: null` (*"not sensitive by its rules"*) and
  `"UNKNOWN"` (tier `PUBLIC`, `classes.ts`) would declare unread text safe.

## 2. Decision — provider semantics

**A new role, `TextRegionDetector`: image region in → text-region boxes + scores out; no text,
ever.** It is implemented through the existing `Detector` interface (`packages/perception/src/detector.ts`)
and admitted through the existing `DetectorRegistry`, with measured `acceptedBackends` and no
fallback chain. Its detection label is the single constant `"text-region"`.

`OCRProvider` **stays** in the constitution, with **no admissible implementation**. A reading
producer, if ever proposed, needs its own ADR. It cannot enter through the detector's slot.

Options considered: Option A, the one chosen, and Option B, keeping `OCRProvider` with optional
text. The full comparison (type safety, privacy, migration, interchangeability, testing, failure,
architectural fit) is in `artifacts/experiments/M9-adoption-review/provider-contract.md`. A was chosen
because only in A is "no plaintext" a property of the type rather than a promise of the producer.

## 3. Decision — fail-closed `TextFinding`

`TextFinding` becomes a discriminated union on `kind`:

- **`UNREAD_REGION { box, score, regionId, treatment: "REDACT_UNREAD" }`**
  - the only shape a detector may produce;
  - no `piiClass`, `length`, `ref` or any string field;
  - always redacted.
- **`READ_TEXT { box, length, piiClass, ref }`**
  - the existing reader shape and semantics, unchanged;
  - no reading producer is adopted.

The parser refuses a missing or unknown `kind`, any key outside the variant's allowlist, non-finite
geometry, a different treatment and an unknown region. **One refused finding makes the whole
report unusable**, and every visual-only region is then masked whole.

Full definition and the 14 executed cases: `textfinding-semantics.md`, and the reference model
`contract/text-region-contract.mjs`, which is **test-only** and must be ported, not imported.

## 4. Decision — model abstraction

- **Both TR-01 and TR-02 are eligible implementations** of `TextRegionDetector`. They share output
  semantics, post-processing parameters, geometry path, lifecycle and failure semantics, and differ
  only in their declared resize rule and resources (`candidate-review.md`).
- **Exactly one is registered `ADMISSIBLE` per build.** Both are never shipped together, and neither
  is a fallback for the other.
- The pinned default is the **owner's choice** (§9) and is recorded in the constitution §8 and
  the model registry. The other stays eligible as the ranked alternative that §8's format provides
  for.
- **Swapping** is a registry change plus a re-run of the product-path validation (§7). It never
  involves a contract change.

## 5. Decision — lifecycle

Lazy, one pinned session per offscreen document, created on the first pass with a visual-only region.

- The session lives beside the UI head's, in one shared ORT arena.
- Inference runs sequentially after the UI head, never concurrently.
- `release()` runs on error. Memory is reclaimed only by closing the document.
- A failed create makes the tier `UNAVAILABLE` for the document's life. There are no silent retries.

Details: `lifecycle.md`.

## 6. Decision — privacy and error semantics

- **Detection:** every detected region in a visual-only area → `UNREAD_REGION` → `redactionMask` →
  opaque fill. The canonical geometry is **unchanged**.
- **Tier failure:** `ERROR`, `TIMEOUT`, `UNAVAILABLE` or a malformed report → `failClosedMask` for
  **every** visual-only region (INV-23).
- **The stated limitation stands:** a clean pass that **misses** text masks nothing there. No recall
  is claimed.
- **Timeout value: OWNER DECISION REQUIRED.** The fail-closed matrix's "200 ms" is a test case,
  below both candidates' measured inference (~470 / ~557 ms).
- **Timeout enforcement:** the deadline must be enforced from outside the perception realm, because
  single-threaded WASM inference occupies it. This is an INFERENCE that the integration must
  verify.
- **No Firefox preference** is ever set by the product. The M8.2a pref was a harness mitigation.

## 7. Decision — integration boundary and testing obligations

**Boundary.**

- The detector, the mask plan and the opaque fill all run in the **perception realm** (the
  offscreen document), on pixels that realm already owns (ADR-0009).
- Only geometry and codes cross out. That is the same class of value `PerceptionSummary` carries
  today.
- No string exists anywhere on this path, so no vault is involved.
- A masked frame may be encoded only **after** masking, and only through the single egress module
  under QG-04.

**Obligations before "integrated" may be claimed** (the full list with owners is in `decision.md` §J):

1. **Contract tests.** Port the reference model's cases onto the product type, with compile-time
   checks.
2. **Post-processing.** `dbPostprocess` goes into product source **verbatim**, pinned by source
   hash and by M8.1's recorded boxes.
3. **Re-screen the unscreened path steps.**
   - G-2: capture → CSS at DPR ≠ 1 and scaled captures.
   - G-3: stream-frame pixels (`grabFrame`) against the screened PNG pixels.
   - G-4: visual-only region enumeration.
4. **Product-path RE-1.** Held-out-style fixtures, **through the real extension**, scored on the
   masked frame.
5. **Fail-closed rows.** Zero outbound requests; the region masked whole on error, timeout and
   malformed output.
6. **Regressions.** Existing perception (UI-head outputs unchanged), bundle diff, permissions and
   egress audit.
7. **In-product cost.** Latency and memory measured inside the product path.

## 8. Rollback

- Set the registry entry to `UNAVAILABLE`, or remove it. The text tier then reports its absence on
  every pass, as it does today.
- Under §6, an absent tier masks every visual-only region whole in any frame that is sent. If no
  frame is sent (today's structure-only behaviour), nothing changes.
- The model file is removed from the bundle. No other component depends on it.
- Rollback is a registry and bundle change, never a contract change, and it can never unmask.

## 9. Owner decision

| Field | Value |
|---|---|
| **Provider semantics** | ☐ approve Option A (`TextRegionDetector`, `OCRProvider` kept with no implementation) ☐ Option B ☐ other |
| **Fail-closed `TextFinding`** (§3) | ☐ approve ☐ amend |
| **Candidates** | ☐ A) TR-01 ☐ B) TR-02 ☐ C) both eligible, one pinned default: ____ ☐ D) neither |
| **Detector timeout budget** | ____ ms (none proposed here) |
| **Frame egress in the next milestone** | ☐ yes (masked frame under QG-04) ☐ no (prove masking at the pre-encode point only) |
| **Approved by / date** | _pending_ |

**Recommendation** (`artifacts/experiments/M9-adoption-review/decision.md` §M):

- approve Option A and §3;
- **approve C**: both eligible behind one contract, with **one pinned default chosen by the owner**;
- start integration only against the §7 obligations.

**The evidence does not rank the candidates, and this ADR does not.**

## 10. What this ADR does not do

It does not integrate a model, change `TextFinding` or `OCRProvider` in code, apply a mask, add a
permission, change capture, egress, actions or geometry, or claim product visual-only protection.
The constitution amendment in the header is **drafted, not applied**.
