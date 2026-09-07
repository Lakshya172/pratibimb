# Blocker Register — PratiBimb

> **Every blocker is listed here, including the ones that are inconvenient to admit.**
> A blocker is anything that stops a defined next action from being taken. It is not a risk
> (see `agentos/templates/risk_register.md`) and it is not an open `UNKNOWN`
> (see `agentos/registry/feasibility-matrix.md`) — a blocker is specific, current, and has
> a named resolution path.
>
> Read after `agentos/state.md`. Updated whenever one changes state.

## Status vocabulary

| Status | Meaning |
|---|---|
| `OPEN` | Active. Work is stopped or degraded and the resolution path is available to us. |
| `BLOCKED` | Active, and the resolution path depends on something we do not control. |
| `RESOLVED` | Cleared, **with evidence recorded**. Never set on the strength of an expectation. |
| `WAIVED` | Consciously accepted, by a named human, with the cost stated. |
| `DEFERRED` | Real, but not on the critical path yet. Carries a review date or trigger. |

**A blocker is never marked `RESOLVED` without an artifact.** Per `AGENTS.md` §5,
documentation asserting a thing is fixed is not evidence that it is fixed.

---

## Active

### B-01 · Firefox absent — S-02 cannot run

| Field | Value |
|---|---|
| **Status** | `BLOCKED` |
| **Owner** | Human — workstation owner |
| **Dependency** | Mozilla Firefox installed on a workstation available to the project |
| **Impact** | **Critical, on the critical path.** `agentos/workflows/spike.md` states *"Nothing else in the project starts until S-01 and S-02 resolve."* S-01 has an answer; S-02 has none, and cannot be attempted. By the project's own gating rule, downstream implementation does not begin. |
| **Evidence** | `artifacts/environment/ENV-0002-workstation-omen-audit.md` — Firefox not installed; Chrome 152 and Edge 152 present |
| **Resolution path** | Install Firefox → run S-02 on `spike/firefox-webgpu-context` per `artifacts/experiments/W1-S02-firefox-webgpu-context/README.md`. The protocol, acceptance criteria and harness plan are already written, so the spike is a same-day task once the browser exists. |
| **Explicitly not done** | S-02 has **not** been emulated, approximated, or inferred from the Chrome result. A Chrome measurement is not a Firefox fact. |

### B-02 · Invariant E enforcement mechanism (2) has a measured coverage gap

| Field | Value |
|---|---|
| **Status** | `OPEN` |
| **Owner** | `privacy-security-engineer` → human architect (ADR required) |
| **Dependency** | An architectural decision on how mechanism (2) is enforced |
| **Impact** | **Critical.** `docs/security/security-invariants.md` requires four enforcement mechanisms for Invariant E, all four. Mechanism (2) — a Playwright interceptor asserting zero requests — **does not observe or block requests from the MV3 offscreen document**, which `docs/architecture/constitution.md` §5 makes the send path. A suite built on `context.route()` would go green while data left the machine. **QG-04 cannot be signed off on the current plan.** |
| **Evidence** | `artifacts/experiments/W1-S01b-playwright-extension-loading/` — 3 runs of 3, abort-everything route handler, offscreen POST reached the collector every time. CDP sees the target; Playwright does not surface it. |
| **Resolution path** | ADR choosing a vehicle. Candidates measured or identified so far: CDP-level `Fetch.enable` attached to the offscreen target; an independent loopback arrival assertion (which is what caught this). **Both change how a frozen invariant is enforced, so neither may be adopted without human approval.** |
| **Update 2026-09-07 (B-02-1, Linux)** | **Two of the three gaps are closed; B-02 stays `OPEN`.** The model was re-run inside **WSL2 Ubuntu 26.04**, headful and headless: 66 runs, every cell unanimous, **headless identical to headful**. CDP auto-attach observes and genuinely blocks; the `late-attach` race reproduces on Linux (false green 10/10) and `setAutoAttach` + `waitForDebuggerOnStart` closes it (10/10); Playwright-only enforcement produces a false green (6/6). Evidence: `artifacts/experiments/W1-B02-1-linux-observation/`. **New and important: CDP auto-attach does NOT fail closed on its own.** With `Fetch.enable` skipped while attachment succeeded, it reported nothing while the payload reached the wire (3/3) — indistinguishable from a clean run. **Only the independent collector caught it.** The collector is therefore not redundancy; it is what makes the pair fail-closed. |
| **Still open** | The **real CI cell is `UNKNOWN`** — `ubuntu-latest` resolves to **`ubuntu-24.04`** and this ran on Ubuntu 26.04 under WSL2 (different release, different kernel, no GPU, no WSLg on a runner). And the **B-02-2 ADR is unwritten**. QG-04 stays unsigned. |
| **Explicitly not done** | The invariant was **not** weakened, the assertion was **not** relaxed, and moving the egress module out of the offscreen document to suit the tooling is rejected as a direction. |

