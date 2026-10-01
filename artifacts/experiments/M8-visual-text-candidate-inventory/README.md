# M8 — visual-text candidate inventory

> **W1, 2026-09-25. Inventory and screening only.** The question is not "which text detector is
> best?". It is **"which text-region detectors are legitimate enough to deserve a separate
> evaluation?"** The test is legitimacy: real, pinned, licensed, reproducible, unable to emit text,
> and able to live in the existing perception realm.
>
> **No weights downloaded, converted or run. No runtime installed. No product file touched.**
> `PP-OCRv5_mobile_det` remains **`REJECTED FOR V1`** and appears only as a historical row.

- **Matrix:** [`candidate-matrix.md`](candidate-matrix.md) — 21 candidates and one excluded class,
  twenty fields each, hard-filter results
- **Provenance:** [`provenance-notes.md`](provenance-notes.md) — how every remote fact was read, and
  the findings that decided dispositions
- **Decision:** [`decision.md`](decision.md) — purpose, hard filters, dependencies, owner decisions,
  preconditions, next milestone

## Hypothesis

That at least one text-region detector exists that is detector-only, licensed and hash-pinned at an
exact revision, has a credible route to ORT Web, and is small enough for the browser. If so, it
could be put forward for evaluation under the frozen RE-1 and the approved QG-03 reading **without
changing either**, and **without downloading anything first**.

**What would falsify it:** every candidate failing a hard filter on licence, revision, provenance,
plaintext or size, so that the eligible set is empty.

## Environment

| | |
|---|---|
| Workstation | W1 (`LAPTOP-6E14K34L`), Windows 11, Node v24.19.0, `curl` |
| Sources | Hugging Face model API and raw files at pinned commits; GitHub REST API and raw files at commits; one HTTP `HEAD`; the WICG Shape Detection draft |
| Repository inputs | M7 / M7.1 records, `model-registry.md`, constitution §3, §7 and §8, RE-1, the QG-03 decision record |
| Fetched | 337 KB of JSON, Markdown and HTML in a session scratch directory outside the repository, deleted afterwards — **no weight file** |

## Expected result

