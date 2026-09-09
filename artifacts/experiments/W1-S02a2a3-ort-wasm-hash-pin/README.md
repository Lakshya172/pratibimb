---
id: W1-S02a-2a-3
title: "Can the SHA-256 pin bind the exact ORT Web .wasm bytes to the bytes executed?"
spike: S-02a-2a-3
status: complete
verdict: CONDITIONAL — the binding is PROVEN, under three named architecture constraints
date: 2026-09-10
labels: [FACT, INFERENCE]
---

# W1-S02a-2a-3 — ORT Web WASM provenance and hash-pin feasibility

> **Throwaway spike code, permanent evidence.** `harness/` is not product code.
> **No manifest, CSP, egress policy or security-critical runtime behaviour was changed.**
> ADR-0001 remains `PROPOSED`.

---

## Hypothesis

ADR-0001 §7.3 proposes hash-pinning the WASM bytes, and marks it **conditional on
S-02a-2a-3**: whether ORT Web exposes its `.wasm` so a pin can precede its own
instantiation without patching the library.

**The bar is not "can we hash the file".** It is:

> **EXACT BYTES HASHED == EXACT BYTES EXECUTED**

**H1:** PratiBimb can obtain, hash and verify the exact artifact, and prove ORT executed
those bytes and no others.
**H0:** ORT owns the fetch/compile boundary in a way that prevents the binding.

## What makes the binding provable rather than asserted

Three design decisions, all load-bearing:

1. **The `.wasm` is deliberately NOT packaged in the extension.** It exists only on an
   arrival-logged loopback origin. If ORT ever loads WebAssembly without our buffer it
   **must** fetch, and that fetch **must** appear in the log. A packaged copy would make
   "zero arrivals" ambiguous.
2. **Attribution by header.** Our fetches carry `x-pratibimb-probe`; ORT's do not. An
   **untagged** artifact request is, by construction, ORT's.
3. **A tamper control.** Handing ORT deliberately corrupted bytes must make session
   creation **fail**. Without this, "no arrivals + session works" is equally consistent
   with ORT holding a cached or embedded copy.

**Isolation requirement, learned the hard way:** ORT initialises its WebAssembly module
**once per JS realm** and caches it. Each scenario therefore runs in a **fresh dedicated
worker**. See *Corrections* — an earlier version ran all scenarios in one realm and
produced a false result.

---

## Environment

Full record: [`environment.json`](environment.json).

| Field | Value |
|---|---|
| Workstation | **1** — `LAPTOP-6E14K34L`, Win 11 `10.0.26200` |
| **ORT Web** | **`onnxruntime-web@1.29.0`**, bundle **`ort.all.min.js`** |
| Browser measured | unbranded **Chromium 151.0.7922.34** (Playwright, headful) |
| Browser **NOT** measured | **Firefox 155.0.1** — see *Firefox coverage* below. **No Firefox result is claimed.** |
| Origins | `127.0.0.1:8910` collector *(in `connect-src`)* · `127.0.0.1:8911` foreign *(not in `connect-src`)* |
| Harness CSP | `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8910` |
| Model | the **same 174-byte model as W1-S03**, `y = x*2+1` over `float32[1,262144]`, verified element-by-element |
| Threads | `numThreads = 1`, `proxy = false` — deterministic; no worker-spawn fetch path |

## Q1 — the artifact resolution path, measured

| | |
|---|---|
| **Artifact ORT actually loads** | **`ort-wasm-simd-threaded.jsep.wasm`** |
| **Bytes** | **27,797,172** |
| **SHA-256** | **`db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea`** |
| Glue (packaged) | `ort-wasm-simd-threaded.jsep.mjs` |
| Artifact **not** loaded | `ort-wasm-simd-threaded.wasm` — `ec8580a9…c109a4d` |

**`ort.all.min.js` selects the JSEP build even for the `wasm` execution provider.**
Measured, not assumed: the first run failed with

```
no available backend found. ERR: [wasm]
TypeError: Failed to fetch dynamically imported module:
http://127.0.0.1:8910/ort-wasm-simd-threaded.jsep.mjs
```

**Two consequences that belong in the ADR:**

- **The bundle you ship determines which artifact you must pin.** A different ORT bundle
  loads a different `.wasm` with a different hash. The pin is bundle-specific.
- **ORT resolves its glue with a dynamic `import()`, which MV3 governs through
  `script-src`, not `connect-src`.** Under `script-src 'self'` the `.mjs` can only come
  from the extension's own origin, so **the glue must be packaged** — it cannot be pinned
  by hash at runtime the way the `.wasm` can, and `connect-src` does not constrain it.

