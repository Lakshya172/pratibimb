# Model Registry — PratiBimb

> **Every model carries its licence here.** Every version is pinned — library, model
> revision, quantisation, runtime assets.
> Source: dossier v4.0 section 11.
>
> **A model is not adopted because this table names it.** Adoption requires a complete
> feasibility row (`agentos/registry/feasibility-matrix.md`) and gate **QG-03**.

---

## Status legend

| Status | Meaning |
|---|---|
| `PINNED-UNVERIFIED` | Named in the dossier. Revision **not yet pinned to a hash**. Feasibility **not tested**. Licence **not verified against the actual revision**. |
| `PINNED` | Revision hash recorded, licence verified against that revision, feasibility row complete |
| `ADOPTED` | `PINNED` + passed QG-03 + benchmark artifact exists |
| `REJECTED` | Failed feasibility or benchmark. Reason and artifact recorded. |

> **Superseded in part, 2026-09-09 (S-04a-1).** The sentence below is preserved as written.
> **Four models have now been downloaded, revision-pinned, licence-verified at that revision,
> and run in a browser.** See the S-04a-1 rows and the evidence table beneath the registry.
> **No model has been ADOPTED** — adoption still requires QG-03 and a benchmark artifact, and
> none exists.

**Every row below is currently `PINNED-UNVERIFIED`. No model has been downloaded,
pinned, licence-verified, or run.**

---

## Registry

| Role | Interface | Pinned implementation | Licence (per dossier) | Licence verified? | Revision hash | Runtime | Format | Quantisation | Status |
|---|---|---|---|---|---|---|---|---|---|
| UI elements | `UIElementDetector` | OmniParser `icon_detect_v3` | MIT (YOLOv9) | **NO — UNKNOWN** | *not pinned* | ONNX Runtime Web | ONNX | INT8 | `PINNED-UNVERIFIED` |
| Faces | `FaceDetector` | YuNet (OpenCV Zoo) | MIT | **NO — UNKNOWN** | *not pinned* | ONNX Runtime Web | ONNX | — | `PINNED-UNVERIFIED` |
| OCR | `OCRProvider` | PP-OCRv5-mobile via `paddle2onnx` | Apache-2.0 | **NO — UNKNOWN** | *not pinned* | ONNX Runtime Web | ONNX | — | `PINNED-UNVERIFIED` |
| Semantic PII | `PIIDetector` | `gliner_multi_pii-v1` | Apache-2.0 | **NO — UNKNOWN** | *not pinned* | Transformers.js | ONNX | INT8 | `PINNED-UNVERIFIED` |
| Local VLM | `LocalVLM` | SmolVLM-256M-Instruct | Apache-2.0 | **NO — UNKNOWN** | *not pinned* | Transformers.js | ONNX | — | `PINNED-UNVERIFIED` |
| Server VLM | `ServerPlanner` | Qwen3-VL-4B-Instruct | Apache-2.0 | **NO — UNKNOWN** | *not pinned* | vLLM | HF weights | — | `PINNED-UNVERIFIED` |
| Server VLM (upgrade) | `ServerPlanner` | Qwen3-VL-8B-Instruct | Apache-2.0 | **NO — UNKNOWN** | *not pinned* | vLLM | HF weights | — | `PINNED-UNVERIFIED` |
| **Text reasoner** | `ReasonerClient` | **`Qwen/Qwen2.5-0.5B-Instruct-GGUF`** | Apache-2.0 | **YES — verified at revision (2026-09-14)** | **`9217f5db79a29953eb74d5343926648285ec7e67`** | llama.cpp `b10956` (CPU x64, MIT) | GGUF | **Q4_K_M** | `PINNED` |

### LOOP-2 evidence — recorded 2026-09-14 (W2)

**The first row in this registry to reach `PINNED`, and the first model the product actually calls.**
It is a **text** model, not a VLM: it reads the sanitized manifest and emits plan steps. It never
sees a screenshot, a pixel or a value.

