# M8 — provenance notes

> How every remote fact in [`candidate-matrix.md`](candidate-matrix.md) was obtained, and what each
> method can and cannot establish. Read on **W1, 2026-09-25**. **No weight file was fetched.** The
> whole research scratch directory, deleted afterwards and never inside the repository, came to
> 337 KB of JSON, Markdown and HTML, with **zero** `.onnx`, `.pdiparams`, `.pth`, `.pt`, `.zip`,
> `.tar` or `.bin` files.

## Methods

| method | what it returns | what it establishes | what it does not |
|---|---|---|---|
| `GET huggingface.co/api/models/<repo>?blobs=true` | the head commit, last-modified, card metadata, and every file's size and **LFS sha256** | an exact revision; the exact bytes a later download must match | anything about what the bytes compute |
| `GET huggingface.co/<repo>/raw/<commit>/<file>` | a small text file **at that commit** (`README.md`, `config.json`, `inference.yml`, `LICENSE`) | the licence declared **at the revision**; the declared input contract | that the declaration is legally sufficient |
| GitHub REST API (`/repos`, `/license`, `/releases/tags`, `/git/trees`, `/commits`) | the SPDX licence, head commit, release asset names and sizes | code licence and revision; release asset identity | integrity of release assets — GitHub returned **no digest** for any asset examined, and assets can be replaced |
| `raw.githubusercontent.com/<repo>/<commit>/<path>` | source files at a commit | model configs, default URLs, output handling | behaviour at runtime |
| HTTP `HEAD` on one MMOCR checkpoint | `Content-Length`, `Last-Modified` | size, without a body | anything else |
| repository records (M7, M7.1, `model-registry.md`, constitution) | this project's own measurements | the anchors of the size screen | — |

**Licence evidence classes, strongest first:** a `LICENSE` file at the pinned revision (TR-05) · model
card front-matter at the pinned revision (TR-01/02/03/04/06/07/08–11; the same class S-04a-1
recorded for the adopted-for-spike models) · a repository licence that says nothing explicit
about weights (TR-12/13/15) · no licence at all (TR-14).

## Revisions read

| source | revision | read |
|---|---|---|
| `PaddlePaddle/PP-OCRv5_mobile_det` | `0d63e78e2b680928f6b1747d76a08db6e645efb7` | head unchanged since M7.1 — TR-00, not re-assessed |
| `PaddlePaddle/PP-OCRv4_mobile_det` | `3cc09f3a5b424e8e010abc7a4271aea12999c2f7` | API, `README.md`, `inference.yml` |
| `PaddlePaddle/PP-OCRv3_mobile_det` | `58f4e5b132e34e516486fb0d0266c662feb48ca1` | API, `README.md`, `inference.yml` |
| `PaddlePaddle/PP-OCRv5_server_det` | `ca867c897ecbca8873081573a802ad70d499cb94` | API, `README.md`, `inference.yml` |
| `PaddlePaddle/PP-OCRv4_server_det` | `50dd9a19217e48ef97f93d6b67e29225c2561cb7` | API, `README.md`, `inference.yml` |
| `opencv/text_detection_ppocr` | `c299e81aedeaf5d4f741fccccea491fb32db005f` | API, `README.md`, `LICENSE` |
| `SWHL/RapidOCR` | `1cfba2e90fc938db55889873735088de210cc173` | API |
| `monkt/paddleocr-onnx` | `7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65` | API, `README.md`, both detection `config.json` |
| `Felix92/onnxtr-db-mobilenet-v3-large` | `21338515c12c7f685b8f1022b9babd90a4b9588a` | API, `README.md`, `config.json` |
| `Felix92/onnxtr-linknet-resnet18` · `-fast-tiny` · `-fast-small` · `-fast-base` · `-db-resnet50` | `5fe9efff…` · `f694deb1…` · `af6748f3…` · `9e1b4f47…` · `f147c0f8…` | API, `config.json` |
| `felixdittrich92/OnnxTR` | `11a68251e854dd6538b3fe2329c072adbd97f809` | licence, tree, `differentiable_binarization.py`; releases `v0.0.1`, `v0.2.0` |
| `mindee/doctr` | `a185b64851f2c8202760d711828922e04486a0ea` | licence, `using_models.rst`, DB and FAST configs, `export_model_to_onnx` |
| `open-mmlab/mmocr` | `966296f26ac34cf0e96d40ab4a0a94c9a697909a` | licence, `configs/textdet/dbnet/metafile.yml` |
| `JaidedAI/EasyOCR` | `master` (config) · releases `pre-v1.1.6`, `v1.6.0` | licence, `easyocr/config.py`, asset sizes |
| `clovaai/CRAFT-pytorch`, `MhLiao/DB`, `argman/EAST`, `datalab-to/surya`, `naptha/tesseract.js` | `master` / default branch | licence via API; README sections on weights and licence; `MhLiao/DB` root listing |
| WICG Shape Detection API, `text.html` | editor's draft, 2026-09-25 | the `DetectedText` IDL |

