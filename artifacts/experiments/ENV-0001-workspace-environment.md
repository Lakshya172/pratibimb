---
id: ENV-0001
title: "Workspace environment audit"
status: recorded
date: 2026-09-07
label: FACT
---

# ENV-0001 — Workspace environment audit

## Question

What exists in the development environment before Sprint 1?

## Method

Direct inspection of `C:\Users\RONIT\OneDrive\Desktop\PratiBimb` and version queries of
the toolchain. Commands run in Git Bash on the development machine.

## Environment

| Field | Value |
|---|---|
| Machine | Windows 11 Home Single Language 10.0.26200 |
| Shell | PowerShell primary; Git Bash available |
| Date | 2026-09-07 |

## Results — FACT

### Workspace contents before this session

**Empty.** The directory existed and contained no files and no subdirectories.
No source code, no package files, no Python files, no extension files, no CI
configuration, no Docker files, no tests, no AgentOS layer, no documentation, no model
assets.

### Version control

**Not a git repository.** No `.git` directory. `git` itself is installed.

### Toolchain present

| Tool | Version |
|---|---|
| Node | v24.19.0 |
| npm | 12.0.2 |
| pnpm | 11.17.0 |
| yarn | not found |
| Python | 3.13.14 |
| git | 2.55.0.windows.3 |
| Docker | 29.6.2 (build dfc4efb) |
| nvidia-smi | driver 610.74 |

### GPU

| Field | Value |
|---|---|
| Device | NVIDIA GeForce RTX 5050 Laptop GPU |
| VRAM | 8151 MiB (~8 GB) |
| Driver | 610.74 |

## Interpretation — INFERENCE

1. **The client toolchain is adequate.** Node 24 + pnpm 11 will run WXT/Vite. Nothing
   blocks Sprint 1 client work.

2. **8 GB of VRAM is tight for Qwen3-VL-4B-Instruct served by vLLM.** FP16 weights for a
   4B-parameter model are roughly 8 GB before any KV cache or activation memory. On this
   device the model would require a quantised serving path (for example AWQ/GPTQ INT4), a
   reduced context/KV budget, or a different host. **This is an inference from parameter
   count, not a measurement — it must be tested.** It bears directly on the dossier's
   stated risk *"GPU host unreachable at the venue"* and on the fallback *"the 4B model
   running on a team laptop"*.

3. **vLLM's supported platform is Linux.** Running it on this machine likely means WSL2 or
   a container with GPU passthrough. Docker is installed; whether GPU passthrough works
   here is **UNKNOWN**.

## Open UNKNOWNs raised by this audit

| # | Question |
|---|---|
| E-01 | Does vLLM run on this machine at all — native, WSL2, or Docker with GPU passthrough? |
| E-02 | Does Qwen3-VL-4B-Instruct fit in 8 GB VRAM at a usable context length, and at what quantisation? |
| E-03 | What is the measured server-reasoning latency on this device, against the 620 ms projected budget? |
| E-04 | Is a separate GPU host available for the team, or is this laptop the only one? |
| E-05 | Is Firefox on Linux available for testing, given that it is the most likely judging configuration? |

## Verdict

Environment recorded. **Client-side work is unblocked. Server-side work has an unresolved
hardware question (E-01 … E-04) that should be answered before week four, and ideally in
week one alongside the thin end-to-end thread (S-07).**
