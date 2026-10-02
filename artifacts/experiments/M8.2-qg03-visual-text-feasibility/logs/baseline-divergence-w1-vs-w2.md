---
id: M82-W1-W2-DIVERGENCE
title: "M8.2 real-frame layer — W1 vs W2 divergence, and why the baseline is machine-local"
status: evidence record
date: 2026-10-02
workstation: W2
---

# M8.2 real-frame layer — W1 vs W2

> **M8.2's native reference is machine-local.** Two independent mechanisms stop one machine's
> real-frame fixtures from reproducing another's, and neither is a defect. W1's evidence stands as
> W1's; this record establishes W2's.
>
> **The product's detector and privacy behaviour did not change.** Same region counts, bit-identical
> held-out box geometry, bit-identical redaction masks, identical RE-1 scores, 0/306 sensitive glyphs
> exposed. Nothing was tuned, relaxed or normalised to get there.

| | |
|---|---|
| W1 record | `../../M8.1-visual-text-screening/results/tr-01-run1.json`, `workstation: "W1"` — **unchanged, byte for byte** |
| W2 baseline | [`w2-baseline-tr-01.json`](w2-baseline-tr-01.json), [`w2-baseline-tr-02.json`](w2-baseline-tr-02.json) |
| W2 integrity | [`w2-fixture-integrity.json`](w2-fixture-integrity.json) — W1's `fixture-integrity.json` is untouched |
| Model | `tr01-ppocrv4-mobile-det.onnx` sha256 `18aaccf9…1575e8` on **both** machines |
| Reference runtime | onnxruntime **1.29.0**, `CPUExecutionProvider`, on both |
| Browser | Chrome for Testing **153.0.8010.12** on both |
| Viewport / DPR | 1280×720, `deviceScaleFactor` 1 on both; W2 `devicePixelRatio` 1.0000000149011612 |
| W2 rasteriser | `ANGLE (AMD, AMD Radeon(TM) 860M Graphics (0x00001114) Direct3D11 vs_5_0 ps_5_0, D3D11)` |
| Preprocessing | type 2, `resize_long` 960, stride 128 — identical, unchanged |

## Layer by layer

| Layer | W1 vs W2 | Attributable to |
|---|---|---|
| Held-out DOM ground truth | **IDENTICAL** — files and geometry match frozen; 6 images, 63 strings, 20 sensitive, 306 sensitive glyphs | — |
| Per-image geometry (`source_hw`, `resized_hw`, `ratio_h`, `ratio_w`, `shape`) | **IDENTICAL** on all 7 | — |
| Screenshot pixels | **DIFFER** on all 7 | **rasterisation** |
| Synthetic input tensor (no screenshot involved) | **IDENTICAL** `fdb3f260…` | — |
| Image input tensors (7) | **DIFFER** | consequence of the pixels |
| **Native ONNX output on the byte-identical synthetic tensor** | **DIFFERS** `c7e54671…` vs `edaa0b4d…` | **CPU float kernels — NOT rasterisation** |
| Detector region count | **IDENTICAL** on all 7 — dev 16, H1 11, H2 11, H3 7, H4 8, H5 7, H6 13 | — |
| Detector box geometry, **H1–H6** | **BIT-IDENTICAL** (max Δ 0.0000 px) | — |
| Detector box geometry, **dev** | **DIFFERS**, max Δ **2.1013 px** | rasterisation |
| Detector scores, H1–H6 | differ, max Δ **0.0012** | float noise |
| Detector scores, dev | differ, max Δ **0.1019** | rasterisation |
| **RE-1 privacy score** (`scoreImage`, frozen scorer) | **BIT-IDENTICAL**, field for field, all 6 held-out images | — |
| **Redaction mask** (`redactionMask`) | **BIT-IDENTICAL**, all 6 held-out images | — |
| Exposed sensitive glyphs | **0 / 306 on both** | — |
| RE-1 gates | **PASS on W2** | — |

## Two independent causes, not one

### 1 · Rasterisation

W1 renders through ANGLE on Intel Graphics; W2 through ANGLE on an AMD Radeon 860M. Same browser
build, same viewport, same DPR, **identical DOM geometry** — different glyph pixels. This explains the
7 screenshot hashes, the 7 image input-tensor hashes, and the 2.1013 px `dev` box shift.

The held-out ground truth is the control: `run-heldout-groundtruth.mjs --check` reports
`files match frozen: true  geometry matches frozen: true` on W2. Layout is identical; only
rasterisation differs.

### 2 · CPU floating-point kernels

onnxruntime 1.29.0, handed the **byte-identical** synthetic tensor and the **byte-identical** model,
returns a different output on each machine:

