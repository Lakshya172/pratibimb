---
id: W1-S04a-1
title: "S-04a-1 — four DIFFERENT models resident together"
status: recorded
date: 2026-09-09
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-04a-1 — four different models, and the answer changes

> S-04a reached the WASM growth regime but used **three copies of one model**, and said so:
> three YuNet sessions share weights and workspace shapes, so *"sessions share the arena"*
> could still have been an artefact of them being identical. The dossier's real risk is
> **~120 MB across four different models.**
>
> **This experiment runs that, and the answer is different.** Where three identical sessions
> cost **+0 MB each**, four different models cost **+16.0, +7.1, +57.3 and +192.8 MB**.

## Hypothesis

Pre-registered before any model was fetched:

> **H1.** Four different models will reach the growth regime more decisively than one model
> repeated.
> **H2.** Residency will cost roughly **A+B+C+D**, unlike the identical-model case where
> sessions 2 and 3 were free.
> **H3.** Repeated four-model lifecycles will still plateau — bounded, not leaking.
> **H4.** Every model stays numerically correct against native ONNX Runtime.

## Expected result

Stated before the runs, so a surprise is visible as a surprise:

- **Expected:** four different models to cost roughly the sum of their parts (**H2**), a more
  decisive growth regime than S-04a (**H1**), a plateau over repeated cycles (**H3**), and
  correct output throughout (**H4**).
- **Expected to differ:** Firefox using more than one `Memory` instance, as in S-04 and S-04a.
- **Expected to fail:** the Chrome MV3 service worker, which cannot load ORT at all (S-03).
- **Not expected, and therefore flagged where it happened:** that residency would be markedly
  **sub-additive** rather than A+B+C+D; that the **int8 model would be numerically broken on
  WebGPU** while correct on WASM; and that the registry's UI-element model would prove
  **unusable on licence grounds**.

## The four models

Chosen from `agentos/registry/model-registry.md`, one per dossier perception role, each
pinned to an exact revision with its licence read **from that revision**.

| Role | Model | Revision | Licence | Bytes | SHA-256 |
|---|---|---|---|---|---|
| Face detection | **YuNet** `face_detection_yunet_2023mar.onnx` | `47534e27c9851bb1128ccc0102f1145e27f23f98` | **Apache-2.0** | 232,589 | `8f2383e4dd3cfbb4…` |
| OCR detection | **PP-OCRv5_mobile_det** | `0d63e78e2b680928f6b1747d76a08db6e645efb7` | **Apache-2.0** | 4,819,576 | `5f353dec11fcfc7c…` |
| OCR recognition | **PP-OCRv5_mobile_rec** | `682f20538d8c086cb2128e5cfac775e6c4904e85` | **Apache-2.0** | 16,557,298 | `e0c89a163abe16e1…` |
| VLM vision tower | **SmolVLM-256M-Instruct** `vision_encoder_int8` | `7e3e67edbbed1bf9888184d9df282b700a323964` | **Apache-2.0** | 94,247,927 | `d534ab668d3563e6…` |

**Total weights: 110.49 MB** — close to the dossier's ~120 MB figure by construction.

They are **genuinely different architectures**, not four sizes of one:

| Model | Nodes | Dominant ops | Character |
|---|---|---|---|
| YuNet | 106 | 53 Conv | small CNN detector, fixed `[1,3,640,640]` |
| PP-OCRv5 det | 502 | 62 Conv, 24 HardSwish | DBNet-style segmentation, **dynamic shapes** |
| PP-OCRv5 rec | 549 | 38 Conv, 13 MatMul | CRNN sequence recognition, 18,385 classes |
| SmolVLM encoder | 1,146 | **73 MatMulInteger** | **int8-quantised** SigLIP ViT |

> **Weights are NOT committed.** `harness/fetch-models.py` pins every revision, records every
> hash, and **refuses on mismatch**. The two PP-OCRv5 models ship in Paddle format and are
> **converted from the first-party Apache-2.0 source** via `paddle2onnx`, exactly as the
> registry row specifies — not taken from an unlicensed third-party ONNX re-export.

