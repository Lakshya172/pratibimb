---
id: W1-S02
title: "S-02 — WebGPU adapter inside a Firefox MV3 event page"
status: BLOCKED — pre-registered, not run
date: 2026-09-07
label: UNKNOWN
verdict: none — the experiment has not been executed
---

# S-02 — WebGPU in a Firefox MV3 event page

> # ⛔ THIS EXPERIMENT HAS NOT RUN. THERE IS NO RESULT.
>
> **Firefox is not installed on any workstation currently available to the project.**
> This document is a **pre-registered protocol**: the question, the environment required,
> the procedure, and the accept/reject criteria — all fixed *before* any measurement, so
> the criteria cannot be fitted to whatever the data turns out to be.
>
> **S-02 remains `UNKNOWN` in `agentos/registry/feasibility-matrix.md`.** Nothing in this
> file may be cited as a result. See blocker **B-01** in `agentos/blockers.md`.

## Hypothesis

`navigator.gpu.requestAdapter()` returns a real, usable GPU adapter inside a **Firefox MV3
event page**, and a WebGPU device created there can execute a compute shader with correct
output.

The dossier states the stakes (§11, quoted in `agentos/registry/feasibility-matrix.md`):

> *"GPU adapter availability from extension background contexts has been inconsistent. If
> it returns null, every WebGPU number in this document becomes the WASM number and the
> entire performance story changes."*

`agentos/workflows/spike.md` makes S-01 and S-02 the two spikes that gate all other work.
S-01 is answered. **S-02 is the one still standing between the project and downstream
implementation.**

### Why the Chrome result does not answer this

S-01 measured Chrome. It says nothing here, and per `AGENTS.md` §5 it may not be
generalised. Three things differ, not one:

| | Chrome (S-01) | Firefox (S-02) |
|---|---|---|
| Extension background context | MV3 service worker + **`chrome.offscreen` document** | **MV3 event page** — Firefox implements no `offscreen` API |
| WebGPU implementation | Dawn | **wgpu** |
| Platform status | shipped since Chrome 113 | **shipped on Windows in Firefox 141; on Linux it remains off by default behind `dom.webgpu.enabled`, with Mozilla targeting 2026** |

The offscreen document is PratiBimb's Chrome inference context and **has no Firefox
equivalent**. Whatever S-02 finds, the Firefox execution context is architecturally
different, and that difference is the point of running it.

## Environment required

**None of this is available yet.** Listed so the blocker is actionable rather than vague.

| Requirement | Why | Status on the current workstation |
|---|---|---|
| Mozilla Firefox, release channel, version recorded exactly | The measurement is meaningless without the build | **ABSENT** |
| A machine with a working GPU adapter and its driver version recorded | The question is about the adapter | Present — AMD Radeon 860M + NVIDIA RTX 5050, `ENV-0002` |
| `web-ext`, or `about:debugging` temporary-add-on loading | Firefox has no `--load-extension` equivalent | Not installed |
| **Firefox on Linux** — separately, and this is the one that matters | The dossier calls Firefox-on-Linux the most likely judging configuration, and it is the cell where WebGPU is off by default | **ABSENT — no Linux environment at all (no WSL, no Docker), see `ENV-0002`** |

> **Two cells, not one.** *Firefox on Windows* and *Firefox on Linux* are separate rows of
> the feasibility matrix. Running S-02 on Windows alone leaves the Linux cell `UNKNOWN`,
> and the Linux cell is the one the risk register calls **High**.

## Procedure

Fixed in advance. Deviations are recorded as corrections, not edits.

1. Record the environment **before running anything** — OS, machine, CPU, both GPUs and
   driver versions, exact Firefox version and channel, and the value of
   `dom.webgpu.enabled` **as found**, before any change.
2. Build a throwaway MV3 extension whose **event page** performs, in order:
   `navigator.gpu` presence → `requestAdapter()` under **both** `default` and
   `high-performance` power preferences → `requestDevice()` → record `adapterInfo`
   (vendor, architecture, device, description) → compile and dispatch a trivial WGSL
   compute shader over a synthetic array → **verify output element-by-element against a
   CPU reference** → destroy the device → re-acquire it to prove teardown is clean.
   Capture `uncapturedErrors` and shader compilation errors throughout.
