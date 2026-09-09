---
id: W1-S02a-2a-2
title: "Firefox MV3 CSP token vocabulary, measured in real extension contexts"
spike: S-02a-2a-2
status: complete
verdict: ACCEPT — Firefox reaches the same security conclusion as Chrome by a different failure mode
date: 2026-09-10
labels: [FACT, INFERENCE]
---

# W1-S02a-2a-2 — Firefox's CSP tokens, measured

> **Throwaway spike code, permanent evidence.** No manifest or policy was changed.
> **Run against real Firefox 155.0.1. Nothing here is inferred from Chrome or from
> documentation** — S-02a-2b-1 left Firefox explicitly `UNKNOWN` and this closes it.

---

## Hypothesis

Chrome's answer, from S-02a-2b-1 and S-02a-2a-1:

| Token | Chrome MV3 |
|---|---|
| `'wasm-eval'` | **extension does not load at all** |
| `'unsafe-eval'` | **extension does not load at all** |
| `'wasm-unsafe-eval'` | loads; permits WASM compilation **only** — `eval`, `new Function`, string-`setTimeout` stay blocked |

**H1:** Firefox behaves equivalently, so one policy serves both browsers.
**H0:** Firefox differs, and the ADR needs a browser-specific policy.

## Environment

Full record: [`environment.json`](environment.json).

| Field | Value |
|---|---|
| Browser | **Mozilla Firefox 155.0.1**, release channel, headful |
| Driver | **web-ext 8.3.0** — temporary add-on into a throwaway profile (the same tool the existing W1-S02a-2 harness uses) |
| Workstation | **1** — `LAPTOP-6E14K34L`, Win 11 `10.0.26200` |
| Scale | 4 variants × 3 runs × 2 contexts = **24 context-observations** |

Contexts: **Firefox MV3 event page**, and a **dedicated worker spawned from it**. Firefox
MV3 has no `chrome.offscreen`, so the event page *is* the background context.

The WASM bytes are **inline in the probe, not fetched**, so the CSP question is isolated
from Firefox MV3 gating `host_permissions` behind origin controls. Byte-identical to the
Chrome experiments: `sha256 f61fd62f…88ba`.

**Liveness:** an `/alive` tab beacon proves the event page executed. *"The extension did not
load"* and *"it loaded and the token blocked everything"* are completely different results
— and Chrome already showed two of these four tokens produce the first. They are never
inferred from one another here.

### Machine changes

| | |
|---|---|
| **PACKAGE** | Mozilla Firefox · **VERSION** 155.0.1 · **SOURCE** `winget Mozilla.Firefox` (installer hash verified) |
| **REASON** | Workstation 1 had no Firefox. **No Firefox result may be inferred from Chrome.** Same version as the workstation-2 cell, so the cells are comparable. |
| **IMPACT** | System-wide install; not set as default browser |
| **ROLLBACK** | `winget uninstall --id Mozilla.Firefox` |

| | |
|---|---|
| **PACKAGE** | `web-ext` · **VERSION** 8.3.0 · **SOURCE** npm |
| **REASON** | Install a temporary MV3 add-on into a throwaway profile |
| **IMPACT** | `node_modules` in this harness only; gitignored |
| **ROLLBACK** | `rm -rf artifacts/experiments/W1-S02a2a2-firefox-csp-tokens/harness/node_modules` |

## Expected result

Equivalence with Chrome — including that `'wasm-eval'` and `'unsafe-eval'` would prevent the
extension loading.

## Actual result

**24/24 unanimous. Event page and dedicated worker behave identically in every variant.**

### Extension load — the expectation was wrong

| Variant | Chrome MV3 | **Firefox MV3** |
|---|---|---|
| *(default)* | loads | **loads** |
| `'wasm-unsafe-eval'` | loads | **loads** |
| `'wasm-eval'` | **DOES NOT LOAD** | **LOADS** ✅ |
| `'unsafe-eval'` | **DOES NOT LOAD** | **LOADS** ✅ |

