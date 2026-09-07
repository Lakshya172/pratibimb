# Project State — PratiBimb

> **MANDATORY first read for every session, after `AGENTS.md`.**
> Update at the end of every session.

---

## Snapshot

| Field | Value |
|---|---|
| **Date** | 2026-09-07 |
| **Phase** | Phase 0 — Initialization complete |
| **Sprint** | Not started. Sprint 1 (Week 1 capability spikes) **awaiting human approval**. |
| **Health** | 🟡 YELLOW — environment established; every technical assumption unverified |
| **Next milestone** | Week-1 capability spikes S-01 … S-07, then the 20-cell feasibility matrix |
| **Product code written** | **None. Zero.** |

---

## Evidence recorded so far

| Artifact | What it establishes |
|---|---|
| `artifacts/experiments/ENV-0001-workspace-environment.md` | The workspace was empty; the toolchain present; the GPU is 8 GB |
| `artifacts/reviews/AUDIT-0001-agentos-framework.md` | What Raptor's Way actually implements, and what PratiBimb adopts from it |

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
| 1 | Workspace is **not a git repository**. Reproducibility, ADR history and release pinning all assume version control. | 🟡 Major | Human decision — ADR candidate C-02 |
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

The two that gate everything else:

- **S-01** — WebGPU adapter inside a Chrome `chrome.offscreen` document.
- **S-02** — WebGPU adapter inside a Firefox MV3 event page.

---

## Decisions log pointer

`docs/adr/README.md` — **0 ADRs recorded.** 12 ADR candidates identified, none written.

---

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-09-07 | Initialization / discovery pass | Dossier v4.0 read in full and recorded; Raptor's Way audited against its implementation, not its README; PratiBimb AgentOS layer created; contracts frozen; registries created empty. **No product implementation started.** |
