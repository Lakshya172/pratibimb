# Decision — M9 adoption review

| Field | Value |
|---|---|
| **Outcome** | **Architecture decided and PROPOSED as ADR-0011; candidate adoption awaits the owner.** No model is integrated, no product file changed |
| **Contract (recommended)** | Option A: a detector-only **`TextRegionDetector`** role; `OCRProvider` kept with **no admissible implementation** |
| **`TextFinding` (recommended)** | discriminated union; detector findings are **`UNREAD_REGION`**, always redacted, with no class and no string; `null` and `UNKNOWN` cannot express "unread" |
| **Candidates** | TR-01 and TR-02 both **satisfy every adoption prerequisite that can be met before integration** (QG-03 PASS, RE-1 PASS, provenance, licence, determinism, no plaintext). Neither satisfies the **integration** prerequisites, because no product integration exists |
| **Owner decision recommended** | **C — both eligible behind one contract, with one pinned default the owner selects.** The evidence does not rank them |
| **Product visual-only PII protection** | **NOT VERIFIED** |
| **Date / workstation** | 2026-09-30 · W1 only |

## J. The exact gates between adoption approval and "integrated"

Only gates the product architecture requires. Each is **open**.

| # | gate | what closes it | why it exists |
|---|---|---|---|
| J1 | **provider contract** | ADR-0011 approved; `TextRegionDetector` added to `DetectorRole`; one `ADMISSIBLE` registry entry with measured `acceptedBackends: ["wasm"]` | constitution §3/§8 amendment |
| J2 | **fail-closed `TextFinding`** | the union in `text-perception.ts`; the reference model's 14 cases ported; compile-time checks (`@ts-expect-error` on `piiClass` in `UNREAD_REGION`; exhaustive `kind`) | `null` / `UNKNOWN` hazard |
| J3 | **model loading / lifecycle** | lazy session per document as `lifecycle.md` specifies; create failure → `UNAVAILABLE`; release on error | resident-memory and failure semantics |
| J3a | **timeout budget and enforcement** | **OWNER DECISION** on the value; a measurement of whether a deadline can be enforced from outside the realm | fail-closed matrix; single-threaded WASM |
| J4 | **pixel-mask application** | opaque fill of `planRedaction`'s rectangles in the perception realm, before any encode | no mask exists anywhere today |
| J5 | **visual-only region enumeration** (G-4) | a product mechanism that names canvas / image / unrolled visual regions in CSS px, with measured coverage | `page-surface-dom.ts` measures only `a, button, input, select, textarea, label, [role]` |
| J6 | **post-processing parity** (G-1) | `dbPostprocess` in product source **verbatim**, pinned by source hash and by M8.1's recorded boxes; any other variant is re-screened | screened code lives in `tests/browser/support` |
| J7 | **product-path re-screening** (G-2, G-3) | RE-1 on frames from the real capture path (stream `grabFrame`, `scaleToCss ≠ 1`), not PNG screenshots | pixel and coordinate equivalence UNKNOWN |
| J8 | **product-level end-to-end proof** | §K below | M8.2a proves feasibility, not protection |
| J9 | **regression against existing local perception** | UI-head outputs bit-identical with the text tier on; all current suites; the UI head's shipped decode unchanged | coexistence shown in harness only |
| J10 | **latency / resources in the product path** | per-pass time and arena measured inside the extension, reported against M8.2's harness figures (no new budget unless the owner sets one) | harness ≠ product |
| J11 | **no plaintext across the worker boundary** | audit of `PerceptionSummary.text` and every message: geometry and codes only; key-allowlist test | P3 |
| J12 | **no new permission or egress** | manifest diff empty; bundle audit; egress interception shows **zero** outbound requests on every fail-closed row | P5, P6, QG-04 |

## K. The product masking gap — stated exactly

**What is true today:**

- The product sends **no frame**. The reasoner receives JSON only
  (`packages/reasoner/src/localModel.ts`), which is structure-only mode.
- Visual-only text therefore reaches the server **neither as pixels** (none leave) **nor as text**
  (nothing reads it).
