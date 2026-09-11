---
id: W1-QG03a-B2-real-model-nms
title: "QG-03a-B2 — the real T1 detector under real backend noise"
status: recorded
date: 2026-09-12
label: FACT (observations) / INFERENCE (assessment)
verdict: B2 PASS on workstation 2; QG-03a-B CONDITIONAL
workstation: 2 (LAPTOP-SRCINK2B)
---

# QG-03a-B2 — does real backend noise break the shipped decode/NMS?

> **Short answer, for this machine: no.** The exact T1 artifact was run on ORT Web WASM and
> WebGPU in Chrome 153 and Firefox 155, plus native ONNX Runtime CPU. **Every measured
> difference passes through the shipped decode and NMS with 0 survivor swaps and 0 true
> failures, and meets the pre-registered detector criterion on 20 of 20 fixtures.**
>
> The theoretical discontinuity is real. It is not triggered by real backend noise here,
> because the model's output is full of exact score ties that every backend reproduces bit
> for bit. The margin on a non-UI stress fixture is only 2×, so **QG-03a-B is CONDITIONAL,
> not PASS.**

## Hypothesis

Stated before running. The numerical difference between real browser backends is small
enough that, passed through the **shipped** `decodeHeadOutput` and NMS, it causes no true
perception failure: no element lost, no wrong element, no class change, no off-target click
point, and no material count change. It meets the pre-registered detector criterion
(≥ 95% matched at IoU 0.5, |count Δ| ≤ 2, worst displacement ≤ 2.0 CSS px).

## Expected result

- WASM should be deterministic, and identical across browsers, since it is the same pinned
  wasm bytes.
- WebGPU should differ from WASM at roughly the 1e-6 level on scores. Workstation 1 recorded
  2.6e-6.
- Whether that crosses the NMS discontinuity was genuinely open. The synthetic curve predicted
  safety at or below 1e-6.

## Environment

| | |
|---|---|
| MODEL | `t1-ui-head.onnx` |
| SHA | `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`, re-verified by every harness before running |
| SIZE | 302,960 bytes |
| INPUT / OUTPUT | `images [1,3,640,640]` float32 / `output [1,12,6400]` float32 |
| MACHINE / OS | workstation 2, `LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350; Windows 11 build 26200 |
| BROWSER / VERSION | Chrome 153.0.8010.36 and Firefox 155.0.1 (installed), headful, throwaway profiles |
| BACKEND | ORT Web **1.29.0**: `wasm` (numThreads 1) and `webgpu`; plus onnxruntime 1.29.0 native CPU |
| RUNTIME | the production ORT pin (`installVerifiedOrtRuntime`, JSEP wasm `db816fad…`) and `createPinnedInferenceSession` |
| FIXTURE | the 20 `capture-png` frames from W1-QG03b-2a, produced by the real `captureVisibleTab`, with committed digests |
| FIXTURE HASH | each fixture's `encodedSha256` in W1-QG03b2a `fixtures.json`, verified per run |

**Backend proof.** `GPUQueue.prototype.submit` was wrapped before ORT loaded.

| cell | GPU submits | adapter |
|---|---|---|
| WebGPU (Chrome) | 180 | ORT reports `amd / rdna-3` (Radeon 860M) |
| WebGPU (Firefox) | 180 | adapterInfo empty, so the identity is not observable |
| WASM (both browsers) | 0 | — |

**Context.** This is a plain `http://127.0.0.1` page, **not** the MV3 extension. The runtime
bytes, session factory, options, model and input are production's and hash-checked; only the
page origin differs. The input tensor was **identical across all five cells** on 20 of 20
fixtures (SHA-256).

**Model provenance.** The owner placed the file in Downloads on 2026-09-12. Its identity is
established by exact size and SHA-256, and it was copied to the gitignored model path. It was
never modified, regenerated, retrained or committed.

## Actual result

### Raw output difference