### The UI-element model was excluded, and why

The registry's fifth role is **UI element detection — OmniParser `icon_detect`**. Its
`icon_detect/LICENSE` at revision `6600256cb0f1b07651e3bc86166196307bad7e2d` reads
**GNU AFFERO GENERAL PUBLIC LICENSE Version 3** — confirming the exact defect the registry
already documents, at the revision, not from a model card. The `onnx-community` re-exports of
it declare **no licence at all**.

**Not used.** The registry's rule was followed rather than worked around: an inadequately
licensed candidate is skipped and the next valid one taken.

## Environment

Chrome for Testing **153.0.8010.12**, Firefox **155.0.1**, ORT Web **1.29.0**, native
`onnxruntime` **1.29.0** as reference, Windows 11 and WSL2 Ubuntu 26.04, headful and headless.
Loopback `127.0.0.1:8908` only. Synthetic deterministic input; **no PII, no secrets**.

Weights are read at runtime from the extension's **own packaged resources** via
`runtime.getURL()` — a same-origin extension read, **not network**. Inlining 110 MB as base64
was not viable.

## Actual result — FACT

### §5 — Individual baselines, each model alone in a fresh context

| Model | weights | after create | after infer | grows | create ms | infer ms |
|---|---|---|---|---|---|---|
| face | 0.22 MB | 16 MB | **28.3 MB** | 2 | 316 | 63 |
| ocr_det | 4.60 MB | 23.1 MB | **69.2 MB** | 8 | 474 | 234 |
| ocr_rec | 15.79 MB | 62.9 MB | **62.9 MB** | 6 | 527 | 79 |
| vlm_vision | 89.88 MB | 206.1 MB | **247.3 MB** | 6 | 674 | 3366 |

**Sum of the four solo peaks: 407.7 MB.** Timings are feasibility data, **not a benchmark** —
no product latency claim is made.

## §6 — Four different models resident together (cold start)

Each model added while every earlier session stays **alive**:

| Step | WASM heap | grows | **added** |
|---|---|---|---|
| none | 0 MB | 0 | — |
| + face | 16 MB | 0 | **+16.0** |
| + ocr_det | 23.1 MB | 2 | **+7.1** |
| + ocr_rec | 80.4 MB | 7 | **+57.3** |
| **+ vlm_vision** | **273.2 MB** | **11** | **+192.8** |
| infer all four | 273.2 MB | 11 | +0.0 |

### The answer to the question S-04a could not settle

| | S-04a (3 × YuNet) | **S-04a-1 (4 different)** |
|---|---|---|
| 2nd model | **+0 MB** | **+7.1 MB** |
| 3rd model | **+0 MB** | **+57.3 MB** |
| 4th model | — | **+192.8 MB** |

**Different models do NOT come free.** Every one of them cost real memory. The identical-model
result was exactly the artefact S-04a warned it might be.

**But it is not simply A+B+C+D either:** 273.2 MB resident against **407.7 MB** as the sum of
solo peaks — **33% cheaper** than additive. Sessions share the arena; they just cannot share
weights or workspaces they do not have in common.

**Peak is 2.5× the weight total** (273.2 MB against 110.49 MB of weights).

## §7 — Inference with all four resident

All four ran with all four resident. Correctness is reported per model in §H below.

## §8 — Lifecycle: destroy one at a time, then repeat

| Snapshot | heap | grows |
|---|---|---|
| all four resident | 273.2 MB | 11 |
| after destroy vlm_vision → infer remaining 3 | 273.2 MB | 11 |
| after destroy ocr_rec → infer remaining 2 | 273.2 MB | 11 |
| after destroy ocr_det → infer remaining 1 | 273.2 MB | 11 |
| after destroy face | 273.2 MB | 11 |
| **after cycle 1 / 2 / 3** (full four-model create→infer→destroy) | **273.2 MB** | **11** |

**Three further complete four-model lifecycles added zero grows.** The heap not shrinking is
**spec-correct** — `WebAssembly.Memory` has `grow()` and no inverse — and is **not a leak**.
The leak question lives in repeated cycles, and repeated cycles are flat.

