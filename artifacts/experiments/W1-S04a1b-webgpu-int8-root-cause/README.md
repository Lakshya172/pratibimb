---
id: W1-S04a-1b
title: "S-04a-1b — isolating the WebGPU int8 correctness defect"
status: recorded
date: 2026-09-09
label: FACT (observations) / INFERENCE (assessment)
verdict: REJECT (this model on WebGPU) — root cause confirmed for defect 1, defect 2 located not isolated
---

# S-04a-1b — it was never an int8 arithmetic problem

> S-04a-1 found the SmolVLM int8 vision encoder correct on WASM and **badly wrong on WebGPU**
> (`sumAbs` off ~3×), and refused to explain it away with tolerance.
>
> **The name "int8 defect" turns out to be wrong.** Every int8 operator in the model is exact
> on WebGPU in isolation. The first divergence is **`DequantizeLinear`**, whose WebGPU kernel
> returns wrong values for *every* parameter form tested — and which the WebGPU backend gets
> wrong while running the surrounding quantised maths perfectly.

## Hypothesis

Pre-registered before any run:

> **H1.** The defect is reproducible from a clean cold start on the pinned model and runtime.
> **H2.** There is a single first point of divergence, findable by bisection, and it is *not*
> visible from the final output alone.
> **H3.** The defect is either MODEL+WebGPU specific or WebGPU+int8 generally — a minimal
> synthetic graph can tell those apart.
> **H4.** If a minimal reproducer exists, an equivalent rewrite or a version change may fix it.

## Environment

| | |
|---|---|
| Model | SmolVLM-256M-Instruct `vision_encoder_int8` @ `7e3e67edbbed1bf9888184d9df282b700a323964`, Apache-2.0, 94,247,927 bytes, sha256 `d534ab668d3563e6d1d809bbbf1ff18308ded48651178614dbcc4a1de13d16f7` |
| Runtime | ORT Web **1.29.0** (pinned), plus **1.27.0** and **1.30.0-dev.20260904** for version variation |
| Reference | native `onnxruntime` **1.29.0**, CPUExecutionProvider |
| Browser | Chrome for Testing **153.0.8010.12**, Windows 11; WSL2 Ubuntu 26.04 |
| Context | Chrome MV3 offscreen document |
| Input | `pixel_values [1,1,3,512,512]`, `pixel_attention_mask [1,1,512,512]` bool, deterministic `((i*37)%255)/255` |
| Output | `image_features [1,64,576]` |

**Model hash re-verified against the S-04a-1 pin before use.** Nothing vendored.

## Expected result

- **Expected:** the divergence to be inside a quantised matmul, since that is what an "int8
  defect" implies.
- **Not expected, and therefore reported prominently:** that every int8 operator would be
  exact; that the culprit would be `DequantizeLinear`; and that fixing it would reveal a
  *second, independent* WebGPU defect.

## Actual result — FACT

### 1. Reproduction

| Backend | `relErr(sumAbs)` vs native CPU | min | max |
|---|---|---|---|
| native CPU (reference) | — | -46.666 | 91.195 |
| **WASM** | **1.957e-02** | -51.105 | 92.979 |
| **WebGPU** | **2.185e+00** | -58.256 | 63.440 |

Reproduced on every run. **H1 confirmed.**

### 2. WebGPU + int8 is NOT broadly broken — H3 answered

Seven minimal synthetic graphs, generated from committed source, compared **element-exact**
against native ORT (small tensors, so no aggregate statistic and no tolerance to argue about):

| Graph | WASM | WebGPU |
|---|---|---|
| `MatMulInteger` | 256/256 exact | **256/256 exact** |
| `DynamicQuantizeLinear` (Q, scale, zero-point) | exact | **exact** |
| `DynamicQuantizeLinear → MatMulInteger` | 256/256 exact | **256/256 exact** |
| `ConvInteger` | 144/144 exact | **144/144 exact** |
| `MatMul` fp32 (control) | 76/256, worstAbs 1.907e-06 | 76/256, worstAbs 1.907e-06 |

**Every int8 operator the model uses is exact on WebGPU.**

### 3. …but were those kernels even running on the GPU?

They rounded *identically* to WASM, which is what a shared CPU kernel looks like. Sizing the
graphs up so a real GPU matmul must engage settles it:

| Graph (256×512×256) | WASM | WebGPU | identical? |
|---|---|---|---|
| `MatMul` fp32 | 9671/65536 exact, worstAbs **1.907e-06** | 4960/65536 exact, worstAbs **3.338e-06** | **NO — GPU kernel ran** |
| `DynamicQuantizeLinear → MatMulInteger` | 65536/65536 exact | **65536/65536 exact, bit-identical** | YES |

**Conclusion:** ORT Web's WebGPU EP **partitions the int8 operators back to CPU**. They are
exact because they are not running on the GPU at all. That is why isolated int8 tests could
never have found this defect — and why the "int8" framing was misleading.

### 4. First point of divergence — the answer

Fifteen checkpoints promoted to graph outputs, compared CPU vs WASM vs WebGPU:

| Checkpoint | op | WASM | **WebGPU** |
|---|---|---|---|
| A1 GatherND pixels | GatherND | 0.000e+00 | 0.000e+00 |
| A2 patch-embedding Conv | Add | 0.000e+00 | 0.000e+00 |
| A3/A4 reshape, transpose | | 0.000e+00 | 0.000e+00 |
| B1–B7 NonZero … ScatterND | | 0.000e+00 | 0.000e+00 |
| B8 position-embedding Gather (uint8) | Gather | 0.000e+00 | **0.000e+00** |
| **B9 position-embedding dequant** | **`DequantizeLinear`** | **0.000e+00** | **1.486e+09** |
| C embeddings Add | Add | 0.000e+00 | 5.723e+08 |

**Everything before it is bit-exact on WebGPU, including the uint8 tensor feeding it.** The
model contains exactly **one** `DequantizeLinear` node, and that is the one.

Identical at `graphOptimizationLevel` **`all`** and **`disabled`** — not a fusion bug.

### 5. Minimal reproducer — a single node

`DequantizeLinear(uint8 x, scale = 0.08602941 scalar, zero_point = 116 scalar)`, no axis.

| Reproducer | WASM | WebGPU |
|---|---|---|
| 1-D `[256]` | 256/256 exact | **0/256 exact**, worstAbs 3.695e+08 |
| 2-D `[16,16]` | exact | **0/256**, worstAbs 3.695e+08 |
| 3-D `[1,16,16]` | exact | **0/256**, worstAbs 3.695e+08 |
| 3-D `[1,128,128]` | exact | **128/16384**, worstAbs 3.695e+08 |
| **model shape `[1,1024,768]`** | **786432/786432 exact** | **6144/786432**, worstAbs 3.695e+08 |
| int8 instead of uint8 | exact | **4/256**, worstAbs 16.35 |
| zero_point 0 | exact | **4/256**, worstAbs 19.96 |

**Rank-independent, size-independent, dtype-independent.** A one-node graph is enough.

### 6. Which parameter form? All of them

| Form | WASM | WebGPU |
|---|---|---|
| scalar (rank-0) scale + zero-point — *the model's form* | exact | **FAIL** |
| rank-1 `[1]` — semantically identical | exact | **FAIL** |
| zero-point omitted | exact | **FAIL** |
| per-channel (`axis=1`) | exact | **FAIL** |

**There is no re-export of the operator's parameters that avoids it.**

### 7. Version variation — not a regression, and no upgrade escapes it

| ORT Web | `DequantizeLinear` on WebGPU |
|---|---|
| **1.27.0** | FAIL — identical values |
| **1.29.0** (pinned) | FAIL |
| **1.30.0-dev.20260904** | FAIL — identical values |

**The project's pin was restored to 1.29.0 immediately after. It was not changed.**

### 8. A validated fix for defect 1

Two controls locate the defect precisely in the kernel and nowhere around it:

| Graph | WASM | WebGPU |
|---|---|---|
| `Cast(uint8 → float32)` alone | exact | **exact** |
| `Cast → Sub(zp) → Mul(scale)` — identical maths | exact | **exact** |
| `DequantizeLinear` — same maths | exact | **FAIL** |

So the operator can be replaced by its own definition. `harness/apply_fix.py` rewrites the
model's single `DequantizeLinear` into `Cast → Sub → Mul` (per-tensor only; per-channel nodes
are **refused, not guessed**).

**Validation:**
- **Native CPU, fixed vs original: `relErr = 0.000e+00`, identical min and max.** The rewrite
  is semantically exact.
- **WebGPU, the whole embedding region becomes bit-exact:** B9 `1.486e+09 → 0.000e+00`,
  C_add3 `5.723e+08 → 0.000e+00`.

### 9. …and then a SECOND, independent defect appears

The fix does **not** make the model correct. WebGPU improves from `2.185` to `1.603` and stays
wrong. Re-bisecting the fixed model:

| Checkpoint (layer 0) | op | WASM | **WebGPU** |
|---|---|---|---|
| embeddings Add | Add | 0.000e+00 | **0.000e+00** ← defect 1 fixed |
| layer_norm1 | Add | 0.000e+00 | 1.044e-07 |
| self-attention Softmax | Softmax | 1.209e-09 | 8.163e-10 |
| **self_attn/out_proj** | **Add** | **4.956e-08** | **3.875e+05** |

**Defect 2 is the attention output projection**, in encoder layer 0 (and every later layer).

**It is NOT reproduced in isolation.** The same quantised-Linear pattern
(`DynamicQuantizeLinear → MatMulInteger → Cast → Mul → Mul`) is **exact on WebGPU** at 2-D,
3-D, and at the model's own `[1,1024,768] × [768,768]` shapes — 786432/786432 exact. So the
cause is something in the surrounding attention data flow, not the quantised matmul itself.

**Defect 2 is located, characterised and honestly recorded as `UNKNOWN` in root cause.**

## Browser matrix