| pair | bitwise fixtures | MAX DELTA | MEAN DELTA (worst fixture) | box channels max | score channels max |
|---|---|---|---|---|---|
| Chrome WASM vs **Firefox WASM** | **20/20** | 0 | 0 | 0 | 0 |
| Chrome WASM vs Chrome WebGPU | 0/20 | 2.14e-3 | 2.00e-5 | 2.14e-3 model px | **1.76e-5** |
| Chrome WASM vs Firefox WebGPU | 0/20 | 1.66e-3 | 1.76e-5 | 1.66e-3 | 1.18e-5 |
| Chrome WebGPU vs Firefox WebGPU | 0/20 | 1.68e-3 | 2.25e-5 | 1.68e-3 | 7.30e-6 |
| Chrome WASM vs native CPU | 0/20 | 1.10e-3 | 1.81e-5 | 1.10e-3 | 5.13e-6 |

Every cell was deterministic, with 3 bitwise-identical runs per fixture.

### Decoded and NMS results

These use the shipped `decodeHeadOutput` + `projectToCapture`: floor 0.25, per-class NMS at
IoU 0.5, cap 300. The **op055** view applies the frozen 0.55 operating point *after* the
decode, as the evaluation tooling does. It is a view, not a change.

| pair | view | reference detections | identical | same anchor | SURVIVOR SWAPS | TRUE FAILURES | worst displacement | pre-registered |
|---|---|---|---|---|---|---|---|---|
| WASM vs Chrome WebGPU | shipped | 4,848 | 22 | 4,826 | **0** | **0** | **0.0025 CSS px** | **20/20** |
| | op055 | 2,500 | 16 | 2,484 | **0** | **0** | 0.0025 | **20/20** |
| WASM vs Firefox WebGPU | shipped | 4,848 | 32 | 4,816 | **0** | **0** | 0.0016 | **20/20** |
| WebGPU vs WebGPU | shipped | 4,848 | 134 | 4,714 | **0** | **0** | 0.0026 | **20/20** |
| WASM vs native CPU | shipped | 4,848 | 96 | 4,752 | **0** | **0** | 0.0013 | **20/20** |
| WASM vs Firefox WASM | both | — | all | — | 0 | 0 | 0 | 20/20 |

"Same anchor" means the same anchor survived and only its numbers moved: displacement at
most 3× the largest raw box-channel difference.

### Perturbation of the real output (iid, relative)

The float32 spacing of the real live values is a relative 5.96e-8 to 1.19e-7 (p50 8.7e-8),
for both scores and boxes. Each noise level ran 20 fixtures × 20 trials = **400 trials**.

| PERTURBATION LEVEL | rounded away | elements actually changed | SURVIVOR SWAPS | TRUE FAILURES | MAX DISPLACEMENT | pre-registered |
|---|---|---|---|---|---|---|
| 1e-9 | **400/400** | 0 | — | — | — | — |
| 1e-8 | **400/400** | 0 | — | — | — | — |
| 1e-7 | 0 | 56% | 1,228 | 238 (lost 162, class 71, count 5) | 92.8 CSS px | 204/400 |
| 1e-6 | 0 | 95% | 1,749 | 309 | 92.8 | 201/400 |
| 1e-5 | 0 | 98% | 2,182 | 394 | 92.8 | 178/400 |
| 1e-4 | 0 | 99% | 3,779 | 712 | 92.8 | 136/400 |

No wrong-element or off-target failure occurred at any level. Swapped survivors always kept
their click point inside the element.

### Scaled real backend difference (how far is real noise from failure?)

Here the reference is WASM plus α × (Chrome WebGPU − WASM). α = 1 reproduces the WebGPU
output **exactly**.

| α | SURVIVOR SWAPS | TRUE FAILURES | where | pre-registered |
|---|---|---|---|---|
| 0.5 | 0 | 0 | — | 20/20 |
| **1 (measured)** | **0** | **0** | — | **20/20** |
| 2 | 4 | 2 | **gradients-edges only**: 1 class change per display mode; swaps 31.9 px | 18/20 |
| 5 / 10 | 16 / 24 | 2 | gradients-edges only | 18/20 |
| 50 | 56 | 8 | gradients-edges, plus realistic-ui losing 1 capped-tail detection | 18/20 |
| 100 | 62 | 8 | as 50, plus a 23 px same-element swap on controls | 16/20 |