| | W1 | W2 |
|---|---|---|
| `min` | 0 | 0 — **identical** |
| `max` | 4.470348358154297e-07 | 4.470348358154297e-07 — **identical** |
| `sum` | 2.2083520889282227e-05 | 2.181529998779297e-05 |
| `sumSq` | 3.240963053485757e-12 | 3.1317171078626416e-12 |
| sampled values | 0, 0, 0, 0 | 0, 0, 0, 0 — identical |
| deterministic on that machine (5 inferences) | true | **true** |
| output sha256 | `c7e54671…` | `edaa0b4d…` |

No screenshot is involved, so rasterisation cannot explain it. `min` and `max` agree exactly and only
the summations diverge, at the 1e-7 scale: this is kernel dispatch on CPU ISA — W1 Intel Core 7 240H
against W2 AMD Ryzen AI 7 350. It is not a defect and it is not fixable.

**Consequence.** M8.2's native reference is machine-local by construction. Its purpose —
"WASM correctness is web-vs-native on IDENTICAL bytes" — still holds, but only *within* one machine.
It was never a portable golden, and this is the first record that says so.

## W2 internal stability

Two independent runs: separate browser launches, separate throwaway profiles, separate Python
processes.

| | result |
|---|---|
| 7 screenshot sha256 | **bit-identical across runs** |
| 8 input tensor sha256 | **bit-identical across runs** |
| 8 native output sha256 | **bit-identical across runs** |
| `native_deterministic` (5 inferences each) | **true** |

## WASM vs native, on W2

M8.1 recorded this diagnostic on W1 — "WASM and native geometry identical, 0 px edge difference, with
scores differing in low digits". **W2 reproduces it**, measured by
`run-tr01-worker.mjs --establish-baseline` and stored in the baseline's `wasmVsNative` block:

| frame | boxes (WASM / native) | geometry identical | max coord Δ | max score Δ |
|---|---|---|---|---|
| dev | 16 / 16 | **yes** | **0 px** | 5.80e-06 |
| H1 | 11 / 11 | **yes** | **0 px** | 6.62e-06 |
| H2 | 11 / 11 | **yes** | **0 px** | 4.33e-06 |
| H3 | 7 / 7 | **yes** | **0 px** | 8.92e-06 |
| H4 | 8 / 8 | **yes** | **0 px** | 2.19e-06 |
| H5 | 7 / 7 | **yes** | **0 px** | 8.40e-06 |
| H6 | 13 / 13 | **yes** | **0 px** | 1.59e-05 |

The baseline's authoritative `boxes` are therefore the WASM ones, the same provenance M8.1 used.

## `dev` is kept, not excluded

`dev` diverges from W1 by 2.1013 px while H1–H6 do not. It is **retained in the W2 baseline**, by
owner decision, and its W2 geometry is exact against that baseline — `run-tr01-worker` compares all
seven frames and passes. The W1→W2 difference is recorded above rather than removed, because an
excluded frame would hide the one place where rasterisation is large enough to move a box edge.

## TR-02 — a genuine additional limitation, reported not accommodated

TR-02 (PP-OCRv3_mobile_det, the rollback candidate) has a **native stage on W2 and no WASM stage**:

- its ONNX is verified — `322c3e63…c236f55`, 2,436,135 B, reproduced byte-identically on W2;
- its input tensors and native outputs are established and verified on W2;
- but **no product harness runs TR-02 through ORT WASM**. The product packages TR-01 only, and TR-02's
  W1 WASM reference came from M8.2's own browser cells (`browser/build-extension.mjs` +
  `run-chromium.mjs`), which have not been re-run on W2.

`loadBaseline("TR-02", …, { requireBoxes: true })` therefore **refuses**, and says why. The comparator
was not changed to accommodate this. `prepare-fixtures.mjs` passes `requireBoxes: false` because it
measures only the input tensor and the native output — that narrows *what* is verified to what was
actually measured, and does not relax *how exactly* it is compared.

`browser/build-extension.mjs` likewise **refuses on any workstation but W1**, because it needs
`inputs[*].wasm.outputSha256`, which only M8.2's own browser cells produce.

## What this licenses, and what it does not

**Licensed.** A W2 real-frame baseline. On W2 the fixture set is stable and the product's detector and
privacy behaviour are the behaviour M8.1 recorded.

**Not licensed.** Any claim that W2 reproduces W1's pixels, tensors, native outputs or detector
scores. It does not, and two separate mechanisms prevent it.

**Not established on W2.** TR-02's WASM stage; M8.2's own browser cells; the real gesture route
(`run-gesture-redaction` and `run-stream-re1` were run on the degraded dry-run route, which the
harnesses label as NOT gesture evidence).
