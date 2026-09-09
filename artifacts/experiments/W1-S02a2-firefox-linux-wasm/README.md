---
id: W1-S02a-2
title: "S-02a-2 — the WASM path in a Firefox MV3 event page on Linux"
status: recorded
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: REJECT at defaults — CONDITIONAL with a manifest CSP change
---

# S-02a-2 — the WASM fallback on Firefox Linux

> **Machine boundary.** Measured **inside a WSL2 Ubuntu 26.04 guest**. Windows cells are
> separate and unaffected.
>
> ## ⛔ This spike hits an architecture / security decision boundary. It stops there.
> The remedy is a **manifest Content Security Policy change**, and the manifest CSP is one
> of Invariant E's four enforcement mechanisms. **Nothing was adopted.** See *Decision
> boundary* below.

## Hypothesis

S-02a established that **WebGPU is off by default in Firefox on Linux**. The dossier's
stated position is *"WebGPU when available, **WASM always**"* — so the whole
Firefox-on-Linux story rests on the WASM path. **S-02a-2 asks whether that fallback
actually works in the extension context.**

**Hypothesis:** WebAssembly is available and correct in the Firefox MV3 event page, making
the WASM budget the operative one on Linux.

## Scope — what this is NOT

**This is not S-03.** It measures the WASM **substrate**: is WebAssembly present, does SIMD
validate and run, are threads usable, and what does a fixed integer kernel cost. **No ONNX
Runtime Web, no Transformers.js, no model.** A working substrate does not imply ORT Web
initialises, and nothing here may be read that way.

## Environment

| | |
|---|---|
| Linux guest | WSL2 Ubuntu 26.04, kernel `6.18.33.2-microsoft-standard-WSL2` |
| Browser | **Mozilla Firefox 155.0.1** release (Mozilla tarball) |
| Contexts | Firefox **MV3 event page** + ordinary-page **control** |
| Modes | headful (WSLg) and headless |
| Kernel | `out[i] = in[i]*2 + 1` over **262,144 i32** — **deliberately identical to the WebGPU probe**, so the two are comparable on one machine, one browser |

Kernels are compiled from the committed `kernel.wat` / `kernel-simd.wat` with `wabt` and
embedded as base64, so the probe needs no fetch. The WAT source is in `harness/`.

## Method

Three variants, 3 runs each:

| # | Variant | Extension CSP |
|---|---|---|
| 1 | `defaults-headful` | manifest default (none declared) |
| 2 | `defaults-headless` | manifest default (none declared) |
| 3 | `wasm-unsafe-eval-headful` | `script-src 'self' 'wasm-unsafe-eval'` |

Variants 1 and 2 decide the verdict. Variant 3 measures **whether a remedy exists** and is
recorded separately — measuring a remedy is not adopting it.

## Expected result

WebAssembly expected available and correct in both contexts, since WASM is universally
supported and needs no hardware.

## Actual result — FACT

### Substrate feature detection — identical in every variant and both contexts

| Feature | Value |
|---|---|
| `WebAssembly` present | **true** |
| **SIMD (v128) validates** | **true** |
| `SharedArrayBuffer` | **false** |
| `crossOriginIsolated` | **false** |
| `Atomics` | true |
| **threads usable** | **false** |
| `hardwareConcurrency` | 16 |

Feature detection succeeds even where compilation does not, because `WebAssembly.validate`
is **not** CSP-gated while `WebAssembly.compile` is.

### The result — MV3 event page at defaults

| Variant | Event page | Ordinary page (control) |
|---|---|---|
| `defaults-headful` | **`CompileError: call to WebAssembly.compile() blocked by CSP`** 3/3 | **works** — correct, 0 mismatches, 3/3 |
| `defaults-headless` | **`CompileError: … blocked by CSP`** 3/3 | **works** — correct, 0 mismatches, 3/3 |
| `wasm-unsafe-eval-headful` | **works** — scalar **and** SIMD correct, 0 mismatches, 3/3 | works, 3/3 |

> ## Finding 1 — the WASM fallback does not run at all in the extension context by default
>
> ```
> CompileError: call to WebAssembly.compile() blocked by CSP
> ```
>
> Firefox MV3's default extension-page CSP **forbids WebAssembly compilation**. The
> ordinary-page control compiles and runs the identical bytes correctly, so **this is the
> extension CSP, not the browser and not the machine.**
>
> Combined with S-02a, on Firefox-on-Linux **at defaults, in the extension context, neither
> path works**: WebGPU is off by preference, and WASM is off by CSP.

**Finding 2 — the remedy is a one-line manifest CSP change, and it works.** Declaring
`'wasm-unsafe-eval'` in `content_security_policy.extension_pages` unblocks it completely:
scalar and SIMD both element-exact, 0 mismatches, 3/3.