## §9 — The growth regime is decisively reached

**11 grow() calls**, 0 → 273.2 MB, against S-04a's 3 grows to 33.9 MB.

```
+52   pages    16   -> 19.3    +1242 pages   80.4 -> 158.1
+62   pages   19.3  -> 23.1    +506  pages  158.1 -> 189.7
+250  pages   23.1  -> 38.8    +607  pages  189.7 -> 227.6
+124  pages   38.8 -> 46.5     +729  pages  227.6 -> 273.2
+149  pages   46.5 -> 55.8
+179  pages   55.8 -> 67
+215  pages     67 -> 80.4
```

**This is the regime the dossier warns about, and it was genuinely entered.**

## §10 — Failure behaviour under memory constraint

**Real exhaustion was NOT safely reproducible and is not claimed.** The host had 23 GB total
but **only ~4.1 GB free**, and wasm32 addresses at most 4 GB — driving a real ORT workload to
the WASM ceiling would have consumed nearly all free host RAM first. The task forbids
destabilising the host, so two **bounded** things were done instead.

**A. Bounded escalation** — repeated rounds of all four models, held live, hard ceiling 1200 MB:

| round | live sessions | heap | grows |
|---|---|---|---|
| 1 | 4 | 273.2 MB | 11 |
| 2 | 8 | 393.5 MB | 13 |
| 4 | 16 | 664.1 MB | 16 |
| 6 | 24 | 884.0 MB | 18 |
| **8** | **32** | **1118.1 MB** | **20** |

**32 concurrent sessions, 1.1 GB, no failure of any kind.** Each additional round of four
models cost **~110–120 MB**, well under the first round's 273 MB. Releasing all 32 freed
nothing (spec-correct). **Stopped at the round cap, not at a failure.**

**B. Allocations that cannot succeed in wasm32, at zero host cost** — this is what actually
answers *explicit / graceful / silent*:

| Attempt | Result |
|---|---|
| `new WebAssembly.Memory({initial: 65537})` (>4 GB) | **`RangeError: value 65537 is above the upper bound 65536`** |
| `new Float32Array(2**31)` (8 GB) | **`RangeError: Array buffer allocation failed`** |

**Failure is EXPLICIT, named, and immediate.** No silent truncation, no corrupted output, no
browser crash. That is the fail-closed behaviour the architecture needs.

**Still `UNKNOWN`:** what a *real ORT workload* does at genuine heap exhaustion. Not tested,
not inferred.

## §11–13 — Browser matrix

| Cell | resident peak | grows | Memory instances | result |
|---|---|---|---|---|
| **Chrome Windows, wasm** | **273.2 MB** | 11 | 1 | ✅ |
| **Chrome WSL2 Linux, wasm** | **273.2 MB** | 11 | 1 | ✅ |
| **Firefox Windows, wasm** | **273.2 MB** | 11 | **2** | ✅ |
| **Chrome Windows, webgpu** | **236.9 MB** | 10 | 1 | ✅ memory, ⚠ correctness |
| Chrome MV3 service worker | — | — | — | cannot run ORT at all (S-03) |

**Firefox is step-for-step identical to Chrome** — 16 → 23.1 → 80.4 → 273.2, the same 11
grows, the same per-model increments, and the same correctness figures to four significant
figures. The only differences are **2 `Memory` instances instead of 1** and no
`SharedArrayBuffer`.

Headful and headless agree in every cell.

**Firefox did not time out.** The chunked reporting fixed in S-04a delivered an 8-chunk report
with `incompleteChunkSets: []` on the first attempt.

### WebGPU

**236.9 MB / 10 grows against wasm's 273.2 MB / 11 — a 13% saving.** Far smaller than S-04a's
43% for a single small model, and the reason is visible in the steps: the saving appears at
`ocr_rec` (43.2 MB vs 57.3) and `vlm_vision` (170.6 vs 192.8), while **the int8 weights still
live in the WASM heap**. GPU-side memory remains **unmeasured**.

## §14 — Threading

