---
id: W1-S04a-1-agentos-review
experiment: W1-S04a1-four-model-residency
date: 2026-09-09
---

# S-04a-1 — AgentOS review

> **What this is.** A review of S-04a-1 against the five relevant agent contracts in
> `agentos/agents/`, applied by the author. **It is not a transcript of five independent
> agents** and is not presented as one — `agentos/config.yml` defines contracts, not running
> reviewers. Findings are recorded the way each contract says that reviewer must judge, and the
> blocking ones are stated as blocking.

---

## `ml-engineer` — L2, **blocking on model adoption (QG-03)**

Owns model selection, ONNX/opset/operator support in ORT Web, quantisation and its measured
accuracy cost, licence verification of each pinned revision, and the WASM heap budget across
concurrent sessions.

| Contract obligation | Finding |
|---|---|
| *"Must refuse adopting any model on the strength of documentation"* | **Honoured.** Four models were downloaded, revision-pinned, hash-recorded and **executed in three browser contexts**. No adoption rests on a model card. |
| Licence verification of each pinned revision | **Done for all four**, read at the revision. Method and its limit (front-matter, no separate `LICENSE` file in the HF repos) recorded rather than overstated. |
| Quantisation and its accuracy cost, **measured** | **Partly.** The int8 SigLIP encoder is correct on WASM (1.96e-02) and **incorrect on WebGPU (2.18, ~3× off)**. The int8-vs-fp32 accuracy cost itself was **not** measured — only int8 web-vs-native. |
| WASM heap budget across concurrent sessions | **Delivered:** 273.2 MB for four different models, 2.5× the 110.49 MB of weights, bounded across repeated lifecycles. |

**BLOCKING — no model may be marked `ADOPTED`.** Two of four fail the stated correctness
criterion in at least one backend, and there is no benchmark artifact. **The registry change in
this PR correctly leaves all rows short of `ADOPTED`** and keeps licence / runtime / browser /
performance as four separate columns.

**RAISED:** the `UIElementDetector` interface has **no viable pinned implementation** — OmniParser
`icon_detect` is AGPL-3.0 at the revision and the ONNX re-exports are unlicensed. That is a hole
behind a frozen interface, not merely a missing experiment. **S-04a-1c, p1.**

---

## `browser-engineer` — L2, blocking on execution context

Owns MV3 manifests, CSP, service worker vs event page, offscreen execution and *"what can and
cannot hold an inference session"*.

| Obligation | Finding |
|---|---|
| Execution context | **Consistent with S-03.** ORT runs in the Chrome offscreen document and its dedicated worker and in the Firefox event page; the **MV3 service worker still cannot run ORT at all**. Unchanged by adding models. |
| CSP | **No production CSP change.** `'wasm-unsafe-eval'` appears only in the throwaway harness manifest with a note that it is not adopted. The decision stays **ADR S-02a-2a**. |
| Chrome/Firefox divergence | **Measured, and smaller than expected:** identical peak, identical grow count, identical per-model increments, correctness equal to four significant figures. Only **2 `Memory` instances vs 1** and no `SharedArrayBuffer` on Firefox. |
| Model loading path | Weights are read via `runtime.getURL()` — a **same-origin extension resource read, not network**. No host permission involved, nothing that could be mistaken for egress. |

**NOT BLOCKING.** One note: the harness Firefox manifest adds the `tabs` permission (needed for
chunked report delivery, S-04a). **Harness-only; it must never migrate to a product manifest.**

---

## `performance-engineer` — L2, **blocking on any latency or resource claim**

Owns peak heap and peak GPU memory (*"peak, never mean"*), the WebGPU **and** WASM budgets, and
*"weights on disk and total resident model size (~120 MB across four models)"*.

| Obligation | Finding |
|---|---|
| *"Must refuse publishing a WebGPU-only budget"* | **Honoured — both are published.** WASM **273.2 MB / 11 grows**; WebGPU **236.9 MB / 10 grows**. |
| Peak, never mean | **Peaks only.** Every figure is a high-water mark from direct `WebAssembly.Memory` instrumentation. |
| Peak GPU memory | **NOT MEASURED, and no VRAM number is offered.** The 13% WebGPU saving is explicitly a *WASM-heap* saving. |
| Total resident model size | **This is the contract's own headline number and it needs correcting.** The dossier's *"~120 MB across four models"* is a **weights** figure. Measured resident cost for 110.49 MB of weights is **273.2 MB — 2.5×**. A budget built on 120 MB would be wrong by more than a factor of two. |

