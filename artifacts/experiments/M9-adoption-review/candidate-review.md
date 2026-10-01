# M9 — candidate review (Part I)

> **Neutral technical record.** The same fields for each candidate, each with its source. No
> weights, no composite, no order of merit. The columns sit side by side for reading, not
> comparison: neither is "preferred", and nothing below is summed.

| field | TR-01 `PP-OCRv4_mobile_det` | TR-02 `PP-OCRv3_mobile_det` | source |
|---|---|---|---|
| **provenance** | `PaddlePaddle/PP-OCRv4_mobile_det` @ `3cc09f3a5b424e8e010abc7a4271aea12999c2f7` (official org); weights sha256 `54a85087…7829` = HF LFS hash, pinned before download | `PaddlePaddle/PP-OCRv3_mobile_det` @ `58f4e5b132e34e516486fb0d0266c662feb48ca1`; weights `7e9518c6…b91a` | M8.1 `TR-01.md` / `TR-02.md` |
| **network definition** | `inference.json` **byte-identical to the rejected PP-OCRv5_mobile_det's**, with different weights | its own (`26c59bd5…`) | M8.1 |
| **licence** | Apache-2.0, model card at the revision (no `LICENSE` file in the repo) | same | M8.1 |
| **converted artifact** | ONNX sha256 `18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8`, 4 766 440 B, opset 16, 925 nodes; reproducible ×4 | `322c3e636b936e5bc695ed29ccf2e1588a827989b23e6f395ad7e7edbc236f55`, 2 436 135 B, opset 16, 663 nodes; reproducible ×4 | M8.1 conversion logs |
| **declared input** | `resize_long 960`, stride 128 → 640×1024 on 720×1280 | upstream defaults `limit_side_len 736`, `min`, stride 32 → 736×1312 | M8.1 |
| **runtime compatibility** | ORT Web 1.29.0, pinned wasm `db816fad…`; Chromium 153 wasm + webgpu; Firefox 155.0.1 Linux wasm; Firefox Windows wasm + webgpu (headful) | same | M8.2 / M8.2a |
| **QG-03** | **PASS** (M8.2; unchanged in M8.2a) | **PASS** (M8.2a; M8.2 recorded FAIL on a confounded launch) | M8.2 `qg03-verdict.json`; M8.2a `m82a-summary.json` |
| QG-03 cells | Chrome WASM ACCEPT · Chrome WebGPU ACCEPT · Firefox WebGPU CONDITIONAL (headless: no adapter) · Firefox WASM (Linux) ACCEPT | Chrome WASM ACCEPT · Chrome WebGPU ACCEPT · Firefox WebGPU CONDITIONAL (same) · Firefox WASM (Linux) ACCEPT (M8.2a) | M8.2 `cells.json`; M8.2a |
| **RE-1** (frozen held-out) | PASS — G1 0/306 · G2 0.376 · G3 0.046 · G4 · G5 · G6 | PASS — G1 0/306 · G2 0.175 · G3 0.045 · G4 · G5 · G6 | M8.1; re-scored per cell in M8.2 / M8.2a |
| G1 smallest glyph margin (diagnostic) | 4.34 px | 2.47 px | M8.1 diagnostics |
| **correctness** (QG-03 cell, relErr sumAbs) | 6.52e-07; worst realistic 4.08e-06; WebGPU 6.32e-07 (Chrome), 6.02e-07 (Firefox) | 6.87e-07; worst 1.10e-05; WebGPU 1.54e-06 / 1.82e-06 | M8.1; M8.2 |
| synthetic diagnostic | 1.04e-01 (saturated tail; not deciding) | degenerate all-zero (not deciding) | M8.1 |
| **determinism** | byte-identical within and across runs, every cell | same | M8.1 / M8.2 / M8.2a |
| **latency** (Chromium wasm, W1, n = 200 per mode) | median 470.5 / 471.1 ms · p90 493.7 / 487.1 · total ~514 ms · cold load ~814–853 ms · cold inference ~621–635 ms | median 557.0 / 561.5 · p90 575.6 / 577.3 · total ~614–622 ms · cold load ~725–747 · cold inference ~681–702 | M8.2 benchmark |
| timing stability | M8.1 saw a ~4× slow mode; **not reproduced** in M8.2 (0/20 launches, 400 inferences). Cause unknown | no slow mode observed in M8.1 or M8.2 | M8.1; M8.2 |
| **memory** (WASM arena) | 27.8 MB after load · 131.1 MB after inference | 19.3 · 152.4 MB | M8.2 |
| **teardown** | PASS 4/4 (plateau; fresh context 0 MB) | PASS 4/4 | M8.2 |
| **coexistence** (UI head + YuNet) | PASS 5/5, bit-identical, peak 131.1 MB | PASS 5/5, peak 152.4 MB | M8.2 |
| Firefox event-page proximity (harness) | longest probe 29.5 s (amended M8.2a) | longest 36.3 s (amended); nearer the default idle limit | M8.2a |
| **privacy semantics** | float map → boxes + score; no text-capable field; no recogniser | same | M8.1 G6; M8.2 |
| **known limitations** | synthetic Latin-script held-out only; screened on PNG screenshots at DPR 1 (G-2, G-3); shares the rejected v5 graph (a fact, not a verdict) | same set-and-path limitations; larger declared input | this review |
| **integration implications** | identical contract and pipeline; differs only in the resize rule (`resize_long 960 / 128`) and resources | identical; resize rule `limit 736 min / 32` | `provider-contract.md` |

## What is identical, and therefore not a selection criterion

Output semantics, post-processing parameters (`thresh 0.3, box_thresh 0.6, unclip 1.5`), the
geometry path, the lifecycle, the privacy properties, and the failure semantics. Both fit the same
`TextRegionDetector` contract with **no security divergence and no operational divergence** beyond
the resize rule and resources.

## What differs — stated as facts for the owner, not scored

- Resources: TR-02 has the smaller artifact and the larger runtime arena.
- Time: TR-01's warm inference is shorter on W1 Chromium. TR-01 showed an unexplained ~4× slow
  mode in M8.1, not reproduced since; TR-02 never showed one.
- Geometry: at the same RE-1 pass, TR-01 has the larger glyph margin with more over-mask, and TR-02
  the smaller margin with less over-mask.
- Lineage: TR-01 shares the network definition of the model rejected in M7.1, which was rejected
  under a different criterion.
