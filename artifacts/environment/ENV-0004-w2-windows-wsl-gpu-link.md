---
id: ENV-0004
title: "Workstation 2 — Windows host and WSL2 guest linked by GPU UUID; server-host facts re-verified"
status: recorded
date: 2026-09-13
label: FACT (observations) / INFERENCE (assessment, marked)
relates_to:
  - artifacts/environment/ENV-0002-workstation-omen-audit.md
  - artifacts/environment/ENV-0003-wsl2-linux-gpu-host.md
---

# ENV-0004 — one machine, two cells, one GPU

> **Why this record exists.** ENV-0003 (2026-09-07) established that a WSL2 guest with GPU
> passthrough exists on "workstation 2", but records **no hostname and no GPU UUID**. The only
> link to the machine was the label. Both workstations carry an RTX 5050 Laptop GPU with 8151 MiB
> (`agentos/state.md`), so the GPU model cannot identify a machine. A planning session also briefly
> treated the W2 GPU description as a conflict; it was not one. ENV-0002 already records **both**
> adapters. This record makes the link checkable.
>
> **ENV-0003 is not edited.** This record supersedes nothing in it. It adds the identifiers it lacked
> and notes one fact that has changed since.

## Method

Read-only inspection in one session. Nothing installed, nothing downloaded, no configuration changed.
The WSL guest was started only to run the queries below.

- **Windows host** (PowerShell): `hostname`; `Get-CimInstance Win32_VideoController`;
  `nvidia-smi --query-gpu=name,uuid,pci.bus_id,driver_version,memory.total --format=csv`;
  `wsl --version`; `wsl -l -v`.
- **WSL guest** (`wsl -d Ubuntu -- bash -lc …`): `hostname`; `uname -r`; `/etc/os-release`; the
  same `nvidia-smi` query; `free -g`; `ls /usr/bin/python3*`; `python3 --version`;
  `python3 -m pip --version`; presence of `uv`, `conda`, `docker`, `nvcc`; `import vllm`;
  `~/.cache/huggingface`; `/usr/lib/wsl/lib`; `df -h /`.

## Results — FACT

### Windows host — 2026-09-13T10:39:26Z

| Field | Value |
|---|---|
| Hostname | **`LAPTOP-SRCINK2B`** |
| Adapters | AMD Radeon(TM) 860M Graphics (driver 32.0.22042.29001) · **NVIDIA GeForce RTX 5050 Laptop GPU** (driver 32.0.15.9282) |
| `nvidia-smi` | RTX 5050 Laptop GPU · **UUID `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`** · PCI `00000000:04:00.0` · driver 592.82 · **8151 MiB** |
| WSL | 2.7.13.0 · kernel 6.18.33.2-2 · WSLg 1.0.73.2 · Windows 10.0.26200.9445 |
| Distributions | `Ubuntu`, version 2, `Stopped` before inspection |

### WSL2 guest — 2026-09-13T10:39:48Z

| Field | Value |
|---|---|
| Hostname | **`LAPTOP-SRCINK2B`** |
| Kernel | `6.18.33.2-microsoft-standard-WSL2` |
| OS | Ubuntu 26.04 LTS |
| `nvidia-smi` | RTX 5050 Laptop GPU · **UUID `GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a`** · PCI `00000000:04:00.0` · driver 592.82 · 8151 MiB |
| Memory | 11 GiB total · 3 GiB swap |
| Python | `/usr/bin/python3` → **3.14.4**, the only interpreter |
| pip | **`pip 25.1.1` (python 3.14), present** |
| uv / conda / docker / nvcc | absent / absent / absent / absent |
| vLLM | **not installed** (`ModuleNotFoundError`) |
| Hugging Face cache | absent: no model weights on this guest |
| WSL CUDA libraries | `libcuda.so`, `.so.1`, `.so.1.1`, `libcudadebugger.so.1` |
| Root filesystem | 1007 G, 950 G free |

## The link

**The GPU UUID reported inside the guest equals the UUID reported by the Windows host
`LAPTOP-SRCINK2B`, in the same session, eleven seconds apart.** Evidence produced inside this guest
may therefore be labelled workstation-2 evidence, **in the cell**:

```
W2 · WSL2 Ubuntu 26.04 guest · RTX 5050 GPU-acde8e3a-c29b-9943-557e-04dd0b20a09a
```

It is **not** a Windows-host measurement, and never just "W2". W1-B02-1 already keeps this
separation.

## What changed since ENV-0003

| Field | ENV-0003 (2026-09-07) | ENV-0004 (2026-09-13) |
|---|---|---|
| pip | "not installed (`No module named pip`)" | **present, pip 25.1.1** |

Everything else ENV-0003 recorded is unchanged: Ubuntu 26.04, Python 3.14.4 only, GPU visible,
8151 MiB, driver 592.82, no vLLM. **Who installed pip, and when, is UNKNOWN**: no record in the
repository describes it.

## Provenance traps, recorded so they are not repeated

1. **The `W1-` experiment-directory prefix is not workstation provenance.**
   `W1-detector-precision-scale` records "workstation 2 (`LAPTOP-SRCINK2B`)", and `W1-B02-1` ran in
   this guest. Read the machine from the record, never from the directory name.
2. **"RTX 5050, 8151 MiB" identifies neither workstation.** Only hostname + UUID in the same session
   does.
3. **Stale living documents.** `agentos/state.md` lists W2 Docker/WSL as "neither", and B-03's
   *Impact* field says the second workstation "has neither Docker nor WSL". Both were superseded by
   ENV-0003 but not corrected in place. They are corrected forward, citing this record, in the same
   change that adds it.

## Assessment — INFERENCE, not measured

- **vLLM on this guest still requires a pinned interpreter.** Ubuntu 26.04 ships only Python 3.14.
  Whether a vLLM build supports 3.14 has **not been attempted** and is UNKNOWN. The present `pip`
  removes one obstacle ENV-0003 listed, not the interpreter question.
- **The frozen checkpoint at BF16 cannot fit this GPU's memory.** This is arithmetic, not a run:
  published safetensors total **8,887,292,732 bytes (8.28 GiB)** for 4,437,815,808 BF16
  parameters, against **8151 MiB (7.96 GiB)** of device memory, before CUDA context, activations or
  KV cache. See `artifacts/experiments/E9-server-feasibility/`.
