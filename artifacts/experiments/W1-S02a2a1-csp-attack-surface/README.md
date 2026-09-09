---
id: W1-S02a-2a-1
title: "What 'wasm-unsafe-eval' actually enables, WASM provenance, and hash-pinning"
spike: S-02a-2a-1
status: complete
verdict: ANSWERED — three facts the CSP ADR needed. The ADR itself is NOT decided here.
date: 2026-09-09
labels: [FACT, INFERENCE]
---

# W1-S02a-2a-1 — the three facts the CSP ADR was missing

> **Throwaway spike code, permanent evidence.** `harness/` is not product code.
> **This experiment measures. It does not decide.** Adopting a CSP directive changes the
> extension manifest that also carries Invariant E's `connect-src` pin, which is a §26
> decision boundary. The ADR is drafted for human approval, not approved here.

---

## Hypothesis

Issue #17 (P0) records that **default MV3 CSP blocks WebAssembly on both Chrome and
Firefox**, so PratiBimb's entire perception tier — ONNX Runtime Web and Transformers.js —
has no execution path at stock settings. S-02a-2b-1 then established that
**`'wasm-unsafe-eval'` is the only token Chrome MV3 accepts**: `'wasm-eval'` and
`'unsafe-eval'` stop the extension loading at all.

So the ADR has no narrower privilege to choose. What it still has to justify is the
directive itself, and issue #17 lists the open questions. Three of them are measurable
rather than decidable, and this experiment measures them.

| | Question | Why the ADR needs it |
|---|---|---|
| **Q1** | Does `'wasm-unsafe-eval'` also unlock JavaScript `eval`, `new Function`, or string-`setTimeout`? | **INV-15** forbids arbitrary JavaScript execution and **INV-16** forbids `eval`. If the token widened those, adopting it would conflict with a frozen invariant. |
| **Q2** | May WASM bytes come from the **network**, or only from the packaged extension? | The same manifest pins `connect-src` for Invariant E. If the CSP token does not constrain provenance, something else must. |
| **Q3** | Can the bytes be **hash-pinned** before instantiation, the way the egress payload is pinned under INV-02/INV-03 — and does the pin actually *refuse* a tampered module? | S-02a-2b-1 names this as *"the ADR's real remaining question"*. |

**H1:** `'wasm-unsafe-eval'` is narrow (WASM only), provenance is *not* constrained by it,
and hash-pinning is implementable in all three MV3 contexts.

## What this experiment does NOT establish

- Whether PratiBimb **should** declare the directive. That is the ADR (S-02a-2a).
- Anything about **Firefox**. Chromium-family only.
- Anything about **ORT Web's** own loader — S-03 established it runs under the directive
  with runtime and model both packaged; how ORT resolves its `.wasm` internally is not
  re-measured here.
- Whether the CI browser behaves identically. Neither browser used is the CI binary.

---

## Environment

Full record: [`environment.json`](environment.json).

| Field | Value |
|---|---|
| Workstation | **workstation 1** — `LAPTOP-6E14K34L`, OMEN 16-am0xxx, Win 11 `10.0.26200`, Intel Core 7 240H |
| Browser A | **unbranded Chromium 151.0.7922.34** (Playwright cache build 1234) |
| Browser B | **branded Microsoft Edge 152.0.4191.66** (Playwright `channel: msedge`) |
| Not used | Branded Google Chrome 152 — **refuses `--load-extension`** (W1-S01 finding C1) |
| Mode | **Headful.** The headless *shell* cannot load extensions at all, so a headless run would measure the shell rather than the CSP. |
| Runs | **3 per browser per variant**, 2 variants, 3 contexts = **36 context-observations** |
| Extension | MV3, unpacked, loaded via `--load-extension` |

### Machine change recorded