- The constitution's wire contract — *"WebP frame + redaction manifest + user goal"* — is **not
  implemented**. The moment it is, every visual-only region in that frame is exposed unless
  masked.
- **No mask is applied anywhere in the product.**

M8.2a does **not** prove `raw page → frame → text-region detector → mask pixels → sanitized
context` inside the extension. It proves the model runs, correctly, in the browser.

> **PRODUCT VISUAL-ONLY PII PROTECTION = NOT VERIFIED.**

### The integration validation that would prove it (designed here, not built)

1. **Fixtures.** A new, frozen, geometry-only fixture set, separate from RE-1's held-out set so
   neither is tuned on the other. It contains `<canvas>` and `<img>` text (synthetic, checksum-
   invalid identifiers), DOM text and controls, at DPR 1 and ≠ 1.
2. **Route.**
   - An automated run on the `WORKER_FRAME` route, since no harness can produce the gesture
     invocation (`perception-realm.ts`).
   - **Plus** a manual gesture run on W1 for the `GESTURE_STREAM` route, which is the product path.
3. **In-realm verification.** A **test-build-only** check in the perception realm compares the
   masked bitmap against the fixture's glyph boxes. It reports **counts only** (exposed glyphs,
   over-mask area), so no pixel leaves the realm even under test. G1 must be 0 per image; G2/G3 as
   RE-1.
4. **If frame egress is in scope** (owner decision): the masked frame is encoded, goes through the
   single egress module to a loopback collector, and is decoded there. G1 is re-scored on the
   received bytes. QG-04's hash pin must hold.
5. **Fail-closed rows.** Detector throws, times out, returns malformed output, or is unavailable.
   Each must give every visual-only region filled whole, and zero outbound requests where the
   matrix requires it.
6. **Regression and audits.** J9–J12.

## M. Owner decision

**The options, as the brief states them:**

| option | what the evidence says |
|---|---|
| **A) approve TR-01** | supported: QG-03 PASS, RE-1 PASS, all prerequisites met |
| **B) approve TR-02** | supported: QG-03 PASS (M8.2a), RE-1 PASS, all prerequisites met |
| **C) approve both as selectable implementations** | supported: both fit ADR-0011's contract with **no security or operational divergence** (`candidate-review.md`), so the architecture can stay model-replaceable |
| **D) approve neither** | not indicated by candidate evidence. It would be indicated only if the owner judges an integration blocker (J1–J12) unacceptable for **any** detector, which is an architecture question, not a candidate one |

**Recommendation: C.**

- Approve ADR-0011 (Option A and the fail-closed `TextFinding`).
- Make both TR-01 and TR-02 eligible implementations of `TextRegionDetector`, with **exactly one
  registered `ADMISSIBLE` per build**.
- **The owner selects the pinned default for the first integration.** That choice is the owner's.
  The facts that bear on it are in `candidate-review.md` §"What differs":
  - artifact size and runtime arena;
  - warm latency on W1;
  - glyph margin against over-mask;
  - TR-01's shared lineage with the rejected v5.

**Also required from the owner before integration begins:**

1. the detector timeout budget (J3a);
2. whether the next milestone includes **masked frame egress** under QG-04, or proves masking only
   at the pre-encode point (K.4);
3. whether a runtime-memory budget is wanted for the perception document (none exists; arena
   131.1 / 152.4 MB against the UI head's 26.4 MB).

## What this authorises

- Recording ADR-0011 as **PROPOSED** and indexing it.
- Treating both candidates as **eligible for integration planning**, pending the owner's §9 choices.

## What this does not authorise

- Any code change to `OCRProvider`, `TextFinding`, the perception realm, capture, egress,
  permissions, actions or the demo UI.
- Adding either model to the bundle.
- Applying masks.
- Claiming visual-only protection, recall, or production readiness.

## Next milestone

**M10 — detector integration (owner-approved candidate).** It closes J1–J7 and J9–J12, then runs
the §K proof (J8). It begins only after the owner's §9 decisions. **M9 starts none of it.**
