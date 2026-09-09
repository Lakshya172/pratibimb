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

### S-04a-1 evidence — recorded 2026-09-09

**These are four SEPARATE evidence dimensions and are deliberately not merged into one
status.** A model can be licence-verified and runtime-validated and still have no benchmark.

| Role | Model @ revision | Licence verified at revision? | Runtime validated? | Browser validated? | Performance validated? |
|---|---|---|---|---|---|
| Faces | YuNet @ `47534e27` | **YES — Apache-2.0** (2026-09-08) | **YES** — ORT Web 1.29.0, wasm + webgpu | **YES** — Chrome (Win + WSL2), Firefox Win | **NO** |
| OCR detection | PP-OCRv5_mobile_det @ `0d63e78e` | **YES — Apache-2.0** (2026-09-09) | **PARTIAL** — runs; **fails the S-04a-1 correctness criterion on wasm** (4.12e-02 vs 2e-02) | **PARTIAL** — passes on webgpu, fails on wasm | **NO** |
| OCR recognition | PP-OCRv5_mobile_rec @ `682f2053` | **YES — Apache-2.0** (2026-09-09) | **YES** — best agreement of the four (5.51e-06) | **YES** — Chrome, Firefox | **NO** |
| Local VLM (vision tower only) | SmolVLM-256M-Instruct `vision_encoder_int8` @ `7e3e67ed` | **YES — Apache-2.0** (2026-09-09) | **PARTIAL** — correct on wasm (1.96e-02); **INCORRECT on WebGPU (2.18)** | **PARTIAL** — wasm only | **NO** |

Hashes, sizes and the acquisition script:
[`W1-S04a-1`](../../artifacts/experiments/W1-S04a1-four-model-residency/README.md). **No
weights are committed.**

**Licence verification method:** the model card front-matter was read at the pinned revision
via `https://huggingface.co/<repo>/raw/<revision>/README.md`. None of the three HF repositories
carries a separate `LICENSE` file; the declaration in-repo at the revision is the strongest
available evidence and is recorded as such rather than as a stronger claim.

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
