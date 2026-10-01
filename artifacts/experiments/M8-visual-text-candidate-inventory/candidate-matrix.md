# M8 — visual-text candidate matrix

> **W1, 2026-09-25. Inventory and screening only — no weights downloaded, nothing converted, nothing
> run.** Every field below comes from metadata read at a pinned revision (Hugging Face model API,
> raw files at a commit, GitHub API) or from this repository's own records. How each was read is in
> [`provenance-notes.md`](provenance-notes.md).
>
> **This is not a ranking.** Candidates are grouped by family, and within a family by the order they
> were found. No row is preferred over another; the only outcome is a disposition.

## Labels used

| label | meaning |
|---|---|
| **FACT (remote)** | read on 2026-09-25 from the named source at the named revision |
| **FACT (repo)** | recorded in this repository's evidence |
| **DOCUMENTED · UNVERIFIED ON W1** | stated by the source's own documentation; never measured here |
| **INFERENCE** | an interpretation; the facts it rests on are named |
| **UNKNOWN** | not established |

## The size screen, and where its anchor comes from

The repository sets **no per-detector size limit**. It sets one frozen projection: tier T2
(*"selective OCR + GLiNER-PII"*) at **105 MB** of weights (constitution §7, projected). The only
anchors that follow from frozen text and recorded measurements, with nothing invented:

| anchor | value | basis |
|---|---|---|
| **A1 — no growth over the dossier's OCR weight** | **21.16 MB** | FACT (repo): the dossier's OCR is `PP-OCRv5-mobile` det + rec, whose ONNX files measured **4.60 MB + 16.56 MB** (M7 README, S-04a-1 artifacts). INFERENCE: the v1 visual-only policy reads nothing, so recognition is not loaded; a detector up to A1 leaves T2 no larger than the dossier projected. |
| **A2 — the whole T2 projection** | **105 MB** | constitution §7. A detector larger than this alone cannot fit T2 with GLiNER, whatever GLiNER's size turns out to be. |

**Screen (hard filter 7):** ≤ A1 → **PASS** · between A1 and A2 → **CONDITIONAL**: T2 would grow past
what the dossier projected, which is an owner decision, so the candidate is **DEFERRED** · > A2 →
**FAIL**. Sizes are artifact sizes, fp32 unless noted.

---

## Summary

