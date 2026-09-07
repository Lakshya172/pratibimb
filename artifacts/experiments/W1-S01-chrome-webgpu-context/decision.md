---
id: W1-S01-decision
spike: S-01
verdict: ACCEPT
date: 2026-09-07
decided_by: ml-engineer + browser-engineer (pending human architect review)
---

# S-01 decision — ACCEPT (with two recorded constraints)

## Verdict

**ACCEPT.**

WebGPU is available and fully functional in a dedicated Worker inside a Chrome MV3
`chrome.offscreen` document — PratiBimb's intended inference context. Adapter returned,
device created, real compute shader executed with element-exact correct output against a
CPU reference, device destroyed and re-acquired cleanly. Identical across three runs, with
zero uncaptured GPU errors.

The dossier's stated failure case — *"if it returns null, every WebGPU number in this
document becomes the WASM number"* — **does not occur on this machine.**

## Constraints attached to the acceptance

1. **Integrated graphics only.** Chrome returned `intel / gen-12lp` in every context and
   every run, under both the default and `high-performance` power preferences, despite an
   NVIDIA RTX 5050 Laptop GPU being present and driver-visible. Every WebGPU figure this
   project measures on this machine is therefore an **integrated-graphics** figure and
   must be labelled as such. Our WebGPU column is not an upper bound.

2. **Branded Chrome cannot be automated with `--load-extension`.** Chrome 152 stable
   refuses the switch. Extensions load only via the DevTools Protocol
   (`Extensions.loadUnpacked` behind `--enable-unsafe-extension-debugging`). This affects
   the CI plan for the Playwright egress interception suite, which is one of the four
   enforcement mechanisms of Invariant E.

## What this unblocks

- **S-02** (Firefox MV3 event page) may now proceed. S-01 and S-02 were the two spikes
  gating all other work.
- The Chrome-side WebGPU assumption underlying the dossier's latency budget is no longer
  UNKNOWN at the *browser capability* level.

## What this explicitly does NOT unblock

- **S-03** — ONNX Runtime Web's WebGPU execution provider is a *separate* question. Raw
  WebGPU working does not imply ORT Web's backend initialises or runs a model.
- **S-04** — the shared WebAssembly heap across multiple ORT sessions. Clean WebGPU device
  teardown is a different allocator and a different failure mode. The dossier's "budget a
  day" warning stands undiminished.
- **S-08…S-27** — the twenty model feasibility cells remain `UNKNOWN`. This spike ran a
  hand-written trivial shader, not a model.
- Anything about Firefox, WASM, or any other machine.

## Architecture impact

**None. No frozen contract is touched, and no change to the dossier is proposed.**

Finding 3 (the MV3 service worker is functional but one to three orders of magnitude
slower and far less predictable than the offscreen contexts) is *independent empirical
support* for an architecture decision the dossier already made on other grounds. The
existing architecture is confirmed, not amended.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-01a | Can Chrome be made to select the discrete NVIDIA adapter? What does that do to the numbers? | p2 | Nothing. Affects labelling of the WebGPU column. |
| S-01b | Does Playwright's bundled Chromium still honour `--load-extension`, so the egress suite can run in CI? | **p1** | QG-04 enforcement plan |

## Registry effect

`agentos/registry/feasibility-matrix.md`: prerequisite spike row **S-01 → FACT**.
The twenty model cells are **unchanged and still `UNKNOWN`** — S-01 does not fill any of
them, and no model has been downloaded.
