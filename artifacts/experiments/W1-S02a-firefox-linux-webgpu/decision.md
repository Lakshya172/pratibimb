---
id: W1-S02a-decision
spike: S-02a
verdict: CONDITIONAL
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer + pratibimb-architect review
---

# S-02a decision — CONDITIONAL

## Verdict

**CONDITIONAL.**

WebGPU works in a Firefox MV3 event page on Linux — **but only with `dom.webgpu.enabled=true`,
which is not the release default.** At defaults, `navigator.gpu` is **absent**, in the event
page and in the ordinary-page control alike, headful and headless, 3/3 each.

The pre-registered criteria decided this before the data existed:

> *"A result that needs an `about:config` change on the release channel is **CONDITIONAL,
> never ACCEPT**, because the judging machine will not have that change."*

**This is pre-registration doing its job.** Had only the forced variant been run, the honest
reading of the output would have been ACCEPT. The defaults variant is what makes it
CONDITIONAL, and it was run first by design.

## Why not REJECT

The capability is present: adapter returned, device created, compute output **element-exact
against a CPU reference (0 mismatches)**, zero shader and zero uncaptured GPU errors, clean
destroy and re-acquire — in **both** contexts, 3/3. Nothing is broken behind the preference.
**The default, not the capability, is the obstacle.**

## Constraints attached

1. **`dom.webgpu.enabled` must be set.** Every Linux WebGPU figure carries that label.
2. **Adapter unidentified, and probably software.** No `/dev/dri`, **0 Vulkan ICDs**,
   OpenGL is `llvmpipe`. `nvidia-smi` works, but that is the **CUDA compute** path, not
   graphics. Firefox exposes neither `adapterInfo` nor `isFallbackAdapter`, so the backend
   **cannot be identified from inside the page**. Software is the strong reading — labelled
   **INFERENCE from the environment, not measured**. **No Linux WebGPU figure from this
   environment may be quoted as a hardware number.**

## Cells kept separate — B-01 residual

| Cell | Verdict |
|---|---|
| **S-02 · Firefox on Windows** | **ACCEPT** (release defaults) |
| **S-02a · Firefox on Linux (WSL2)** | **CONDITIONAL** (needs the preference) |
| Firefox on **native** Linux with a real GPU | **`UNKNOWN`** |

**The Windows ACCEPT is not upgraded into a universal Firefox ACCEPT.** B-01 remains
`RESOLVED` for what it covered — Firefox existing and S-02 being runnable — and S-02a is
recorded as its own cell with its own weaker verdict.

## Architecture impact — evidence for S-02b and S-02c, but no change

**No frozen contract is touched. Nothing is redesigned.**

- **S-02b (per-browser execution context)** — reinforced. The Firefox MV3 event page behaves
  exactly like an ordinary page on both platforms, confirming it is a DOM context needing no
  offscreen-document equivalent. **Still PROPOSED.**
- **S-02c (Firefox origin controls vs egress)** — unchanged by this experiment; the same
  `host_permissions` gating was worked around for reporting only. **Still PROPOSED.**

**Neither ADR is written or accepted here, and no trust or security contract was modified to
make Firefox work.**

## What this does NOT unblock

- **S-03** — ORT Web was **not tested**. Raw WebGPU working is not ORT Web working.
- **Native Linux** — WSL2 has no `/dev/dri` and no Vulkan. A judging laptop on native Linux
  could differ **in either direction**: the preference default would still apply, but the
  backend would not be software.
- Any WASM-path conclusion, any model cell, any latency budget.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-02a-1 | Firefox on **native** Linux with a real GPU and `/dev/dri`. WSL2 cannot answer this. | **p1** | The judging-configuration story |
| S-02a-2 | Does the **WASM path** carry the Firefox-on-Linux case, given WebGPU is off by default? The dossier's position is "WASM always" — this is where that is cashed in. | **p1** | Firefox parity |
| S-02a-3 | Is `dom.webgpu.enabled` on by default in any Linux Firefox channel we could legitimately target, and what is Mozilla's 2026 ship status? | p2 | Slide accuracy |
| S-02a-4 | Confirm the backend is software by a route other than `adapterInfo` | p2 | Labelling of Linux figures |

## Registry effect

- `agentos/registry/feasibility-matrix.md`: **Firefox-on-Linux cell → `CONDITIONAL`**, with
  the preference named. Windows cell unchanged at `FACT`.
- `agentos/blockers.md`: **B-01 residual updated** — S-02a executed, result CONDITIONAL,
  native Linux still `UNKNOWN`.
- `docs/security/security-invariants.md`, `docs/architecture/constitution.md`: **unchanged.**
- Twenty model cells: **unchanged, all `UNKNOWN`.** No model downloaded. No product code.
