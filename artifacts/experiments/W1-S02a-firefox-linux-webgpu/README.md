---
id: W1-S02a
title: "S-02a — WebGPU in a Firefox MV3 event page on LINUX"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-02a — Firefox on Linux

> **Machine boundary.** Measured **inside a WSL2 Ubuntu 26.04 guest**. **S-02 (Windows
> Firefox) is a separate cell and its `ACCEPT` is not extended by this result.** The two are
> kept apart deliberately: same browser version, different platform, different answer.

## Hypothesis

S-02 established WebGPU works in a Firefox MV3 event page **on Windows**, at release
defaults. S-02a asks the same question on **Linux** — the configuration the dossier calls the
most likely judging environment and the risk register rates **High**, precisely because
`dom.webgpu.enabled` is off by default there.

**The acceptance criteria are the ones pre-registered for S-02, unchanged**, including the
clause that decides this experiment:

> *"A result that needs an `about:config` change on the release channel is **CONDITIONAL,
> never ACCEPT**, because the judging machine will not have that change."*

## Environment

Full detail in [`environment.json`](environment.json).

| | |
|---|---|
| Linux guest | **WSL2 Ubuntu 26.04**, kernel `6.18.33.2-microsoft-standard-WSL2` |
| Browser | **Mozilla Firefox 155.0.1** release — **the same version as the Windows cell** |
| Source | Mozilla official linux64 tarball, **not** the Ubuntu apt package (a snap stub on 26.04) |
| Contexts | Firefox **MV3 event page** (`background.scripts`) + ordinary-page **control** |
| Display | headful (WSLg) **and** headless |

Same browser version on both platforms makes this a **platform** comparison rather than a
version comparison.

## Method

Three variants, **in a fixed order decided before the data existed**:

| # | Variant | Preferences | Role |
|---|---|---|---|
| 1 | `defaults-headful` | **none touched** | **decides ACCEPT / REJECT** |
| 2 | `defaults-headless` | **none touched** | same, headless |
| 3 | `webgpu-forced-headful` | `dom.webgpu.enabled=true` | recorded **separately**; can only ever support a CONDITIONAL |

3 runs each. Identical probe code in both contexts. Compute output verified
element-by-element against a CPU reference.

## Expected result

`navigator.gpu` expected **absent by default on Linux** and present when forced. The open
questions were whether the event page differs from an ordinary page, and whether a forced
adapter actually produces correct output in this GPU-less graphics stack.

## Actual result — FACT

### Variant 1 and 2 — release defaults, nothing touched

| | MV3 event page | ordinary page (control) |
|---|---|---|
| `navigator.gpu` present | **false** 3/3 headful, 3/3 headless | **false** 3/3, 3/3 |
| adapter / device / compute | — (API absent) | — (API absent) |
| conclusion recorded by the probe | `navigator.gpu ABSENT in this context` | same |

**WebGPU is not available at all in Firefox 155.0.1 on Linux at release defaults — headful or
headless — and it is equally absent in the ordinary-page control.**

The control matters: **this is not an extension-context restriction.** The API is simply off
on this platform. Had only the event page failed, the finding would have been about MV3; it
is not.

### Variant 3 — `dom.webgpu.enabled=true`

| | MV3 event page | ordinary page (control) |
|---|---|---|
| `navigator.gpu` present | **true** 3/3 | true 3/3 |
| adapter returned | **true** 3/3 | true 3/3 |
| device created | **true** 3/3 | true 3/3 |
| **output element-exact vs CPU reference** | **true 3/3 — 0 mismatches** | true 3/3 — 0 mismatches |
| shader compile errors / uncaptured GPU errors | **0 / 0** | 0 / 0 |
| destroy → re-acquire | clean 3/3 | clean 3/3 |
| `adapterInfo` | `{vendor:"", architecture:"", device:"", description:""}` | same |

Timings (event page): cold dispatch 93–102 ms, warm p50 ~101 ms.

## Findings

**Finding 1 — the dossier is right about Linux, and this is the cell that matters.**
WebGPU is off by default in Firefox on Linux. The dossier said so; it is now `FACT` on a
measured machine rather than a claim quoted from a document.

**Finding 2 — it is not an MV3 or extension-context problem.** The ordinary-page control is
equally without `navigator.gpu`. Whatever the Firefox-on-Linux story becomes, it is a
platform story.

**Finding 3 — when forced, it works, and works correctly.** Adapter, device, element-exact
compute, clean teardown and re-acquire, zero errors, in both contexts. So there is no
*second*, hidden obstacle behind the preference.

