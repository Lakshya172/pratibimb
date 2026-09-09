---
id: W1-S02a-2a-3-decision
spike: S-02a-2a-3
verdict: CONDITIONAL
date: 2026-09-10
decided_by: browser-engineer + ml-engineer + privacy-security-engineer (reviews below)
---

# S-02a-2a-3 decision — CONDITIONAL

## Verdict

**CONDITIONAL.**

**The binding is PROVEN.** `EXACT BYTES HASHED == EXACT BYTES EXECUTED` was demonstrated,
not asserted. **It is CONDITIONAL because it holds only under three architecture
constraints that PratiBimb must actively adopt and keep.**

**This is not a downgraded ACCEPT.** The mechanism works and is reproducible. It is simply
not free-standing: remove any of C-1..C-3 and the pin silently stops meaning anything.

## What was proven

| Evidence | Result |
|---|---|
| Artifact deterministically identified | `ort-wasm-simd-threaded.jsep.wasm`, 27,797,172 bytes, `db816fad…08a44dea` |
| Bytes obtainable before compilation | **Yes** — fetched, hashed with `crypto.subtle`, compared to the pin, then handed to ORT via `ort.env.wasm.wasmBinary` |
| ORT fetches in the pinned scenarios | **ZERO**, and the artifact is not packaged, so there was nowhere else to obtain bytes |
| **Tampered bytes break the session** | **Yes** — genuine `CompileError: WebAssembly.instantiate()`. **This is what closes the binding**: if ORT had ignored our buffer, corrupt bytes could not have caused a compile error |
| Second/subsequent session | Pinned module reused; **no re-fetch** |
| Silent fallback | **None.** Missing artifact fails after 3 retries; `fellBackSilently: false` |
| Foreign origin | 0 arrivals; `connect-src` refuses before the wire |

## The three constraints — why CONDITIONAL rather than ACCEPT

| # | Constraint | Consequence if violated |
|---|---|---|
| **C-1** | `wasmBinary` **must be set before the first session in each JS realm.** ORT caches its WebAssembly module per realm. | A realm that creates a session first is **unpinned for its entire lifetime** |
| **C-2** | The pin is **bundle- and artifact-specific.** `ort.all.min.js` loads `…jsep.wasm`, not `…wasm`. | A bundle change **silently pins a file the runtime never loads** — the pin passes and verifies nothing |
| **C-3** | The pin covers the **`.wasm` only.** The `.mjs` glue is loaded by dynamic `import()`, governed by `script-src` (not `connect-src`), and **must be packaged**. | Runtime glue provenance rests on packaging alone, with no hash check |

## Effect on ADR-0001 §7.3

§7.3 proposed hash-pinning **conditional on this spike**. The condition is met — **with
constraints**. §7.3 is therefore **reopened and rewritten**, not silently confirmed:
the sub-decision now carries C-1..C-3 as explicit requirements and three new verification
gates.

**No fake pinning layer was invented, and no wrapper was built to make the experiment
pass.** The mechanism measured is ORT's own documented `wasmBinary` input, used as-is.

## What this does NOT do

- **No manifest, CSP or egress policy changed.** ADR-0001 stays `PROPOSED`.
- **QG-04 unsigned. B-02 `OPEN`** — untouched; this concerns provenance, not mechanism (2).
- Does not cover `numThreads > 1` (**S-02a-2a-3a**), the WebGPU EP (**S-02a-2a-3b**), or
  glue integrity beyond packaging (**S-02a-2a-3c**).
- Does not convert any Firefox/Linux unknown into ACCEPT.
- **Firefox is NOT measured.** The verdict is a **Chromium** verdict. A Firefox runner
  exists and two toolchain defects were fixed, but no valid Firefox measurement was
  obtained; the failed attempt is committed as evidence. Tracked as **S-02a-2a-3d**.

## AgentOS specialist review

### browser-engineer — PASS

Contexts are the ones the constitution names. The decisive design choice — **not packaging
the artifact** — is what converts "no arrivals" from an absence of evidence into evidence
of absence, and the s4/s5 scenarios prove the observer works by producing arrivals on
demand. The `chrome.runtime.getURL`-undefined-in-a-worker finding from W1-S02a-2a-1 was
reused correctly via `new URL(..., location.href)`.

**Raises for the ADR:** C-3 is a browser-level constraint, not an ORT one. `script-src`
governs dynamic `import()`, so the glue can never be fetched from the server origin
regardless of `connect-src`. That is a *good* default — it forces packaging — but it must
be written down, because a future change to `wasmPaths.mjs` would fail in a way that looks
like a network problem.

### ml-engineer — PASS

The runtime is the pinned `onnxruntime-web@1.29.0` and the loading path is ORT's real one;
nothing was stubbed. C-2 is the finding I would most expect to be lost in translation: the
artifact is selected by the **bundle**, and `ort.all.min.js` takes the JSEP build even for
the `wasm` execution provider. Pinning `ort-wasm-simd-threaded.wasm` — the obvious choice —
would have produced a pin over a file that is never loaded.

**Condition on my PASS:** the model registry must record the pinned artifact **per bundle**,
not per package version. **S-02a-2a-3a** (threads) matters for the performance path and is
not covered.

### privacy-security-engineer — PASS, standing veto NOT waived

The claim is established the right way round. A hash of a file on disk would have proved
nothing; the tamper control is what makes this a binding rather than a coincidence, and the
ground truth is an independent arrival log rather than the page's self-report — the B-02
discipline held. **Not attempted** is never reported as **blocked**, and three harness
defects were fixed rather than explained away, including one that produced a *true
conclusion by a false route*.

**Requirements carried into ADR-0001:**

1. **C-1 must become a runtime assertion, not a convention.** "Set `wasmBinary` before the
   first session" is exactly the kind of ordering rule that decays. It needs a guard that
   fails closed if a session is created in an unpinned realm.
2. **C-2 must be enforced at build time.** The expected artifact filename **and** hash must
   be derived from the shipped bundle, so a bundle change breaks the build rather than
   quietly voiding the pin.
3. **C-3 must be stated as a residual risk.** The glue is unpinned. Packaging plus
   `script-src 'self'` is a reasonable control, but it is *not* a hash pin and must not be
   described as one.

**The pin does not replace `connect-src`, and `connect-src` does not replace the pin** —
S-02a-2a-4 measured that the hash accepts foreign-origin bytes, and this spike measured
that `connect-src` alone permits any bytes from the pinned origin. Both, or neither.