`wasmPaths` accepts an object form — `{ mjs, wasm }` — which is what makes this workable:
the glue points at the packaged copy, and only the `.wasm` location is a variable.

> `chrome.runtime.getURL` is **undefined inside a dedicated worker** (W1-S02a-2a-1), so the
> glue URL is resolved with `new URL(MJS_FILE, location.href)`, which works in both contexts.

## Q2–Q4 — obtain, hash, compare

`ort.env.wasm.wasmBinary` (`ArrayBufferLike | Uint8Array`) is documented as *"a custom
buffer which contains the WebAssembly binary; if set, `wasmPaths` will be ignored"*. That
is documentation, and documentation is `UNKNOWN` here until observed — so it was measured.

**Measured:** the artifact is fetched by PratiBimb, hashed with `crypto.subtle.digest`,
compared to the pin, and only then handed to ORT. Session creation succeeds and the
inference is element-exact. **3/3 runs, both Chromium contexts.**

---

## Expected result

| | Expectation |
|---|---|
| Pin computable | yes |
| **Binding provable** | **uncertain — the actual question** |
| ORT re-fetch despite `wasmBinary` | uncertain |
| Silent fallback on missing artifact | uncertain, and security-relevant |

## Actual result — Chromium 151, 3 runs, unanimous

| # | Scenario | Session | Ground truth |
|---|---|---|---|
| **s1** | fetch + hash | — | `matchesPin: true` 3/3, 27,797,172 bytes |
| **s2** | **pinned `wasmBinary`** | **created, `correct: true`, 0 mismatches** | **0 untagged ORT fetches** |
| **s3** | **tampered `wasmBinary`** | **FAILED** — `CompileError: WebAssembly.instantiate()` | **0 untagged ORT fetches** — no replacement sought |
| **s4** | ORT owns the fetch | created, correct | **1 untagged fetch** of the real artifact |
| **s5** | missing artifact | FAILED | **3 untagged fetches** of `/no-such-file.wasm`; `fellBackSilently: false` |
| **s6** | foreign origin | FAILED | **0 arrivals at the foreign origin** |
| **s7** | second load | **both sessions succeeded** | **0 additional untagged fetches** |

**Ground-truth totals over 3 runs:** 27 `.wasm` arrivals — **15 ours, 12 ORT's**, and every
one of ORT's is attributable:

```
/ort-wasm-simd-threaded.jsep.wasm   x3   <- s4 only, one per run
/no-such-file.wasm                  x9   <- s5 only, three retries per run
foreign-origin arrivals             x0
```

> **ORT made ZERO untagged fetches of the real artifact in s2, s3 and s7 — the pinned
> scenarios.** The artifact is not packaged, so there was nowhere else to get bytes from.

### The binding

| Evidence | Result |
|---|---|
| Artifact packaged locally? | **No** — only on the arrival-logged origin |
| ORT fetches in pinned scenarios? | **Zero**, 3/3 |
| Do tampered bytes break the session? | **Yes** — genuine `CompileError` from the WASM compiler |
| Does a second session re-fetch? | **No** — module reused, still no fetch |

**The tamper control is what closes it.** If ORT had ignored our buffer, corrupt bytes
could not have caused a `WebAssembly.instantiate()` compile error. The bytes we hashed
determined the outcome.

> **EXACT BYTES HASHED == EXACT BYTES EXECUTED — demonstrated, not asserted.**

### Q8 negative controls

| Case | Behaviour |
|---|---|
| expected artifact + expected hash | session created, output element-exact |
| **hash mismatch** | our gate refuses **before** ORT is invoked — `refused: true`, fail closed |
| **unexpected bytes, expected origin** | `CompileError`; ORT does **not** fetch a replacement |
| **same bytes, unexpected origin** | our fetch blocked by `connect-src`; ORT's attempt fails with `NetworkError`; **0 foreign arrivals** |
| **missing artifact** | fails after **3 retries**. **`fellBackSilently: false`** — no silent fallback |
| **second/subsequent load** | pinned module reused; no re-fetch |
| **ORT fallback behaviour** | none observed that bypasses the pin |

---

## Firefox coverage — NOT MEASURED, and not inferred

**This experiment's result is a Chromium result. Firefox is `UNKNOWN` for S-02a-2a-3.**

A Firefox runner exists (`harness/run-s02a2a3-firefox.js`, reusing the W1-S02a-2 `web-ext`
pattern) and the Firefox extension is built, but **no valid Firefox measurement was
obtained in this session.** The committed
`logs/results-s02a2a3-windows-ws1-firefox-155.json` records a **failed** attempt —
`aliveBeacon: false`, zero contexts reporting, zero arrivals — and is kept as evidence of
that failure rather than deleted.