**Finding 4 — but almost certainly on a software backend, and we cannot prove which.**
This guest has **no `/dev/dri`, zero Vulkan ICDs, and `llvmpipe` for OpenGL**, while
`nvidia-smi` works. **CUDA compute and the graphics stack are different paths**, and only the
former has hardware here.

`isFallbackAdapter` is `null` and `adapterInfo` is empty — **Firefox does not expose the
adapter**, so the backend cannot be identified from inside the page. Given a GPU-less
graphics stack, a software backend is the strong reading — but that is **INFERENCE from the
environment, not a measurement**, and it is labelled that way. The ~100 ms dispatch is
consistent with software, and equally consistent with the Windows cell's ~100 ms, so it
discriminates nothing.

> **This is exactly the trap §8 warns about.** `nvidia-smi` works in this guest. It would be
> wrong to conclude the GPU is being used for WebGPU. It is not, and the evidence says the
> graphics stack has no hardware path at all.

**Finding 5 — headless and headful agree** at defaults. Both have no `navigator.gpu`.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| **A** WebGPU API available? | **FACT — NO at release defaults. YES only when `dom.webgpu.enabled` is set.** |
| **B** ONNX Runtime Web backend available? | **`UNKNOWN` — NOT TESTED.** That is **S-03**. Raw WebGPU is not ORT Web. |
| **C** Available in the exact MV3 execution context? | **FACT — the event page behaves exactly like an ordinary page**, both at defaults (absent) and when forced (present and correct). Not an extension-context issue. |
| GPU visible at OS level? | **FACT — yes**, `nvidia-smi` works |
| GPU used by Firefox for WebGPU? | **`UNKNOWN`, and probably not.** No `/dev/dri`, 0 Vulkan ICDs, `llvmpipe`. Firefox hides the adapter. |

## Conclusion

**CONDITIONAL**, by the criteria fixed before any data existed.

WebGPU **works** in a Firefox MV3 event page on Linux — **but only with
`dom.webgpu.enabled=true`, which is not the release default.** The pre-registered rule is
explicit that this is CONDITIONAL and never ACCEPT, because the judging machine will not have
that change.

**It is not REJECT.** The adapter is not null when the platform allows it, the device is
created, the compute output is element-exact and the context is stable across teardown. The
capability exists; the *default* is what blocks it.

**Two constraints attached:**

1. **`dom.webgpu.enabled` must be set.** Anything measured on Linux is measured under a
   non-default preference, and every Linux WebGPU figure must carry that label.
2. **Adapter unidentified, and probably software.** No `/dev/dri`, no Vulkan ICD, `llvmpipe`.
   **No Linux WebGPU performance figure from this environment may be quoted as a hardware
   number.**

### The cells, kept separate

| Cell | Verdict | Basis |
|---|---|---|
| **S-02 · Firefox on Windows** | **ACCEPT** | release defaults, no preference changed |
| **S-02a · Firefox on Linux (WSL2)** | **CONDITIONAL** | requires `dom.webgpu.enabled=true` |
| Firefox on **native** Linux with a real GPU | **`UNKNOWN`** | WSL2 is not native Linux — no `/dev/dri`, no Vulkan |

**The Windows ACCEPT is not upgraded to a universal Firefox ACCEPT.** It never covered Linux
and still does not.

### What this does NOT establish

- **S-03** — ORT Web was **not tested**. Raw WebGPU working is not ORT Web working.
- **Native Linux.** WSL2 has a peculiar graphics stack. A judging laptop running native Linux
  has `/dev/dri` and a real driver, and could behave differently **in either direction** —
  the preference default would still apply, but the backend would not be software.
- Any WASM-path conclusion, any model cell, any latency budget.

## Reproducibility

```bash
# inside WSL2 Ubuntu, DISPLAY=:0 for the headful variants
cd /root/spikes/s02
RUNS=3 node run-s02a-linux.js     # -> results-linux.json
```

Firefox at `/opt/firefox/firefox`. Fresh temporary profile per run, deleted afterwards. The
harness contacts **no host other than `127.0.0.1:8903`**, which also serves the control page
so both contexts run byte-identical probe code.

## Scope

**WSL2 Ubuntu 26.04 · Firefox 155.0.1 release · MV3 event page · headful and headless · no
hardware graphics path.** Per `AGENTS.md` §5 this fills the cell it tested and no other.