### B-03 · No vLLM host — server-side work has nowhere to run

| Field | Value |
|---|---|
| **Status** | `BLOCKED` |
| **Owner** | Human — team decision |
| **Dependency** | A machine that can run vLLM, and a decision about which machine it is |
| **Impact** | **Major, not yet on the critical path.** The dossier schedules the first server round trip in week one (S-07) and closes the loop in week four. vLLM's supported platform is Linux. The second workstation has **neither Docker nor WSL**, so it has no vLLM path at all; the first workstation has Docker but 8 GB of VRAM, which ENV-0001 assesses as tight for Qwen3-VL-4B before KV cache. |
| **Evidence** | `artifacts/environment/ENV-0002-workstation-omen-audit.md` (no Docker, no WSL); `artifacts/experiments/ENV-0001-workspace-environment.md` (E-01…E-04) |
| **Resolution path** | Name the GPU host, then run E-01 (does vLLM run there at all) and E-02 (does Qwen3-VL-4B fit, at what quantisation and context) on a dedicated branch. |
| **Explicitly not done** | No model weights downloaded. No attempt to force a vLLM deployment onto a machine that cannot host it. **The current workstation is not described anywhere as the server host.** |

### B-04 · Fork-topology contributors cannot merge their own pull requests

| Field | Value |
|---|---|
| **Status** | `BLOCKED` |
| **Owner** | Human — repository owner (`ronitsaha11`) |
| **Dependency** | Either a maintainer merges, or the contributor is granted write access |
| **Impact** | **Major, process-level, and it has two halves.** (1) Work can be branched, committed, pushed, evidenced and opened as a PR, but **not merged**; open PRs accumulate and no checkpoint tag can be cut, because tags come from merged `main`. (2) **CI does not even run.** GitHub holds workflow runs on pull requests from a first-time fork contributor in `action_required` until a maintainer approves them, and approving requires admin. So "required checks are green" — the third condition of any merge policy — is **unreachable from the fork side**, not merely unmet. |
| **Evidence** | `gh api repos/ronitsaha11/pratibimb` → `{"admin":false,"maintain":false,"push":false,"triage":false,"pull":true}` for both authenticated identities. `gh pr merge 1` → `GraphQL: Lakshya172 does not have the correct permissions to execute MergePullRequest`. `gh run list` → PRs #2 and #3 both `action_required`, duration `0s`, zero check-runs. `POST .../actions/runs/<id>/approve` → **HTTP 403 "Must have admin rights to Repository."** |
| **Resolution path** | Repository owner (a) approves the held workflow runs so CI reports, (b) merges reviewed PRs — **or** grants write access to the contributing account, which resolves both halves at once. |
| **Update 2026-09-07** | **Half two is cleared in practice.** The owner approved the held runs; CI now reports on fork PRs and PRs #2 and #3 both went green. **Half one stands:** the contributing account is still `pull` only, so it still cannot merge or cut a tag. The owner merged PR #1 (`2fb4e82`) and PR #3 (`09aa71b`), which demonstrates the workflow functions **with the owner as merger** — that is Option A, working. Whether to stay on Option A or move to Option B is still an open human decision. |
| **Interim mitigation** | Every CI job is reproduced locally on each PR head and the verbatim output is posted as a PR comment, so a reviewer has the evidence even while the hosted run is held. **This is a substitute for visibility, not for CI**, and it is not represented as a passing hosted run anywhere. |
| **Explicitly not done** | No attempt to route around the permission model, no use of a second identity to obtain access it does not have, and **no PR reported as merged that was not merged**. |