| | |
|---|---|
| Role | `ReasonerClient` — the untrusted reasoner boundary. **Replaceable; not a security authority.** |
| Download approval | **EXPLICIT**, owner, 2026-09-14. E9 stopped at this boundary for want of one; this did not proceed without it. |
| Licence verification | `LICENSE` fetched **at revision `9217f5db…`** and read (11 343 B, Apache-2.0). The card tag was not trusted on its own — SECURITY.md §7. |
| Weights | `qwen2.5-0.5b-instruct-q4_k_m.gguf`, 491 358 496 B, sha256 `74a4da8c9fdbcd15…` · **not committed** |
| Runtime validated | **YES** — llama.cpp `b10956` CPU x64 on W2; service healthy in 2 124 ms including model load |
| Browser validated | **YES (indirectly)** — driven from Chrome for Testing 153.0.8010.12 over loopback HTTP; the model itself runs out-of-browser |
| Performance validated | **NO** — six warm runs (p50 609 ms end-to-end) is a sample, not a benchmark |
| Correctness | **PROVISIONAL** — 5/5 and 7/7 on one goal, and only with enum-constrained decoding plus a worked example. Bare-schema prompting produced schema-valid nonsense. |
| Status | **`PINNED`**, not `ADOPTED`. Adoption needs QG-03 and a benchmark artifact; neither exists. |

Evidence: [`LOOP-2`](../../artifacts/experiments/LOOP-2-local-reasoner-egress/README.md).
**`MODEL_PATH = EXPERIMENTAL`, `FALLBACK_PATH = VERIFIED`** — the deterministic planner remains the
known-good path, and the security pipeline was not weakened to accommodate the model.

### S-04a-1 evidence — recorded 2026-09-09

**These are four SEPARATE evidence dimensions and are deliberately not merged into one
status.** A model can be licence-verified and runtime-validated and still have no benchmark.

| Role | Model @ revision | Licence verified at revision? | Runtime validated? | Browser validated? | Performance validated? |
|---|---|---|---|---|---|
| Faces | YuNet @ `47534e27` | **YES — Apache-2.0** (2026-09-08) | **YES** — ORT Web 1.29.0, wasm + webgpu | **YES** — Chrome (Win + WSL2), Firefox Win | **NO** |
| OCR detection | PP-OCRv5_mobile_det @ `0d63e78e` | **YES — Apache-2.0** (2026-09-09; re-read at the revision 2026-09-25) | **wasm: PASS on realistic input** (S-04a-1a, 4.23e-06, M7.1) · **fails on the synthetic input** (4.12e-02, reproduced in M7.1; saturated output) | **PARTIAL** — Chrome wasm (M7.1) and webgpu (S-04a-1); Firefox not re-run | **NO** — **`REJECTED FOR V1`** on the pre-registered text-region criteria (M7.1): localisation IoU 0.427 / 0.365 < 0.5 |
| OCR recognition | PP-OCRv5_mobile_rec @ `682f2053` | **YES — Apache-2.0** (2026-09-09) | **YES** — best agreement of the four (5.51e-06) | **YES** — Chrome, Firefox | **NO** |
| Local VLM (vision tower only) | SmolVLM-256M-Instruct `vision_encoder_int8` @ `7e3e67ed` | **YES — Apache-2.0** (2026-09-09) | **wasm YES** (1.96e-02) · **WebGPU REJECT** — root-caused, see below | **PARTIAL** — wasm only | **NO** |

Hashes, sizes and the acquisition script:
[`W1-S04a-1`](../../artifacts/experiments/W1-S04a1-four-model-residency/README.md). **No
weights are committed.**

**Licence verification method:** the model card front-matter was read at the pinned revision
via `https://huggingface.co/<repo>/raw/<revision>/README.md`. None of the three HF repositories
carries a separate `LICENSE` file; the declaration in-repo at the revision is the strongest
available evidence and is recorded as such rather than as a stronger claim.

