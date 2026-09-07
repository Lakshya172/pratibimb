# Project State — PratiBimb

> **MANDATORY first read for every session, after `AGENTS.md`.**
> Update at the end of every session.

---

## Snapshot

| Field | Value |
|---|---|
| **Date** | 2026-09-07 |
| **Phase** | Phase 1 — Week-1 capability spikes (in progress) |
| **Sprint** | Sprint 1 — Week-1 capability spikes. **S-01 complete (ACCEPT). S-02 not started, awaiting review.** |
| **Health** | 🟡 YELLOW — repository and CI established; S-01 resolved; every other technical assumption still unverified |
| **Next milestone** | S-02 (Firefox MV3 event page), then S-03 … S-07, then the 20-cell feasibility matrix |
| **Product code written** | **None. Zero.** |

---

## Evidence recorded so far

| Artifact | What it establishes |
|---|---|
| `artifacts/experiments/ENV-0001-workspace-environment.md` | The workspace was empty; the toolchain present; the GPU is 8 GB |
| `artifacts/reviews/AUDIT-0001-agentos-framework.md` | What Raptor's Way actually implements, and what PratiBimb adopts from it |
| `artifacts/experiments/W1-S01-chrome-webgpu-context/` | **S-01 ACCEPT** — WebGPU is fully functional in a dedicated worker inside a Chrome MV3 offscreen document, across 3 runs. Chrome selects integrated graphics. Chrome 152 refuses `--load-extension`. |

## Repository

| Field | Value |
|---|---|
| Remote | `https://github.com/ronitsaha11/pratibimb` (**private**) |
| Default branch | `main` — protected: PRs required, force-push and deletion blocked, `Governance and secret hygiene` a required check |
| Checkpoint | `v0.1.0-foundation` |
| Workflow | `CONTRIBUTING.md` · `docs/operations/git-workflow.md` |

## What exists

- The PratiBimb AgentOS engineering layer (this repository).
- The governing dossier, recorded at `docs/dossier/`.
- Frozen contracts, the architecture constitution, specialist contracts, workflows, gates.
- The model registry and the feasibility matrix — **structures only, all cells `UNKNOWN`**.

## What does not exist

- Any extension code. Any server code. Any model asset. Any test. Any CI.
- Any measurement of anything.
- Any verified licence.
- Any evidence that WebGPU, ONNX Runtime Web, or any of the five models function in the
  target contexts.

---

## Active work

| Task | Status | Owner | Blocked by |
|---|---|---|---|
| Human review of the initialization report | `IN_REVIEW` | Project architect | — |
| Sprint 1 approval | `BLOCKED` | Project architect | The review above |

---

## Blockers

| # | Blocker | Severity | Resolution path |
|---|---|---|---|
| ~~1~~ | ~~Workspace is not a git repository.~~ **RESOLVED** — initialized, pushed to a private GitHub remote, `main` protected, `v0.1.0-foundation` tagged. | ✅ | — |
| 2 | **8 GB VRAM (RTX 5050 Laptop) is tight for Qwen3-VL-4B under vLLM.** FP16 weights alone are ~8 GB before KV cache. Needs a quantised serving path, a reduced context budget, or another host. | 🟡 Major | Spike E-02 · see `artifacts/experiments/ENV-0001` |
| 3 | **vLLM's supported platform is Linux.** Whether it runs here — native, WSL2, or Docker with GPU passthrough — is UNKNOWN. | 🟡 Major | Spike E-01 |
| 4 | No separate GPU host identified for the team | 🟡 Major | Human decision — spike E-04 |
| 5 | **Firefox-on-Linux test environment not identified**, and it is the most likely judging configuration | 🟡 Major | Human decision — spike E-05 |

**Toolchain present (FACT, `artifacts/experiments/ENV-0001`):** Node v24.19.0 · pnpm 11.17.0 ·
Python 3.13.14 · git 2.55.0 · Docker 29.6.2 · NVIDIA driver 610.74 · RTX 5050 Laptop, 8151 MiB.
**Client-side work is unblocked.**

---

## Open UNKNOWNs gating work

All of `docs/architecture/constitution.md` section 9, and every cell of
`agentos/registry/feasibility-matrix.md`. **Nothing has been promoted to `FACT`.**

The two that gated everything else:

- ~~**S-01** — WebGPU adapter inside a Chrome `chrome.offscreen` document.~~
  **RESOLVED: FACT, ACCEPT.** See `artifacts/experiments/W1-S01-chrome-webgpu-context/`.
- **S-02** — WebGPU adapter inside a Firefox MV3 event page. **Still `UNKNOWN`. Next.**

New UNKNOWNs raised by S-01:

- **S-01a** — can Chrome be made to select the discrete NVIDIA adapter? (p2, blocks nothing)
- **S-01b** — does Playwright's bundled Chromium still honour `--load-extension`, so the
  egress interception suite can run in CI? (**p1**, blocks the QG-04 enforcement plan)

Known operational risk: the working tree is on a **OneDrive-synced path**. OneDrive can
race with Git on `.git/` internals. No problem observed so far; the remote is the durable
copy. See `docs/operations/git-workflow.md` §8.

---

## Decisions log pointer

`docs/adr/README.md` — **0 ADRs recorded.** 12 ADR candidates identified, none written.

---

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-09-07 | Initialization / discovery pass | Dossier v4.0 read in full and recorded; Raptor's Way audited against its implementation, not its README; PratiBimb AgentOS layer created; contracts frozen; registries created empty. **No product implementation started.** |
