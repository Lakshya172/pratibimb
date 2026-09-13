# E9 — server feasibility for the frozen planner model

> **STATUS: NOT RUN. Stopped at the weight-download boundary.** No weights downloaded, no vLLM
> installed, no model served, no latency, memory, JSON-validity or determinism result exists.
> Explicit approval to download weights is **not** recorded anywhere in the repository, so the run
> stops here, as its protocol requires.
>
> **One conclusion was reachable without running anything**, and it changes the owner decision
> this experiment needs: **the frozen checkpoint at its published BF16 precision is larger than the
> GPU's memory.**

- **Date:** 2026-09-13 · **Workstation:** W2 · **Cell:** see `ENV-0004`
- **Decision record:** [`decision.md`](decision.md) · **Metadata snapshot:** [`logs/model-metadata.json`](logs/model-metadata.json)

## Hypothesis

The frozen planner — *Qwen3-VL-4B-Instruct*, constitution §5 — can be served on a host we control,
with guided JSON, at the context the E1 representation experiment needs (text-only for Arm A,
image-bearing for Arms B and C).

## Environment

| | |
|---|---|
| Candidate host | W2 WSL2 guest, **linked by GPU UUID** to `LAPTOP-SRCINK2B` (ENV-0004) |
| GPU | NVIDIA RTX 5050 Laptop, **8151 MiB**, UUID `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`, driver 592.82 |
| Guest | Ubuntu 26.04 LTS, Python **3.14.4 only**, pip present, **no vLLM**, 11 GiB RAM + 3 GiB swap |
| Other candidate | Workstation 1: Docker, and the **same GPU model and memory** (`agentos/state.md`). Not inspected here |

## Expected result

Pre-stated labels, so no result could later be relabelled to suit:

| Label | Definition |
|---|---|
| INTENDED | vLLM (Linux) + the owner-pinned revision and quantisation + a controlled GPU host + guided JSON |
| FALLBACK | same weights and quantisation, different serving stack, GPU |
| INDICATIVE | CPU, a different quantisation, or a different runtime |

**Planned battery, once approved:**
- sequential calls, concurrency 1, temperature 0
- 50 text calls at Arm-A size and 50 image calls at Arm-B/C size
- 10 requests × 5 repeats for determinism
- guided and unguided JSON validity
- startup time, peak VRAM (1 s `nvidia-smi` sampling), peak guest RSS, TTFT and total latency, and OOM, crash and timeout counts

## Actual result

### What exists — FACT, from the public Hugging Face API (no download)

| Repository | Revision | Files total | Published precision |
|---|---|---|---|
| `Qwen/Qwen3-VL-4B-Instruct` | `ebb281ec70b05090aa6165b016eac8ec08e71b17` | **8,887,292,732 B (8.28 GiB)** | BF16, 4,437,815,808 parameters |
| `Qwen/Qwen3-VL-4B-Instruct-FP8` | `fefbb44cbcce8d1bb7e20b920b94f77432b3446d` | **6,036,505,569 B (5.62 GiB)** | FP8 (vendor-published) |
| `Qwen/Qwen3-VL-4B-Instruct-GGUF` | `1cd86afb9a95c410a6038ab3b40d8b578c892266` | 16,119,136,164 B for the whole repository: F16 8,051,286,144 · Q8_0 4,280,406,144 · Q4_K_M 2,497,281,664 · `mmproj` F16 836,180,256 / Q8_0 453,974,304 | GGUF (a different runtime) |

All three are Apache-2.0 and not gated. Exact per-file sizes are in `logs/model-metadata.json`.

### What that implies

**Arithmetic, not a run:**
- **BF16:** 8,887,292,732 bytes of weights > 8,546,934,784 bytes (8151 MiB) of device memory. **The
  published BF16 checkpoint does not fit this GPU before CUDA context, activations or KV cache.**
  Workstation 1's GPU has the same 8151 MiB.
- **FP8:** 6,036,505,569 bytes of files leaves about 2.5 GB of device memory. Whether that covers CUDA
  context, activations and a KV cache at E1's context, especially with image tokens, is **UNKNOWN**.
  Only a run can answer it.
- **FP8 kernels on this GPU:** whether vLLM's FP8 path supports this consumer Blackwell part is
  **UNKNOWN**.
- **GGUF:** a different runtime and quantisation, so **INDICATIVE by the pre-stated definition**. It
  can teach, but it cannot unlock the Planning View freeze.

**Toolchain blocker, unchanged:**
- The guest has only Python 3.14.
- Whether a vLLM build installs on 3.14 has **not been attempted**.
- Installing a pinned interpreter (e.g. uv-managed 3.12) and vLLM with its CUDA wheels is a
  multi-gigabyte change to the guest. It was **not** done, because it is pointless before the model
  and quantisation are approved and the host is named.

## Conclusion

1. **E9 has no feasibility result.** Nothing about serving, latency or JSON validity is known.
2. **"The frozen model" must be pinned to a quantisation before E9 can mean anything on either
   workstation.** At BF16 it cannot be INTENDED on an 8151 MiB GPU. The owner must choose:
   - the vendor FP8 checkpoint as the frozen implementation
   - a larger GPU host
   - GGUF, accepting an INDICATIVE label that cannot freeze the Planning View
3. **E1 remains blocked** on an admissible E9 label.

## Reproducibility

```bash
# Metadata only (what this record did):
curl -s https://huggingface.co/api/models/Qwen/Qwen3-VL-4B-Instruct
curl -s https://huggingface.co/api/models/Qwen/Qwen3-VL-4B-Instruct/tree/main
# Environment link:
#   see artifacts/environment/ENV-0004-w2-windows-wsl-gpu-link.md
```

**Before anything is downloaded, the owner must approve in writing:**
- repository
- revision SHA (above)
- quantisation
- total bytes (above)
- host

The run itself follows the battery in *Expected result* with no prompt tuning.
