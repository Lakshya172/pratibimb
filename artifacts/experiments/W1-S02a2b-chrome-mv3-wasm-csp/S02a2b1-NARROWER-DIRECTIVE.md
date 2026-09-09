---
id: W1-S02a-2b-1
title: "S-02a-2b-1 — is a narrower CSP directive accepted? No."
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: RESOLVED — 'wasm-unsafe-eval' is the only token Chrome MV3 accepts
---

# S-02a-2b-1 — there is no narrower option

## Why this was asked

S-02a-2b recorded Chrome's error verbatim:

> *"…because neither **`'wasm-eval'`** nor **`'unsafe-eval'`** is an allowed source of
> script…"*

`'wasm-eval'` permits WebAssembly compilation **without** permitting JavaScript `eval`, so it
is strictly narrower than `'wasm-unsafe-eval'`. Adopting a broader directive than necessary —
in the same manifest that carries Invariant E's `connect-src` pin — would be a poor default,
so S-02a-2b filed this as **p0 blocking the S-02a-2a ADR**.

**Hypothesis:** `'wasm-eval'` is accepted and sufficient, and the ADR should adopt it instead.

## Method

Two further extensions, identical to the others except for one manifest line:

| Variant | `extension_pages` |
|---|---|
| `ext-wasm-eval` | `script-src 'self' 'wasm-eval'; object-src 'self'` |
| `ext-unsafe-eval` | `script-src 'self' 'unsafe-eval'; object-src 'self'` |

Run on **native Windows and WSL2 Linux**, Chrome for Testing 153.0.8010.12, headless.

## Actual result — FACT

| Directive | Extension loads? | WASM compiles? |
|---|---|---|
| *(default — none declared)* | ✅ loads | ❌ **blocked** |
| **`'wasm-eval'`** | ❌ **DOES NOT LOAD** 2/2 Windows, 2/2 Linux | — |
| **`'unsafe-eval'`** | ❌ **DOES NOT LOAD** 2/2 Windows, 2/2 Linux | — |
| **`'wasm-unsafe-eval'`** | ✅ loads | ✅ **works in all three contexts** |

Failure mode, identical on both platforms:

```
TimeoutError: browserContext.waitForEvent: Timeout 30000ms exceeded
while waiting for event "serviceworker"
```

The extension's service worker **never registers**. The only difference between a loading and
a non-loading extension is that single manifest line.

## Assessment

**FACT:** with `'wasm-eval'` or `'unsafe-eval'` declared in `extension_pages`, the extension
does not load at all — no service worker, on either platform, 4 runs each.

**INFERENCE (strongly supported, not directly captured):** Chrome MV3's manifest CSP
validator **rejects these tokens**, so the extension is refused before it starts. The
inference rests on the single-line difference and the total absence of a service worker; the
browser's own manifest error string was **not** captured, and that is the one gap. It does
not change the operational conclusion.

## Conclusion — the ADR is unblocked, and simpler than feared

> **`'wasm-unsafe-eval'` is not "the first token that worked". It is the only token Chrome
> MV3 accepts for this purpose.**

The choice the S-02a-2a ADR faces is therefore **binary**:

**declare `'wasm-unsafe-eval'`, or have no WebAssembly in the extension — and therefore no
perception tier.**

There is no middle privilege level to negotiate. That *narrows* the decision rather than
widening it: the ADR no longer has to justify choosing a broader directive over a narrower
one, because no narrower one exists. What it must still justify is the directive itself, and
what constrains it — hash-pinning the WASM bytes, packaged-only origins, and whether ORT Web
requires runtime compilation at all.

**S-02a-2b-1 is RESOLVED. S-02a-2a is no longer blocked by it.**

## What is still not established

- Whether **Firefox** accepts `'wasm-eval'`. Firefox's error text did not name it, and this
  experiment was Chrome-only. **`UNKNOWN`** — but it cannot widen Chrome's options, so it does
  not block the ADR.
- Anything about **ORT Web** — **S-03**.
- Whether WASM bytes can be **hash-pinned** or restricted to packaged origins. **That is the
  ADR's real remaining question**, and it is a design question rather than a browser one.

## Reproducibility

```bash
PLATFORM_LABEL=windows-s02a2b1 CHROME_PATH='C:\Users\OMEN\cft\chrome.exe' RUNS=2 node run-s02a2b.js
PLATFORM_LABEL=linux-s02a2b1  CHROME_PATH=/opt/chrome-linux64/chrome        RUNS=2 node run-s02a2b.js
```

`harness/ext-wasm-eval/` and `harness/ext-unsafe-eval/` differ from `harness/ext-default/` in
exactly one manifest line each.