### B-05 · `main` has no branch protection, and `agentos/state.md` claims otherwise

| Field | Value |
|---|---|
| **Status** | `OPEN` |
| **Owner** | Human — repository owner (`ronitsaha11`) |
| **Dependency** | Repository settings; requires admin |
| **Impact** | **Major.** `docs/operations/git-workflow.md` §2 says *"`main` is protected and release-quality"* and PR #1 adds a line to `agentos/state.md` asserting *"protected: PRs required, force-push and deletion blocked, `Governance and secret hygiene` a required check"*. **None of that is configured.** A claimed control that does not exist is worse than a known absent one, because reviewers stop checking. The same `state.md` line also calls the repository **private**; it is **public**. |
| **Evidence** | `gh api repos/ronitsaha11/pratibimb/branches/main/protection` → **HTTP 404 Not Found**. `gh repo view --json isPrivate,visibility` → `{"isPrivate":false,"visibility":"PUBLIC"}`. |
| **Resolution path** | Owner enables branch protection on `main` (require a PR, require the `Governance and secret hygiene` check, block force-push and deletion) **and** the two false claims in `state.md` are corrected in a follow-up PR once PR #1 merges. |
| **Update 2026-09-07** | PR #1 was merged at `2fb4e82` with the two false claims still in it, so they reached `main`. They are now corrected forward in a follow-up PR — the original wording stays in the file's history, and the correction says what was wrong and how it was verified. **The documentation half is therefore closing. The substantive half is not: `main` is still unprotected**, and that needs admin. Re-verified after the merges: `gh api repos/ronitsaha11/pratibimb/branches/main/protection` → **404**. |
| **Explicitly not done** | The claims were **not** corrected by rewriting PR #1's branch or its merged commits. Forward-moving correction only, per `docs/operations/git-workflow.md` §5. |

### B-06 · Line endings are unmanaged; a `.sh` file committed from Windows will break CI

| Field | Value |
|---|---|
| **Status** | `OPEN` |
| **Owner** | `integration-release-engineer` |
| **Dependency** | None — operational, resolvable without an architectural decision |
| **Impact** | **Minor now, latent.** There is no `.gitattributes`. PR #1 commits CRLF blobs for `scripts/verify-repo.py`, `agentos/state.md` and `agentos/registry/feasibility-matrix.md`, which on `verify-repo.py` turns a 3-line semantic change into a 237-line whole-file diff — reviewable only with `--ignore-cr-at-eol`. Nothing is broken today because CI invokes `python scripts/…`. **The latent failure is a shell script**: `scripts/check-secrets.sh` committed with CRLF fails on `ubuntu-latest` with `bash: \r: command not found`. |
| **Evidence** | `git cat-file blob` on both branches — `main` blob CR count 0, PR #1 blob CR count 238. No `.gitattributes` tracked. |
| **Resolution path** | Add `.gitattributes` normalising text to LF (guard against new damage), then renormalise the tree in a separate, clearly labelled commit **after PR #1 merges**, so the renormalisation diff never contaminates a review. |

---

## Resolved

### B-00 · Workspace was not a git repository

| Field | Value |
|---|---|
| **Status** | `RESOLVED` |
| **Evidence** | `ronitsaha11/pratibimb`, 10 commits, tag `v0.1.0-foundation` at `7a31857`, CI green |
| **Note** | Recorded as blocker 1 in `agentos/state.md` before the repository existed. Retained here for continuity of the record. |

---

## Not blockers, deliberately

Recorded so they are not re-raised:

| Item | Why it is not a blocker |
|---|---|
| No product code exists | Intended. CI actively asserts `apps/` and `packages/` do not exist during the spike phase. |
| 20 feasibility cells `UNKNOWN` | Intended. They are filled by S-08…S-27, and nothing has been claimed about them. |
| Playwright's browser CDN returns HTTP 400 here | An obstacle to *local* egress-suite runs on one workstation, not to the project. Recorded in `W1-S01b/environment.json`; folded into B-02's evidence. |
| Chrome 152 refuses `--load-extension` | A measured browser behaviour, recorded in S-01 and reproduced in S-01b. It constrains tooling choices; it does not stop defined work. |
