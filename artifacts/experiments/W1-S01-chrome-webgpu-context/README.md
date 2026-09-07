---
id: W1-S01
title: "Chrome WebGPU availability in PratiBimb's MV3 extension execution contexts"
spike: S-01
status: complete
verdict: ACCEPT (with two recorded constraints)
date: 2026-09-07
labels: [FACT, INFERENCE]
---

# W1-S01 — Chrome WebGPU in the MV3 extension context

> **Throwaway spike code, permanent evidence.** `harness/` is not production code and is
> not reviewed as such. See `docs/operations/repository-structure.md`.

---

## Hypothesis

The dossier's client architecture runs local inference in an **offscreen document plus a
dedicated worker**, on WebGPU where available and WASM always. Section 11 schedules a
week-one spike to confirm that `navigator.gpu.requestAdapter()` returns a real adapter
inside a Chrome `chrome.offscreen` document, warning:

> *"GPU adapter availability from extension background contexts has been inconsistent.
> If it returns null, every WebGPU number in this document becomes the WASM number and
> the entire performance story changes."*

**H1:** `navigator.gpu` is exposed, and returns a usable adapter and device, inside the
Chrome MV3 contexts PratiBimb intends to use — specifically a **dedicated Worker running
inside a `chrome.offscreen` document**.

**H0:** it is not, and every WebGPU figure in the dossier collapses to its WASM value.

This spike answers **adapter and device availability plus functional compute**. It does
**not** answer whether ONNX Runtime Web's WebGPU execution provider works — that is a
separate question (S-03), and the distinction is deliberate.

## What this spike does NOT establish

Stated first, because conflating these is the most likely way to misuse this result:

| Not established | Owning spike |
|---|---|
| ONNX Runtime Web's WebGPU backend initialises or runs a model | S-03 |
| Any of the five models loads, or produces correct output | S-08…S-27 |
| Firefox behaviour, in any context | S-02 |
| WASM fallback behaviour | S-03 |
| Multi-session WebAssembly heap behaviour | S-04 |
| Performance of a *real* model — this ran a trivial hand-written shader | S-08…S-27 |

**"Chrome exposes WebGPU in an offscreen worker" is not "PratiBimb can run ONNX Runtime
Web inference on WebGPU there."** Those are separate feasibility questions and are
recorded separately.

---

## Environment

Full machine-readable record: [`environment.json`](environment.json).

| Field | Value |
|---|---|
| OS | Windows 11, build 10.0.26200, AMD64 |
| CPU | Intel64 Family 6 Model 186 Stepping 2 (Raptor Lake-U/H class) |
| **Browser** | **Google Chrome 152.0.7977.82, stable channel, headful** |
| CDP browser string | `Chrome/152.0.7977.82` |
| V8 | 15.2.124.21 |
| **GPUs present** | Intel(R) Graphics (driver 32.0.101.7077) **and** NVIDIA GeForce RTX 5050 Laptop GPU, 8151 MiB (driver 32.0.16.1074) |
| Extension | **Manifest V3**, unpacked, id `ldhncamjeodalamhbbbomleedodpncco` |
| Offscreen reason | `WORKERS` — the same reason PratiBimb itself will declare |
| Runs | **3 complete repetitions**, plus one discarded pilot (see *Corrections*) |

**Headful on purpose.** Headless Chrome and CI runners fall back to a software adapter,
which answers a different question. The user-data-dir is created in the system temp
directory and deleted after each run, so no browser profile is ever committed.

---

## Exact execution contexts probed

One probe file (`harness/extension/probe.js`) is loaded verbatim into all four contexts,
so any difference in the result is attributable to the **context**, not to the code.

| # | Context | `globalThis` | Origin | Why it is here |
|---|---|---|---|---|
| 1 | Ordinary web page — **CONTROL** | `Window` | `http://127.0.0.1:8899` | Distinguishes *"this machine has WebGPU"* from *"this extension context has WebGPU"*. Without it, a negative result is uninterpretable. |
| 2 | **MV3 background service worker** | `ServiceWorkerGlobalScope` | `chrome-extension://…` | The dossier says service workers cannot hold inference sessions. Worth measuring rather than assuming. |
| 3 | **`chrome.offscreen` document** | `Window` | `chrome-extension://…` | The dossier's host document. |
| 4 | **Dedicated Worker inside the offscreen document** | `DedicatedWorkerGlobalScope` | `chrome-extension://…` | **PratiBimb's real inference context.** This is the result that decides. |