| | |
|---|---|
| **PACKAGE** | `playwright` |
| **VERSION** | `1.63.0` — the same version used by W1-S01b and W1-S02a-2b |
| **SOURCE** | npm registry, `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` |
| **REASON** | Drive a Chromium build that honours `--load-extension` |
| **IMPACT** | `node_modules` inside this harness directory only; gitignored. No global install, **no browser downloaded** |
| **ROLLBACK** | `rm -rf artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness/node_modules` |

> **Playwright's own browser download failed on this machine** —
> `npx playwright install chromium` → `Download failure, code=1`. This is **the same
> symptom W1-S01b recorded on workstation 2**, now reproduced on workstation 1, so it is a
> property of this network/account rather than of that machine. Browsers already present
> were used instead. Recorded because S-01b-1 depends on Playwright's own Chromium.

## Method

Two extension variants differing in **exactly one manifest line**:

| Variant | `content_security_policy.extension_pages` |
|---|---|
| `ext-default` | *(absent — browser default)* |
| `ext-wasm-unsafe-eval` | `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` |

One probe file (`harness/probe.js`) loaded **verbatim** into all three contexts — MV3
service worker, `chrome.offscreen` document, and a **dedicated worker inside the offscreen
document** (PratiBimb's real inference context) — so any difference is attributable to the
context, not the code.

Fixtures are two hand-built 41-byte WASM modules, verified in Node before use:
`add.wasm` computes `add(2,3)=5`; `add-tampered.wasm` differs by **one byte**
(`i32.add`→`i32.sub`) and computes `-1`, so the tamper is semantically real rather than
cosmetic. Both are synthetic; no real data anywhere.

---

## Expected result

| | Expectation | Basis |
|---|---|---|
| Q1 | `'wasm-unsafe-eval'` permits WASM only | Chrome's own error text names `'wasm-eval'` and `'unsafe-eval'` as *separate* tokens |
| Q2 | **Uncertain.** Possibly packaged-only. | The directive's name says nothing about origin |
| Q3 | Pinning should work — `crypto.subtle` is not CSP-gated | Inference, untested |

## Actual result

**36/36 context-observations unanimous. Chromium and Edge agree on every cell.**

### Q1 — attack surface

| Sink | `ext-default` | `ext-wasm-unsafe-eval` |
|---|---|---|
| `eval("1+1")` | **blocked** 3/3 all contexts | **blocked** 3/3 all contexts |
| `new Function("return 1+1")()` | **blocked** 3/3 | **blocked** 3/3 |
| `setTimeout("<string>")` | **blocked** 3/3 | **blocked** 3/3 |
| `WebAssembly.compile` (packaged) | **blocked** 3/3 | **ALLOWED** 3/3 |

Blocked-JS error, identical in both variants:

```
Evaluating a string as JavaScript violates the following Content Security Policy
directive because 'unsafe-eval' is not an allowed source of script
```

> **`'wasm-unsafe-eval'` changes exactly one thing: WebAssembly compilation. It does not
> widen any JavaScript execution sink.**

### Q2 — provenance

| | `ext-default` | `ext-wasm-unsafe-eval` |
|---|---|---|
| `fetch()` network bytes | ALLOWED 3/3 | ALLOWED 3/3 |
| `WebAssembly.compile(network bytes)` | **blocked** 3/3 | **ALLOWED** 3/3 |
| `WebAssembly.instantiateStreaming(fetch(network))` | **blocked** 3/3 | **ALLOWED** 3/3 |

> **The CSP directive imposes no provenance restriction at all.** Under
> `'wasm-unsafe-eval'`, bytes fetched from the network compile and instantiate exactly as
> freely as packaged bytes, by both the buffer and the streaming API. Under the default
> CSP the *fetch* still succeeds — it is **compilation** that is blocked, not retrieval.

### Q3 — integrity

| | Result |
|---|---|
| Clean bytes: digest == pin → compile | **succeeds** 3/3, all contexts, both browsers. `add(2,3)=5`, digest `f61fd62f…88ba` |
| Tampered bytes: digest != pin → refuse | **pin refused** 3/3, all contexts, both browsers. Digest `51851cf8…` |
| Would the tampered module have run if the pin were bypassed? | **Yes — it computes `-1`** under `'wasm-unsafe-eval'` |

> The pin is **load-bearing, not decorative**: the module it refuses is one the browser
> would otherwise have executed. `crypto.subtle.digest` works in all three contexts and is
> unaffected by the CSP.

### Incidental finding — `chrome.*` is not available in a dedicated worker

`chrome.runtime.getURL()` is **undefined inside the dedicated worker** (`chromeApiAvailable: false`,
36/36). Packaged assets must be addressed by **relative URL**, or the URL passed in from
the offscreen document. This is a **FACT about PratiBimb's actual inference context** and
belongs in the perception-tier design; it is not a CSP finding.

---

## Corrections made during the experiment

All three would have produced a wrong record, and one would have been a **false security
finding**. Recorded rather than quietly fixed.

**C1 — `setTimeout(string)` was reported ALLOWED when it was blocked.** A CSP violation
here does **not throw** — the string silently never executes. The first probe tested
*"did `setTimeout` throw"*, which reports ALLOWED for a blocked sink. Now it sets a flag
inside the string and checks the flag actually became `true`. **Before the fix this
experiment would have reported an eval-equivalent sink as open under the default CSP.**

**C2 — `chrome is not defined` in the dedicated worker** made Q2 and Q3 unanswerable in
the most important context, showing as `packaged fetch failed` — which looked like a CSP
result. Fixed with a relative-URL fallback; the cause became the incidental finding above.

**C3 — `extensionLoaded: false` for extensions that had loaded fine.**
`waitForEvent("serviceworker")` misses a worker that registered before the listener
attached. Now checks `ctx.serviceWorkers()` first. An unloaded extension and a fully
blocked one look identical at the collector, so this flag has to be right.

---

## Conclusion

**H1 is supported on both counts that matter, and Q2 came back the more permissive way.**

1. **The directive is narrow.** `'wasm-unsafe-eval'` unlocks WebAssembly compilation and
   nothing else. **Adopting it does not violate INV-15 or INV-16.** That is the single
   most important input the ADR was missing.
2. **The directive does not constrain provenance.** Network-origin WASM compiles freely
   under it. **Provenance must therefore be constrained by something else** — and in this
   manifest the only such control is `connect-src`, which is **Invariant E enforcement
   mechanism (3)**. The CSP decision and Invariant E are coupled through one file.
3. **Hash-pinning is implementable and load-bearing** in all three contexts, on both
   browsers, and refuses a module the browser would otherwise have run.

**INFERENCE, for the ADR to weigh rather than for this experiment to settle:** a defensible
posture is *declare `'wasm-unsafe-eval'`, keep `connect-src` pinned to the configured
server origin, package the WASM, and hash-pin the bytes before instantiation* — because
(1) makes the directive narrow, (2) shows the directive alone is insufficient, and (3)
shows the compensating control works. **That is a recommendation, not a decision.**

## Reproducibility

See [`commands.md`](commands.md). Deterministic: 36/36 observations unanimous, two
independent browsers.

**Limits:** one machine, one OS, Chromium-family only, and neither browser is the CI
binary. Nothing here transfers to Firefox — Firefox's CSP token vocabulary was not tested
and S-02a-2b-1 explicitly left it `UNKNOWN`.

## New UNKNOWNs raised

| # | Question | Blocks |
|---|---|---|
| **S-02a-2a-2** | Does Firefox accept `'wasm-unsafe-eval'`, and is it equally narrow there? | Cross-browser parity of the ADR |
| **S-02a-2a-3** | Does ORT Web load its `.wasm` by a URL we control, so a pin can be inserted *before* its own instantiation without patching the library? | Whether recommendation (3) is implementable against the real runtime |
| **S-02a-2a-4** | Does `connect-src` pinned to the server origin actually prevent fetching WASM from any other origin, in all three contexts? | Whether mechanism (3) really is the provenance control |
