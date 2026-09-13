---
id: HANDOFF-W1-W2-ARTIFACTS
title: "W1 → W2 handoff — artifact and checksum manifest"
status: handoff record
date: 2026-09-13
---

# Artifact manifest

Two halves, and the second matters more: what **is** committed, and what W2 **must obtain
separately**.

Hashes already established by the project are **quoted, not recomputed and relabelled**. Where a
hash was computed for this handoff it is marked *(computed 2026-09-13, W1)*.

## A — required, and NOT in Git

### A1 · The detector artifact — blocks the extension build

| Field | Value |
|---|---|
| Path | `artifacts/models/t1-ui-head/t1-ui-head.onnx` |
| Size | **302,960 bytes** |
| **SHA-256** | **`ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0`** |
| Recorded in | `artifacts/gates/T1-detector-training/README.md`; the same digest appears in the QG-05 and T1-fusion gate records |
| Present on W1? | **yes** — verified byte-for-byte today |
| In Git? | **no** |

**Why it is excluded.** `.gitignore` excludes `*.onnx` and `artifacts/models/` as repository
policy, and **ADR-0003 records the artifact's licence and provenance as "absent — not yet
assembled"**. So it is not merely unvendored; whether it is *legally appropriate to store* is an
open question, and committing it would answer that question by accident.

**What breaks without it.** `apps/extension/wxt.config.ts` throws `missing <path>` and the MV3
host build fails. It is also required by every detector-backed harness.

**How W2 obtains it — two routes, and they are not equivalent:**

1. **Out of band.** Copy the file; verify the SHA-256 above **before use**. This is the only route
   that guarantees the exact artifact all existing evidence was produced against.
2. **Retrain from the recipe** — `artifacts/gates/T1-detector-training/README.md` §Reproducing:

   ```bash
   node tools/dataset/build-dataset.mjs --counts=120,40,40   # deterministic; dataset hash 4bbc57de
   python tools/detector/microoverfit.py --samples=16 --steps=2500
   python tools/detector/train.py --steps=4000 --batch=4     # seed 20260910, AdamW wd 1e-4, cosine, lr 3e-3
   ```

   **Byte-identity is not guaranteed.** `tools/detector/train.py` calls
   `torch.use_deterministic_algorithms(True, warn_only=True)` — `warn_only` means a
   non-deterministic kernel degrades to a warning rather than an error, so a different CPU, GPU,
   PyTorch or CUDA build may produce a different file. **If the SHA-256 differs, it is a different
   artifact and prior evidence does not transfer to it.** Record the new digest and say so.

### A2 · Dataset — regenerable, deterministic

| Field | Value |
|---|---|
| Identity | `t1-ui-rendered@4bbc57de` (version 1.0.0), 200 samples, split 120/40/40 |
| Path | `artifacts/datasets/` (gitignored) |
| Command | `node tools/dataset/build-dataset.mjs --counts=120,40,40 --seed=20260910` |
| Guarantee | recipe = spec version + seed + the script. **Pixels are never committed** |

### A3 · ONNX Runtime Web — pinned by hash, installed by npm

From `packages/security/src/generated/ortPin.ts`, `onnxruntime-web@1.29.0`:

| Artifact | Bytes | SHA-256 | Role |
|---|---|---|---|
| `ort-wasm-simd-threaded.jsep.wasm` | 27,797,172 | `db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea` | **enforced at runtime** — exact bytes hashed == exact bytes executed |
| `ort.all.min.js` | 819,591 | `292feb81eb47989f30d40e62e29e2373979e7588231c189e6dd494ff294f069d` | bundle; hashed so a bundle swap breaks the build |
| `ort-wasm-simd-threaded.jsep.mjs` | 46,676 | `3d68fa7af88c48894d4b0c8629de12018ab73b77519bc0b05dc8d908ad82749f` | Emscripten glue — **provenance and drift detection only, NOT a runtime pin** (ADR-0001 C-3) |

`npm run pin:check` verifies these against `node_modules`. The pin is **bundle-specific**, not a
universal ORT pin (ADR-0001 C-2).

### A4 · Browser binaries

Not transferred. Playwright resolves `chromium-1243`; **W1 has `chromium-1234` installed and
`npx playwright install` fails on W1 (download failure)**, so every browser harness on W1 runs via
`CHROME_PATH`. W2 should run `npx playwright install chromium` and use the bundled browser if that
succeeds — and record which browser actually ran, because the version is part of the evidence.

### A5 · Server model weights — never in Git, and not downloaded

E9 recorded published sizes from the HuggingFace metadata API **without downloading anything**:

| Repo | Revision | Total bytes |
|---|---|---|
| `Qwen/Qwen3-VL-4B-Instruct` (BF16) | `ebb281ec70b05090aa6165b016eac8ec08e71b17` | **8,887,292,732** |
| `Qwen/Qwen3-VL-4B-Instruct-FP8` | `fefbb44cbcce8d1bb7e20b920b94f77432b3446d` | **6,036,505,569** |
| `Qwen/Qwen3-VL-4B-Instruct-GGUF` | `1cd86afb9a95c410a6038ab3b40d8b578c892266` | see `logs/model-metadata.json` |

**Download requires explicit owner approval per repository, revision and size (D-H, D-I). None is
recorded. Do not download on W2 either.**

## B — committed artifacts

| Path | Size | SHA-256 | Provenance |
|---|---|---|---|
| `docs/dossier/PratiBimb-Engineering-Dossier-v4.0.pdf` | 628,424 B | `ae8d99c72981a1cb543d189f9bac8eefa76fae4055bf67a86c363306af9b6bba` *(computed 2026-09-13, W1)* | the frozen v4.0 dossier. Extract text with **PyMuPDF, not pypdf** — pypdf silently drops digits from this file |
| `…/W1-S02a2a1-csp-attack-surface/harness/fixtures/add.wasm` (+ 5 copies) | 41 B | `f61fd62f57c41269c3c23f360eeaf1090b1db9c38651106674d48bc65dba88ba` *(computed 2026-09-13, W1)* | synthetic 2-op WASM, deliberately tracked despite the `ort-wasm-*` ignore rule |
| `…/fixtures/add-tampered.wasm` (+ 2 copies) | 41 B | `51851cf8e54178b3161139f569e2d7ba60aa6433ef0a76dbcea897ff677a9e96` *(computed 2026-09-13, W1)* | the tampered control for the hash-pin experiment |
| `…/W1-QG03b2a-chromium-jpeg-capture/harness/captured/*.{png,jpg}` | 3.45 MiB total, 41 files | per-file digests in `captured/manifest.json` | real browser captures kept as gate evidence. The `.r2.*` duplicates are ignored by policy — their digests live in the manifest |
| `packages/security/src/generated/ortPin.ts` | — | generated | **do not hand-edit**; `npm run pin:generate` |

**No model weights, no ORT runtime binaries, no browser binaries and no dataset pixels are
committed**, and this handoff did not add any.

## C — verifying the manifest on W2

```bash
node scripts/verify-handoff.mjs
```

It checks Node, the lockfile install, the ORT pin, the detector artifact's presence **and
SHA-256**, and the dataset — then prints exactly what is missing and how to get it. It is
standalone and is **not** wired into `npm run verify`, because CI has no detector artifact and a
gate that fails for an expected reason teaches nothing.
