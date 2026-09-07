---
id: W1-B02-phase2
title: "B-02 phase 2 — the CDP target-discovery race, and how to close it"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
---

# B-02 phase 2 — the race is real, and `setAutoAttach` closes it

Phase 1 recommended CDP-attached interception plus an independent collector, and listed
three things it had **not** measured. This phase measures them.

## What phase 1 left open

| # | Question |
|---|---|
| **B** | Does the CDP target-discovery race actually lose requests? |
| **C** | Does deterministic attachment (`Target.setAutoAttach` + `waitForDebuggerOnStart`) close it? |
| **D** | Does failure-to-attach look different from "nothing happened"? |
| **E** | Is any of it repeatable? |
| **A/F** | Does it hold on **Playwright's own bundled Chromium**, and is it CI-suitable? |

## The five-state classifier

Phase 1's central point was that silence is not absence. This phase encodes that as a
classifier, so no run can be recorded ambiguously:

| State | Meaning |
|---|---|
| `OBSERVED` | the mechanism saw the request |
| `NOT_OBSERVED` | the mechanism did **not** see it, **and it reached the wire** — the false green |
| `BLOCKED_CONFIRMED` | the mechanism blocked it **and the collector confirms nothing arrived** |
| `DID_NOT_OCCUR` | the sender never attempted, and nothing arrived |
| `NOT_OBSERVABLE` | the mechanism could not attach at all — **not** the same as silence |

`BLOCKED_CONFIRMED` requires the independent collector. Nothing inside the browser can
distinguish "I blocked it" from "I think I blocked it".

## Method

A second probe extension, `harness/extension-race/`, whose offscreen document **sends
immediately on script load**, before any message arrives. That is the adversarial shape for
target discovery: attach late and the send has already happened.

Three attachment modes × two browsers × five runs = **30 runs**.

## Environment

Same workstation 2 as phase 1. **Playwright's own bundled Chromium now runs here**, which
phase 1 could not achieve:

| Field | Value |
|---|---|
| Playwright | 1.63.0 |
| `msedge` | branded Microsoft Edge 152.0.4191.66 |
| `chromium-bundled` | **Chrome for Testing 153.0.8010.12** — the exact build Playwright names for `chromium` v1243 |

The bundled build was obtained from Google's official `chrome-for-testing-public` bucket
because Playwright's own CDN still returns **HTTP 400** on this network. Getting it to start
required two fixes recorded in `environment-phase2.json`: a shorter install path (the
`ms-playwright` path failed side-by-side assembly resolution) and an AppContainer ACL grant
so the sandbox could read the executable.

## Actual result — FACT

**30 runs. Every cell unanimous. Both browsers identical.**

| Browser | `no-attach` | `late-attach` | `auto-attach` |
|---|---|---|---|
| **Edge 152** | `NOT_OBSERVABLE` 5/5 | **`NOT_OBSERVED` 5/5** | **`BLOCKED_CONFIRMED` 5/5** |
| **Chrome for Testing 153** (Playwright's bundled build) | `NOT_OBSERVABLE` 5/5 | **`NOT_OBSERVED` 5/5** | **`BLOCKED_CONFIRMED` 5/5** |

### Finding 1 — the race is real, and naive CDP has Playwright's failure mode

**`late-attach` lost the request in 10 runs out of 10**, on both browsers. Polling
`Target.getTargets` and attaching after the offscreen document exists is **too late**: the
immediate send has already reached the wire, and the mechanism reports nothing.

**This is the same false green as Playwright.** Phase 1's recommendation, implemented the
obvious way, would have reproduced the exact defect B-02 exists to prevent. Recording this
is the point of the phase.

### Finding 2 — `setAutoAttach` closes it deterministically

`Target.setAutoAttach { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }`,
armed **before** the offscreen document exists, gave **`BLOCKED_CONFIRMED` in 10 runs out of
10**. New targets start paused; `Fetch.enable` is installed on the session, and only then is
`Runtime.runIfWaitingForDebugger` sent. There is no window in which bytes can leave.

Auto-attached target types: Edge `page, service_worker, other`; Chrome for Testing
`page, browser_ui ×2, service_worker, other`. The offscreen document arrives as `other`.

### Finding 3 — failure-to-attach is distinguishable from silence

`no-attach` produced `NOT_OBSERVABLE` in 10 of 10, never `NOT_OBSERVED` and never
`DID_NOT_OCCUR`, while the collector recorded the arrival every time. **A harness that
cannot attach must say so**, and this one does.

### Finding 4 — Playwright's bundled Chromium honours `--load-extension`

The extension loaded and its service worker registered in **all 15 Chrome-for-Testing runs**.
This **answers the literal S-01b question, on Windows**: Playwright's bundled build does
honour `--load-extension`; **branded Chrome 152 is the outlier**, not Chromium.

It also removes the concern that phase 1's results were an Edge quirk: **the bundled build
behaves identically, cell for cell.**

## Assessment — INFERENCE

| | |
|---|---|
| **Trust level** | High for `auto-attach`. **`late-attach` must be treated as unsafe** and named as such. |
| **Proves** | That deterministic attachment eliminates the discovery race for a target created after arming, on two Chromium browsers, 10/10 each. |
| **Does not prove** | Anything about **Linux**. Both browsers here are Windows builds. Nor about targets that exist *before* arming — the harness arms first by construction, and a suite must too. |
| **False positive risk** | Low. `BLOCKED_CONFIRMED` requires collector agreement. |
| **False negative risk** | **Low for `auto-attach`, total for `late-attach`** — measured, not estimated. |
| **Reproducibility** | **30/30 unanimous**, no flakes, no partial runs. |
| **CI suitability** | **Good, with one caveat**: every run here is **headful**. `chrome-headless-shell` sits behind the same failing CDN, so headless is **`UNKNOWN`** and CI runners are headless by default. |

## Conclusion

Phase 1's recommendation stands and is now **sharper and safer**:

> Invariant E mechanism (2) should use **`Target.setAutoAttach` with
> `waitForDebuggerOnStart`, armed before the extension can create its offscreen document**,
> paired with an independent arrival check. **Late attachment is not an acceptable
> implementation** — it reproduces the false green it was adopted to fix.

Still **CONDITIONAL**, and the remaining gap is now precisely one thing rather than three:

- ✅ **B-02-3 closed** — the race is real and `setAutoAttach` fixes it (FACT, 30/30).
- ✅ **S-01b literal question answered** on Windows — bundled Chromium honours `--load-extension` (FACT, 15/15).
- ✅ Edge-quirk concern removed — bundled Chromium behaves identically (FACT).
- ❌ **B-02-1 still open** — **Linux and headless are both `UNKNOWN`.** No Linux environment
  exists on this workstation (no WSL, no Docker).

**`docs/security/security-invariants.md` remains untouched. Invariant E is unchanged.
QG-04 remains unsigned**, and adoption still requires the **B-02-2 ADR**.

## Reproducibility

```bash
cd artifacts/experiments/W1-B02-invariant-e-observation/harness
RUNS=5 node run-b02-phase2.js                      # both browsers, 30 runs
RUNS=5 BROWSERS=msedge node run-b02-phase2.js      # Edge only
```

`BROWSERS=chromium-bundled` requires Chrome for Testing at `C:\Users\OMEN\cft\chrome.exe`;
see `environment-phase2.json` for how it was obtained and why that path.