| ID | candidate | family | revision | licence | plaintext? | artifact | disposition |
|---|---|---|---|---|---|---|---|
| TR-00 | `PP-OCRv5_mobile_det` | PP-OCR / DB | `0d63e78e` | Apache-2.0 | NO | 4.69 MB params | **HISTORICAL REJECTED CANDIDATE** — `REJECTED FOR V1`, not counted |
| TR-01 | `PP-OCRv4_mobile_det` | PP-OCR / DB | `3cc09f3a` | Apache-2.0 | NO | 4.69 MB params | **ELIGIBLE FOR SCREENING** — conditional |
| TR-02 | `PP-OCRv3_mobile_det` | PP-OCR / DB | `58f4e5b1` | Apache-2.0 | NO | 2.38 MB params | **ELIGIBLE FOR SCREENING** — conditional |
| TR-03 | `PP-OCRv5_server_det` | PP-OCR / DB | `ca867c89` | Apache-2.0 | NO | 87.9 MB params | **DEFERRED** — size |
| TR-04 | `PP-OCRv4_server_det` | PP-OCR / DB | `50dd9a19` | Apache-2.0 | NO | 113.3 MB params | **REJECTED** — size |
| TR-05 | OpenCV Zoo `text_detection_ppocr` | PP-OCR / DB, third-party ONNX | `c299e81a` | Apache-2.0 | NO | 2.42 MB ONNX | **BLOCKED** — provenance |
| TR-06 | `SWHL/RapidOCR` detector ONNX | PP-OCR / DB, third-party ONNX | `1cfba2e9` | Apache-2.0 (card) | NO | 2.34–113.4 MB ONNX | **DEFERRED** — redistribution |
| TR-07 | `monkt/paddleocr-onnx` detector ONNX | PP-OCR / DB, third-party ONNX | `7b02d0a3` | Apache-2.0 (card) | NO | 2.43 / 88.0 MB ONNX | **BLOCKED** — provenance |
| TR-08 | docTR `db_mobilenet_v3_large` (OnnxTR export) | docTR / DB | `21338515` | Apache-2.0 | NO | 16.08 MB ONNX | **ELIGIBLE FOR SCREENING** — conditional |
| TR-09 | docTR `linknet_resnet18` (OnnxTR export) | docTR / LinkNet | `5fe9efff` | Apache-2.0 | NO | 46.13 MB ONNX | **DEFERRED** — size |
| TR-10 | docTR `fast_tiny` / `fast_small` / `fast_base` (OnnxTR export) | docTR / FAST | `f694deb1` / `af6748f3` / `9e1b4f47` | Apache-2.0 | NO | 34.11 / 38.70 / 42.34 MB ONNX | **DEFERRED** — size |
| TR-11 | docTR `db_resnet50` / `db_resnet34` (OnnxTR export) | docTR / DB | `f147c0f8` / release `v0.0.1` | Apache-2.0 | NO | 100.92 / 89.14 MB ONNX | **DEFERRED** — size |
| TR-12 | CRAFT (`clovaai/CRAFT-pytorch`) | CRAFT | code only; weights unpinned | MIT (code); weights UNKNOWN | NO | ~77 MB (zip, via TR-13) | **BLOCKED** — provenance, licence |
| TR-13 | EasyOCR detectors (CRAFT, DBNet18) | CRAFT / DB | release assets | Apache-2.0 (code); weights UNKNOWN | NO (detector alone) | 77.3 / 52.0 MB zip | **BLOCKED** — provenance, licence |
| TR-14 | DB / DBNet++ official (`MhLiao/DB`) | DB | code only; weights on drives | **none found** | NO | UNKNOWN | **REJECTED** — no licence |
| TR-15 | MMOCR DBNet family | DB | `966296f2` | Apache-2.0 (code); data terms UNKNOWN | NO | 59.07 MB checkpoint (r18) | **DEFERRED** — data terms, toolchain, size |
| TR-16 | EAST (`argman/EAST`) | EAST | repository | **GPL-3.0** | NO | UNKNOWN | **REJECTED** — licence |
| TR-17 | Surya detection | Surya | repository | Apache-2.0 code · **OpenRAIL-M-modified weights** | NO (detector alone) | UNKNOWN | **REJECTED** — licence |
| TR-18 | Tesseract.js | Tesseract | repository | Apache-2.0 | **YES** | UNKNOWN | **REJECTED** — plaintext engine |
| TR-19 | Shape Detection API `TextDetector` | browser platform | WICG draft | n/a | **YES** — `rawValue` required | n/a | **REJECTED** — plaintext |
| TR-20 | a project-owned text-region head | own | none | own | NO | none | **DEFERRED** — training, owner decision |
| — | recognisers and VLM OCR, as a class | various | — | — | **YES** | — | **REJECTED** — emit characters |

**Eligible for screening: TR-01, TR-02, TR-08** — each conditional on the owner decisions listed in
[`decision.md`](decision.md). Nothing here says any of them will pass RE-1 or QG-03.

---

## Hard-filter results

Filters as numbered in [`decision.md`](decision.md): **F1** detector-only / privacy-safe output ·
**F2** no mandatory recognition · **F3** verifiable licence · **F4** exact revision · **F5**
reproducible artifact · **F6** conversion/runtime story · **F7** size (above) · **F8** local
perception architecture · **F9** canonical redaction geometry · **F10** RE-1.

`PASS` · `COND` = passes only with a named owner decision or measurement · `FAIL` · `UNK` = not
established · `—` = not assessed because an earlier hard failure already decides the row.