1. The repository still holds no second candidate (M7's search, unchanged).
2. Several detector families would surface: PP-OCR, DB, CRAFT, EAST, docTR/OnnxTR, MMOCR and others.
3. Most would fail on provenance or licence rather than on capability: weights on file-sharing
   drives, restricted weight licences, undocumented conversions.
4. A small eligible set would remain, each member conditional on owner decisions about measurement
   tooling.

## Method

1. **Repository first.** M7's exhaustive name search is still current: the only text-region
   artifact ever recorded is `PP-OCRv5_mobile_det` (rejected). Nothing new is in `artifacts/models/`.
2. **External discovery**, metadata only, across the families the brief lists: DBNet, CRAFT, EAST,
   PP-OCR detector-only variants, lightweight ONNX and browser text detectors. Where a model is
   redistributed, both the source and the redistribution were read.
3. **Twenty fields per candidate**, each labelled FACT (remote / repo), DOCUMENTED · UNVERIFIED ON
   W1, INFERENCE or UNKNOWN.
4. **Ten hard filters**, applied in order, stopping at the first hard failure.
5. **Dispositions** only: ELIGIBLE FOR SCREENING · DEFERRED · BLOCKED · REJECTED · HISTORICAL
   REJECTED CANDIDATE. No score, no rank.

## Actual result

| # | expected | actual |
|---|---|---|
| 1 | no second candidate in the repository | **confirmed**. Nothing added since M7 |
| 2 | several families surface | **21 candidates** from PP-OCR, docTR/OnnxTR, CRAFT, EasyOCR, DB, MMOCR, EAST, Surya, Tesseract, the browser platform and a project-owned option, plus one excluded class (recognisers / VLM OCR) |
| 3 | most fail on provenance or licence | **10 end blocked or rejected on provenance, licence or plaintext** (TR-05, 07, 12, 13, 14, 16, 17, 18, 19; TR-04 on size). **7 are deferred**, mostly on size |
| 4 | a small conditional set remains | **3 ELIGIBLE FOR SCREENING**: TR-01, TR-02, TR-08, each conditional on owner decisions D1–D3 |

### Dispositions

| disposition | candidates |
|---|---|
| **HISTORICAL REJECTED CANDIDATE** | TR-00 `PP-OCRv5_mobile_det` |
| **ELIGIBLE FOR SCREENING** (conditional) | TR-01 `PP-OCRv4_mobile_det` · TR-02 `PP-OCRv3_mobile_det` · TR-08 docTR `db_mobilenet_v3_large` (OnnxTR) |
| **DEFERRED** | TR-03 `PP-OCRv5_server_det` (size) · TR-06 RapidOCR ONNX (redistribution) · TR-09 `linknet_resnet18` (size) · TR-10 FAST ×3 (size) · TR-11 `db_resnet50`/`34` (size) · TR-15 MMOCR DBNet (data terms, toolchain, size) · TR-20 own head (training, owner) |
| **BLOCKED** | TR-05 OpenCV Zoo PP-OCRv3 (en/cn files byte-identical) · TR-07 `monkt` ONNX (input contract misstated) · TR-12 CRAFT (unpinned weights) · TR-13 EasyOCR detectors (replaceable assets, MD5 only) |
| **REJECTED** | TR-04 `PP-OCRv4_server_det` (113 MB) · TR-14 `MhLiao/DB` (no licence) · TR-16 EAST (GPL-3.0) · TR-17 Surya (restricted weights) · TR-18 Tesseract.js (plaintext engine) · TR-19 `TextDetector` (`rawValue` required) |

### Findings worth knowing beyond the dispositions

- **Two third-party ONNX redistributions of the PP-OCR family are internally inconsistent.**
  OpenCV Zoo ships byte-identical "English" and "Chinese" files. `monkt/paddleocr-onnx` documents
  the wrong input normalisation. Independent exports of one model differ at byte level. Official
  source plus a recorded conversion stays the rule.
- **The eligible docTR artifact is hash-linked across two hosts**, but its conversion is
  unrecorded and its weights' training data is undocumented. Both are stated, not glossed.
- **The size screen needed no invented number.** The v1 policy reads nothing, so recognition's
  measured 16.56 MB is not loaded. A detector up to 21.16 MB therefore keeps T2 within the dossier's
  projection (INFERENCE, stated as such).

## Conclusion

| | |
|---|---|
| **COMPLETE** | the candidate inventory and hard-filter screen |
| **ELIGIBLE FOR SCREENING** | TR-01, TR-02, TR-08 — conditional on owner decisions D1–D3 |
| **NOT YET VERIFIED** | every candidate's RE-1 result, realistic WASM correctness, ORT Web compatibility and W1 cost |
| **REJECTED FOR V1** | `PP-OCRv5_mobile_det`: unchanged, historical, not counted |
| **PRECONDITION FOR CANDIDATE INTEGRATION** | the `TextFinding` seam; an ADR on the `OCRProvider` shape and the pinned default |
| **NOT YET VERIFIED** | visual-only PII protection in the product |

The hypothesis holds: the eligible set is not empty. **Not claimed:** that any candidate is
accurate, fast, WASM-correct, preferred or suitable. Those are evaluation questions, and M8 did not
ask them.

## Reproducibility

Every remote fact carries its source and revision in `candidate-matrix.md` and
`provenance-notes.md`. To re-check a Hugging Face row without downloading weights:

```bash
curl -s "https://huggingface.co/api/models/<repo>/revision/<commit>?blobs=true"
curl -s "https://huggingface.co/<repo>/raw/<commit>/README.md"
```

A later acquisition must produce bytes whose sha256 equals the LFS hash recorded here, or it stops.
