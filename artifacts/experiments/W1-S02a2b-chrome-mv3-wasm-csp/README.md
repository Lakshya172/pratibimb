---
id: W1-S02a-2b
title: "S-02a-2b — Chrome MV3 blocks WebAssembly too"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: REJECT at defaults — CONDITIONAL with a manifest CSP change
---

# S-02a-2b — Chrome MV3 and the WASM CSP

> ## The headline
> **This is not a Firefox problem.** Chrome MV3 blocks WebAssembly compilation by default in
> **all three** extension contexts — service worker, offscreen document, and the dedicated
> worker inside it — on **Linux and Windows**, **headful and headless**.
>
> **S-02a-2a is therefore a project-wide p0, not a Firefox workaround.**

## Hypothesis

S-02a-2 found `WebAssembly.compile()` blocked by CSP in the Firefox MV3 event page, and
filed S-02a-2b with an explicit instruction not to assume Chrome behaves the same way.

**Hypothesis:** Chrome MV3 permits WebAssembly by default, making this a Firefox-specific
problem with a Firefox-specific fix.

**The hypothesis is wrong.**

## Environment

| | Linux | Windows |
|---|---|---|
| Host / guest | WSL2 Ubuntu 26.04, kernel `6.18.33.2` | Windows 11 10.0.26200, **native** |
| Browser | **Chrome for Testing 153.0.8010.12** | **Chrome for Testing 153.0.8010.12** |
| Runs | 4 variants × 3 runs × 3 contexts | 4 variants × 2 runs × 3 contexts |

Windows was measured specifically to establish this is **a Chrome MV3 behaviour and not
something peculiar to WSL2**.

The probe, the kernel bytes and the workload are **identical to S-02a-2**, so the Firefox
and Chrome cells are directly comparable.

## Method

Two extensions differing in **exactly one line** — one declares no CSP, the other declares
`script-src 'self' 'wasm-unsafe-eval'`. Each probes three contexts:

1. the MV3 **service worker**
2. the **`chrome.offscreen` document**
3. a **dedicated worker inside the offscreen document** — the context
   `docs/architecture/constitution.md` §5 assigns inference to

## Expected result

Chrome permits WASM by default; only Firefox needs a change.

## Actual result — FACT

### Every context, every platform, every display mode

| Variant | Service worker | Offscreen document | Offscreen dedicated worker |
|---|---|---|---|
| **default CSP** (Linux, headful + headless) | **BLOCKED** 3/3 | **BLOCKED** 3/3 | **BLOCKED** 3/3 |
| **default CSP** (Windows, headful + headless) | **BLOCKED** 2/2 | **BLOCKED** 2/2 | **BLOCKED** 2/2 |
| `wasm-unsafe-eval` (Linux, headful + headless) | works 3/3 | works 3/3 | works 3/3 |
| `wasm-unsafe-eval` (Windows, headful + headless) | works 2/2 | works 2/2 | works 2/2 |

The exact error, identical in all three contexts:

```
CompileError: WebAssembly.compile(): Compiling or instantiating WebAssembly module
violates the following Content Security policy directive because neither 'wasm-eval'
nor 'unsafe-eval' is an allowed source of script in the following Content Security
Policy directive: "script-src 'self'".
```

With `'wasm-unsafe-eval'` declared: scalar **and** SIMD element-exact, **0 mismatches**, in
every context and platform.

## Findings

**Finding 1 — the restriction is cross-browser.** Chrome MV3 and Firefox MV3 both refuse
WebAssembly compilation under their default extension CSP. **The perception tier has no
working execution path in either browser at stock settings.** S-02a-2a stops being a
Firefox accommodation and becomes a decision the project cannot ship without.

**Finding 2 — it is not platform-specific.** Identical on native Windows and on Linux, so
it is a property of Chrome MV3's CSP, not of an environment.

**Finding 3 — Chrome's error names a narrower directive than the one we tested.** Chrome
says *"neither `'wasm-eval'` nor `'unsafe-eval'`"*. **`'wasm-eval'` is narrower than
`'unsafe-eval'`** — it permits WebAssembly compilation without permitting JavaScript
`eval`. This is directly relevant to S-02a-2a: the security question may not be a binary
between "blocked" and "arbitrary eval". **Which token Chrome MV3 actually accepts in
`content_security_policy.extension_pages`, and whether Firefox accepts the same, was not
tested here** — filed as **S-02a-2b-1**.

**Finding 4 — a cross-browser asymmetry that changes the WASM budget.**

