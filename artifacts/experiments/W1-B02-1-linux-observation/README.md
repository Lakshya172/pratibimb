---
id: W1-B02-1
title: "B-02-1 — does the CDP + collector observation model hold on Linux?"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# B-02-1 — Invariant E observation on Linux, headful and headless

> **Machine boundary.** Every measurement below was taken **inside a WSL2 Ubuntu 26.04
> guest**. The earlier B-02 phases were **Windows-host** measurements. These are different
> cells and are never merged.

## Hypothesis

B-02 (Windows) concluded that Invariant E mechanism (2) should be **CDP `Fetch` attached via
`Target.setAutoAttach` + `waitForDebuggerOnStart`, paired with an independent loopback
collector**, and left one gap: **Linux and headless were `UNKNOWN`, and both are what CI
runs.**

**Hypothesis:** the model holds on Linux, in both headful and headless, and the
`late-attach` race behaves as it did on Windows.

## Environment

Full detail in [`environment.json`](environment.json).

| | |
|---|---|
| **Windows host** | workstation 2 — Windows 11 10.0.26200, AMD Ryzen AI 7 350 |
| **Linux guest** | **WSL2 Ubuntu 26.04**, kernel `6.18.33.2-microsoft-standard-WSL2` |
| Browser | **Chrome for Testing 153.0.8010.12** — the build Playwright 1.63.0 names for chromium v1243 |
| Modes | **headful (WSLg) and headless**, both fully tested |
| Collector | `http://127.0.0.1:8902`, independent process, recomputes SHA-256 |

### GPU state, recorded because it is easy to misread

| Signal | Value |
|---|---|
| `nvidia-smi` inside Linux | **works** — RTX 5050, 8151 MiB |
| `/dev/dri` | **absent** |
| Vulkan ICDs | **0** |
| OpenGL renderer | **`llvmpipe` — software** |

**CUDA compute is available; the graphics stack is software-only.** B-02-1 needs neither, so
this does not affect its result — it is recorded because it *does* affect S-02a, and because
"`nvidia-smi` works" must never be read as "the GPU is usable for graphics".

## Method

Two verdicts are recorded per run and **never collapsed into one**:

| Field | Values |
|---|---|
| `mechanismState` — what the instrumentation saw | `OBSERVED` · `NOT_OBSERVED` · `NOT_OBSERVABLE` · `BLOCKED_CONFIRMED` |
| `groundTruth` — what actually reached the wire, decided by the collector alone | `GROUND_TRUTH_ARRIVED` · `GROUND_TRUTH_NO_ARRIVAL` |

`BLOCKED_CONFIRMED` is only awarded when the mechanism blocked **and** the collector agrees
nothing arrived. **Absence of instrumentation is never evidence that traffic did not occur** —
that is the entire reason the two fields exist.

## Expected result

The Windows pattern reproduces: `auto-attach` blocks, `late-attach` loses the request,
Playwright-only enforcement fails, and the collector catches everything.

## Actual result — FACT

**66 runs. Every cell unanimous. Headless identical to headful in every case.**

### The five mechanism cases (§3)

| Case | Mode | `mechanismState` | `groundTruth` | false green |
|---|---|---|---|---|
| **A** authorised egress | headful / headless | `OBSERVED` 3/3 · 3/3 | ARRIVED | no |
| **B** unauthorised sender | headful / headless | `OBSERVED` 3/3 · 3/3 | ARRIVED | no |
| **C** tampered bytes | headful / headless | `OBSERVED` 3/3 · 3/3 | ARRIVED | no |
| **D** Playwright enforcing | headful / headless | **`NOT_OBSERVED` 3/3 · 3/3** | **ARRIVED** | **YES** |
| **E** CDP enforcing | headful / headless | **`BLOCKED_CONFIRMED` 3/3 · 3/3** | NO_ARRIVAL | no |

Collector detail, identical headful and headless:

- **B** — the rogue send arrived with `declared: false`: **no correlation id, no declared
  hash.** An unauthorised path is detectable from outside the browser.
- **C** — the tampered send arrived with `declared: true, hashMatches: false`. **The payload
  pin was caught by recomputing SHA-256 over the bytes that actually arrived.**

### The race (§4)

| Attach mode | headful | headless |
|---|---|---|
| `no-attach` | `NOT_OBSERVABLE` 5/5, ARRIVED | `NOT_OBSERVABLE` 5/5, ARRIVED |
| **`late-attach`** | **`NOT_OBSERVED` 5/5, ARRIVED — false green** | **`NOT_OBSERVED` 5/5, ARRIVED — false green** |
| **`auto-attach`** | **`BLOCKED_CONFIRMED` 5/5** | **`BLOCKED_CONFIRMED` 5/5** |

