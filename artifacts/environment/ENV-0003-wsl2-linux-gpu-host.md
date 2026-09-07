---
id: ENV-0003
title: "WSL2 Linux environment with GPU passthrough on workstation 2"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
relates_to: artifacts/environment/ENV-0002-workstation-omen-audit.md
---

# ENV-0003 — a Linux environment now exists, with the GPU visible

> **What changed:** `ENV-0002` recorded *"no Docker, no WSL, no Linux environment at all"*.
> That is no longer true. WSL2 and Ubuntu were installed on workstation 2 on 2026-09-07,
> **without a reboot**, and `nvidia-smi` works inside the distribution.
>
> **This does not resolve B-03.** It removes the *first* obstacle and exposes the next one.

## Question

Does a Linux environment with a usable GPU exist on workstation 2 — and if so, is it a
viable host for vLLM (**E-01**)?

## Method

`wsl --install --no-distribution` (elevated), then `wsl --install -d Ubuntu --no-launch`,
then direct inspection from inside the distribution. No reboot was required or performed.

## Results — FACT

### The environment

| Field | Value |
|---|---|
| WSL default version | **2** |
| Distribution | **Ubuntu 26.04 (Resolute Raccoon)** |
| Kernel | `6.18.33.2-microsoft-standard-WSL2` |
| CPUs visible | 16 |
| RAM visible | ~11 GiB (WSL default allocation, host has ~23 GiB) |
| Root filesystem | 1007 GB, 955 GB free |
| Reboot required | **No.** `CBS RebootPending` = `False` after install. |

### GPU passthrough — works

`nvidia-smi` **inside Ubuntu**:

```
NVIDIA-SMI 590.74     Driver Version: 592.82     CUDA Version: 13.1
NVIDIA GeForce RTX 5050 ...  On | 00000000:04:00.0 Off | N/A
N/A  44C  P8  9W / 78W | 0MiB / 8151MiB | 0% Default
```

WSL CUDA libraries present at `/usr/lib/wsl/lib/`: `libcuda.so`, `libcuda.so.1`,
`libcudadebugger.so.1`, `libd3d12.so`, `libd3d12core.so`.

**The discrete GPU is visible and addressable from Linux, with the same 8151 MiB and the
same driver as the Windows side.**

### The next obstacle — Python

| Field | Value |
|---|---|
| `python3` | **3.14.4** |
| Other interpreters in `/usr/bin` | **none** — only `python3.14` |
| `python3.12` in apt | **not available** on this release |
| `pip` | **not installed** (`No module named pip`) |

## Assessment — INFERENCE

1. **B-03's first obstacle is gone.** ENV-0002 recorded no Linux path at all. A Linux
   environment with working GPU passthrough now exists on this workstation.

2. **E-01 is still NOT validated, and vLLM has not been installed or run.** Ubuntu 26.04
   ships **only Python 3.14**, which is newer than the interpreter versions vLLM publishes
   wheels for. A straight `pip install vllm` is **not expected to resolve** here. Installing
   a pinned interpreter (uv-managed Python, deadsnakes, or a container) is the next step.
   **This is an inference from the version numbers, not a measured install failure** — it has
   not been attempted, because attempting it without a pinned Python would only prove the
   obvious.

3. **The 8 GB VRAM question from ENV-0001 is unchanged.** 8151 MiB is the same figure, and
   Qwen3-VL-4B at FP16 is ~8 GB of weights before any KV cache. **E-02 remains open and
   will very likely require a quantised serving path** whatever happens with E-01.

4. **This environment is worth more than vLLM alone.** It is the first Linux available to
   the project, so it also bears on two p1 items that have nothing to do with the server:
   **B-02-1** (does the Invariant E interception result hold on `ubuntu-latest`, the real CI
   cell?) and **S-02a** (Firefox on Linux, the configuration the risk register rates High).
   Those may now be runnable for the first time.

5. **WSL2 is not `ubuntu-latest`.** A GitHub-hosted runner is a different kernel, a
   different graphics stack, and has **no GPU**. WSL2 narrows the gap; it does not close it.

## System changes made

| Field | Value |
|---|---|
| **Packages** | Windows optional components for WSL2; `Ubuntu` distribution |
| **Versions** | WSL default version 2 · Ubuntu 26.04 · kernel 6.18.33.2-microsoft-standard-WSL2 |
| **Source** | `wsl.exe --install` (Microsoft, in-box) |
| **Reason** | ENV-0002 recorded no Linux environment. Three separate blockers (B-03, B-02-1, S-02a) all depend on one existing. |
| **System impact** | Enables the WSL2 platform components and creates one distribution. No reboot was required. Does not alter the Windows browser stack, the toolchain, or any project file. |
| **Rollback** | `wsl --unregister Ubuntu`, then `wsl --uninstall` if the platform itself should go. |
| **Elevation** | Yes — `wsl --install` was run elevated. No security policy was changed. |

## Open UNKNOWNs

| # | Question | Relation |
|---|---|---|
| E-01 | Does vLLM install and run under a **pinned** Python in this WSL2 Ubuntu, with the GPU? | The blocker itself |
| E-02 | Does Qwen3-VL-4B fit in 8151 MiB, at what quantisation and context length? | Unchanged by this audit |
| B-02-1 | Does the Invariant E interception result reproduce on Linux, and headless? | **Now possibly runnable** |
| S-02a | Firefox on Linux — WebGPU is off by default there | **Now possibly runnable** |

## Verdict

**A Linux host with GPU passthrough exists on workstation 2. B-03 stays `BLOCKED`** — the
host existing is not the same as vLLM running on it, and nothing about vLLM has been
measured. **No model weights were downloaded. No server architecture was changed. No
replacement inference server was introduced.**
