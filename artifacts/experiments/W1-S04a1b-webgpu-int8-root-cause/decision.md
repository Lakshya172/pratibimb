---
id: W1-S04a-1b-decision
experiment: W1-S04a1b-webgpu-int8-root-cause
date: 2026-09-09
---

# S-04a-1b — decision record

## What was asked

S-04a-1 found the SmolVLM int8 vision encoder correct on WASM and materially wrong on WebGPU,
and the instruction was explicit: **find the first real divergence, do not explain it away with
tolerance, and either fix the root cause or reject that model/backend combination cleanly.**

## Decision 1 — the experiment's own name was wrong, and the evidence says so

It was filed as an **int8** defect. It is not one.

Seven minimal synthetic graphs put `MatMulInteger`, `DynamicQuantizeLinear`,
`DynamicQuantizeLinear → MatMulInteger` and `ConvInteger` **all exact on WebGPU** — element for
element, against native ORT.

The reason matters and was measured rather than assumed. Scaled to 256×512×256, an fp32
`MatMul` rounds **differently** on WebGPU (worstAbs 3.338e-06) than on WASM (1.907e-06), so a
GPU kernel genuinely runs. At the same size the int8 pattern is **bit-identical** across
backends. **ORT Web's WebGPU EP partitions the int8 operators back to CPU.** They are exact
because they never touch the GPU.

**No isolated int8 test could have found this defect.** Only bisecting the real model did.

## Decision 2 — the first divergence is one node, and it is `DequantizeLinear`

Fifteen checkpoints, CPU vs WASM vs WebGPU. Everything up to and including the **uint8 tensor
feeding it** is `0.000e+00` on WebGPU. Then:

```
B9  /vision_model/embeddings/position_embedding/Gather_output_0
    DequantizeLinear      WASM 0.000e+00      WebGPU 1.486e+09
```

The model contains exactly **one** `DequantizeLinear`. It is that one.

**Not a fusion or optimisation artefact:** identical at `graphOptimizationLevel` `all` and
`disabled`.

**Minimal reproducer: a single-node graph.** It fails at 1-D, 2-D and 3-D; at 256 elements and
at 786,432; with uint8 and int8; with zero-point 116 and 0; and in **all four** parameter
forms — scalar, rank-1, omitted zero-point, and per-channel. **There is no re-export of the
operator's parameters that avoids it.**

**Not a regression, and no upgrade escapes it:** 1.27.0, 1.29.0 and 1.30.0-dev all fail with
identical values. **The project pin was restored to 1.29.0 and verified; it was never changed.**

## Decision 3 — a fix exists for defect 1, and it is validated, but NOT adopted

Two controls locate the fault in the kernel and nowhere around it:

| | WebGPU |
|---|---|
| `Cast(uint8 → float32)` alone | **exact** |
| `Cast → Sub(zp) → Mul(scale)` — identical maths | **exact** |
| `DequantizeLinear` — identical maths | **FAIL** |

`harness/apply_fix.py` rewrites the node into its own definition. It refuses per-channel nodes
rather than guessing at broadcasting.

**Validated twice:**
- **Native CPU, fixed vs original: `relErr = 0.000e+00`.** Semantically exact — the rewrite
  changes nothing.
- **WebGPU: the entire embedding region becomes bit-exact** (`1.486e+09 → 0.000e+00`).

**It is offered as evidence, not adopted**, because of Decision 4.

## Decision 4 — fixing defect 1 revealed defect 2, and that is reported, not buried

The fixed model is **still wrong on WebGPU**: 2.185 → 1.603. Re-bisecting found a second,
independent divergence at the **attention output projection**, `self_attn/out_proj`, in encoder
layer 0 and every layer after it — while `layer_norm1` (1.044e-07) and `Softmax` (8.163e-10)
immediately before it are clean.

**Defect 2 is NOT minimally reproduced.** The same quantised-Linear pattern is exact on WebGPU
at 2-D, at 3-D, and at the model's own `[1,1024,768] × [768,768]` shapes — 786432/786432 exact.
So the cause lies in the surrounding attention data flow, not the quantised matmul.

**Root cause of defect 2: `UNKNOWN`.** Located, characterised, and left labelled — not guessed
at, and not folded into defect 1 to make the result look complete.

## Decision 5 — two harness defects were found and fixed, and both had been hiding evidence

Recorded because each silently removed data rather than failing loudly — the same failure mode
as the S-04a collector.

1. **Promoted graph outputs need explicit types.** Without them ORT Web returned **5 of 15**
   outputs while native ORT returned all 15, with no error. Fixed by running ONNX shape
   inference and copying the inferred `ValueInfo`.
2. **int64 outputs arrive as `BigInt64Array`.** `sum += v` throws *"Cannot mix BigInt and other
   types"*, which aborted the comparison loop after the five float32 checkpoints. **Ten
   checkpoints vanished from three separate runs**, and the earlier "first divergence at the
   embeddings" reading came from that truncated set. Fixed by explicit conversion plus a
   per-checkpoint `try`, so one bad tensor can no longer take the sweep down with it.

**Neither changed a conclusion that was published** — both were caught before the write-up —
but the second one had already produced a misleading intermediate reading, and that is exactly
why it is recorded here.

## Decision 6 — the model/backend decision

> **SmolVLM-256M `vision_encoder_int8`: WebGPU = REJECT. WASM = ACCEPT. CPU = ACCEPT.**

Per the task's §15, the chosen product decision is **B — use WASM for this model**:

- **not A** (avoid WebGPU generally): S-04a-1 ran YuNet, PP-OCRv5 det and PP-OCRv5 rec
  correctly on the same backend, and `ocr_det` actually passed on WebGPU while failing on WASM;
- **not D** (upgrade): 1.30.0-dev is equally broken;
- **not C alone** (compatible export): the rewrite fixes defect 1 only.

**The granularity is model × backend × context, and the matrix must be able to say
`Model X: WASM ACCEPT, WebGPU REJECT` without implying anything about either backend
generally.** That is how the registry has been written.

## What is deliberately NOT changed by this PR

- **No production CSP change.** `'wasm-unsafe-eval'` appears only in the throwaway harness
  manifest with a note. The decision remains **ADR S-02a-2a**, and this experiment was not used
  to pre-empt it.
- **No backend routing, no product code, no perception pipeline, no agent loop.**
- **The ORT Web pin is unchanged at 1.29.0** — other versions were tested in a scratch
  directory and the pin was restored and verified.
- **No model weights committed**; no model in the repository was altered. The fixed model is a
  locally generated artifact, reproducible from `apply_fix.py`.
- **No invariant, no frozen contract, no B-02 change.**
- **`agentos/registry/model-registry.md` is updated** with WASM and WebGPU correctness as
  **separate** fields, and the model is **not** moved to `ADOPTED`.

## Gates

| Gate | Status after S-04a-1b |
|---|---|
| QG-01 | satisfied — hypothesis pre-registered, artifact present, every claim labelled |
| QG-03 | **still OPEN** — a model with a REJECT cell cannot be adopted, and no benchmark exists |
| QG-04 | **still UNSIGNED** — untouched by this experiment |

## Outcome against the stated success conditions

The task allowed four defensible outcomes. This lands on **B and C together**:

- **C — root cause narrowed to a third-party defect with a reproducible minimal reproducer**
  (defect 1: `DequantizeLinear`, single node, three runtime versions);
- **B — model/backend combination rejected** (WebGPU REJECT for this model), because defect 2
  remains and the model is still incorrect.

**Not A**, because the validated fix does not make the model correct. Saying so is the point.