| | `SharedArrayBuffer` | `crossOriginIsolated` | threads usable |
|---|---|---|---|
| **Chrome MV3** (all 3 contexts, both platforms) | **`true`** | `false` | **YES** |
| **Firefox MV3** event page (S-02a-2) | **`false`** | `false` | **NO** |

**Chrome extension contexts get `SharedArrayBuffer` without cross-origin isolation;
Firefox does not.** ORT Web's WASM backend uses threads for performance, so on current
evidence **multi-threaded WASM is available on Chrome and unavailable on Firefox**.

That is not a footnote. It means **the WASM budget is not one budget** — it is potentially
a threaded Chrome number and a single-threaded Firefox number, and the dossier publishes
one. Filed as **S-02a-2c** (already open) and reinforced here.

**Finding 5 — SIMD is available everywhere tested**, and produces element-exact output.

### Timings — recorded, and not to be over-read

Chrome, `wasm-unsafe-eval`, per context: compile 0.3–0.8 ms, cold 0.4–1.1 ms,
**warm p50 0.1–0.4 ms**.

Chrome reports finer timer resolution than Firefox (which read 0 ms for the same kernel).
**This is a trivial integer kernel, not a model**, and says nothing about ORT Web
throughput. It is recorded for reproducibility, not for any budget.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Does Chrome MV3 block WASM by default? | **FACT — yes**, all three contexts, both platforms, both display modes |
| Is this Firefox-specific? | **FACT — no** |
| Is it WSL-specific? | **FACT — no** |
| Does `'wasm-unsafe-eval'` fix it? | **FACT — yes**, fully |
| Is a narrower directive available? | **`UNKNOWN`** — Chrome's error names `'wasm-eval'`; untested. **S-02a-2b-1** |
| Are WASM threads available? | **FACT — yes on Chrome, no on Firefox.** A real asymmetry |
| Does this tell us ORT Web works? | **No. `UNKNOWN` — that is S-03.** |

## Conclusion

**REJECT at defaults; CONDITIONAL with a manifest CSP change — on both browsers.**

The finding S-02a-2 recorded for Firefox is **general**. Neither Chrome nor Firefox will
compile WebAssembly in an extension context under the default MV3 CSP, and PratiBimb's
entire perception tier is WebAssembly.

**This does not change what must happen next; it changes its scope and its urgency.**
S-02a-2a — the CSP decision — was filed as a Firefox p0. It is a **project p0**: without
it there is no perception tier on any browser.

**Nothing was adopted. No CSP was edited anywhere. `docs/security/security-invariants.md`
and `docs/architecture/constitution.md` are untouched. QG-04 remains unsigned.**

## What this does NOT establish

- **ORT Web.** Not tested. **S-03.** A compiling WASM substrate does not imply ORT Web
  initialises, allocates, or runs a model.
- **Which CSP token is minimal.** `'wasm-eval'` vs `'wasm-unsafe-eval'` vs `'unsafe-eval'`
  — Chrome's error names the first, and it was not tested. **S-02a-2b-1.**
- **Whether threads help.** `SharedArrayBuffer` being present on Chrome is not evidence
  that ORT Web's threaded backend works or is faster.
- Any model cell, any latency budget, anything about native Linux.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| ~~S-02a-2b-1~~ | ~~Is `'wasm-eval'` accepted?~~ **RESOLVED — NO.** `'wasm-eval'` and `'unsafe-eval'` both make the extension fail to load, both platforms. **`'wasm-unsafe-eval'` is the only accepted token.** See `S02a2b1-NARROWER-DIRECTIVE.md`. | ✅ | — |
| S-02a-2b-2 | Confirm the Chrome/Firefox `SharedArrayBuffer` asymmetry survives on native Linux and on a real judging machine | **p1** | The WASM budget |

## Reproducibility

```bash
# Linux
PLATFORM_LABEL=linux-wsl2 CHROME_PATH=/opt/chrome-linux64/chrome RUNS=3 node run-s02a2b.js
# Windows
PLATFORM_LABEL=windows CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=2 node run-s02a2b.js
```

`harness/ext-default/` and `harness/ext-wasm-csp/` differ in exactly one manifest line. The
harness contacts no host other than `127.0.0.1:8905`.

## Scope

**Chrome for Testing 153.0.8010.12 · MV3 · three extension contexts · Linux (WSL2) and
native Windows · headful and headless.** Says nothing about branded Chrome, Edge, native
Linux, ORT Web, or any model.