**The race is real on Linux exactly as on Windows, and `setAutoAttach` closes it in both
display modes.** Auto-attached target types: `browser_ui, browser_ui, page, service_worker,
other` — the offscreen document arrives as `other`.

### Injected failure cases (§4) — and the most important finding here

| Injected failure | `mechanismState` | `groundTruth` | false green |
|---|---|---|---|
| CDP endpoint unreachable | `NOT_OBSERVABLE` 3/3 | NO_ARRIVAL | no |
| **`Fetch.enable` silently skipped** | **`NOT_OBSERVED` 3/3** | **ARRIVED** | **YES** |

> ## Finding 1 — CDP auto-attach does **not** fail closed on its own
>
> When `Fetch.enable` fails while attachment still succeeds, the mechanism reports **nothing
> at all** and the payload **reaches the wire**. From CDP's point of view that is
> indistinguishable from a clean run in which no request was made.
>
> **It fails OPEN. Only the independent collector caught it.**
>
> This is the strongest evidence yet that the two mechanisms are not belt-and-braces
> redundancy but a **required pair**: the collector is what converts a fail-open
> instrumentation into a fail-closed test. §4 of the task requires fail-closed behaviour, and
> **CDP alone does not deliver it.**

By contrast, a **connection** failure is loud: `NOT_OBSERVABLE`, clearly distinguished from
silence. The dangerous failure is the *partial* one.

### Attachment timing

`swReady` 263–359 ms, `armed` (auto-attach) 277–373 ms, `firstPaused` 325–437 ms.

**Measurement limitation, recorded rather than glossed:** `offscreenAttachedMs` and
`fetchEnabledMs` were **not captured**, because the harness keyed them on the target URL
containing `offscreen.html` and the offscreen target is auto-attached as type `other` before
its URL is populated. So `instrumentationBeforeSend` is `null` — **unmeasured, not false**.
The *outcome* nevertheless demonstrates the ordering: `BLOCKED_CONFIRMED` in 10/10
auto-attach runs means the request was paused before it left. A direct timestamp comparison
would be better and is filed as a follow-up.

## Assessment — INFERENCE

| | |
|---|---|
| **Linux result** | The Windows conclusion **holds on Linux**, in both display modes, 66/66. |
| **Headless result** | **Identical to headful in every single cell.** This is the strongest CI-relevant evidence in the experiment: extensions load, CDP attaches, `Fetch` blocks, and the collector agrees. |
| **CI-relevant evidence** | Chrome for Testing 153 (Playwright's own build) loads an unpacked MV3 extension headlessly on Linux and is fully instrumentable. |
| **CI result** | **`UNKNOWN`. Not measured, and not claimed.** |

### Why the CI cell is still `UNKNOWN`

`ubuntu-latest` resolved to **`ubuntu-24.04`, image `20260831.293`** in this repository's own
most recent Actions run. This experiment ran on **Ubuntu 26.04 under WSL2** — a different
release, a different kernel, no WSLg on a runner, and no GPU. **WSL2 is not a GitHub-hosted
runner**, and the actual CI cell was not executed. Per the task, that is recorded as
`UNKNOWN` rather than inferred.

## Conclusion

**CONDITIONAL — and materially stronger than before.**

The recommended model — **CDP `Fetch` via `setAutoAttach` + `waitForDebuggerOnStart`, paired
with an independent collector** — reproduces on Linux, headful and headless, 66/66, and now
carries a measured justification for *why both halves are required*: **CDP alone fails open
under partial instrumentation failure.**

It stays CONDITIONAL because the actual CI cell is unmeasured and the adoption ADR is
unwritten.

**`docs/security/security-invariants.md` is untouched. Invariant E is unchanged. No assertion
was relaxed. QG-04 remains unsigned.**

## Reproducibility

```bash
# inside WSL2 Ubuntu
cd /root/spikes/b02
RUNS=5 node run-b02-linux.js     # -> results-linux.json
```

`harness/wslinstall.sh` provisions the guest exactly as measured. The harness contacts **no
host other than `127.0.0.1:8902`** and CDP on `127.0.0.1:9446`.

## Scope

**WSL2 Ubuntu 26.04 · Chrome for Testing 153.0.8010.12 · headful and headless.** It says
nothing about `ubuntu-24.04`, nothing about a GitHub-hosted runner, nothing about Firefox,
and nothing about the Windows host.
