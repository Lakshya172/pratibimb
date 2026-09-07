# PratiBimb — AI Assistant Entrypoint

> **Read this file first, before any other file in this repository.**
> **Status:** Initialization complete · Implementation NOT started · Awaiting Sprint 1 approval

---

## 1. What this repository is

PratiBimb is a privacy-preserving, on-device visual perception system for a lightweight
browser agent. Smart India Hackathon 2026, Problem Statement **26171**, ISRO /
Department of Space.

**The governing document is `docs/dossier/PratiBimb-Engineering-Dossier-v4.0.pdf`.**
It is the implementation baseline. Its contracts are frozen. See §4 below.

## 2. What AgentOS is here, and what it is not

This repository contains a **PratiBimb-specific AgentOS layer**, adapted from the
Raptor's Way / AgentOS framework (`https://github.com/Rexy-5097/raptors-way`).

- AgentOS governs **how we develop PratiBimb**: planning, review, decisions, gates.
- AgentOS is **not part of the PratiBimb runtime product**. No AgentOS file, agent,
  policy or convention may appear in the shipped extension or the shipped server.
  The runtime is: browser extension + local perception + privacy firewall + server
  VLM + local validator + re-hydration + action execution. Nothing else.

## 3. Required reading order

**First session on this repository:**
```
AGENTS.md  →  docs/architecture/vision.md  →  docs/architecture/constitution.md  →  agentos/state.md
           →  docs/security/security-invariants.md
```

**Returning session:**
```
AGENTS.md  →  agentos/state.md  →  agentos/blockers.md  →  docs/adr/README.md (recent)  →  task
```

**Before any implementation task:**
```
agentos/state.md  →  the relevant docs/architecture/*.md  →  agentos/workflows/implementation.md
                  →  the owning agent contract in agentos/agents/  →  agentos/gates/
```

**Before adopting or changing a model:**
```
agentos/registry/model-registry.md  →  agentos/registry/feasibility-matrix.md
                            →  agentos/workflows/model-adoption.md  →  agentos/gates/README.md (QG-03)
```

Load on demand. Do not read the whole repository into context.

## 4. Non-negotiable rules for any agent or engineer working here

1. **The dossier is authoritative.** Deviating from it requires an ADR in
   `docs/adr/` approved by the human architect. Not a comment, not a commit
   message — an ADR.
2. **Frozen contracts may not be silently changed.** `docs/architecture/constitution.md` lists
   what is frozen and what is replaceable. Changing a frozen item without an ADR is a
   process failure, regardless of how good the reason is.
3. **Never mark an UNVERIFIED item as verified without evidence in
   `artifacts/experiments/`.** Documentation saying a thing should work is not evidence
   that it works. See §5.
4. **No security invariant may be weakened to make a test pass.** See
   `docs/security/security-invariants.md`. Fail closed is the design, not a fallback.
5. **No invented numbers.** Every latency, accuracy, memory or licence figure is either
   (a) quoted from the dossier and labelled *projected*, or (b) produced by the
   benchmark harness and labelled *measured*. Nothing else goes in a document or on a
   slide.
6. **Do not add dependencies outside the frozen stack** (`docs/architecture/constitution.md` §2)
   without an ADR. Explicitly banned without approval: LangChain, CrewAI, AutoGen,
   Redis, model ensembles, multi-model routing, streaming action execution, a large
   local VLM in the normal path.

## 5. Epistemic discipline — FACT / INFERENCE / UNKNOWN

Every claim recorded in this repository carries one of three labels. This is enforced in
`agentos/registry/feasibility-matrix.md`, `agentos/state.md` and all experiment artifacts.

| Label | Meaning | Allowed source |
|---|---|---|
| **FACT** | Observed directly, on this hardware, in this environment | A command that was run, a file that was read, a measurement recorded in `artifacts/` |
| **INFERENCE** | An engineering interpretation of one or more FACTs | Must name the FACTs it rests on |
| **UNKNOWN** | Must be experimentally verified before it can be relied upon | Anything asserted only by documentation, a README, a model card, or a previous version of this project |

Promotion from UNKNOWN to FACT requires an artifact under `artifacts/experiments/`
that names the machine, browser, browser version, backend and date.

**"ONNX-exportable" is not "runs in a Firefox extension worker on WASM".**
**"WebGPU API present" is not "ORT Web session created successfully in an offscreen document".**
**"Model card says Apache-2.0" is not "this pinned revision is Apache-2.0".**

## 6. Repository map

| Path | Purpose |
|---|---|
| `docs/architecture/vision.md` | The problem, the thesis, the rubric, what winning means |
| `docs/architecture/constitution.md` | **The architecture constitution** — frozen vs replaceable |
| `agentos/state.md` | Live project state. Updated every session. |
| `agentos/blockers.md` | **Blocker register** — what is currently stopping defined work, and why. Read after `state.md`. |
| `docs/adr/README.md` | ADR index |
| `docs/architecture/glossary.md` | Viva glossary — shared vocabulary |
| `docs/architecture/` | Frozen contracts: coordinate, manifest v1.1, action schema |
| `docs/security/` | Security invariants (INV-01..INV-25) and the threat model |
| `docs/testing/` | The benchmark / measurement contract |
| `docs/operations/` | Git workflow, checkpoint and rollback policy, repository structure |
| `agentos/registry/` | Model registry and the model feasibility matrix |
| `agentos/agents/` | Specialist reviewer contracts (7) |
| `agentos/workflows/` | Development SOPs |
| `agentos/gates/` | Quality gates that implementation must pass |
| `artifacts/experiments/` | Reproducible spike evidence |
| `artifacts/reviews/` | Audits |
| `docs/dossier/` | The governing dossier (PDF + extracted text) |
| `CONTRIBUTING.md` | **Branch, commit, PR, checkpoint and rollback rules. Read before your first commit.** |

## 7. Current status

**Implementation has not started. No product code exists.** The next action is human
review of the initialization report, then approval of Sprint 1 (Week 1 capability
spikes) as defined in `agentos/workflows/spike.md`.