All four installed cleanly — `web-ext` reported *"Installed … as a temporary add-on"* with
**no manifest warning**, and the `/alive` beacon fired in every run.

### Capability matrix — event page and worker identical, 3/3 each

| Variant | `eval` | `new Function` | `setTimeout(string)` | `WebAssembly.validate` | `WebAssembly.compile` | instantiate |
|---|---|---|---|---|---|---|
| *(default)* | blocked | blocked | blocked | **allowed** | blocked | — |
| **`'wasm-unsafe-eval'`** | blocked | blocked | blocked | allowed | **ALLOWED** | **`add(2,3)=5`** |
| `'wasm-eval'` | blocked | blocked | blocked | **allowed** | **blocked** | — |
| `'unsafe-eval'` | blocked | blocked | blocked | **allowed** | **blocked** | — |

Firefox error text, verbatim:

```
call to eval() blocked by CSP
call to WebAssembly.compile() blocked by CSP
```

Three findings inside that table:

1. **Only `'wasm-unsafe-eval'` enables WebAssembly.** `'wasm-eval'` and `'unsafe-eval'` are
   **accepted but inert**: the extension loads, and WASM stays blocked.
2. **`'unsafe-eval'` does not enable `eval` either.** Firefox MV3 refuses to honour it in
   `extension_pages` at all — declaring it buys nothing and breaks nothing.
3. **`WebAssembly.validate()` is permitted in every variant, including the default.**
   Validation parses without compiling to machine code, so it is not gated. **`validate`
   succeeding is not evidence that `compile` will** — a distinction worth keeping, because
   a capability probe that only called `validate` would report WASM as available when it
   is not.

### The security-critical answer is the same as Chrome

**`'wasm-unsafe-eval'` never widened a JavaScript execution sink in any Firefox variant or
context.** `eval`, `new Function` and string-`setTimeout` were blocked 24/24 — exactly as
on Chromium and Edge.

---

## Conclusion

**H1 is supported on the question that matters, and H0 on the failure mode.**

> **One policy serves both browsers: declare `'wasm-unsafe-eval'`. It is the only token
> that enables WebAssembly on either engine, and on neither engine does it widen
> JavaScript execution.**

**But the failure modes differ, and that is operationally important:**

| Wrong token | Chrome | Firefox |
|---|---|---|
| `'wasm-eval'` / `'unsafe-eval'` | **extension dead** — no service worker, loudly broken | **extension alive, WASM silently absent** |

A misconfiguration that is instantly obvious on Chrome is **silent on Firefox** — the
perception tier would simply never run, with no load error to explain why. **INFERENCE for
the ADR:** the CSP directive should be asserted at runtime rather than trusted, and a
startup capability check should distinguish *"WASM blocked"* from *"WASM missing"* — the
`validate`-vs-`compile` split above is exactly the trap such a check could fall into.

## Reproducibility

See [`commands.md`](commands.md). 24/24 unanimous.

**Limits:** Windows only — **Firefox on Linux is a separate cell and remains `UNKNOWN`**
(S-02a-1). Release channel only. This measures the CSP token vocabulary, **not** ORT Web,
and not `connect-src` provenance on Firefox.

**Recorded imperfection:** the payload field `reportedVia` is always `null` — it is assigned
after the payload is serialised. The collector's own `__via` tag carries the truth: **all 24
reports arrived via `fetch`**. Cosmetic; it affects no finding, and is recorded rather than
tidied away.

## New UNKNOWNs raised

| # | Question | Blocks |
|---|---|---|
| S-02a-2a-2a | Does the same token behaviour hold on **Firefox for Linux**? | The judging-configuration story |
| S-02a-2a-2b | Does a startup capability check reliably distinguish *WASM blocked* from *WASM absent* on Firefox, given `validate` succeeds either way? | Fail-closed startup behaviour |
| S-02a-2a-4b | Does **`connect-src`** bound WASM provenance on Firefox as it does on Chromium? | Cross-browser parity of Invariant E mechanism (3) |