### Why real noise is harmless and iid noise is not

The tie census counts candidates as the shipped decode sees them.
- **1,402 overlapping same-class pairs have EXACTLY equal float32 scores** in the WASM output,
  and 1,404 in WebGPU's, out of 20,466 candidates. None is 1.0.
- Hard NMS resolves an exact tie by anchor index, deterministically.
- Every measured backend reproduces the ties, so it reproduces the resolution.
- iid noise breaks every tie independently, so even a one-ULP perturbation (1e-7) swaps
  survivors. **iid noise is therefore not a valid model of backend noise.** The earlier
  synthetic curve, whose scene had few exact ties, looked safe below 1e-6 for the opposite
  reason.

### Performance

These are real-model costs on workstation 2, single fixture runs, excluding
perturbation-experiment overhead.

| cell | session create | first inference | warm inference, median / p95 | decode + NMS (in page) |
|---|---|---|---|---|
| Chrome WASM | 613 ms | 83 ms | 47.6 / 50.8 ms | 19.7 ms |
| Chrome WebGPU | 1,674 ms | 802 ms (shader compile) | **9.8 / 13.4 ms** | 4.9 ms |
| Firefox WASM | 154 ms | 39 ms | 33 / 37 ms | 5 ms |
| Firefox WebGPU (headful) | 2,007 ms | 2,904 ms | 100 / 101 ms | 5 ms |
| native CPU | — | 16.7 ms | ~7.5 ms | — |

In Node, the shipped decode + NMS takes a median of 6.7 ms (p95 15.4 ms). The projected
18 ms dossier target is unchanged and not re-litigated.

## Conclusion

- **DECODED / NMS RESULTS:** at real backend noise, 0 swaps and 0 true failures in every pair
  and view.
- **GROUNDING IMPACT:** none. The minimum matched IoU was 0.99991, and every click point was
  unchanged within 0.003 CSS px.
- **ACCEPTANCE CRITERION:** the existing pre-registered detector criterion is **sufficient to
  evaluate B at measured backend noise, and it is met (20/20 in every pair).** No new
  criterion is invented.

  The open question is whether the architect accepts this bound, evaluated **at measured
  backend noise per machine × browser × backend cell**, as QG-03a-B's criterion
  (QG-03a-B1). That is **ARCHITECT APPROVAL REQUIRED**.
- **RESULT:** B2 is **PASS on workstation 2.**
- **QG-03a-B:** **CONDITIONAL**:
  1. the margin on the non-UI `gradients-edges` stress page is 2×;
  2. Intel, NVIDIA and other ORT versions are unmeasured;
  3. the runs used a page context, not the extension;
  4. the criterion needs approval.
- **No NMS change** is justified by this evidence, and none was made.

## Limitations

- "Same element" is judged against the reference cell's detections. The capture pages have no
  recoverable DOM geometry on this machine.
- The fixtures were captured on workstation 1 and inferred on workstation 2. That is valid for
  numerical comparison, since the same bytes go to every cell.
- Firefox WebGPU was run headful only (headless has no adapter, a known REJECT).
- The 300-cap saturates on 3 fixtures (text-heavy, gradients-edges, realistic-ui), so their
  tails are rank-sensitive.
- One machine: the backend deltas are properties of this GPU, driver and browser build.

## Reproducibility

```
# prerequisites: npm ci && npm run typecheck; the model at artifacts/models/t1-ui-head/ (hash-checked)
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/run-b2-browser.mjs --browser=chrome  --backend=wasm
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/run-b2-browser.mjs --browser=chrome  --backend=webgpu
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/run-b2-browser.mjs --browser=firefox --backend=wasm
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/run-b2-browser.mjs --browser=firefox --backend=webgpu
python artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/b2_native_reference.py
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/analyze-b2.mjs
node   artifacts/experiments/W1-QG03a-B2-real-model-nms/harness/aggregate-b2.mjs
```

The raw output dumps (~6 MB per cell) are gitignored. Every one is identified by the SHA-256
in its cell log, and the analysis refuses to run on a dump that does not match its log. The
guard is `packages/perception/test/qg03aB2Evidence.test.ts`.