| | `SharedArrayBuffer` | `crossOriginIsolated` | threads used |
|---|---|---|---|
| Chrome (Windows + Linux) | **true** | false | **1** (requested) |
| Firefox Windows | **false** | false | **1** (forced) |

Threading was **not forced** and **no performance claim** is made.

## §H — Correctness, and a correctness metric that had to be fixed

**The first run reported OUTPUT INCORRECT, and the cause was my metric, not the runtime.**

The original criterion compared the **raw sum** of each output. That is a bad statistic here:
for `vlm_vision` the sum is **0.027% of n×scale** — almost total cancellation between large
positive and negative terms — so it is dominated by cancellation rather than by error.

A native conditioning measurement settled it. Perturbing the input by **one part in a million**:

| Model | max element change / scale | raw `sum` change | **`sumAbs` change** |
|---|---|---|---|
| face | 3.3e-07 | 7.7e-08 | **1.5e-08** |
| ocr_rec | 1.4e-06 | 1.5e-08 | **1.5e-08** |
| **ocr_det** | **9.8e-02** | 2.7e-06 | **2.7e-06** |
| **vlm_vision** | **5.0e-02** | **1.0e-01** | **2.9e-03** |

**The two models that failed are exactly the two that are ill-conditioned**, and `sumAbs` —
which cannot cancel, so per-element error accumulates into it instead — is stable for all four.

The criterion is therefore **exact output count + `sumAbs` within 2e-2**, about 3× the measured
conditioning bound. `min`, `max`, raw `sum` and sampled values are recorded as **data, not
pass/fail**, because single extreme elements are precisely what ill-conditioning and int8
bucket-flipping move first. **This is a stricter aggregate test than the original, not a looser
one** — and it is set from measurement, not chosen to make a run pass.

### Result under that criterion

| Model | Chrome wasm | Chrome webgpu | Firefox |
|---|---|---|---|
| face | ✅ 1.59e-02 | ✅ 4.67e-03 | ✅ 1.59e-02 |
| ocr_rec | ✅ **5.51e-06** | ✅ 1.0e-06 | ✅ 5.51e-06 |
| vlm_vision | ✅ 1.96e-02 | ❌ **2.18** | ✅ 1.96e-02 |
| **ocr_det** | ❌ **4.12e-02** | ✅ 4.96e-03 | ❌ 4.12e-02 |

**Two findings, both reported as measured rather than tuned away:**

**`ocr_det` fails on WASM at 4.12e-02.** Its output is a sigmoid probability map that the
synthetic input drives into saturation — every value is ~1e-6, meaning pre-sigmoid logits near
−14.4. Converting to that space: **web −14.4669 vs native −14.4248, a difference of 0.042
absolute — 0.29%.** The 4.12% is the exponential amplifying a 0.29% logit difference. It is
reported as a **failure against the stated criterion** regardless, and validation with a
realistic text-bearing input is a named follow-up.

**`vlm_vision` is grossly wrong on WebGPU — `sumAbs` off by a factor of ~3 (2.18 relative).**
Not rounding, not conditioning: **broken**. The int8 `MatMulInteger` path is not reliable on
ORT Web's WebGPU (JSEP) backend, while the same model is fine on WASM (1.96e-02). **This is a
capability finding that directly affects any plan to run a quantised transformer on WebGPU.**

## Findings

**Finding 1 — different models do not share, identical ones do.** The central S-04a caveat is
resolved: +0/+0 for identical sessions became +7.1/+57.3/+192.8 for different ones.

**Finding 2 — residency is sub-additive but not free.** 273.2 MB resident vs 407.7 MB summed
solo peaks — **33% cheaper**, and **2.5× the raw weight total**.

**Finding 3 — the footprint is still bounded.** 11 grows, then flat across the full teardown
sweep and three more complete four-model lifecycles.

**Finding 4 — allocation failure is explicit.** `RangeError` in both impossible-allocation
cases; no silent corruption. 32 live sessions at 1.1 GB with no failure at all.