**Finding 3 — WASM threads are NOT usable in this context.** `SharedArrayBuffer` is
`false` and `crossOriginIsolated` is `false`. ORT Web's WASM backend uses threads for
performance, so **the realistic assumption for this context is single-threaded WASM**, and
any WASM budget should be built on that until measured otherwise. `hardwareConcurrency`
reporting 16 is irrelevant while `SharedArrayBuffer` is absent.

**Finding 4 — SIMD is available**, validates, and produces element-exact output.

### Timings — and why they must not be over-read

Ordinary page and (variant 3) event page: compile 1–6 ms, cold dispatch 0–4 ms,
**warm p50 0 ms** (below the timer's reported resolution for this kernel).

The same kernel through **WebGPU** on the same machine and browser (S-02a, forced) was
**~100 ms**.

> **This is not evidence that WASM beats WebGPU.** The S-02a WebGPU path was almost
> certainly **software-backed** — no `/dev/dri`, 0 Vulkan ICDs, `llvmpipe`. The comparison
> measures *a software WebGPU implementation against native WASM*, which is not the
> comparison the dossier's two budgets are about. On hardware WebGPU the ordering could
> reverse. **Neither figure may be quoted as a WASM-vs-WebGPU result.**

Also: this is a trivial integer kernel, **not a model**. It says nothing about ORT Web
throughput.

## Decision boundary — STOPPED HERE

The remedy is to declare `'wasm-unsafe-eval'` in the extension manifest CSP. **That is not a
change this spike may make**, for two reasons:

1. **The manifest CSP is one of Invariant E's four enforcement mechanisms** —
   mechanism (3), the `connect-src` pin. Editing that CSP touches a security control the
   whole submission rests on, even when the edit concerns `script-src`.
2. **It weakens the script-execution policy of every extension page.** `wasm-unsafe-eval`
   permits compiling arbitrary WebAssembly in the extension origin. That may well be the
   right and necessary trade — the perception tier cannot exist without it — but it is a
   **trust-boundary judgement for the human architect and the `privacy-security-engineer`**,
   recorded in an ADR, not a spike edit.

**Nothing was adopted. No manifest in any product path was changed — there is no product
code. `docs/security/security-invariants.md` and `docs/architecture/constitution.md` are
untouched.**

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Does the WASM path carry Firefox-on-Linux **as things stand**? | **NO.** Blocked by the extension CSP at defaults. |
| Is there a remedy? | **Yes, measured** — `'wasm-unsafe-eval'` in the manifest CSP. |
| Is the remedy free? | **No.** It is a security-policy change requiring an ADR. |
| Are WASM threads available? | **No** — no `SharedArrayBuffer`, not cross-origin isolated. |
| Is SIMD available? | **Yes.** |
| Does this tell us ORT Web works? | **No. `UNKNOWN` — that is S-03.** |

## Conclusion

**REJECT at defaults; CONDITIONAL with a manifest CSP change.**

On Firefox-on-Linux, in the MV3 extension context, **at stock settings neither acceleration
path is available**: WebGPU is off by preference (S-02a) and **WASM is off by CSP** (here).
The dossier's *"WASM always"* is, on this platform and in this context, **not true by
default** — and that is the single most consequential thing found so far, because the WASM
path is what the Firefox story falls back to.

**It is fixable, cheaply, and the fix is measured working.** But the fix is a security-policy
change, so the spike stops and escalates.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-02a-2a | **ADR: declare `'wasm-unsafe-eval'` in the extension CSP?** Security-policy change; interacts with Invariant E mechanism (3). | **p0** | The entire perception tier on Firefox |
| S-02a-2b | Does Chrome MV3 have the same restriction? Chrome's MV3 CSP also gates WASM. **Untested — do not assume.** | **p1** | Perception tier on Chrome |
| S-02a-2c | Can cross-origin isolation be obtained in an extension page, to enable WASM threads? If not, **all WASM budgets are single-threaded.** | **p1** | Every WASM latency figure |
| S-02a-2d | Re-measure the WASM-vs-WebGPU comparison where WebGPU is **hardware**-backed | p2 | The two published budgets |

## Reproducibility

```bash
# inside WSL2 Ubuntu, DISPLAY=:0
cd /root/spikes/s02a2
npm install wabt web-ext@10.6.0
node -e "…"                       # rebuild kernel.wasm from kernel.wat (see commands.md)
RUNS=3 node run-s02a2-linux.js    # -> results-linux.json
```

The two extension directories differ **only** in the manifest CSP line. The harness contacts
no host other than `127.0.0.1:8904`.

## Scope

**WSL2 Ubuntu 26.04 · Firefox 155.0.1 · MV3 event page · headful and headless.** Says
nothing about Chrome, nothing about native Linux, nothing about ORT Web, and nothing about
any model.