All four reported `isSecureContext: true`.

## Method

1. `harness/collector.py` binds `127.0.0.1:8899`, serves the control page, and receives
   results by `POST`. It serves the extension's own `probe.js` verbatim to the control
   page, so there is exactly one copy of the probe logic.
2. `harness/run-s01.py` launches headful Chrome with a throwaway profile, loads the
   unpacked extension **over the DevTools Protocol** (see *Corrections*), and opens the
   control page.
3. The service worker probes itself, then creates the offscreen document; the offscreen
   document probes itself, then spawns the dedicated worker, which probes itself.
4. Each probe: `navigator.gpu` presence → `requestAdapter()` (default **and**
   `high-performance`) → adapter info, features, limits → `requestDevice()` → a WGSL
   compute shader over 262,144 `f32` (`out[i] = in[i]*2 + 1`), 20 iterations, output
   **verified element-by-element against a CPU reference** → `device.destroy()` → acquire
   a fresh adapter and device and run again, to test teardown and repeatability.

**Measurement definition — read before quoting any number.** `dispatchMs` is **end-to-end
wall clock from `queue.submit()` to the readback buffer's `mapAsync()` resolving.** It
includes command encoding, GPU execution, buffer copy and readback. It is **not** isolated
GPU kernel time. This is deliberate — it is the latency a caller in PratiBimb would
actually experience — but it must never be quoted as a kernel benchmark.

---

## Corrections made during the experiment

Recorded because each one would have produced a **false negative**, and a false REJECT
here would have rewritten the project's entire performance story on an artefact.

### C1 — Chrome 152 refuses `--load-extension` outright

The first two runs produced **zero extension results** while the control page succeeded.
That pattern is indistinguishable from *"extension contexts have no WebGPU"*. Chrome's
own log gives the real reason:

```
[WARNING:chrome\browser\extensions\extension_service.cc:423]
--load-extension is not allowed in Google Chrome, ignoring.
```

`--disable-features=DisableLoadExtensionCommandLineSwitch` does **not** restore it in this
build. Verified independently: the throwaway profile's `Default/Preferences` listed
**0 installed extensions**.

**Resolution:** load over the DevTools Protocol —
`--remote-debugging-port` + `--enable-unsafe-extension-debugging`, then
`Extensions.loadUnpacked`, which returns the extension id. The runner now **aborts** if no
id comes back, rather than letting a silent load failure masquerade as a capability
result.

### C2 — self-inflicted GPU contention in the pilot run

The pilot showed the service worker with a warm p95 of **4,332 ms**, which would have
supported a dramatic and wrong conclusion. Cause: `background.js` called `main()` both at
top-level evaluation **and** from `onInstalled`, so **two probes ran concurrently and
competed for the same GPU**. Guarded with a `started` flag; the pilot run is discarded and
the three reported runs are clean.

### C3 — adapter identity was recorded for only one adapter

The probe requested both a default and a `high-performance` adapter but read identity
from only one. On a hybrid-graphics laptop those can be different physical GPUs, which is
load-bearing. Both are now recorded — and the answer turned out to matter (Finding 2).

---

## Expected result

Stated before the runs, so the outcome could disagree with it:

| | Expectation | Basis |
|---|---|---|
| Ordinary page (control) | WebGPU present and working | Chrome 113+ ships WebGPU on Windows |
| Offscreen document | **Uncertain.** The dossier flags extension background contexts as historically inconsistent. | Dossier §11 |
| Offscreen dedicated worker | **Uncertain — the question.** | Dossier §11 |
| MV3 service worker | Likely absent or unreliable | Dossier §12: service workers "cannot hold inference sessions" |
| Adapter identity | Discrete NVIDIA under `high-performance` | Standard hybrid-graphics behaviour |

## Actual result

**Every context worked, including the two flagged as uncertain — and the adapter
expectation was wrong.**