### Backend correctness is per model, per backend — S-04a-1b, recorded 2026-09-09

**A REJECT here is a `model x backend` cell and nothing wider.** In S-04a-1 the same WebGPU
backend ran three of the four models correctly, and `PP-OCRv5_mobile_det` actually passed on
WebGPU while failing on WASM. Neither backend is globally good or globally broken.

| Model | CPU (native) | WASM | WebGPU |
|---|---|---|---|
| YuNet | ACCEPT | ACCEPT | ACCEPT |
| PP-OCRv5_mobile_det | ACCEPT | **synthetic: fails** (4.12e-02) · **realistic: ACCEPT** (4.23e-06, M7.1) | ACCEPT (4.96e-03) |
| PP-OCRv5_mobile_rec | ACCEPT | ACCEPT (5.51e-06) | ACCEPT |
| **SmolVLM-256M `vision_encoder_int8`** | ACCEPT | **ACCEPT** (1.96e-02) | **REJECT** |

#### Why SmolVLM is REJECT on WebGPU

Evidence: [`W1-S04a-1b`](../../artifacts/experiments/W1-S04a1b-webgpu-int8-root-cause/README.md)

**It is not an int8 problem.** Every int8 operator the model uses — `MatMulInteger`,
`DynamicQuantizeLinear`, `ConvInteger` — is **exact on WebGPU** in isolation, because ORT Web's
WebGPU EP **partitions them back to CPU**. That was proven, not assumed: at 256×512×256 an fp32
`MatMul` rounds *differently* on WebGPU while the same-sized int8 graph is bit-identical.

Layer-wise bisection found **two independent WebGPU defects**:

1. **`DequantizeLinear` returns wrong values.** Minimal reproducer is a **single node**; fails
   at every rank, size, dtype and parameter form (scalar, rank-1, omitted zero-point,
   per-channel), at both `graphOptimizationLevel` settings, on ORT Web **1.27.0, 1.29.0 and
   1.30.0-dev**. A `Cast → Sub → Mul` rewrite is bit-exact on both backends and fixes this
   defect — validated, **not adopted**, because:
2. **A second defect at `self_attn/out_proj`** in every encoder layer. **Root cause `UNKNOWN`** —
   the quantised-Linear pattern is exact on WebGPU at the model's own shapes, so it is not the
   matmul.

**Product decision: use WASM for this model.** Not "avoid WebGPU" — three of four models are
fine on it.

**`onnxruntime` pin unchanged at 1.29.0.** Other versions were tested in a scratch directory
and the pin was restored and verified.

### Runtime artifact pins — recorded 2026-09-10 (S-02a-2a-3)

**The WebAssembly runtime is a pinned artifact too, and it is pinned PER BUNDLE, not per
package version.** S-02a-2a-3 measured that `ort.all.min.js` loads the **JSEP** build even
for the `wasm` execution provider — so pinning the obvious file would pin one the runtime
never loads, and the check would pass while verifying nothing.

| Package | Version | Bundle shipped | Artifact actually loaded | Bytes | SHA-256 |
|---|---|---|---|---|---|
| `onnxruntime-web` | **1.29.0** | `ort.all.min.js` | **`ort-wasm-simd-threaded.jsep.wasm`** | 27,797,172 | `db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea` |
| `onnxruntime-web` | 1.29.0 | *(not shipped)* | `ort-wasm-simd-threaded.wasm` | 13,961,845 | `ec8580a9d7b9476ceee52e10a7f94124e4dc71a019d666ed6d4726697c109a4d` |

The Emscripten glue `ort-wasm-simd-threaded.jsep.mjs` is loaded by dynamic `import()`,
governed by `script-src`, and **must be packaged**. It is **not** hash-pinned — see C-3 in
[`W1-S02a-2a-3`](../../artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/README.md).

**No ORT artifact is committed.** They are 14–28 MB and are referenced by pinned revision,
per the repository's no-weights rule.