| ID | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 | F9 | F10 | first hard failure |
|---|---|---|---|---|---|---|---|---|---|---|---|
| TR-00 | — | — | — | — | — | — | — | — | — | — | *historical: `REJECTED FOR V1` (M7.1)* |
| TR-01 | PASS | PASS | PASS | PASS | COND | COND | PASS | PASS | PASS | PASS | none |
| TR-02 | PASS | PASS | PASS | PASS | COND | COND | PASS | PASS | PASS | PASS | none |
| TR-03 | PASS | PASS | PASS | PASS | COND | COND | COND | PASS | PASS | PASS | none — deferred on F7 |
| TR-04 | PASS | PASS | PASS | PASS | COND | COND | **FAIL** | — | — | — | F7 |
| TR-05 | PASS | PASS | PASS | PASS | **FAIL** | — | — | — | — | — | F5 |
| TR-06 | PASS | PASS | PASS | PASS | COND | COND | PASS / FAIL by file | PASS | PASS | PASS | none — deferred as redistribution |
| TR-07 | PASS | PASS | PASS | PASS | **FAIL** | — | — | — | — | — | F5 |
| TR-08 | PASS | PASS | PASS | PASS | COND | COND | PASS | PASS | PASS | PASS | none |
| TR-09 | PASS | PASS | PASS | PASS | COND | COND | COND | PASS | PASS | PASS | none — deferred on F7 |
| TR-10 | PASS | PASS | PASS | PASS | COND | COND | COND | PASS | PASS | PASS | none — deferred on F7 |
| TR-11 | PASS | PASS | PASS | PASS | COND | COND | COND | PASS | PASS | PASS | none — deferred on F7 |
| TR-12 | PASS | PASS | **UNK** | **FAIL** | — | — | — | — | — | — | F4 |
| TR-13 | PASS | PASS | **UNK** | **FAIL** | — | — | — | — | — | — | F4 |
| TR-14 | PASS | PASS | **FAIL** | — | — | — | — | — | — | — | F3 |
| TR-15 | PASS | PASS | **UNK** | PASS | COND | COND | COND | PASS | PASS | PASS | none — deferred on F3 (data terms) |
| TR-16 | PASS | PASS | **FAIL** | — | — | — | — | — | — | — | F3 |
| TR-17 | PASS | PASS | **FAIL** | — | — | — | — | — | — | — | F3 |
| TR-18 | **FAIL** | **FAIL** | — | — | — | — | — | — | — | — | F1 |
| TR-19 | **FAIL** | **FAIL** | — | — | — | — | — | — | — | — | F1 |
| TR-20 | PASS | PASS | PASS | — | — | — | — | — | — | — | none — no artifact exists |

F9 and F10 are **structural** here — the candidate emits boxes or quadrilaterals that
`redactionMask` accepts, and its output can be scored by RE-1. They say nothing about whether it
would **pass** RE-1; that is measured only in evaluation.

---

## Per-candidate records

Twenty fields each, as the brief lists them. "Memory" and "inference cost" are documented figures
only; none is a W1 measurement.

### TR-00 — `PP-OCRv5_mobile_det` · HISTORICAL REJECTED CANDIDATE

| field | value |
|---|---|
| 1 name | `PaddlePaddle/PP-OCRv5_mobile_det` |
| 2 revision | `0d63e78e2b680928f6b1747d76a08db6e645efb7` — FACT (remote): still the HF head today |
| 3–19 | as recorded in M7 / M7.1 and `model-registry.md`; **not re-read for eligibility, not re-assessed** |
| 20 disposition | **HISTORICAL REJECTED CANDIDATE.** `REJECTED FOR V1` under `text-region-acceptance.md` (M7.1). Not re-evaluated, not scored under RE-1, not counted as viable. |

### TR-01 — `PP-OCRv4_mobile_det`

