# Governing Project Artifact

## PratiBimb Engineering Dossier v4.0 (final)

| Field | Value |
|---|---|
| **Status** | **Implementation baseline.** Supersedes v3.0. |
| **Authority** | Authoritative unless a factual implementation issue is discovered and documented in an approved ADR |
| **Audience** | Build team, evaluators, finale panel |
| **Pages** | 37 |
| **Recorded** | 2026-09-07 |

| File | SHA-256 | Bytes |
|---|---|---|
| `PratiBimb-Engineering-Dossier-v4.0.pdf` | `ae8d99c72981a1cb543d189f9bac8eefa76fae4055bf67a86c363306af9b6bba` | 628,424 |
| `PratiBimb-Engineering-Dossier-v4.0.txt` | `0328966b9cf43b0d54f9f4861f5dadfcf13ebbecdb2e6a5f61b04645c87ef348` | 74,533 |

The `.txt` is a full text extraction of the `.pdf`, page-delimited, produced with PyMuPDF.
It exists so contract text is greppable and diffable. **The PDF is the artifact of record**
— it carries figures and layout the extraction does not.

> **Extraction note (FACT).** The document's body text uses Type3 subset fonts with
> scrambled glyph identifiers and no `ToUnicode` map. A naive `pypdf` extraction returns
> correct letters but **silently drops every digit** — "25%" becomes "%", "620 ms" becomes
> " ms". The `.txt` here was produced with PyMuPDF, which resolves the glyphs correctly and
> preserves all numerals. **Any future re-extraction must be spot-checked against the
> latency table on page 21 before it is trusted.** Every figure quoted in
> `docs/architecture/` and `agentos/registry/` was taken from the PyMuPDF extraction.

---

## Section map

| Section | Page | Topic |
|---|---|---|
| 01 | 1–2 | The brief; deliverables; rubric weights |
| 02 | 3 | Product thesis; five principles |
| 03 | 3–4 | **Threat model** (new in v4.0) |
| 04 | 4–5 | The loop; action freshness (stage 8, new in v4.0) |
| 05 | 5–7 | System architecture; **the egress invariant**; the payload pin (new in v4.0) |
| 06 | 7–8 | **The coordinate contract**; content below the fold (new in v4.0) |
| 07 | 8–11 | Perception; tiers; the change policy (new in v4.0); DOM/vision fusion |
| 08 | 11–15 | **Privacy**: four detectors; Indian validators; confidentiality classes; opaque fill; the differential verifier; the fail-closed test matrix |
| 09 | 15–18 | **Re-hydration**; the dual-mode `type` action (rewritten in v4.0); manifest schema v1.1 |
| 10 | 18–20 | Server and safety; action allowlist; origin policy; prompt injection |
| 11 | 20–23 | **Performance**: two latency budgets; the local-decision path; the **20-cell model feasibility matrix** (new in v4.0); the WASM heap landmine; the week-one spike |
| 12 | 23–26 | Stack; the `UIElementDetector` risk and its three ranked implementations; **the model registry with licences**; the WebGPU position |
| 13 | 26–27 | Scope: ships / waits / refuses |
| 14 | 27–29 | Delivery: six weeks; team of six; finale runbook |
| 15 | 29–31 | Evidence: what we measure and what we refuse to claim; adversarial and decoy sets |
| 16 | 31–32 | Risk register |
| 17 | 32–34 | Demonstration: four sequences, twelve minutes |
| 18 | 34–37 | Appendix: engineering rules; changelogs v3→v4 and v2→v4; glossary |

---

## v4.0 changes (from the dossier's own changelog)

**v3.0 → v4.0**

| Section | Change |
|---|---|
| 08, 09, 10 | **The `type` action was too restrictive and is rewritten.** v3.0 allowed `value_ref` only, which forbids typing a search term or a district and cannot drive a browser. Literals are now permitted for fields with no redaction token, behind a target check, a shape check and a vault check — **with a vault match escalated from defect to leak**. |
| 07 | **The change gate is stated precisely.** MutationObserver is the structural signal, not a claim to see everything visual. Dynamic regions are enumerated and polled at a bounded rate; a low-rate full-frame hash bounds the worst case; **"changed frame" now has a definition T1 can be gated on**. |
| 05 | **The payload is a single hash-pinned artifact.** Verify-then-encode left a window in which the thing checked was not the thing sent. The ledger hash, the verified artifact and the request body are now provably the same object. |
| 11, 14 | **The week-one spike covers models, not just the adapter.** A twenty-cell feasibility matrix — five models across Chrome and Firefox, WebGPU and WASM — gates entry into the build. |
| 12 | **`UIElementDetector` promoted to a hard interface** with three ranked implementations. Our own detector head starts in week three regardless of whether OmniParser is working. |
| 10 | **Origin-crossing sequence defined**, with a rehearsal rule that no demo may depend on a value surviving the transition. |
| 13 | Universal confidentiality detection added to "not building". The taxonomy stays a config file. |
| 03 | **Threat model added.** Four adversaries, named mitigations, stated scope limit on quasi-identifiers. |
| 04, 10 | **Action freshness** and **origin policy** added as pipeline stage 8 and a validator rule. |
| 05, 06 | Egress invariant formalised with three enforcement mechanisms. **Coordinate contract added.** Off-screen content policy added. **"Accessibility tree" corrected to "derived element graph".** |
| 08 | Verifier made **differential** and supplemented with a **value-aware residual check**; verification moved to the encoded bytes. Semantic labels composited over fills. GSTIN check digit added. Confidentiality classes added as configuration, not a policy engine. Fail-closed test matrix added. |
| 09 | Manifest to **v1.1** — coordinate block, capability block, detector provenance, field role, off-screen elements. Unknown-token and literal-value rejection added. |
| 11 | **Two latency budgets published, WebGPU and WASM, all labelled projected.** p50/p95 and peak reporting rules stated. |
| 12 | **OmniParser `icon_detect` moved to the MIT-licensed v3** — the pinned v2.0 model was AGPL-3.0. **Licence column added.** SmolVLM replaces FastVLM on licence grounds. **Qwen3-VL-4B becomes the default, 8B the upgrade.** |
| 14 | Two week-one spikes added, and **the first server round trip moved from week five to week one**. |
| 15 | Adversarial, decoy and disagreement sets added. **Task success after privacy promoted onto the main metrics table.** |
| 17 | Adversarial and failure-path sequences added to the demonstration. |
| 02 | **Client share corrected from 85% to a defensible split.** Visual-context accuracy is shared, not ours alone. |

**v2.0 → v4.0 (framing)**

| Section | Change |
|---|---|
| 07, 11, 17 | **Vision made load-bearing.** T1 reframed as always-on rather than gated away; scanned-document content added to the demo; the client-side decision path added. Answers the brief's requirement for a local model that reads and decides. |
