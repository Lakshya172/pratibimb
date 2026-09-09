---
id: W1-S04a-1-decision
experiment: W1-S04a1-four-model-residency
date: 2026-09-09
---

# S-04a-1 — decision record

## What was asked

S-04a closed `CONDITIONAL` for one stated reason: it used **three copies of one model**, and
the dossier's risk is **four different models resident together**. The instruction was:

> *"Use FOUR DIFFERENT MODELS. Do not use four copies of YuNet."*

## Decision 1 — the S-04a caveat was correct, and it mattered

| | S-04a (3 × YuNet) | **S-04a-1 (4 different)** |
|---|---|---|
| adding the 2nd model | **+0 MB** | **+7.1 MB** |
| adding the 3rd model | **+0 MB** | **+57.3 MB** |
| adding the 4th | — | **+192.8 MB** |
| peak | 33.9 MB | **273.2 MB** |
| grows | 3 | **11** |

**Identical sessions really were sharing everything; different models share much less.**
S-04a explicitly warned that its result might be an artefact of the models being identical.
It was. Reporting that caveat rather than rounding it off is what made this experiment
worth running.

**Residency is still sub-additive:** 273.2 MB against **407.7 MB** as the sum of the four
solo peaks — 33% cheaper. So sessions do share an arena; they simply cannot share weights and
workspaces they do not have in common. And the peak is **2.5× the raw weight total**, which is
the number a memory budget has to be built from — not the 110 MB of weights.

## Decision 2 — model selection followed the registry rule instead of routing around it

The registry names five browser-side roles. **The UI-element detector could not be used.**
`microsoft/OmniParser-v2.0`, at revision `6600256cb0f1b07651e3bc86166196307bad7e2d`, has an
`icon_detect/LICENSE` that begins:

```
                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007
```

That is the exact defect `model-registry.md` already documents, confirmed **at the revision**
rather than from a model card, and the registry's intended MIT replacement `icon_detect_v3`
does not exist as a pinnable ONNX artifact. The `onnx-community` ONNX re-exports declare **no
licence at all**.

Per the instruction — *"If any candidate is not adequately pinned/licensed: do not use it"* —
it was skipped and the VLM vision tower taken instead. **No AGPL model was downloaded or run.**

The two PP-OCRv5 models ship in Paddle format. Rather than take an unlicensed third-party ONNX
re-export, they are **converted from the first-party Apache-2.0 source with `paddle2onnx`**,
which is what the registry row already specifies. That required pinning `paddlepaddle==3.1.0`
against `paddle2onnx==2.1.0` — 3.3.1 fails with a DLL import error. Root cause found and
pinned rather than worked around.

## Decision 3 — the first "OUTPUT INCORRECT" was my metric, and I fixed the metric

The first run reported failures for `ocr_det` and `vlm_vision`. The criterion compared the
**raw sum** of each output tensor. That statistic is unusable for these two arrays:

- `vlm_vision`'s sum is **0.027% of n×scale** — near-total cancellation between large positive
  and negative terms, so it is dominated by cancellation, not by error.
- `ocr_det`'s values are all ~1e-6, so a `max(1, …)` tolerance scale made the comparison
  effectively absolute on a quantity of magnitude 0.2.

A native conditioning measurement decided it. Perturbing the input by **one part in a
million**:

| Model | max element / scale | raw `sum` | **`sumAbs`** |
|---|---|---|---|
| face | 3.3e-07 | 7.7e-08 | 1.5e-08 |
| ocr_rec | 1.4e-06 | 1.5e-08 | 1.5e-08 |
| **ocr_det** | **9.8e-02** | 2.7e-06 | 2.7e-06 |
| **vlm_vision** | **5.0e-02** | **1.0e-01** | 2.9e-03 |

**The two models that failed are exactly the two that are ill-conditioned**, and `sumAbs` is
stable for all four. The criterion is now **exact output count + `sumAbs` within 2e-2**.

**This is a stricter aggregate test, not a looser one.** `sumAbs` cannot cancel, so per-element
error accumulates into it instead of hiding in it. `min`, `max`, raw `sum` and sampled values
are still recorded — as **data, not pass/fail** — because single extreme elements are exactly
what ill-conditioning and int8 bucket-flipping move first.