**BLOCKING on any latency claim, and none is made.** Create/infer/destroy timings are recorded
as feasibility data and explicitly disclaimed; cold vs warm start was **not** separated, so no
figure here may be quoted as a latency result.

**RAISED:** the 2.5× ratio should reach the performance budget before any slide quotes 120 MB.

---

## `evaluation-qa-engineer` — L2, **blocking on any reported metric**

| Obligation | Finding |
|---|---|
| *"Must refuse any number on a slide that the harness did not produce"* | **Honoured.** Every number traces to a committed log; `metrics.json` carries 57 cells. |
| *"A dossier budget is labelled `projected` and stays labelled `projected`"* | **Relevant here.** The ~120 MB is a dossier projection; 273.2 MB is measured. The two are kept distinct and the projection is not retro-fitted. |
| Reported metrics must be defensible | **The correctness criterion changed mid-experiment**, and that is the finding this reviewer should scrutinise hardest. It moved from raw `sum` to cancellation-free `sumAbs`, justified by a **committed conditioning measurement** (1e-6 input perturbation → up to 1.0e-01 on raw sum, at most 2.9e-03 on `sumAbs`). **`sumAbs` is a stricter aggregate test**, since error accumulates rather than cancels. |
| Failing cells | **Reported as failing.** `ocr_det` misses the criterion on WASM (4.12e-02 vs 2e-02) and is recorded as a failure **despite** a good explanation (0.29% in logit space). An explanation is not a pass. |

**NOT BLOCKING, with one condition:** the tolerance is defensible only because the conditioning
table is committed alongside it. **It must not be reused elsewhere without that evidence.**

**RAISED:** correctness for `ocr_det` and `vlm_vision` under *realistic* input is untested —
synthetic input drives both into degenerate regimes. **S-04a-1a, p1.**

---

## `pratibimb-architect` — L1, recommends; the human decides

Owns constitution consistency, the ADR process, and *"guarding the scope boundary"*.

| Obligation | Finding |
|---|---|
| No frozen-contract change without an ADR | **None made.** No interface, no invariant, no dependency in the product path. |
| *"Any architecture change justified by preference rather than measured evidence"* | **None.** Every claim carries an artifact. |
| Scope boundary — *"the largest risk is building a research programme"* | **Watch item.** S-04a-1 is the sixth consecutive capability spike. It was the one S-04a explicitly required, and it **closed** that question — but the follow-up list grew by five items. |
| Constitution consistency | **§11's WebGPU mitigation needs qualifying.** S-04a measured 43% less WASM heap for one small model; with four models it is **13%**, and WebGPU **breaks the int8 model**. The mitigation is weaker and more conditional than the constitution currently implies. |

**RECOMMENDS TWO ADRs, neither written here:**

1. **Backend selection.** *"Prefer WebGPU"* is no longer unconditionally safe — it returns wrong
   numbers for a quantised transformer. A per-model backend decision with a correctness gate is
   an architectural choice, not an implementation detail.
2. **The `UIElementDetector` gap.** The pinned implementation is AGPL-3.0 and unusable. Choosing a
   replacement, or activating the dossier's *"our own head trained on the synthetic set"*
   fallback, is an architecture decision.

**Explicitly NOT recommended:** any CSP change, any move to `ADOPTED`, and any `v0.2.0-spikes`
tag — the checkpoint belongs to merged, validated `main`, and QG-03 and QG-04 are both open.

---

## `privacy-security-engineer` — not required

Per the task, privacy-security review is required *only where CSP or security implications are
involved*. **This experiment changes no CSP, no invariant, no trust boundary and no egress
path**, uses synthetic input with no PII, commits no weights and no secrets, and talks only to
`127.0.0.1:8908`. **No review requested.**

---

## Summary

| Reviewer | Verdict | Blocking items |
|---|---|---|
| `ml-engineer` | **CONDITIONAL** | No model may be `ADOPTED`; `UIElementDetector` has no licensed implementation |
| `browser-engineer` | **PASS** | — |
| `performance-engineer` | **CONDITIONAL** | Resident budget is **2.5× weights**, not 1×; GPU memory unmeasured |
| `evaluation-qa-engineer` | **CONDITIONAL** | Tolerance valid only with its conditioning table; realistic-input correctness untested |
| `pratibimb-architect` | **CONDITIONAL** | Two ADRs recommended; constitution §11 needs qualifying |

**Consolidated: CONDITIONAL — consistent with the experiment's own verdict.** Nothing here
argues the memory result is wrong; the blocks are all about **what may be claimed on the strength
of it**.
