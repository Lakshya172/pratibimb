# Project State — PratiBimb

> **MANDATORY first read for every session, after `AGENTS.md`.**
> Update at the end of every session.

---

## Snapshot

| Field | Value |
|---|---|
| **Date** | 2026-09-07 |
| **Phase** | Phase 1 — Week-1 capability spikes (in progress) |
| **Sprint** | Sprint 1 — Week-1 capability spikes. **S-01 merged (ACCEPT). S-01b merged (CONDITIONAL). B-02 answered (CONDITIONAL, PR #9 open). S-02 BLOCKED — no Firefox.** |
| **Health** | 🟠 **AMBER** — S-01 resolved, but the gating spike S-02 cannot run and Invariant E's test vehicle is measurably blind to the send path. Neither is a code defect; both stop defined work. |
| **Next milestone** | **`v0.2.0-spikes`** — blocked on S-02, which cannot run without Firefox (**B-01**). Then S-03 … S-07, then the 20-cell matrix. |
| **Product code written** | **None. Zero.** |

---

## Evidence recorded so far

| Artifact | What it establishes |
|---|---|
| `artifacts/experiments/ENV-0001-workspace-environment.md` | The workspace was empty; the toolchain present; the GPU is 8 GB |
| `artifacts/reviews/AUDIT-0001-agentos-framework.md` | What Raptor's Way actually implements, and what PratiBimb adopts from it |
| `artifacts/experiments/W1-S01-chrome-webgpu-context/` | **S-01 ACCEPT** — WebGPU is fully functional in a dedicated worker inside a Chrome MV3 offscreen document, across 3 runs. Chrome selects integrated graphics. Chrome 152 refuses `--load-extension`. **Workstation 1 only.** |
| `artifacts/environment/ENV-0002-workstation-omen-audit.md` | **Workstation 2** — AMD integrated graphics, no Docker, no WSL, no Firefox. Establishes that S-01's adapter finding cannot transfer. |
| `artifacts/experiments/W1-S01b-playwright-extension-loading/` | **S-01b CONDITIONAL** — Playwright's `context.route()` does not observe or block egress from the MV3 offscreen document. 3 runs of 3. **Workstation 2 only.** Merged `d7fe11d`. |
| `artifacts/experiments/W1-B02-invariant-e-observation/` *(open PR #9)* | **B-02 CONDITIONAL** — CDP attached to the offscreen target observes and genuinely blocks; an independent loopback collector proves arrival, detects an unauthorised sender by absent provenance, and caught a tampered payload by recomputing its hash. **Workstation 2 only.** |
| `artifacts/experiments/W1-S02-firefox-webgpu-context/` | **No result.** A pre-registered protocol and accept/reject criteria for S-02, fixed before any data exists. **Nothing in it may be cited as a result.** |

## Repository

| Field | Value |
|---|---|
| Remote | `https://github.com/ronitsaha11/pratibimb` — **PUBLIC** |
| Default branch | `main` — **NOT protected.** No rule requires a PR, blocks force-push or deletion, or makes any check required. → **B-05**, issue #6 |
| Checkpoint | `v0.1.0-foundation` = `7a31857` |
| Workflow | `CONTRIBUTING.md` · `docs/operations/git-workflow.md` · **blockers: `agentos/blockers.md`** |
| Contribution topology | Direct push (`ronitsaha11`) **and** fork → PR (contributors with read access). See `docs/operations/git-workflow.md` §8. |

> **Both fields above were previously recorded incorrectly** — the repository was
> described as private and `main` as protected. Neither was true, and both were verified
> against the API rather than assumed:
> `gh repo view --json isPrivate` → `false` ·
> `gh api repos/.../branches/main/protection` → **404 Not Found**.
> The originals are preserved in the history of this file (`git log -p agentos/state.md`).
> **This matters beyond tidiness: this is a privacy product, the repository is
> world-readable, and a claimed branch protection that does not exist is worse than a
> known-absent one, because reviewers stop checking for it.**

## What exists

- The PratiBimb AgentOS engineering layer (this repository).
- The governing dossier, recorded at `docs/dossier/`.
- Frozen contracts, the architecture constitution, specialist contracts, workflows, gates.
- The model registry and the feasibility matrix — **structures only, all cells `UNKNOWN`**.

## What does not exist

- Any extension code. Any server code. Any model asset. Any test.
- Any product measurement — no model has been run, no latency measured.
- Any verified licence.
- Any evidence that WebGPU, ONNX Runtime Web, or any of the five models function in the
  target contexts.

---

## Active work

| Task | Status | Owner | Blocked by |
|---|---|---|---|
| S-01 — WebGPU in a Chrome MV3 offscreen document | `DONE` — ACCEPT, merged in PR #1 (`2fb4e82`) | `browser-engineer` | — |
| S-01b — Playwright / Invariant E interception coverage | `DONE` — CONDITIONAL, merged `d7fe11d` | `browser-engineer` · `evaluation-qa-engineer` | — |
| B-02 — which mechanism can be trusted to enforce Invariant E | `IN_REVIEW` — CONDITIONAL, evidence in **open PR #9** | `browser-engineer` · `evaluation-qa-engineer` | Maintainer merge (**B-04**) |
| S-02 — WebGPU in a Firefox MV3 event page | `BLOCKED` | `browser-engineer` | **B-01** — no Firefox on any workstation |
| Invariant E enforcement vehicle | `BLOCKED` | `privacy-security-engineer` → human architect | **B-02** — needs an ADR, issue #5 |
| Server host decision, then E-01 / E-02 | `BLOCKED` | Human — team | **B-03** |

---

## Blockers

> **`agentos/blockers.md` is the register of record.** The table below is the original
> Phase-0 list, kept for continuity and mapped onto the register rather than deleted.
> When the two disagree, **the register wins**.
>
> | Here | Register | |
> |---|---|---|
> | 1 | *(closed)* | B-00 — workspace was not a git repository |
> | 2, 3, 4 | **B-03** | No vLLM host; 8 GB VRAM; Linux-only platform |
> | 5 | **B-01** | Firefox / Firefox-on-Linux |
> | — | **B-02** | Invariant E enforcement vehicle *(new, from S-01b)* |
> | — | **B-04** | Fork PRs can neither merge nor run CI *(new)* |
> | — | **B-05** | `main` unprotected *(new)* |
> | — | **B-06** | Line endings unmanaged *(new)* |

| # | Blocker | Severity | Resolution path |
|---|---|---|---|
| ~~1~~ | ~~Workspace is not a git repository.~~ **RESOLVED** — initialized and pushed to a **public** GitHub remote, `v0.1.0-foundation` tagged. (**Correction:** this line previously also said the remote was private and `main` protected. Neither was true; `main` is still unprotected — **B-05**.) | ✅ | — |
| 2 | **8 GB VRAM (RTX 5050 Laptop) is tight for Qwen3-VL-4B under vLLM.** FP16 weights alone are ~8 GB before KV cache. Needs a quantised serving path, a reduced context budget, or another host. | 🟡 Major | Spike E-02 · see `artifacts/experiments/ENV-0001` |
| 3 | **vLLM's supported platform is Linux.** Whether it runs here — native, WSL2, or Docker with GPU passthrough — is UNKNOWN. | 🟡 Major | Spike E-01 |
| 4 | No separate GPU host identified for the team | 🟡 Major | Human decision — spike E-04 |
| 5 | **Firefox-on-Linux test environment not identified**, and it is the most likely judging configuration | 🟡 Major | Human decision — spike E-05 |

### Machines — two, and no result transfers between them

| | **Workstation 1** (`ENV-0001`) | **Workstation 2** (`ENV-0002`) |
|---|---|---|
| CPU / integrated GPU | Intel · Intel Graphics | **AMD Ryzen AI 7 350 · Radeon 860M** |
| Discrete GPU | RTX 5050 Laptop, 8151 MiB | RTX 5050 Laptop, 8151 MiB |
| Node · Python | 24.19.0 · 3.13.14 | **26.4.0 · 3.12.10** |
| Docker / WSL | Docker 29.6.2 | **neither** |
| Browsers | not recorded | Chrome 152, Edge 152, **no Firefox** |
| Working tree | OneDrive-synced path | plain local path |
| Evidence recorded on it | S-01 | S-01b, ENV-0002 |

**Client-side work is unblocked on both. Server-side work is blocked on both** (B-03).

Per `AGENTS.md` §5 these are **separate experimental cells**. S-01 recorded Chrome
selecting `intel / gen-12lp`; workstation 2 has no Intel GPU, so that finding cannot
reproduce there and is not a fact about it. Neither machine's numbers generalise to the
other.

---

## Open UNKNOWNs gating work

All of `docs/architecture/constitution.md` section 9, and **all twenty model cells** of
`agentos/registry/feasibility-matrix.md`, remain `UNKNOWN`. **No model has been downloaded
or run.** The only promotions to `FACT` so far are prerequisite spikes, not model cells.

The two that gated everything else:

- ~~**S-01** — WebGPU adapter inside a Chrome `chrome.offscreen` document.~~
  **RESOLVED: FACT, ACCEPT.** See `artifacts/experiments/W1-S01-chrome-webgpu-context/`.
- **S-02** — WebGPU adapter inside a Firefox MV3 event page. **Still `UNKNOWN`. Next.**

New UNKNOWNs raised by S-01:

- **S-01a** — can Chrome be made to select the discrete NVIDIA adapter? (p2, blocks nothing)
- **S-01b** — **answered, and the answer is worse than the question.** Merged `d7fe11d`,
  verdict **CONDITIONAL**. Branded Edge 152 loads the unpacked MV3 extension
  where branded Chrome 152 does not — but `context.route()` **does not cover the MV3
  offscreen document**, which `docs/architecture/constitution.md` §5 makes the send path.
  Under an abort-everything route handler the offscreen POST reached the wire in **3 runs
  of 3**. A suite written on `context.route()` would assert *zero outbound requests*, pass,
  and prove nothing. **QG-04 cannot be signed off on the current enforcement plan.**
  → **B-02**, issue #5. The literal S-01b question (Playwright's *bundled* Chromium) is
  still `UNKNOWN` — the binary would not execute on workstation 2.

**Invariant E itself is unchanged and has not been weakened.** Mechanisms (1) lint,
(3) manifest CSP and (4) payload hash pin are unaffected; mechanism (2) has a measured
coverage gap over the send path, and choosing its replacement is an ADR decision reserved
for the human architect.

- **B-02** — **answered.** Open **PR #9**, verdict **CONDITIONAL**. CDP attached to the
  offscreen target observes 5 of 5 and genuinely blocks (the collector confirms zero
  arrivals); an independent loopback collector detects an unauthorised sender by its absent
  provenance headers and caught a tampered payload by recomputing SHA-256 over the received
  bytes. **No single mechanism answers all five sub-questions; `CDP + collector` does**, with
  independent failure modes. **Not adopted — that needs an ADR (B-02-2).** A deterministic
  regression guard now encodes the false-green failure mode, 3 of 3 runs.

Operational risk, **workstation 1 only**: its working tree is on a OneDrive-synced path,
which can race with Git on `.git/` internals. Workstation 2 is on a plain local path and
is unaffected. See `docs/operations/git-workflow.md` §8.4.

---

## Decisions log pointer

`docs/adr/README.md` — **1 ADR recorded, approved and implemented.** 12 ADR candidates
identified, one written.

- **ADR-0001** — WebAssembly CSP directive and the `connect-src` provenance pin.
  **APPROVED 2026-09-10** by the human architect at the architectural decision level, subject
  to G1–G7. Implemented; all nine gate cells recorded in §12.1, with **G6 a CONDITIONAL
  PASS** (CSP diff only; the `privacy-security-engineer` veto is not waived). Approval was
  explicitly not approval to weaken any gate — **QG-04 stays UNSIGNED, B-02 stays OPEN,
  Firefox on Linux stays UNKNOWN.**

---

## Session log

| Date | Session | Outcome |
|---|---|---|
| 2026-09-07 | Initialization / discovery pass | Dossier v4.0 read in full and recorded; Raptor's Way audited against its implementation, not its README; PratiBimb AgentOS layer created; contracts frozen; registries created empty. **No product implementation started.** |
| 2026-09-07 | Reconstruction onto workstation 2 | Repository reconstructed from GitHub on a second machine via a fork. S-01 evidence re-verified independently — every headline figure recomputed from the raw run records and reproduced exactly. Raptor's Way audit re-measured; one figure corrected forward (`AUDIT-0001` Correction C-1). Five documentation defects fixed (PR #3, merged `09aa71b`). Blocker register created. **No product implementation started.** |
| 2026-09-07 | S-01b executed | Invariant E's planned Playwright interception measured against the real send path. **CONDITIONAL** — `context.route()` is blind to the MV3 offscreen document, 3 runs of 3. Invariant unchanged, QG-04 unsigned, replacement vehicle deliberately left to an ADR. **No product implementation started.** |
| 2026-09-10 | ADR-0001 approved and implemented | The project's **first production code**. `packages/security` implements the approved CSP builder, the G1 WebAssembly capability assertion (`compile`, never `validate`) and the ORT WASM byte pin with its C-1 realm guard; `scripts/generate-ort-pin.mjs` breaks the build on bundle **or ORT API** drift; `tests/browser/gates` carries G1–G3 as permanent regression guards across Chromium and Firefox. All nine gate cells recorded, G6 **CONDITIONAL**. B-02 guard re-run and still passing 3/3. **QG-04 unsigned, B-02 open, Firefox-on-Linux UNKNOWN — none promoted.** Perception/product work deliberately not started. |
| 2026-09-10 | S-05 perception substrate | **The perception tier exists.** `packages/perception` implements the coordinate contract (four spaces, branded so a device-pixel value cannot be passed as CSS pixels), capture with its full geometry block, the derived element graph, the off-screen observation model, the capability-aware detector interface, DOM/vision fusion at the frozen IoU > 0.5 with provenance preserved rather than collapsed, the T0 change gate, and the perception-state assembly with a handoff type that structurally cannot carry pixels. **QG-02: criteria 1–6 PASS on Chromium across six DPR/zoom configurations, criterion 7 CONDITIONAL pending an executor.** 142 perception tests, 178 across the workspace. **UIElementDetector still has NO admissible implementation** — option A is AGPL-excluded, B is week 3, C is the DOM-only floor. Firefox QG-02 NOT RUN on this workstation. **QG-04 unsigned, B-02 open, no model adopted.** |
| 2026-09-10 | W1-S05-rate capture limits | **S-05's own question answered — `CONDITIONAL`.** `captureVisibleTab` characterized on Chromium 151 (MV3 service worker) and Firefox 155 (MV2 background) over bounded schedules, ladder repeated 3x per run, Chromium x2 runs. **Chromium: safe envelope 500 ms spacing (~1.7 captures/sec), onset between 2 and 3 Hz, ceiling ~2.6/s, burst allowance 2, recovery ~1.15 s, stateful.** **Firefox: no throttle observed at or below 10 Hz** — recorded as an absence of observation, not a proof of absence. The **first run was invalid** (0% success everywhere) and the A-F cause rule caught it: 212 of 304 failures were a permission error, not a rate limit. **`activeTab` NOT MEASURED**, which caps this at `CONDITIONAL`. Production: `CAPTURE_THROTTLED` added as a distinct refusal with **no retry/backoff/queueing** in the adapter; `minCaptureIntervalMs` 250 -> 500 ms, the only constant the evidence bounds. **QG-04 unsigned, B-02 open, no model touched.** |
| 2026-09-10 | T1 detector head + fusion | **The fusion half is complete and gated; the detector half is a contract with no admissible implementation.** Added the T1 `UIElementDetector` tensor contract (YOLO-family, 640 square letterboxed, anchor-free `[1, 4+C, A]`, matching option A's so it stays droppable-in), a fifth branded coordinate space for model-input pixels with the model->capture->CSS chain explicit, per-class deterministic NMS pinned to the frozen fusion IoU, and pinned model identity on every detection. **Fixed a real gap in shipped code: `fuse()` had never compared detection frame identity against the graph's, so an old screenshot could fuse silently with a current DOM** - now `STALE_FRAME`, verified on real browser data. **The detector has NO WEIGHTS and reports `MODEL_ASSET_UNAVAILABLE`**; option A stays licence-excluded, option B untrained, **option C (DOM-only) is the shipped configuration**. **Not benchmark-complete** - the prescribed metric (element mAP@0.5, element recall, grounding accuracy over ScreenSpot-v2 plus 300 self-labelled screens) is QG-05, which does not exist. T2's accessible-name hazard is now pinned open by test rather than fixed here. 234 perception tests, 270 across the workspace. **QG-02 unchanged (criterion 7 still CONDITIONAL), QG-03 unaffected, QG-04 unsigned, B-02 open, model registry untouched.** |