### UI element detection — BLOCKED on licence

**`microsoft/OmniParser-v2.0` `icon_detect` is AGPL-3.0.** Read at revision
`6600256cb0f1b07651e3bc86166196307bad7e2d`, the file `icon_detect/LICENSE` begins
`GNU AFFERO GENERAL PUBLIC LICENSE Version 3`. **This confirms the defect recorded below, at
the revision rather than from a model card.**

The dossier's intended MIT replacement, `icon_detect_v3`, **could not be found as a pinnable
ONNX artifact**, and the `onnx-community/OmniParser-icon_detect*` re-exports **declare no
licence at all**, so they inherit an unresolved AGPL question rather than escaping it.

**No AGPL model was downloaded or run.** S-04a-1 used the VLM vision tower in this slot
instead. **A licensed UI-element detector is an open p1 item (S-04a-1c)** and the
`UIElementDetector` role has no viable pinned implementation today.

### Notes carried from the dossier

- **UI elements.** Purpose-trained on interactable web elements. ~12 MB at 640 px.
  **Committed only once its feasibility row is green.** Fallback: our own head trained on
  the synthetic set, which removes the dependency entirely.
- **Faces.** 340 KB, sub-10 ms. No reason to use anything larger.
- **OCR.** Detection and recognition both exportable. Selective in T2; full-frame in the verifier.
- **Semantic PII.** Zero-shot — new entity categories are a config change, not a training run.
- **Local VLM.** Changed from FastVLM-0.5B, which ships under **Apple's ML research
  licence** — a poor fit for the brief's offline-deployable clause.
- **Server VLM.** On the public ScreenSpot leaderboard, Qwen3-VL-32B-Instruct leads the
  open-weight field at **0.958** while Qwen3-VL-4B-Instruct reaches **0.940** — under two
  points for a fraction of the compute. Given that server inference is the dominant
  latency term and "GPU host unreachable at the venue" is a live risk, **4B is the better
  default and 8B is the upgrade** if the benchmark on our own 300 Indian screens says
  otherwise. Both are benchmarked behind the same interface in week five, **and the data
  decides**.

---

## The licence rule — and why this column exists

> **Licence defect carried over from v2.0.** The v2.0 registry pinned
> `microsoft/OmniParser-v2.0` for UI element detection. Its `icon_detect` model is
> **AGPL-3.0** — it is a fine-tuned Ultralytics YOLO, and only `icon_caption` is MIT.
> **AGPL section 13 has network-service implications that matter for anything handed to a
> government department.** OmniParser added an `icon_detect_v3` based on the MIT-licensed
> YOLOv9 implementation in mid-2026; earlier Ultralytics-based detectors retain their
> AGPL licence. We move to v3, **and we add a licence column so this cannot happen again**.

**Rule — FROZEN:**

> **"Model is Apache-2.0" must be verified against the actual pinned repository AND
> revision, and the verification recorded here with a date and the URL inspected.**
> A licence stated on a model card, in a README, or in this dossier is **UNKNOWN** until
> someone has opened the pinned revision and read its licence file.

This applies with particular force to any model whose upstream is a fine-tune of an
Ultralytics YOLO.

---

## Adoption record

*Empty. No model has been adopted.*

| Date | Role | Implementation | Revision | Decision | ADR | Benchmark artifact |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## Rejection record

Blocking rule 5: *"A rejected model is recorded as `REJECTED` with its artifact. It is not quietly
swapped out."*

