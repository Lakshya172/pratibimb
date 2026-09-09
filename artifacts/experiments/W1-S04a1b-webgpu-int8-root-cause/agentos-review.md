---
id: W1-S04a-1b-agentos-review
experiment: W1-S04a1b-webgpu-int8-root-cause
date: 2026-09-09
---

# S-04a-1b — AgentOS review

> A review against the agent contracts in `agentos/agents/`, applied by the author. **Not a
> transcript of independent agents** and not presented as one.

---

## `ml-engineer` — L2, **blocking on model adoption (QG-03)**

Owns ONNX/opset/operator support in ORT Web, quantisation and its measured accuracy cost, and
per-model-per-backend accuracy.

| Obligation | Finding |
|---|---|
| *"Must refuse adopting any model on the strength of documentation"* | **Honoured.** The REJECT rests on a single-node reproducer and a layer-wise bisection, not on a claim. |
| Operator support in ORT Web | **Materially advanced.** `MatMulInteger`, `DynamicQuantizeLinear` and `ConvInteger` are **not executed on the GPU** — the WebGPU EP partitions them to CPU. That is a fact about the runtime the registry did not previously hold. |
| Quantisation and its accuracy cost, measured | **Still not measured.** int8-vs-fp32 accuracy was never compared; only int8 web-vs-native. Unchanged from S-04a-1. |

**BLOCKING — SmolVLM must not be marked WebGPU-compatible, and no model may reach `ADOPTED`.**
The registry change satisfies this: WASM and WebGPU are separate cells and the row stays short
of `ADOPTED`.

**RAISED:** the "prefer WebGPU" instinct is unsafe for quantised models specifically. On this
backend they gain nothing (they run on CPU) and can be silently wrong.

---

## `browser-engineer` — L2, blocking on execution context

| Obligation | Finding |
|---|---|
| Offscreen execution | **Unchanged and consistent with S-03.** All work ran in the Chrome MV3 offscreen document. |
| CSP | **No production CSP change.** Harness manifest only, with a note. **ADR S-02a-2a untouched** — and this experiment was explicitly not used to pre-empt it. |
| Browser/platform divergence | **WSL2 cannot test WebGPU at all** (`Failed to get GPU adapter`), consistent with S-02a. Recorded as **not testable**, not as a failure — so the Linux cell is not silently counted as evidence either way. |
| Firefox | **Not run and not inferred.** WebGPU is off by default there (S-02a). |

**NOT BLOCKING.**

---

## `evaluation-qa-engineer` — L2, **blocking on any reported metric**

| Obligation | Finding |
|---|---|
| *"Must refuse any number on a slide that the harness did not produce"* | **Honoured.** `metrics.json` carries 1,700 cells, each traceable to a committed log. |
| Correctness standard must not be relaxed to obtain PASS | **Honoured, and strengthened.** The micro reproducers use **element-exact** comparison against full reference tensors — no aggregate statistic, no tolerance. The S-04a-1 tolerance debate does not arise here because the tensors are small enough to compare exactly. |
| Reported failures | **Two defects reported, one unresolved.** The verdict is REJECT even though a validated fix exists for defect 1, because the model is still wrong. |

**NOT BLOCKING — but this reviewer should note the two harness defects.** Both silently
*removed data* rather than failing loudly, and one produced a misleading intermediate reading
before it was caught:

- promoted graph outputs without explicit types → ORT Web returned **5 of 15**, no error;
- int64 outputs as `BigInt64Array` → the comparison loop threw and truncated, **hiding ten
  checkpoints across three runs**.

**That is the third time in this project that an instrument has failed open** (S-04a's
collector, S-04a-1's config plumbing, and now twice here). **It is a pattern, not a run of bad
luck**, and it belongs in the B-02-2 ADR's argument for fail-closed instrumentation.

---

## `performance-engineer` — L2, blocking on any latency or resource claim

| Obligation | Finding |
|---|---|
| Blocking on latency/resource claims | **None made.** The task said correctness first and no latency claims; none are offered. |
| The WebGPU budget | **Directly affected.** S-04a-1 measured WebGPU saving 13% of WASM heap on the four-model set. For this model that saving is **unavailable at any price**, and for quantised models generally the WebGPU path runs the int8 operators on CPU anyway. **The WebGPU budget should not assume quantised models benefit.** |

**NOT BLOCKING.** **RAISED:** the WASM budget remains the one that must be published.

---

## `pratibimb-architect` — L1, recommends; the human decides

| Obligation | Finding |
|---|---|
| No frozen-contract change without an ADR | **None made.** No interface, invariant, dependency or routing change. |
| *"Any architecture change justified by preference rather than measured evidence"* | **None.** The REJECT is evidence-first. |
| Scope boundary | **Respected.** No product code, no perception pipeline, no agent loop, no backend routing implementation. |
| Constitution consistency | **§11's "prefer the WebGPU execution provider" now needs an explicit exception.** It is unsafe as an unconditional rule: it can silently return wrong numbers, and for quantised models it does not even use the GPU. |

**RECOMMENDS ONE ADR, not written here:** *backend selection must be per model and gated on a
correctness check*, replacing the unconditional "prefer WebGPU". This is a genuine architecture
decision and belongs to the human.

**Explicitly NOT recommended:** adopting the `Cast→Sub→Mul` rewrite into any product path
(it fixes one of two defects), changing the ORT pin (1.30.0-dev is equally broken), or any
`v0.2.0-spikes` tag.

---

## `privacy-security-engineer` — not required

Required only where the chosen fix changes CSP, trust boundary, execution permissions or
network behaviour. **This experiment changes none of them**: no CSP change, no invariant, no
egress path, loopback `127.0.0.1:8909` only, synthetic input, no PII, no secrets, no weights
committed. **No review requested.**

---

## Summary

| Reviewer | Verdict | Blocking |
|---|---|---|
| `ml-engineer` | **REJECT the WebGPU cell** | No `ADOPTED`; no WebGPU-compatible claim |
| `browser-engineer` | **PASS** | — |
| `evaluation-qa-engineer` | **PASS** | — (raises the third fail-open instrument) |
| `performance-engineer` | **PASS** | — (WebGPU budget must not assume quantised gains) |
| `pratibimb-architect` | **CONDITIONAL** | One ADR recommended: per-model backend selection |

**Consolidated: the model/backend REJECT is sound and the evidence supports it.** The open
architectural question is the unconditional "prefer WebGPU" rule, which this experiment shows
is unsafe as written.