Two causes were found and fixed, and they are the reason the record is preserved:

1. **`web-ext` was copied between harness directories instead of installed**, so its
   transitive dependencies were missing:
   `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'camelcase'`. The add-on therefore
   never installed, and the event page never ran. Fixed by a real
   `npm install web-ext@8.3.0`.
2. **Leaked Firefox processes.** `web-ext` spawns Firefox as a grandchild, so killing the
   wrapper left it running — **189 live processes** were observed accumulating across
   runs. The runner now issues an explicit `taskkill /F /IM firefox.exe /T`.

**`aliveBeacon: false` is exactly why that beacon exists.** Without it, "the extension
never installed" would have been indistinguishable from "ORT could not load WebAssembly in
Firefox" — and the second reading would have been a fabricated limitation.

> **The Chromium result is NOT generalised to Firefox.** Firefox has a different CSP
> failure mode (W1-S02a-2a-2), no `chrome.offscreen`, and its own dynamic-`import()`
> behaviour. Whether the `wasmBinary` binding holds there is **`UNKNOWN`** and is tracked
> as **S-02a-2a-3d**.

## Corrections made during the experiment

Three, all recorded rather than tidied away. Each would have produced a wrong answer.

**C1 — a false "binding supported".** The first version ran all seven scenarios in one JS
realm. Every scenario failed with the same unrelated error (missing `.jsep.mjs` glue), and
the tamper scenario's canned interpretation therefore announced *"ORT FAILED on corrupt
bytes → binding supported"* — **a true conclusion reached by a false route**. Fixed by
running one scenario per fresh worker, and by recording error text verbatim so a failure
can be attributed rather than assumed.

**C2 — wrong artifact.** The harness initially pinned `ort-wasm-simd-threaded.wasm`. ORT's
own error revealed that `ort.all.min.js` loads the **jsep** build. Had this gone unnoticed
the experiment would have pinned a file the runtime never loads — a pin that verifies
nothing while appearing to work.

**C3 — a deleted worker generator.** A patch removed the Chrome `worker.js` builder, so
`new Worker()` 404'd and every worker scenario reported `fatal: "undefined"`. It looked
like an ORT limitation. Fixed, and the worker now reports its own load failures, because a
worker that dies silently is indistinguishable from a scenario that failed.

---

## Conclusion — CONDITIONAL

**The binding is PROVEN. The classification is CONDITIONAL because it holds only under
three architecture constraints that must be stated, not assumed.**

This is **not** a downgraded ACCEPT. The mechanism works and is demonstrable. But it is not
free-standing: it depends on constraints PratiBimb must actively adopt and keep.

| # | Constraint | If violated |
|---|---|---|
| **C-1** | `ort.env.wasm.wasmBinary` **must be set before the first session in each JS realm.** ORT caches per realm. | A realm that creates a session first is unpinned, permanently |
| **C-2** | The pin is **bundle- and artifact-specific**. `ort.all.min.js` → `…jsep.wasm`. | A bundle change silently pins a file the runtime never loads |
| **C-3** | The pin covers the **`.wasm` only**. The `.mjs` glue is loaded by dynamic `import()`, governed by `script-src`, and **must be packaged**. | The glue is unpinned; its provenance rests on packaging alone |

**Every context that runs inference needs its own pinned initialisation** — this is a
per-realm property, not a per-extension one.

## Reproducibility

See [`commands.md`](commands.md). 3 runs, unanimous.

**Limits:** **Chromium only — Firefox is `UNKNOWN` (S-02a-2a-3d)**; one machine; `numThreads = 1` throughout (multi-threaded ORT spawns workers
that may fetch additional assets — **not covered**); the **`wasm` EP only**, not WebGPU;
origins differ by **port**, not host.

## New UNKNOWNs raised

| # | Question | Blocks |
|---|---|---|
| S-02a-2a-3a | Does the binding hold with `numThreads > 1`, where ORT spawns its own workers? | Threaded WASM performance path |
| S-02a-2a-3b | Does the **WebGPU** EP touch additional resources beyond the jsep artifact? | Pinning the WebGPU path |
| S-02a-2a-3c | Can the `.mjs` glue's integrity be assured beyond packaging — SRI, or a build-time hash check? | Completeness of runtime provenance |
| **S-02a-2a-3d** | **Does the `wasmBinary` binding hold in Firefox MV3?** Harness ready; not measured this session. | Cross-browser parity of the pin |