| | Expected | Actual |
|---|---|---|
| Ordinary page (control) | works | ✅ works |
| Offscreen document | uncertain | ✅ **works, and is fast and stable** |
| Offscreen dedicated worker | uncertain | ✅ **works — most stable of all four** |
| MV3 service worker | absent / unreliable | ⚠️ **present and functional, but erratic** (p95 up to 2.36 s) |
| Adapter identity | discrete NVIDIA | ❌ **integrated Intel in every context and run**, even under `high-performance` |

The two disagreements with expectation are Findings 2 and 3 below. Neither changes the
architecture; one changes how our numbers must be labelled.

Full raw records: [`results.json`](results.json) (last run) and
[`logs/results-run1..3.json`](logs/). Aggregates: [`metrics.json`](metrics.json).

### Capability — identical across all 3 runs

| Context | `navigator.gpu` | adapter | device | compute **correct** | repeatable after `destroy()` |
|---|---|---|---|---|---|
| Ordinary web page (control) | ✅ | ✅ | ✅ | ✅ | ✅ |
| MV3 background service worker | ✅ | ✅ | ✅ | ✅ | ✅ |
| `chrome.offscreen` document | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Offscreen dedicated worker** | ✅ | ✅ | ✅ | ✅ | ✅ |

Zero uncaptured GPU errors and zero shader compilation errors in every context, every run.
`device.lost` resolved with `reason: "destroyed"` in every case, and a fresh adapter and
device were obtained afterwards each time.

### Latency — min / median / max across 3 runs (ms)

| Context | `requestAdapter` | `requestDevice` | cold dispatch | warm p50 | warm p95 |
|---|---|---|---|---|---|
| Ordinary web page (control) | 51.1 / 63.7 / 492.0 | 12.8 / 19.1 / 153.7 | 6.7 / 7.2 / 7.3 | 4.1 / 4.1 / 4.7 | 6.1 / 7.8 / 24.3 |
| **MV3 service worker** | **507.9 / 1121.5 / 3737.8** | **89.0 / 122.4 / 1789.0** | 12.2 / 28.2 / 127.2 | 7.0 / 11.1 / 13.9 | **63.6 / 430.0 / 2358.6** |
| `chrome.offscreen` document | 13.2 / 22.4 / 24.2 | 10.5 / 16.7 / 17.5 | 5.6 / 6.4 / 6.5 | 3.8 / 4.3 / 4.9 | 4.7 / 5.5 / 6.2 |
| **Offscreen dedicated worker** | **17.5 / 17.8 / 22.9** | **9.3 / 9.8 / 18.7** | **5.8 / 6.2 / 6.3** | **4.6 / 4.8 / 5.0** | **5.7 / 6.0 / 6.2** |

Workload: 262,144 `f32` in and out, `workgroup_size(64)`, 20 iterations (1 cold + 19 warm).

### Adapter identity — every context, every run

| | vendor / architecture |
|---|---|
| default adapter | `intel / gen-12lp` |
| `powerPreference: "high-performance"` | `intel / gen-12lp` |

`isFallbackAdapter` was not set (`null`), 20 adapter features exposed,
`maxBufferSize` 2,147,483,648 (2 GiB), `maxStorageBufferBindingSize` 2,147,483,644.

---

## Findings

### Finding 1 — WebGPU is fully functional in PratiBimb's target context — FACT

In the **dedicated worker inside a `chrome.offscreen` document**, across three runs:
`navigator.gpu` exposed, adapter returned, device created, a real compute shader executed
with **element-exact correct output against a CPU reference**, and the device destroyed
and re-created successfully.

**The dossier's H0 does not occur on this machine.** The WebGPU path in the Chrome
column is available.

It is also the **most stable** of the four contexts: warm p50 spread 4.6–5.0 ms and p95
spread 5.7–6.2 ms across runs — tighter than the ordinary web page control, which saw a
24.3 ms p95 outlier.

### Finding 2 — Chrome selects the **integrated** GPU, even when asked for high-performance — FACT

Both GPUs are present and driver-visible (Intel Graphics; NVIDIA RTX 5050 Laptop, 8 GiB).
Chrome returned `intel / gen-12lp` in **every context, in every run, under both the
default and the `high-performance` power preference**. The discrete GPU was never
selected.