| field | value |
|---|---|
| 1 name | `PaddlePaddle/PP-OCRv4_mobile_det` (official PaddlePaddle organisation on HF) |
| 2 revision | `3cc09f3a5b424e8e010abc7a4271aea12999c2f7` (last modified 2025-07-22) · `inference.pdiparams` 4 692 937 B, LFS sha256 `54a85087b4d31fa3ea4e4aba100169a1ec3e3274cd3352b9068b3cfccbca7829` |
| 3 source | `huggingface.co/PaddlePaddle/PP-OCRv4_mobile_det`; code `PaddlePaddle/PaddleOCR` (Apache-2.0) |
| 4 licence | **Apache-2.0** — model card front-matter at the revision (FACT, remote). No separate `LICENSE` file in the HF repository — same evidence class as the S-04a-1 rows |
| 5 detector / recogniser | **detector** (the `_det` model of the PP-OCRv4 series) |
| 6 output semantics | DB segmentation: a per-pixel text probability map; boxes come from threshold + contour + unclip post-processing (`thresh 0.3`, `box_thresh 0.6` in `inference.yml`, FACT remote) |
| 7 plaintext | **NO** — a float map; no character head |
| 8 format | PaddlePaddle inference (`inference.json` + `.pdiparams`) |
| 9 conversion | **yes** — `paddle2onnx`, the route reproduced in M7.1 for the sibling |
| 10 runtime | ORT Web — **UNVERIFIED** for this model. INFERENCE: the identical parameter-file size to TR-00 (4 692 937 B both, different hashes) suggests the same graph, which ran on ORT Web `wasm` in M7.1 |
| 11 ONNX | none official; third-party exports exist (TR-06) — not used as the artifact of record |
| 12 WASM suitability | **UNVERIFIED.** Realistic-input QG-03 cell not run |
| 13 input | dynamic `[N,3,H,W]`; `scale 1/255` then mean/std (`inference.yml`, FACT remote); sides to multiples of 32 — the PaddleOCR DB convention (INFERENCE from the TR-00 run at 640×1024) |
| 14 size | 4.69 MB parameters; ONNX expected ≈ 4.8 MB (INFERENCE from TR-00's reconstruction, 4 766 440 B) — **F7 PASS** (≤ A1) |
| 15 memory | not documented on the card · TR-00, a different model, measured 23.1 MB heap on W1 (FACT repo, not transferable) |
| 16 inference cost | not documented on the card |
| 17 licence status | **VERIFIED at the revision** (card front-matter) |
| 18 provenance confidence | **HIGH for the source** (official org, immutable revision, LFS hash) · **conversion not yet reproduced** |
| 19 architecture | compatible: pixels in, map out, in the perception realm; boxes into `redactionMask`; nothing to the worker but geometry |
| 20 disposition | **ELIGIBLE FOR SCREENING — conditional** on owner approval of `paddle2onnx` measurement tooling for this candidate (M7.1's approval was scoped to M7.1). **Stated plainly:** it shares the family and, by inference, the graph of the rejected TR-00. Evaluating it does not re-evaluate TR-00 and cannot change TR-00's verdict; the owner may prefer a different family first. Documented accuracy: card's "key accuracy metrics" average **0.624** (metric unnamed on the card) — DOCUMENTED · UNVERIFIED ON W1 |

### TR-02 — `PP-OCRv3_mobile_det`

| field | value |
|---|---|
| 1 name | `PaddlePaddle/PP-OCRv3_mobile_det` |
| 2 revision | `58f4e5b132e34e516486fb0d0266c662feb48ca1` (2025-07-23) · `inference.pdiparams` 2 377 917 B, sha256 `7e9518c6ab706fe87842a8de1c098f990e67f9212b67c9ef8bc4bca6dc17b91a` |
| 3 source | HF PaddlePaddle organisation; code `PaddlePaddle/PaddleOCR` |
| 4 licence | **Apache-2.0**, card front-matter at the revision |
| 5 | **detector** |
| 6 output | DB probability map → boxes; `thresh 0.3`, `box_thresh 0.6` |
| 7 plaintext | **NO** |
| 8 format | PaddlePaddle inference |
| 9 conversion | **yes** — `paddle2onnx` |
| 10 runtime | ORT Web — **UNVERIFIED** |
| 11 ONNX | none official; third-party exports exist (TR-05, TR-06, TR-07) — not used |
| 12 WASM | **UNVERIFIED** |
| 13 input | dynamic `[N,3,H,W]`, `scale 1/255` + mean/std (FACT remote) |
| 14 size | 2.38 MB parameters; third-party ONNX of the same model family 2.42–2.43 MB (FACT remote, TR-05/06/07) — **F7 PASS** |
| 15 memory | not documented |
| 16 inference cost | not documented on the card |
| 17 licence status | **VERIFIED at the revision** |
| 18 provenance | **HIGH for the source**; conversion not reproduced |
| 19 architecture | compatible, as TR-01 |
| 20 disposition | **ELIGIBLE FOR SCREENING — conditional** on the same tooling approval as TR-01. An older generation of the same family as TR-00. No accuracy figure found on the card |

### TR-03 — `PP-OCRv5_server_det`

| field | value |
|---|---|
| 1–2 | `PaddlePaddle/PP-OCRv5_server_det` @ `ca867c897ecbca8873081573a802ad70d499cb94` · `inference.pdiparams` 87 932 887 B, sha256 `183146fe9d9910352f68482f623bcbbb9fa7b9e8fa1463b9ad288cef00524d2d` |
| 3–7 | official HF org · **Apache-2.0** (card) · **detector** · DB map → boxes · **no plaintext** |
| 8–13 | Paddle inference · `paddle2onnx` required · ORT Web UNVERIFIED · no official ONNX · WASM UNVERIFIED · dynamic input |
| 14 size | 87.9 MB — **F7 CONDITIONAL** (above A1, below A2) |
| 15–16 | not documented · card average 0.827 (metric unnamed) — DOCUMENTED · UNVERIFIED ON W1 |
| 17–19 | licence VERIFIED at revision · provenance HIGH · architecture compatible |
| 20 disposition | **DEFERRED** — it would make T2 roughly four times the OCR weight the dossier projected; only the owner can accept that |

### TR-04 — `PP-OCRv4_server_det`

| field | value |
|---|---|
| 1–2 | `PaddlePaddle/PP-OCRv4_server_det` @ `50dd9a19217e48ef97f93d6b67e29225c2561cb7` · 113 295 054 B params, sha256 `48cecf9e30e9261a634126bc5211a2736508ae89d2d6199ef2ede06cdebe678f` |
| 3–7 | official · Apache-2.0 · detector · DB · no plaintext |
| 14 size | 113.3 MB — **F7 FAIL** (> A2 alone) |
| 20 disposition | **REJECTED** on size. Other fields not assessed |

### TR-05 — OpenCV Zoo `text_detection_ppocr`

| field | value |
|---|---|
| 1–2 | `opencv/text_detection_ppocr` (HF mirror of `opencv/opencv_zoo`) @ `c299e81aedeaf5d4f741fccccea491fb32db005f` |
| 3 source | OpenCV organisation; README cites the Paddle source tarballs on `paddleocr.bj.bcebos.com` (unversioned URLs) |
| 4 licence | **Apache-2.0** — a `LICENSE` file is present at the revision (FACT remote), headed *Copyright (c) 2016 PaddlePaddle Authors* |
| 5–7 | detector · PP-OCRv3 DB · no plaintext |
| 8–11 | ONNX, pre-converted; conversion toolchain not recorded; fp32 + two int8 variants |
| 14 size | 2 423 490 B fp32 · 705 007 B int8 · 855 375 B int8bq |
| 18 provenance | **FAILED.** The `en` and `cn` fp32 files are **byte-identical** (sha256 `03f550c6b406fda8bf54bd8327815f6c7e2edd98cea02348c93d879254366587` both), and so are the `int8bq` pair (`7f4638708dde26fc…`), although the README names two different source models, one English and one Chinese. At least one file is not what its name says, and nothing in the repository says which |
| 20 disposition | **BLOCKED** — F5. Resolving it would mean reconverting from source, which is TR-02's route anyway |

### TR-06 — `SWHL/RapidOCR` detector ONNX

| field | value |
|---|---|
| 1–2 | `SWHL/RapidOCR` @ `1cfba2e90fc938db55889873735088de210cc173` (personal namespace) |
| 3–7 | third-party redistribution of PP-OCR v1–v4 detectors · card Apache-2.0 · detectors · no plaintext |
| 11, 14 | ONNX present, e.g. `ch_PP-OCRv4_det_infer.onnx` 4 745 517 B (sha256 `d2a7720d…`), `en_PP-OCRv3_det_infer.onnx` 2 423 224 B (`f139598b…`), `ch_PP-OCRv4_det_server_infer.onnx` 113 352 104 B |
| 18 provenance | conversion toolchain not recorded in the files listed; the `en_PP-OCRv3` file's hash differs from OpenCV's (TR-05) — two exports of nominally one model disagree at byte level, as M7.1 found for TR-00 |
| 20 disposition | **DEFERRED** — it duplicates TR-01/TR-02 with weaker provenance. If a PP-OCR candidate is acquired, it is reconstructed from the official source with a recorded toolchain (M7.1 precedent); these files may serve only as a cross-check |

### TR-07 — `monkt/paddleocr-onnx` detector ONNX

| field | value |
|---|---|
| 1–2 | `monkt/paddleocr-onnx` @ `7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65` |
| 3–7 | third-party · card Apache-2.0 · detectors · no plaintext |
| 11, 14 | `detection/v3/det.onnx` 2 429 873 B · `detection/v5/det.onnx` 88 030 804 B, whose `config.json` names it `PP-OCRv5_server_det` · opset 11 |
| 18 provenance | **FAILED.** Its `config.json` states preprocessing *"RGB image, normalized to [0, 1]"*, while PaddlePaddle's own `inference.yml` for these models specifies `scale 1/255` followed by mean/std normalisation. The redistribution's documentation contradicts its source on the input contract |
| 20 disposition | **BLOCKED** — F5 |

### TR-08 — docTR `db_mobilenet_v3_large`, OnnxTR export

| field | value |
|---|---|
| 1 name | `db_mobilenet_v3_large`, trained by docTR (Mindee), exported to ONNX by OnnxTR |
| 2 revision | HF `Felix92/onnxtr-db-mobilenet-v3-large` @ `21338515c12c7f685b8f1022b9babd90a4b9588a` · `model.onnx` 16 076 965 B, LFS sha256 `4987e7bdea372559808bd5add85fda10e179dc639696fb489e59a197a25b4c64` — **matches** the OnnxTR `v0.2.0` release asset `db_mobilenet_v3_large-4987e7bd.onnx` (same size, hash prefix in the name) |
| 3 source | `felixdittrich92/OnnxTR` (Apache-2.0, head `11a68251`) ← `mindee/doctr` (Apache-2.0, head `a185b648`); source weights `v0.8.1/db_mobilenet_v3_large-21748dd0.pt` on `doctr-static.mindee.com` (docTR source at `a185b648`) |
| 4 licence | **Apache-2.0** — HF card front-matter at the revision; OnnxTR and docTR repositories Apache-2.0 (GitHub API) |
| 5 | **detector** |
| 6 output | DB: the ONNX graph returns **logits**; OnnxTR applies the sigmoid outside it and post-processes to boxes (OnnxTR source at `11a68251`, FACT remote). Box granularity (word or line) **UNKNOWN** — to be observed on the development screen |
| 7 plaintext | **NO** — a float map; the recogniser is a separate model and is not part of this artifact |
| 8 format | ONNX |
| 9 conversion | none needed to run; **reproducing** it needs PyTorch + `python-doctr` (`export_model_to_onnx`) — measurement tooling that is not approved |
| 10 runtime | built for `onnxruntime` (Python); ORT Web **UNVERIFIED** |
| 11 ONNX | **yes**, hash-pinned. An earlier export of the same architecture exists (`v0.0.1`, `db_mobilenet_v3_large-1866973f.onnx`, same byte size, different hash); why it was re-exported is not documented |
| 12 WASM | **UNVERIFIED** |
| 13 input | **fixed** `3×1024×1024` (config), mean `(0.798, 0.785, 0.772)`, std `(0.264, 0.2749, 0.287)`; dynamic batch only (docTR's exporter default — INFERENCE for this file). A 1280×720 frame fits at scale 0.8, so 11 px text arrives at about 8.8 px (INFERENCE) |
| 14 size | 16.08 MB fp32 — **F7 PASS** (≤ A1) · a static 8-bit variant exists, 4 314 136 B (release asset, not on HF) |
| 15 memory | not documented |
| 16 inference cost | **0.5 s/it**, batch 1, PyTorch on an i7-11800H (docTR docs) — DOCUMENTED · UNVERIFIED ON W1, and not ONNX, not WASM. 4.2 M parameters. FUNSD recall/precision 82.69 / 84.63, CORD 94.51 / 70.28 — measured by docTR on **training and evaluation sets combined** (their own caveat) |
| 17 licence status | **VERIFIED at the revision** for the artifact and code · **training data of the weights UNKNOWN** — not stated in the docs read |
| 18 provenance | **MEDIUM**: artifact immutable and hash-matched across two hosts; conversion by a third party with an unrecorded toolchain; weights' training data undocumented |
| 19 architecture | compatible: pixels in, map out, in the perception realm |
| 20 disposition | **ELIGIBLE FOR SCREENING — conditional** on the owner either approving measurement-only PyTorch + `python-doctr` tooling to reproduce the export, or accepting the hash-pinned third-party export as the artifact of record; and on the unknown training-data provenance being accepted as stated |

### TR-09 — docTR `linknet_resnet18`, OnnxTR export

| field | value |
|---|---|
| 1–2 | HF `Felix92/onnxtr-linknet-resnet18` @ `5fe9efffcd9fb8821993b08dba66e9d09b5b5ef2` · 46 134 192 B, sha256 `e0e0b9dc95b881e1a869954bb785b83bc6a1259c7444ffe914a3538698d0d79e` (matches release `v0.0.1` asset) |
| 3–13 | as TR-08: Apache-2.0 · detector · segmentation → boxes · no plaintext · fixed `3×1024×1024` · ORT Web / WASM UNVERIFIED |
| 14 size | 46.13 MB — **F7 CONDITIONAL** |
| 16 | 11.5 M params · 0.6 s/it PyTorch i7-11800H — DOCUMENTED · UNVERIFIED ON W1 |
| 20 disposition | **DEFERRED** — size |

### TR-10 — docTR `fast_tiny` / `fast_small` / `fast_base`, OnnxTR export

| field | value |
|---|---|
| 1–2 | HF `Felix92/onnxtr-fast-tiny` @ `f694deb1e32bddfd96d33be5e1e7b804564594ab` (34 110 202 B, `28867779…`) · `-fast-small` @ `af6748f3322dcbd5daabaa76847d183cd94a5a05` (38 695 217 B, `10428b70…`) · `-fast-base` @ `9e1b4f4773acfee2f252523c7fa563bf699c1fe5` (42 342 927 B, `1b89ebf9…`) — re-parameterised (`rep_`) exports |
| 3–13 | as TR-08 |
| 14 size | 34.1–42.3 MB — **F7 CONDITIONAL** |
| 16 | 8.5–10.6 M params re-parameterised · 0.4–0.5 s/it — DOCUMENTED · UNVERIFIED ON W1 |
| 20 disposition | **DEFERRED** — size |

### TR-11 — docTR `db_resnet50` / `db_resnet34`, OnnxTR export

| field | value |
|---|---|
| 1–2 | HF `Felix92/onnxtr-db-resnet50` @ `f147c0f8a3f7ec603a7e55aa384fa59dceda9b53` (100 919 029 B, `69ba0015…`) · `db_resnet34` release `v0.0.1` asset only (89 140 096 B) |
| 14 size | 100.9 / 89.1 MB — **F7 CONDITIONAL**, close to A2 |
| 20 disposition | **DEFERRED** — size |

### TR-12 — CRAFT (`clovaai/CRAFT-pytorch`)

| field | value |
|---|---|
| 3–4 | code **MIT** (GitHub API); pretrained weights linked from the README to **Google Drive** — no revision, no published hash; trained on SynthText, IC13, IC17 (README) |
| 5–7 | detector · character region + affinity score maps → quadrilaterals · no plaintext |
| 9 | PyTorch; ONNX export required, unrecorded |
| 14 | ~77 MB (EasyOCR's zip of the same weights, TR-13) |
| 17 | code licence verified; **whether MIT covers weights trained on ICDAR data: UNKNOWN** |
| 20 disposition | **BLOCKED** — F4 (no exact revision for the weights) and F3 unresolved |

### TR-13 — EasyOCR detectors

| field | value |
|---|---|
| 3–4 | `JaidedAI/EasyOCR`, code **Apache-2.0**; detector weights are GitHub release assets: `craft_mlt_25k.zip` 77 251 756 B (`pre-v1.1.6`), `pretrained_ic15_res18.zip` 51 957 916 B (`v1.6.0`), MD5 only in `easyocr/config.py`; GitHub reports no digest for these assets |
| 5–7 | detectors (CRAFT; DBNet) · the package's pipeline recognises text, the detectors alone do not |
| 17 | weights' licence not stated separately; the DBNet weights are named for IC15 training data, whose terms are UNKNOWN |
| 20 disposition | **BLOCKED** — F4 (release assets are replaceable, MD5 is the only integrity record) and F3 unresolved |

### TR-14 — DB / DBNet++ official (`MhLiao/DB`)

| field | value |
|---|---|
| 3–4 | repository root lists no `LICENSE` file and GitHub reports no licence (FACT remote, 2026-09-25). Weights on Google Drive and Baidu Drive |
| 20 disposition | **REJECTED** — F3: no licence grant found. It contains a `convert_to_onnx.py`, which does not change that |

### TR-15 — MMOCR DBNet family

| field | value |
|---|---|
| 1–2 | `open-mmlab/mmocr` @ `966296f26ac34cf0e96d40ab4a0a94c9a697909a` (last push 2024-11-27) · e.g. `dbnet_resnet18_fpnc_1200e_icdar2015_20220825_221614-7c0e94f2.pth`, 59 068 395 B (HTTP HEAD, no body fetched) |
| 3–4 | code **Apache-2.0**; checkpoints on `download.openmmlab.com`; training data **ICDAR2015** or Total-Text per `metafile.yml` — the dataset terms are **UNKNOWN** here |
| 5–7 | detectors · DB → polygons · no plaintext |
| 9 | PyTorch; ONNX via MMDeploy — a heavy toolchain, not approved |
| 14 | 59.1 MB checkpoint (may include non-weight state) — **F7 CONDITIONAL** |
| 16 | hmean-iou 0.8169 on ICDAR2015 (r18) — DOCUMENTED · UNVERIFIED ON W1; a scene-text benchmark, not rendered UI |
| 20 disposition | **DEFERRED** — F3 training-data terms, toolchain, size |

### TR-16 — EAST (`argman/EAST`)

**GPL-3.0** (GitHub API). Shipping GPL-3.0 weights in the extension would bring copyleft obligations
to the distributed product; that is a licence decision this inventory cannot make. **REJECTED — F3.**
Weights hosting not examined.

### TR-17 — Surya detection (`datalab-to/surya`)

Code Apache-2.0; **model weights under a modified AI Pubs Open Rail-M licence**, free only for
research, personal use and organisations under a revenue/funding limit, with commercial licensing
sold separately (README, FACT remote). **REJECTED — F3**: restricted weights for a government
deployment.

### TR-18 — Tesseract.js

Apache-2.0, a WASM build of a **recognition engine**: its results carry recognised text. It would also
be a new runtime beside ORT Web. **REJECTED — F1/F2.**

### TR-19 — Shape Detection API `TextDetector`

WICG *Draft Community Group Report*. `dictionary DetectedText { required DOMRectReadOnly boundingBox;
required DOMString rawValue; required sequence<Point2D> cornerPoints; }` — **the recognised string is
a required field** (FACT remote). Platform-dependent, not a pinned model. **REJECTED — F1/F2.**

### TR-20 — a project-owned text-region head

The T1 pipeline (option B) proved the project can train and ship its own small ONNX head with no
licence question. A text-region head would need a labelled text set, training and its own RE-1
evaluation; the brief rules out tuning the T1 detector here. **DEFERRED — owner decision**, not an
inventory item that can be downloaded.

### Recognisers and VLM OCR, as a class

`PP-OCRv5_mobile_rec`, docTR recognition models, EasyOCR/Tesseract recognisers, and VLMs used for
OCR all output character sequences by design. **REJECTED as a class — F1/F2.** This includes any
pipeline shaped *perception → OCR plaintext → worker → content vault*, which the realm architecture
forbids.
