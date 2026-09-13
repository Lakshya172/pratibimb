# E9 — verdict

**Date:** 2026-09-13 · **Workstation:** W2 · **Verdict: BLOCKED — stopped at the weight-download boundary**

| Question | Answer | Basis |
|---|---|---|
| Is the host identified and linked? | **Yes**: W2 WSL2 guest, GPU UUID matched to `LAPTOP-SRCINK2B` | ENV-0004, FACT |
| Is weight download approved? | **No record of approval exists** | Repository search |
| Can the BF16 checkpoint fit the GPU? | **No**: 8,887,292,732 B of weights > 8151 MiB | Published file sizes, arithmetic |
| Can the FP8 checkpoint serve at E1's context? | **UNKNOWN** | Needs a run |
| Can vLLM install on this guest? | **UNKNOWN**: Python 3.14 only, never attempted | ENV-0003, ENV-0004 |
| Serving, latency, memory, JSON, determinism | **No result** | Not run |

## Owner decisions this record makes necessary

| # | Decision | Options |
|---|---|---|
| **D-H (sharpened)** | Which quantisation *is* "the frozen Qwen3-VL-4B" | (a) vendor FP8 `fefbb44c…`, 6,036,505,569 B · (b) BF16 `ebb281ec…` on a larger host · (c) GGUF, INDICATIVE only |
| **D-I** | The E9 host | W2 WSL2 guest (8151 MiB) · W1 Docker (same GPU memory) · another controlled host (E-04) |
| Download approval | Explicit, per repository, revision and size | — |
| Toolchain | Approve installing a pinned Python and vLLM into the W2 guest | Required for INTENDED on W2 |

## Not done, on purpose

No weights downloaded, no package installed, no interpreter added, no model changed, no 8B, no CPU
run presented as equivalent to anything. E1's protocol is not affected by this record.
