---
id: ENV-0002
title: "Second workstation environment audit — reconstruction from GitHub"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
supersedes: nothing
relates_to: artifacts/experiments/ENV-0001-workspace-environment.md
---

# ENV-0002 — Second workstation environment audit

> **This is not the machine ENV-0001 describes.** ENV-0001 audited
> `C:\Users\RONIT\OneDrive\Desktop\PratiBimb`. This audit covers a *different physical
> workstation*, reconstructed from the GitHub repository. Every capability figure
> recorded on the ENV-0001 machine — including the S-01 WebGPU result — is scoped to
> that machine and is **not** transferred here by this document.

## Question

What does the second development workstation provide, and which parts of the project's
established plan are unblocked, blocked, or newly uncertain on it?

## Method

Direct inspection before cloning anything: `systeminfo`, `Get-CimInstance`
(`Win32_ComputerSystem`, `Win32_Processor`, `Win32_VideoController`), `nvidia-smi`,
`wsl --status`, `df`, version queries of each toolchain binary, and `gh auth status`.
Commands run in Git Bash (MSYS) on the workstation itself.

## Environment — FACT

### Host

| Field | Value |
|---|---|
| Machine | HP OMEN Gaming Laptop 16-ap0xxx |
| Hostname | LAPTOP-SRCINK2B |
| OS | Windows 11 Home Single Language 10.0.26200 (build 26200) |
| Architecture | AMD64 / x64 |
| CPU | AMD Ryzen AI 7 350 w/ Radeon 860M — 16 logical processors |
| RAM | 24,717,639,680 bytes (~23.0 GiB) |
| Disk (C:) | 853 GB total, 399 GB free |
| Workspace | `C:\Users\OMEN\Desktop\PratiBimb` — **not** an OneDrive-synced path |
| Shell | PowerShell primary; Git Bash (MSYS, 3.6.9) available |

### GPU

| Adapter | Driver | Memory |
|---|---|---|
| AMD Radeon 860M Graphics (integrated) | 32.0.22042.29001 | reported 512 MB `AdapterRAM` |
| NVIDIA GeForce RTX 5050 Laptop GPU (discrete) | 32.0.15.9282 | 8151 MiB (`nvidia-smi`) |

`nvidia-smi` reports driver **592.82**, CUDA **13.1**, 0 MiB in use, WDDM driver model.

### Toolchain present

| Tool | This workstation | ENV-0001 workstation |
|---|---|---|
| Node | **v26.4.0** | v24.19.0 |
| npm | **11.17.0** | 12.0.2 |
| pnpm | **10.28.2** | 11.17.0 |
| yarn | not found | not found |
| Python | **3.12.10** | 3.13.14 |
| pip | 26.2.1 | — |
| git | 2.55.0.windows.3 | 2.55.0.windows.3 |
| GitHub CLI | **2.97.0 — present** | not recorded |
| Docker | **NOT INSTALLED** | 29.6.2 |
| WSL | **NOT INSTALLED** | not recorded |
| uv / poetry / conda | not found | — |
| Playwright | not installed | — |
| NVIDIA driver | **592.82 (CUDA 13.1)** | 610.74 |

### Browsers

| Browser | Version | Path |
|---|---|---|
| Google Chrome | **152.0.7977.77** | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Microsoft Edge | 152.0.4191.66 | `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |
| **Mozilla Firefox** | **NOT INSTALLED** | — |

### GitHub authentication

| Field | Value |
|---|---|
| `gh` accounts authenticated | `Lakshya172` (active), `Rexy-5097` |
| Git protocol | HTTPS (no SSH key pair present; `~/.ssh` holds only `known_hosts`) |
| `git config user` | Lakshya Agarwal `<agarwallakshya172@gmail.com>` |
| Permission on `ronitsaha11/pratibimb` | `{admin:false, maintain:false, push:false, triage:false, pull:true}` — **read only** |
| Can create repositories / forks | Yes — fork created successfully (see §Fork) |
| Token scopes | `gist`, `read:org`, `repo`, `workflow` |

No token, password, key or credential value is recorded in this file.

### Fork

`Lakshya172/pratibimb` created 2026-09-07T15:22:22Z as a fork of `ronitsaha11/pratibimb`.
At creation it carried identical refs to upstream: `main` and
`spike/chrome-webgpu-context` at the same SHAs, and the tag `v0.1.0-foundation`.

## Assessment — INFERENCE

1. **Client-side work is unblocked.** Node 26 + pnpm 10 run WXT/Vite. Chrome 152 is
   present at the same major version as the one S-01 was measured on.

2. **Server-side work is blocked harder here than on the ENV-0001 machine.** vLLM's
   supported platform is Linux. That machine had Docker 29.6.2; this one has **neither
   Docker nor WSL**. Blocker E-01 is therefore *worse* on this workstation, not merely
   unresolved. Installing either is a human decision, not something to do silently.

3. **The 8 GB VRAM concern from ENV-0001 carries over unchanged** — same RTX 5050 Laptop
   GPU, same 8151 MiB. E-02 is unaffected by the machine change.

4. **Firefox is absent, so S-02 cannot run here today.** S-02 is one of the two spikes the
   dossier says gate all other work. Installing Firefox is cheap; it is recorded rather
   than done, because installing software is the human's call.

5. **The S-01 integrated-GPU constraint does not transfer.** S-01 recorded that Chrome
   selected `intel / gen-12lp` on the ENV-0001 machine. This workstation's integrated
   adapter is an **AMD Radeon 860M**, not Intel. Which adapter Chrome selects here, and
   what it does to the numbers, is **UNKNOWN**. Re-running S-01 on this machine would
   fill a second, different cell — it would not confirm or contradict the first.

6. **`docs/operations/git-workflow.md` §8 (the OneDrive race risk) does not apply to this
   workstation.** The working tree is on a plain local path. The risk is machine-scoped,
   not project-scoped, and the document should say so.

7. **The branch→PR model in `docs/operations/git-workflow.md` assumes push access to the
   canonical repository.** This account has read-only access, so contribution from this
   workstation must go fork → branch → PR. The document does not currently describe a
   fork topology. This is a documentation gap, not a workflow violation.

## Open UNKNOWNs raised by this audit

| # | Question | Relation to existing items |
|---|---|---|
| E-06 | Does Chrome select the discrete NVIDIA adapter or the AMD Radeon 860M for WebGPU on this workstation? | New cell; relates to S-01a |
| E-07 | Does the S-01 result reproduce on AMD integrated graphics, and at what latency? | Re-run of S-01 on a second machine |
| E-08 | Without Docker or WSL, is there any vLLM path on this workstation at all? | Sharpens E-01 |
| E-09 | Which of the two workstations is the team's designated GPU host? | Answers E-04 |
| E-10 | Is Firefox to be installed here, and is a Firefox-on-Linux target available to the team at all? | Blocks S-02; relates to E-05 |

## Verdict

Environment recorded. **Client-side reconstruction and repository work are unblocked on
this workstation. S-02 is blocked by the absence of Firefox. Server-side work is blocked
by the absence of both Docker and WSL.** No capability figure recorded on the ENV-0001
machine is promoted, demoted or generalised by this audit.