| Cell | Result |
|---|---|
| **Chrome Windows, WASM** | ✅ reference-matching throughout |
| **Chrome Windows, WebGPU** | ❌ both defects reproduce |
| **Chrome WSL2 Linux, WASM** | ✅ all 19 micro graphs correct |
| **Chrome WSL2 Linux, WebGPU** | ⚠️ **NOT TESTABLE** — `Failed to get GPU adapter`. Consistent with S-02a (no `/dev/dri`, 0 Vulkan ICDs). **An environment limit, not a failure.** |
| **Firefox, WebGPU** | **NOT VALID** — off by default (S-02a); not run, not inferred |

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Reproducible? | **FACT — yes**, every run |
| WebGPU + int8 broadly broken? | **FACT — no.** Every int8 op exact; they run on CPU by partitioning |
| First divergence? | **FACT — `DequantizeLinear`**, one node, bit-exact input |
| Minimal reproducer? | **FACT — yes**, single node, all ranks/sizes/dtypes/param forms |
| Fusion or optimisation? | **FACT — no**, identical at `all` and `disabled` |
| ORT version regression? | **FACT — no**, 1.27.0, 1.29.0 and 1.30.0-dev all fail |
| Fixable in-model? | **FACT — yes for defect 1**, `Cast→Sub→Mul`, validated bit-exact |
| Does that fix the model? | **FACT — NO.** A second defect remains |
| Root cause of defect 2? | **`UNKNOWN`** — located to `self_attn/out_proj`, not isolated |
| GPU memory / performance | **not measured, not claimed** |

## Model decision

> ### SmolVLM-256M `vision_encoder_int8`
> - **WASM = ACCEPT** (subject to S-04a-1's stated criterion, which it meets at 1.96e-02)
> - **WebGPU = REJECT**
> - **CPU (native, reference) = ACCEPT**
>
> **This says nothing about other models on WebGPU**, and nothing about all of WASM. In
> S-04a-1 the same WebGPU backend ran YuNet, PP-OCRv5 det and PP-OCRv5 rec correctly — indeed
> `ocr_det` passed on WebGPU while failing on WASM. **The granularity is model × backend.**

**Recommended product decision — `B. use WASM for this model`.** Not A (avoid WebGPU
generally), because three of four models are fine on it. Not D (upgrade), because 1.30.0-dev
is equally broken. The `Cast→Sub→Mul` rewrite is real and validated but **insufficient alone**,
so it is offered as evidence, not adopted.

## Findings

**Finding 1 — the "int8 defect" framing was wrong**, and only bisection could show it. Every
int8 operator is exact; they are exact because the WebGPU EP runs them on CPU.

**Finding 2 — `DequantizeLinear` is broken on ORT Web's WebGPU backend**, reproducibly, in one
node, across three runtime versions. **This is a third-party defect with a minimal reproducer.**

**Finding 3 — the operator is replaceable by its own definition**, and the replacement is exact
on both backends. A useful mitigation for anyone hitting only this defect.

**Finding 4 — there is a second, independent WebGPU defect** at the attention output
projection, which the quantised-Linear pattern does not reproduce in isolation. **Fixing one
defect revealed the next; neither was visible from the final output.**

**Finding 5 — WSL2 cannot test WebGPU at all.** Reported as not-testable rather than as a
failure, so the Linux cell is not silently counted as evidence either way.

## What this does NOT establish

- **Nothing about other models on WebGPU.** Three of four in S-04a-1 were fine.
- **No root cause for defect 2.**
- **No claim that ORT Web's WebGPU backend is broadly incorrect.**
- **No performance or memory claim.** Correctness only, as instructed.
- **No CSP change**, no production backend routing, no product code.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-04a-1b-1 | Isolate defect 2 at `self_attn/out_proj` — bisect *within* the attention block (reshape/transpose feeding out_proj) | **p1** | Any future WebGPU use of this model |
| S-04a-1b-2 | Report the `DequantizeLinear` reproducer upstream to onnxruntime | **p1** | Third-party fix |
| S-04a-1b-3 | Re-test both defects when ORT Web 1.30.0 ships stable | p2 | Backend re-evaluation |
| S-04a-1b-4 | Decide whether an fp16/fp32 SmolVLM export avoids both defects — would need a 178–357 MB download | p2 | Tier design |

## Reproducibility

```bash
python harness/build_micro.py && python harness/build_micro_large.py
python harness/build_dql_repro.py && python harness/build_dql_repro2.py
python harness/micro_ref.py
node harness/build-ext.js
PLATFORM_LABEL=windows CHROME_PATH='...' RUNS=1 node harness/run-chrome.js

python harness/build_instrumented2.py && python harness/layer_ref.py
LAYERWISE=1 OPT_LEVELS=all,disabled node harness/build-ext.js && ... node harness/run-chrome.js

python harness/apply_fix.py            # the validated defect-1 rewrite
```

`commands.md` records which configuration produced which log. Loopback `127.0.0.1:8909` only.

## Scope

**This model at this revision · ORT Web 1.27.0 / 1.29.0 / 1.30.0-dev · Chrome for Testing
153.0.8010.12 · Windows 11 and WSL2 Ubuntu 26.04 · Chrome MV3 offscreen document.** Per
`AGENTS.md` §5 this fills the cells it tested and no others.