Reading a default branch fixes nothing in time. Where only a branch was read, the matrix uses it to
**reject or block**, never to make a candidate eligible.

## Findings that decided dispositions

1. **OpenCV Zoo's English and Chinese PP-OCRv3 detectors are the same file** (TR-05). The fp32 pair
   share sha256 `03f550c6…6587` and the `int8bq` pair share `7f463870…`, while the README cites two
   different source tarballs. Only the plain `int8` pair differs. The repository cannot say which
   model the shared file is. **BLOCKED.**
2. **A redistribution misstates its input contract** (TR-07). `monkt/paddleocr-onnx` documents
   *"normalized to [0, 1]"*; PaddlePaddle's `inference.yml` for the same models specifies `scale
   1/255` then mean/std. A detector fed the wrong normalisation still returns boxes, just worse ones,
   so the error would not be obvious. **BLOCKED.**
3. **Exports of one model disagree at byte level.** `en_PP-OCRv3_det` from RapidOCR (`f139598b…`,
   2 423 224 B) is not OpenCV's (`03f550c6…`, 2 423 490 B). M7.1 saw the same thing for TR-00 and
   showed the differences can be functionally harmless — but only by measuring. A third-party ONNX is
   therefore never the artifact of record for the PP-OCR family: the official Paddle source, with a
   recorded conversion, is.
4. **OnnxTR's artifact is hash-linked across two hosts** (TR-08). HF's LFS sha256 `4987e7bd…` is the
   prefix in the GitHub release asset's name, at the same byte size. That makes it immutable and
   verifiable. It does **not** make the conversion reproducible: no exporter version or opset is
   recorded, and an earlier `v0.0.1` export (`1866973f`) exists at the identical size.
5. **docTR does not document what its detection weights were trained on**, in the pages read. Its
   published metrics are over FUNSD and CORD **training and evaluation sets combined**, by its own
   statement — they are not a held-out figure.
6. **OnnxTR's DB graph outputs logits, not probabilities** (`expit` is applied in Python after
   `run`). For QG-03's realistic-input cell, the statistic is taken on the graph's output as it is;
   whether that changes the numerical regime compared with TR-00's sigmoid output is **UNKNOWN** until
   measured.
7. **PP-OCRv4_mobile_det and PP-OCRv5_mobile_det have parameter files of identical size**
   (4 692 937 B) with different hashes. INFERENCE: the same graph with different weights. Stated so
   that nobody mistakes an evaluation of TR-01 for independent evidence about architecture choice.
8. **GitHub release assets carry no digest** for OnnxTR `v0.0.1`/`v0.2.0` or EasyOCR
   `pre-v1.1.6`/`v1.6.0`. For OnnxTR this is covered by the HF LFS hash; for EasyOCR the only
   integrity record is an MD5 in source code. **Contributes to TR-13 BLOCKED.**
9. **Weights linked from Google Drive or Baidu Drive have no revision** (TR-12, TR-14). A link can be
   re-pointed at different bytes without trace.
10. **Training-data terms were not verified for any candidate.** ICDAR-family and Total-Text data
    are named for TR-12, TR-13 and TR-15. This inventory does not decide whether weights inherit
    dataset terms; it records the question, and it blocks no candidate on that alone — it defers
    TR-15, where the data is the only stated provenance.

## What a later acquisition must reproduce

For any candidate the owner selects, M8's successor records, **before** evaluation: the revision
above; the exact downloaded bytes' sha256 equal to the LFS hash above; for a converted model, the
source hashes, the full toolchain with versions, and the output hash, reproduced twice
byte-identically (M7.1 precedent). A mismatch with this file stops the acquisition.