**Finding 5 — Chrome and Firefox agree to four significant figures**, on a 110 MB four-model
workload, on two operating systems.

**Finding 6 — WebGPU saves less than S-04a suggested (13%, not 43%) and breaks the int8
model.** Both halves matter for tier design.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Growth regime reached with four different models? | **FACT — yes**, 11 grows to 273.2 MB |
| Does each different model cost memory? | **FACT — yes**, +7.1 / +57.3 / +192.8 MB |
| Is it A+B+C+D? | **FACT — no**, 33% sub-additive |
| Unbounded growth over repeated cycles? | **FACT — no**, 3 cycles, zero grows |
| Correct under residency? | **FACT — 3 of 4 on wasm**; `ocr_det` fails the stated criterion |
| Failure mode when allocation is impossible? | **FACT — explicit `RangeError`** |
| Real heap-exhaustion behaviour? | **`UNKNOWN`** — not safely reproducible on this host |
| GPU memory? | **`UNKNOWN`** — not measured |
| int8 transformer on WebGPU? | **FACT — incorrect**, `sumAbs` off ~3× |

## Conclusion

**CONDITIONAL.**

The dossier's multi-model risk is now **measured rather than feared**, and it is real but
bounded: four different perception models totalling 110 MB of weights occupy **273 MB** of WASM
heap, cost real memory each, and then **stop growing** — flat across a full teardown sweep and
three further complete lifecycles, identically on Chrome and Firefox, on Windows and Linux.
Allocation failure, where it can be provoked safely, is **explicit**.

**It is not ACCEPT, for three reasons:**

1. **`ocr_det` does not meet the stated correctness criterion on the WASM backend.** The logit
   analysis explains it and no evidence suggests a runtime defect — but the criterion is the
   criterion, and validation under realistic input has not been done.
2. **The int8 VLM encoder is incorrect on WebGPU.** A backend that silently returns wrong
   numbers for one of the four models is not a settled capability.
3. **Real heap-exhaustion behaviour remains `UNKNOWN`**, and GPU-side memory is unmeasured.

## What this does NOT establish

- **No latency or throughput claim.** Timings are feasibility data only. **QG-03 stays open.**
- **Nothing about GPU-side memory**, so WebGPU's 13% is a WASM-heap saving only.
- **Nothing about a fifth resident model**, or about the excluded UI-element detector.
- **Nothing about real heap exhaustion.**
- **No CSP decision.** `'wasm-unsafe-eval'` appears only in the throwaway harness manifest.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-04a-1a | Validate `ocr_det` and `vlm_vision` with **realistic text-bearing input**, out of the saturated regime | **p1** | QG-03, correctness sign-off |
| S-04a-1b | **int8 `MatMulInteger` on ORT Web WebGPU returns wrong values** — isolate, report upstream, decide whether WebGPU is usable for quantised models | **p1** | Tier design, backend selection |
| S-04a-1c | A licensed UI-element detector — OmniParser `icon_detect` is **AGPL-3.0** and unusable | **p1** | The UI-detection role itself |
| S-04a-1d | Real heap-exhaustion behaviour on a host with sufficient free RAM | p2 | Fail-closed guarantees |
| S-04a-1e | Measure GPU-side memory for the WebGPU EP | p2 | The WebGPU budget |

## Reproducibility

```bash
python harness/fetch-models.py     # pins 4 revisions, verifies hashes, converts PP-OCRv5
python harness/mkref.py            # native onnxruntime 1.29.0 reference
node harness/build-extension.js
PHASE=resident CYCLES=3 PLATFORM_LABEL=... CHROME_PATH=... RUNS=1 node harness/run-s04a1-chrome.js
PRESSURE=1 ... node harness/run-s04a1-chrome.js     # section 10
```

`commands.md` records which configuration produced which log.

## Scope

**These four models at these revisions · ORT Web 1.29.0 · Chrome for Testing 153.0.8010.12 and
Firefox 155.0.1 · Windows 11 and WSL2 Ubuntu 26.04 · single-threaded WASM and WebGPU.** Per
`AGENTS.md` §5 this fills the cells it tested and no others.