3. Probe a **content-script / ordinary page context as a control**, so a null adapter can
   be attributed to the extension context rather than to the machine.
4. Load the extension via `about:debugging` (temporary add-on) or `web-ext run`, recording
   which, and record whether the loading mechanism itself constrains automation — the
   Firefox counterpart of S-01's `--load-extension` finding.
5. **Three complete runs.** A single run does not establish repeatability.
6. Post results to a **loopback-only** collector. No external host.
7. Write `decision.md`, `environment.json`, `commands.md`, `metrics.json` and raw per-run
   logs, matching the layout of `W1-S01-chrome-webgpu-context/`.
8. Update `agentos/registry/feasibility-matrix.md` and `agentos/state.md`.
9. Delete the browser profile. Commit no profile, capture or personal data.

## Acceptance / rejection criteria

Fixed before measurement. **The verdict is read off this table, not argued for afterwards.**

| Verdict | Condition |
|---|---|
| **ACCEPT** | `requestAdapter()` returns a non-null adapter **in the Firefox MV3 event page**, `requestDevice()` succeeds, the compute shader output is **element-exact** against the CPU reference, and this holds in **3 of 3 runs** with zero uncaptured GPU errors. |
| **REJECT** | The adapter is null, or the device cannot be created, or output is incorrect, in the event page — **while the ordinary-page control succeeds on the same machine**. This is a real result and is merged with its evidence. Consequence: **every WebGPU figure in the dossier becomes the WASM figure for Firefox**, and the performance story is rewritten rather than quietly kept. |
| **CONDITIONAL** | It works only under a stated constraint — for example only with `dom.webgpu.enabled` flipped manually, only on the discrete adapter, only on Windows, or only headful. **The constraint is recorded in the verdict line itself**, and any figure measured under it is labelled with it. A result that needs an `about:config` change on the release channel is CONDITIONAL, never ACCEPT, because the judging machine will not have that change. |
| **INCONCLUSIVE** | The harness did not answer the question — the extension would not load, the control also failed, or the runs disagreed. **The write-up must state what would answer it.** Not a soft REJECT. |

**Fixed in advance so it cannot be argued later:**

- A **null adapter is a valid, publishable result**, not a spike failure. Per
  `agentos/workflows/spike.md`: *"A null result is a result."*
- **No fallback rescues the verdict.** If WebGPU is unavailable, the answer is that it is
  unavailable; the WASM path is the architecture's response, not a way to record ACCEPT.
- **The result fills the cell measured and no other** — Windows or Linux, that Firefox
  version, that GPU. Not both cells, not "Firefox".
- Raw WebGPU working is **not** ONNX Runtime Web working. That remains S-03, whatever S-02
  returns.

## Expected result

Stated in advance to make an unwelcome outcome visible rather than absorbable:
`navigator.gpu` is expected **present on Firefox ≥ 141 on Windows** and **absent by default
on Linux**. The adapter's availability *inside the MV3 event page specifically* is the open
question, and the honest prior is that it is genuinely uncertain — which is why the spike
gates the project.

## Actual result

**NOT MEASURED.** The experiment has not been run. Firefox is not installed. See **B-01**.

## Conclusion

**None. `UNKNOWN`.** This document establishes a procedure and a set of criteria; it
establishes no fact. `agentos/registry/feasibility-matrix.md` continues to record S-02 as
`UNKNOWN`, and `agentos/workflows/spike.md`'s gating rule continues to hold: downstream
implementation does not start.

## Reproducibility

Not yet applicable — nothing has been run. Once Firefox is available:

```bash
git switch -c spike/firefox-webgpu-context upstream/main
# build the harness per Procedure above, under this directory's harness/
# three runs, raw logs under logs/
```

The harness will contact no host other than loopback.