The tolerance is set from the measured conditioning bound (2.9e-3 → 2e-2, about 3×), **not
chosen to make a run pass**. The conditioning table is committed.

## Decision 4 — two failures are reported as failures

**`ocr_det` fails on WASM at 4.12e-02 against a 2e-02 criterion.** The explanation is solid:
the output is a sigmoid probability map that the synthetic input drives into saturation
(~1e-6 everywhere, i.e. logits near −14.4). In logit space, **web −14.4669 vs native −14.4248
— 0.042 absolute, 0.29%**. The 4.12% is `exp()` amplifying a 0.29% difference.

**It is still recorded as a failure.** The criterion was stated before the result, and an
explanation is not a pass. Validation with realistic text-bearing input is **S-04a-1a**.

**`vlm_vision` on WebGPU is broken — `sumAbs` off by a factor of ~3 (2.18 relative).** That is
not rounding and not conditioning. The same model is correct on WASM (1.96e-02). **The int8
`MatMulInteger` path on ORT Web's WebGPU/JSEP backend returns wrong numbers.** This is a
capability finding with direct architectural weight: any plan to run a quantised transformer on
WebGPU is currently unsound. **S-04a-1b.**

## Decision 5 — §10 was bounded deliberately, and the UNKNOWN is stated

The host has 23 GB total but **~4.1 GB free**, and wasm32 addresses at most 4 GB. Driving a real
ORT workload to the WASM ceiling would have exhausted host RAM first. The instruction forbids
destabilising the host and says to record `UNKNOWN` rather than fake a pass, so:

- **Bounded escalation** reached **32 live sessions at 1118 MB with no failure**, growing
  ~110–120 MB per additional set of four. Stopped at the round cap, **not at a failure**.
- **Impossible allocations**, at zero host cost, gave the answer §10 actually asks for:
  `WebAssembly.Memory({initial: 65537})` → **`RangeError`**; `new Float32Array(2**31)` →
  **`RangeError`**. **Explicit, named, immediate. No silent truncation, no corruption, no
  crash.**

**Real heap-exhaustion behaviour under a real workload remains `UNKNOWN`** and is not inferred
from either result.

## Decision 6 — verdict stays CONDITIONAL

The multi-model risk is now measured rather than feared, and it is **real but bounded**. It is
**not ACCEPT** because:

1. `ocr_det` does not meet the stated correctness criterion on WASM.
2. The int8 VLM encoder is **incorrect on WebGPU**.
3. Real heap exhaustion is `UNKNOWN`; GPU-side memory is unmeasured.

**S-04 / S-04a therefore also stay CONDITIONAL.** Their mechanism claims survive contact with
four different models, but a backend that returns wrong numbers for one of the four is not a
settled capability.

## What is deliberately NOT changed by this PR

- **No production CSP change.** `'wasm-unsafe-eval'` appears only in the throwaway harness
  manifest, carrying the note that it is not adopted. The decision remains **ADR S-02a-2a**.
- **No product code, no invariant, no frozen contract, no new dependency.**
- **No model weights committed.** `.onnx` stays a banned type; `fetch-models.py` is the
  reproducible acquisition path and refuses on hash mismatch.
- **`agentos/registry/model-registry.md` is updated in this PR** — but only with what was
  actually established: revision, licence-verified-at-revision, hash, size, and a
  **runtime-validated** note scoped to the cells measured. **Licence, runtime, browser and
  performance stay separate columns**; nothing is marked performance-validated, and no model is
  moved to `ADOPTED`.
- **QG-04 is untouched.** B-02-1a, B-02-1c and B-02-2 remain open, and no memory result bears
  on them.

## Gates

| Gate | Status after S-04a-1 |
|---|---|
| QG-01 | satisfied for S-04a-1 — hypothesis pre-registered, artifact present, every claim labelled |
| QG-03 | **still open** — feasibility and memory only; no benchmark, and two correctness cells fail |
| QG-04 | **still UNSIGNED** — unrelated to this experiment |