**INFERENCE:** every WebGPU figure this project measures on this machine is an
**integrated-graphics** figure. That is arguably the *representative* case for a judging
laptop, so it is not bad news — but it must be labelled, and it means our WebGPU column
is not an upper bound. Whether the RTX 5050 can be selected at all (Windows graphics
preference, driver Optimus policy, or a Chrome flag) is a **new UNKNOWN**, recorded below
as **S-01a**. It does not block S-02.

### Finding 3 — the MV3 service worker is functional but erratic — FACT

WebGPU *works* there, which is worth knowing. But `requestAdapter` ranged 508–3738 ms,
`requestDevice` 89–1789 ms, and warm p95 63.6–2358.6 ms — one to three orders of magnitude
worse and vastly less predictable than the offscreen contexts, with the *same* code and
the *same* adapter.

**INFERENCE:** consistent with MV3 service-worker lifecycle throttling. This is
independent empirical support for the dossier's existing decision to keep inference
sessions out of the service worker and in an offscreen document — a decision it justified
on the grounds that service workers have no DOM and terminate when idle. We now also have
a latency reason. **No architecture change is implied; the existing architecture is
confirmed.**

### Finding 4 — Chrome 152 stable cannot load unpacked extensions from the command line — FACT

`--load-extension` is refused (C1 above). **This has consequences beyond this spike**, and
they belong to the integration-release-engineer:

- Automated end-to-end tests — including the **Playwright egress interception suite**,
  which is one of the four enforcement mechanisms of Invariant E — cannot drive branded
  Google Chrome via `--load-extension`.
- Playwright bundles **Chromium**, not branded Chrome, and Chromium/Chrome-for-Testing
  builds still honour the switch. **INFERENCE, not yet verified** — it must be confirmed
  before the egress suite is built, and is recorded as **S-01b**.
- Whatever we use, the browser under test in CI is then **not the browser the panel will
  run**, which is a difference we should state rather than discover.

### Finding 5 — device teardown and re-acquisition is clean — FACT

In all four contexts and all three runs, `device.destroy()` completed in 0.4–1.3 ms,
`device.lost` resolved with `reason: "destroyed"`, and a fresh adapter and device were
acquired and produced correct output immediately afterwards.

**This is weak positive evidence** for the dossier's tier-teardown strategy — but it is
**not** an answer to S-04. S-04 asks about the shared **WebAssembly** heap across multiple
ONNX Runtime Web sessions, which is a different allocator and a different failure mode.
Nothing here should be read as reducing that risk.

---

## Conclusion

**H1 is supported. Verdict: ACCEPT, with two recorded constraints.**

WebGPU is available and fully functional — adapter, device, correct compute output, clean
teardown, repeatable — in a dedicated worker inside a Chrome MV3 offscreen document, which
is exactly the context PratiBimb intends to use. On this machine the dossier's WebGPU
column survives.

Constraints attached to the acceptance:

1. **The adapter is integrated graphics** (Finding 2), so every WebGPU number measured
   here is an integrated-graphics number.
2. **Branded Chrome cannot be automated with `--load-extension`** (Finding 4), which
   affects the CI strategy for the egress interception suite.

## Reproducibility

See [`commands.md`](commands.md). Deterministic given the same Chrome build and machine;
the capability results were identical across three runs, and the latency figures are
reported as min/median/max rather than a single number precisely because the service
worker's are not stable.

**Known limits of this reproduction:** one machine, one Chrome build, one GPU pair, one
OS. Nothing here generalises to another machine, to Firefox, or to a different Chrome
channel. The feasibility matrix records the cell that was measured and no other.

## New UNKNOWNs raised

| # | Question | Blocks |
|---|---|---|
| **S-01a** | Can Chrome be made to select the discrete NVIDIA adapter, and what does that do to the numbers? | Nothing. Affects how the WebGPU column is labelled. |
| **S-01b** | Does Playwright's bundled Chromium (or Chrome for Testing) still honour `--load-extension`, so the egress interception suite can run in CI? | The Invariant E enforcement plan (QG-04) |