| Date | Role | Implementation | Revision | Decision | Measured reason | Artifact |
|---|---|---|---|---|---|---|
| 2026-09-25 | OCR detection (text regions, no recognition) | PP-OCRv5_mobile_det via `paddle2onnx 2.1.0` | `0d63e78e` · ONNX sha256 `d9056b16…ac068`, 4 766 440 B | **`REJECTED FOR V1`** | Fails pre-registered localisation (`docs/perception/text-region-acceptance.md` criterion 2): best IoU **0.427** (identifier) and **0.365** (holder name) against 0.5 — 0.472 / 0.413 under PaddleOCR's own box convention. Coverage (1.000 / 1.000), flood (2.98× ≤ 3×), plaintext-free output and determinism all pass. WASM correctness on realistic input passes (4.23e-06). | [`M7.1`](../../artifacts/experiments/M7-visual-text/M7.1-ppocrv5-det-validation.md) |

## Screening record

Candidates that passed a screening milestone and are **eligible for QG-03 / adoption review**. This is
**not** adoption: nothing here enters the build, and the adoption log above stays empty until QG-03
is completed and the owner decides.

| Date | Role | Implementation | Revision | Status | Evidence summary | Artifact |
|---|---|---|---|---|---|---|
| 2026-09-25 | Text-region detection (no recognition) | PP-OCRv4_mobile_det via `paddle2onnx 2.1.0` (opset 16) | `3cc09f3a` · ONNX sha256 `18aaccf9…75e8`, 4 766 440 B, reproducible ×4 | **`ELIGIBLE FOR QG-03 / ADOPTION REVIEW`** | Realistic WASM relErr 6.52e-07 (QG-03 text-region cell, Option A); RE-1 G1–G6 pass on the frozen held-out set (0 / 306 sensitive glyphs exposed); byte-identical across runs. Same `inference.json` as PP-OCRv5_mobile_det, with different weights | [`M8.1`](../../artifacts/experiments/M8.1-visual-text-screening/TR-01.md) |
| 2026-09-25 | Text-region detection (no recognition) | PP-OCRv3_mobile_det via `paddle2onnx 2.1.0` (opset 16) | `58f4e5b1` · ONNX sha256 `322c3e63…6f55`, 2 436 135 B, reproducible ×4 | **`ELIGIBLE FOR QG-03 / ADOPTION REVIEW`** | Realistic WASM relErr 6.87e-07; RE-1 G1–G6 pass (0 / 306); byte-identical across runs | [`M8.1`](../../artifacts/experiments/M8.1-visual-text-screening/TR-02.md) |

The two rows are independent and in no order.

## QG-03 feasibility record

Full QG-03 feasibility (M8.2, W1). A PASS makes a candidate **eligible for adoption review**; it is **not**
adoption, and the adoption log above stays empty.

| Date | Role | Implementation | Revision | QG-03 | Cells (Chrome WebGPU · Chrome WASM · Firefox WebGPU · Firefox WASM Linux) | Artifact |
|---|---|---|---|---|---|---|
| 2026-09-26 | Text-region detection (no recognition) | PP-OCRv4_mobile_det (TR-01) | `3cc09f3a` · ONNX `18aaccf9…75e8` | **`PASS` → `ELIGIBLE FOR ADOPTION REVIEW`** | ACCEPT · ACCEPT · CONDITIONAL · ACCEPT; coexistence 5/5, teardown 4/4; benchmark `artifacts/benchmarks/M8.2-text-region-qg03.json` | [`M8.2`](../../artifacts/experiments/M8.2-qg03-visual-text-feasibility/TR-01.md) |
| 2026-09-26 | Text-region detection (no recognition) | PP-OCRv3_mobile_det (TR-02) | `58f4e5b1` · ONNX `322c3e63…6f55` | **`FAIL`** | ACCEPT · ACCEPT · CONDITIONAL · **CONDITIONAL** (one Linux launch never reported; reproduced as a Firefox event-page limit affecting both candidates); coexistence 5/5, teardown 4/4 | [`M8.2`](../../artifacts/experiments/M8.2-qg03-visual-text-feasibility/TR-02.md) |

Disclosed with both rows: Windows Firefox measured 156.0.1, not the frozen 155.0.1. Owner decisions pending: whether
to amend the harness and re-run the Firefox WASM (Linux) cell for both candidates; TR-01 adoption review.
