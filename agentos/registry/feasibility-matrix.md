# Model Feasibility Matrix — PratiBimb

> **Twenty cells. Filled in week one, re-run in CI thereafter.**
> Source: dossier v4.0 section 10 ("Model feasibility matrix", new in v4.0).
>
> **No model enters the build until its row is complete across all four combinations.**
> **A model that fails the WASM columns is not shipped whatever it does on WebGPU** — the
> judging machine is more likely to be the WASM one.

---

## What each cell must record

Four things, all four required for the cell to count as filled:

1. **Does the session load?** (`LOAD: yes/no`)
2. **p50 latency on a fixed fixture** (`P50: N ms`)
3. **Peak heap** (`HEAP: N MB`)
4. **Output correctness against a known-good reference** (`CORRECT: yes/no`)

Plus provenance: machine, OS, browser version, ORT/Transformers.js version, date, and the
artifact path under `artifacts/experiments/`.

---

## The matrix

**One row of five has been run.** The UI element detector row below is measured; every other
row is still `UNKNOWN` and nothing has been run for it.

| Model | Chrome WebGPU | Chrome WASM | Firefox WebGPU | Firefox WASM (Linux) |
|---|---|---|---|---|
| **UI element detector** — `pratibimb-t1-ui-head` @ `ba6d9e93695b` | **`ACCEPT`** ¹ | **`ACCEPT`** ¹ | **`CONDITIONAL`** ² | **`UNKNOWN`** ³ |
| YuNet faces | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| PP-OCRv5-mobile | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| GLiNER-PII | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| SmolVLM (offline path) | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |

¹ **Unbranded Chromium 151.0.7922.34 on WINDOWS**, not branded Chrome — Chrome 152 refuses
`--load-extension`. WebGPU ran on the **Intel `gen-12lp` integrated adapter**; the RTX 5050
on the same machine is unmeasured (S-01a).

² **Firefox 155.0.1 on WINDOWS. Headful `ACCEPT`, headless `REJECT`** — no GPU adapter at
release defaults, 3/3 reproducible. `dom.webgpu.enabled` was deliberately not touched, per
S-02a's rule. **CI is headless, so this is the cell CI would hit.** Headful is also **8.6×
slower than Chromium WebGPU** and slower than its own WASM backend.

³ **NOT MEASURED. This column is Firefox WASM on LINUX** and no Linux environment was used.
Firefox WASM on **Windows** *was* measured and passes (33–36 ms p50, correct, deterministic,
3/3 both display modes) — but that is a different cell and is not this one.

### UI element detector — the four required fields, per cell

Measured 2026-09-11, **workstation 1**, Windows 11 build 26200, Intel Core 7 240H.
ORT Web 1.29.0, `numThreads = 1`, artifact `302,960` bytes sha256 `ba6d9e93695b22d1…`.
Evidence: [`W1-QG03`](../../artifacts/experiments/W1-QG03-t1-detector-runtime/README.md).

| browser | backend | display | LOAD | P50 | HEAP (WASM) | CORRECT |
|---|---|---|---|---|---|---|
| Chromium 151 | wasm | headful | yes 3/3 | 41.0 ms | 26.4 MB | yes |
| Chromium 151 | wasm | headless | yes 3/3 | 28.2 ms | 26.4 MB | yes |
| Chromium 151 | webgpu | headful | yes 3/3 | 11.6 ms | 16.0 MB | yes |
| Chromium 151 | webgpu | headless | yes 3/3 | 10.9 ms | 16.0 MB | yes |
| Firefox 155.0.1 | wasm | headful | yes 3/3 | 33.0 ms | 26.4 MB | yes |
| Firefox 155.0.1 | wasm | headless | yes 3/3 | 36.0 ms | 26.4 MB | yes |
| Firefox 155.0.1 | webgpu | headful | yes 3/3 | 100 ms | 16.0 MB | yes |
| Firefox 155.0.1 | webgpu | headless | **no 0/3** | — | — | — |

`CORRECT` means element-wise agreement with a Python reference inside a **pre-registered**
criterion (class channels 1e-4, box channels 0.25 model px), with **bitwise-identical**
repeated inference. Worst observed: **5.6e-06** class, **1.6e-03** model px box.
`HEAP` is WASM linear memory, which is ORT's arena — **the 0.30 MB model accounts for
essentially none of it**, and JS heap is recorded separately.

> ### A filled row is not an adopted model
>
> **The detector is NOT adopted and `model-registry.md` is unchanged.** These cells settle
> whether the artifact *runs*. They do not settle whether it *works*.
>
> **Preprocessing blocker — CLOSED 2026-09-11 by [`W1-QG03b`](../../artifacts/experiments/W1-QG03b-letterbox-conformance/README.md).**
> When these cells were measured, the browser performing its own letterboxing lost **16–34%
> of the reference detections**, because canvas `drawImage` is not PIL `BILINEAR` and the two
> engines do not agree with each other either. The root cause was that the contract specified
> the fit's *geometry* and nothing else. `preprocess.ts` now implements PIL's algorithm
> exactly; the browser path is **byte-identical** to the reference in all 8 cells and
> detection agreement is **100%** with exact counts.
>
> **The cell verdicts above are UNCHANGED by that fix** — they were always measurements of
> whether the artifact executes correctly, which it did. **Firefox WebGPU headless remains
> `REJECT`**, reconfirmed 3/3.
>
> **Capture formats — ALL MEASURED 2026-09-12 by [`W1-QG03b-2`](../../artifacts/experiments/W1-QG03b2-capture-format-conformance/README.md).**
> `captureVisibleTab` produces PNG or JPEG. Both decode **bitwise identically** to the
> reference in both browsers, on 45 fixture/encoding pairs across 8 cells — max absolute
> difference **0**, better than the pre-registered lossy bound required. Colour management is
> not involved. WebP is measured too and is **not a capture format**: the API cannot produce
> it, and every WebP reference in the dossier is the T2 egress encoding.
>
> Also measured: **PNG is smaller than JPEG q62 on 9 of 9 fixtures** (1.86–2.01× on the real
> UI frames), decodes faster, and costs no detections — so JPEG offers nothing for this
> workload. And a **non-opaque frame is now refused** rather than silently corrupted: the
> canvas premultiply round trip is not invertible, and neither browser can be configured out
> of it.
>
> **The browser's OWN encoder — MEASURED 2026-09-11 by [`W1-QG03b-2a`](../../artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/README.md).**
> Every file QG-03b-2 tested was written by Pillow, and Pillow's encoder and Chromium's
> decoder are both libjpeg-turbo — so that agreement was partly structural. Frames produced
> by the real `chrome.tabs.captureVisibleTab` decode **bitwise identically** too, on 40
> fixtures across 8 Chromium cells, despite carrying encoder choices the synthetic fixtures
> never had: **4:2:0 chroma subsampling** and a **456-byte embedded sRGB ICC profile**.
>
> Measured about the API itself: **omitting `format` yields JPEG, not PNG** — the shipped
> adapter passes `{format:"png"}` explicitly, and a test now guards that. `{format:"webp"}`
> is **rejected at schema validation**, which settles by observation what QG-03b-2 inferred
> from the type. `quality` is ignored for PNG. Default JPEG quality is **exactly 90**, derived
> from the quantization tables rather than assumed. **PNG is smaller than the default JPEG on
> 9 of 10 fixtures.**
>
> **What still blocks adoption:** resampler *robustness* (**QG-03a** — the model was trained
> with `augmentation: "none"` on one resampler), **compression robustness** — the detector
> loses **8–9% of detections at JPEG q62** against the lossless frame — **box-decode stability
> under inference noise** (new, QG-03b-2a: a 1e-07 relative perturbation of model output moves
> a matched box 47 CSS px), and adoption items 11 and 14, acceptable metrics and usable
> grounding. None of them is touched by QG-03b, QG-03b-2 or QG-03b-2a.
>
> **Proposed by [ADR-0002](../../docs/adr/ADR-0002-t1-capture-format-policy.md) (QG-03b-2c),
> effective on approval:** T1 production capture is PNG only, so **compression robustness
> leaves QG-03a's T1 production-path scope**. There is no lossy step between
> `captureVisibleTab` and preprocessing. It returns only if a later ADR admits a lossy T1
> capture format. It does **not** disappear globally: whether T2 detection survives the WebP
> q62 egress encoding is a T2 verification question. **Resampler robustness, box-decode
> stability (QG-03a-4), the label/raster fix (QG-03b-1) and items 11/14 are unchanged, and
> QG-03a still blocks adoption.**

---

## Prerequisite spike — must pass before the matrix can be filled

**This is the first thing the project does. Nothing else starts until it resolves.**

| # | Question | Status | Evidence |
|---|---|---|---|
| S-01 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Chrome `chrome.offscreen` document? | **`FACT` — YES** | [`W1-S01`](../../artifacts/experiments/W1-S01-chrome-webgpu-context/README.md) |
| S-02 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Firefox MV3 event page? | **Windows: `FACT` — YES. Linux (WSL2): `CONDITIONAL`. Native Linux: `UNKNOWN`.** | [`W1-S02`](../../artifacts/experiments/W1-S02-firefox-webgpu-context/README.md) · [`W1-S02a`](../../artifacts/experiments/W1-S02a-firefox-linux-webgpu/README.md) |

### S-02 result — recorded 2026-09-07

**ACCEPT.** Firefox **155.0.1** release, headful, Windows 11, **workstation 2**.
`dom.webgpu.enabled` was **not** touched — release defaults.

Adapter returned, device created, WGSL compute shader output **element-exact against a CPU
reference over 262,144 elements**, device destroyed and re-acquired cleanly. **3 runs of 3**,
**zero uncaptured GPU errors**, **zero shader compilation errors**. The ordinary-page control
passed on the same machine.

Timings (event page, min/median/max over 3 runs): `requestAdapter` 376 / 409 / 1864 ms -
`requestDevice` 111 / 127 / 146 ms - cold dispatch 99 / 99 / 100 ms - warm p50 100 ms.
End-to-end submit-to-readback on a trivial shader, **not** a model and **not** kernel time.
**These must not be compared with S-01's Chrome figures — different browser AND different
machine.**

Two constraints attached to the acceptance:

1. **The adapter cannot be identified.** Firefox returns an **empty `adapterInfo`**. Unlike
   the Chrome cell, no Firefox figure can be attributed to a specific GPU. Every Firefox
   WebGPU number must be labelled **"adapter unidentified"**.
2. **Windows only.** **Firefox on Linux remains `UNKNOWN`** — WebGPU is off by default there
   behind `dom.webgpu.enabled`, and it is the configuration the risk register rates **High**.
   No Linux environment exists on this workstation.

   > **Superseded in part, 2026-09-07.** The sentences above are preserved as written.
   > A Linux environment now exists (WSL2, `ENV-0003`) and **S-02a has been executed** —
   > see the S-02a section below. **The Windows verdict is unchanged**; only the
   > statement that no Linux environment exists is out of date. Firefox on **native**
   > Linux remains `UNKNOWN` (S-02a-1).

**S-01 and S-02 both now have answers, so the gate in `agentos/workflows/spike.md` is
satisfied for the cells measured.** S-02 does **not** answer S-03: ORT Web's WebGPU backend
was **not tested**, and raw WebGPU working is not ORT Web working.

| # | New question raised by S-02 | Status | Blocks |
|---|---|---|---|
| S-02a | **Firefox on Linux** — the likely judging configuration | **ANSWERED — `CONDITIONAL`**, see below | [`W1-S02a`](../../artifacts/experiments/W1-S02a-firefox-linux-webgpu/README.md) |
| S-02b | **ADR:** per-browser execution context. Chrome needs an offscreen document; Firefox's MV3 background is already a `window` with DOM. | `UNKNOWN` | Perception tier |
| S-02c | **ADR/spike:** Firefox MV3 gates `host_permissions` behind user-granted origin controls, and the extension `fetch` was refused. What does that mean for the egress path, Invariant E and the CSP `connect-src` pin? | `UNKNOWN` | **QG-04** |
| S-02d | How are Firefox figures labelled when no adapter identity is available? | `UNKNOWN` | Reporting discipline |

### S-02a result (Firefox on LINUX) — recorded 2026-09-07

**CONDITIONAL.** Firefox **155.0.1** release — the same version as the Windows cell — inside
**WSL2 Ubuntu 26.04**, headful and headless.

**At release defaults, `navigator.gpu` is ABSENT**, in the MV3 event page *and* in the
ordinary-page control, 3/3 in both display modes. **This is a platform default, not an
extension-context restriction** — the control proves it.

With **`dom.webgpu.enabled=true`**: adapter returned, device created, compute output
**element-exact against a CPU reference (0 mismatches)**, zero shader and zero uncaptured
errors, clean destroy and re-acquire, 3/3, in both contexts.

The pre-registered criteria settle it: *a result requiring an `about:config` change on the
release channel is **CONDITIONAL, never ACCEPT***. **Not REJECT either** — nothing is broken
behind the preference; the default is the obstacle.

Two constraints: **the preference must be set**, and **the adapter is unidentified and
probably software** — this guest has no `/dev/dri`, **0 Vulkan ICDs** and `llvmpipe` for
OpenGL, while `nvidia-smi` works (that is the **CUDA compute** path, not graphics). Firefox
exposes neither `adapterInfo` nor `isFallbackAdapter`. **No Linux WebGPU figure from this
environment may be quoted as a hardware number.**

**The cells stay separate: Windows `ACCEPT`, Linux (WSL2) `CONDITIONAL`, native Linux
`UNKNOWN`.** The Windows result is not upgraded into a universal Firefox ACCEPT.

**S-02a does not answer S-03.** ORT Web was not tested.

| # | New question raised by S-02a | Status | Blocks |
|---|---|---|---|
| S-02a-1 | Firefox on **native** Linux with a real GPU and `/dev/dri`. WSL2 cannot answer it. | `UNKNOWN` | The judging-configuration story |
| S-02a-2 | Does the **WASM path** carry Firefox-on-Linux, given WebGPU is off by default? | `UNKNOWN` | Firefox parity |

### S-02a-2a-3 result — recorded 2026-09-10 (workstation 1)

**CONDITIONAL. The hash-pin binding is PROVEN on BOTH Chromium and Firefox; it holds under
three named constraints.** ORT Web **1.29.0**, bundle `ort.all.min.js`, Chromium 151 and
Firefox 155.0.1, 3 runs each, unanimous. Evidence:
[`W1-S02a-2a-3`](../../artifacts/experiments/W1-S02a2a3-ort-wasm-hash-pin/README.md).

> **EXACT BYTES HASHED == EXACT BYTES EXECUTED** — demonstrated, not asserted.

| Artifact ORT actually loads | `ort-wasm-simd-threaded.jsep.wasm` |
|---|---|
| Bytes | 27,797,172 |
| **SHA-256** | `db816fadbab47a755170c08f933961e231412ac17f5981f9a62e519708a44dea` |
| Artifact **not** loaded by this bundle | `ort-wasm-simd-threaded.wasm` — `ec8580a9…c109a4d` |

How the binding was established — three independent observations, none of them ORT's
self-report:

| Observation | Result |
|---|---|
| `.wasm` **not packaged** in the extension | ORT had nowhere else to obtain bytes |
| ORT's own fetches in the pinned scenarios | **ZERO** (independent arrival log) |
| **Tampered bytes handed to ORT** | Session **FAILS**, `CompileError: WebAssembly.instantiate()` |

Negative controls: hash mismatch → **refused before ORT is invoked**; missing artifact →
fails after 3 retries, **`fellBackSilently: false`**; foreign origin → **0 arrivals**;
second session → pinned module reused, **no re-fetch**.

**The three constraints — requirements, not caveats:**

| # | Constraint | If violated |
|---|---|---|
| **C-1** | `wasmBinary` must be set **before the first session in each JS realm** (ORT caches per realm) | that realm is unpinned for its lifetime |
| **C-2** | The pin is **bundle- and artifact-specific** | a bundle change silently pins a file the runtime never loads |
| **C-3** | Pin covers the **`.wasm` only**; the `.mjs` glue is loaded by dynamic `import()` under **`script-src`**, so it must be **packaged** | glue provenance rests on packaging, unpinned |

| # | New question raised | Status | Blocks |
|---|---|---|---|
| S-02a-2a-3d | Does the binding hold in **Firefox MV3**? | **ANSWERED — YES**, identical to Chromium, 3 runs, both contexts | — |
| S-02a-2a-3a | Does the binding hold with `numThreads > 1`, where ORT spawns its own workers? | `UNKNOWN` | Threaded WASM path |
| S-02a-2a-3b | Does the **WebGPU** EP touch resources beyond the jsep artifact? | `UNKNOWN` | Pinning the WebGPU path |
| S-02a-2a-3c | Can the `.mjs` glue's integrity be assured beyond packaging? | `UNKNOWN` | Completeness of runtime provenance |

---

### S-02a-2a-4 result — recorded 2026-09-10 (workstation 1)

**ACCEPT. `connect-src` blocks foreign-origin WASM at the NETWORK layer, before the wire.**
Chromium 151.0.7922.34 and Edge 152.0.4191.66, three MV3 contexts, two variants, 3 runs
each — **36/36 unanimous**. Evidence:
[`W1-S02a-2a-4`](../../artifacts/experiments/W1-S02a2a4-connect-src-provenance/README.md).

Two loopback origins served **byte-identical** WASM; `host_permissions` listed **both** in
every variant, so the block is attributable to `connect-src` and not to host permissions.

| | `ext-pinned` | `ext-unpinned` (positive control) |
|---|---|---|
| Network retrieval | **BLOCKED** — `TypeError: Failed to fetch` | resolved |
| **Foreign-origin arrivals (ground truth)** | **0** per browser | **18** per browser |
| WASM compilation | *never attempted* | allowed |
| Instantiation | *never attempted* | `add(2,3)=5` |
| Cross-check | **`CONSISTENT_BLOCKED`** | `CONSISTENT_ALLOWED` |

**The finding that matters:** in the unpinned control the **SHA-256 pin ACCEPTED the
foreign-origin bytes** (identical bytes → `digestMatchesPin: true`). A content hash cannot
express provenance. **`connect-src` and hash-pinning are orthogonal and both are required.**

| # | New question | Status | Blocks |
|---|---|---|---|
| S-02a-2a-4a | Cross-host / https origin rather than a second loopback port? | `UNKNOWN` | Generality of the claim |
| S-02a-2a-4b | Does `connect-src` bound WASM provenance on **Firefox** too? | `UNKNOWN` | Cross-browser parity of mechanism (3) |
| S-02a-2a-4c | Can a **redirect** from the allowed origin reach foreign bytes past the pin? | `UNKNOWN` | Completeness of mechanism (3) |

---

### S-02a-2a-2 result — recorded 2026-09-10 (workstation 1)

**ACCEPT. Firefox reaches the same security conclusion as Chrome, by a different failure
mode.** Real **Firefox 155.0.1** release, 4 variants x 3 runs x 2 contexts — **24/24
unanimous**. Evidence:
[`W1-S02a-2a-2`](../../artifacts/experiments/W1-S02a2a2-firefox-csp-tokens/README.md).

| Token | Chrome MV3 | **Firefox MV3** |
|---|---|---|
| *(default)* | loads · WASM blocked | loads · WASM blocked |
| **`'wasm-unsafe-eval'`** | loads · WASM allowed · JS sinks blocked | **same** |
| `'wasm-eval'` | **DOES NOT LOAD** | **loads** · WASM still blocked |
| `'unsafe-eval'` | **DOES NOT LOAD** | **loads** · WASM still blocked · `eval` still blocked |

**Security conclusion identical — one policy serves both browsers.** `'wasm-unsafe-eval'`
never widened `eval`, `new Function` or string-`setTimeout` in any variant or context.

**Operationally they differ: Firefox fails SILENTLY.** A wrong token kills the Chrome
extension outright but leaves Firefox running with no perception tier and no load error.
**Compounding trap: `WebAssembly.validate()` succeeds in every Firefox variant including the
default**, so a startup check using `validate` would report WASM available when compilation
is blocked. It must use `compile`.

| # | New question | Status | Blocks |
|---|---|---|---|
| S-02a-2a-2a | Same token behaviour on **Firefox for Linux**? | `UNKNOWN` | Judging-configuration story |
| S-02a-2a-2b | Can a startup check reliably distinguish *WASM blocked* from *WASM absent*? | `UNKNOWN` | Fail-closed startup behaviour |

---

### S-02a-2a-1 result — recorded 2026-09-09 (workstation 1)

**ANSWERED — measurement only. The CSP ADR is prepared, not approved.**

Two browsers (unbranded **Chromium 151.0.7922.34**, branded **Edge 152.0.4191.66**), three
MV3 contexts, two manifest variants, 3 runs each — **36/36 context-observations
unanimous**. Evidence:
[`W1-S02a-2a-1`](../../artifacts/experiments/W1-S02a2a1-csp-attack-surface/README.md).

| # | Question | Answer |
|---|---|---|
| Q1 | Does `'wasm-unsafe-eval'` widen JavaScript execution? | **NO.** `eval`, `new Function` and string-`setTimeout` remain blocked, identically to the default CSP. It unlocks WebAssembly compilation and nothing else. **Adopting it does not breach INV-15 or INV-16.** |
| Q2 | Does it constrain WASM **provenance**? | **NO.** Under the directive, network-origin bytes compile *and* `instantiateStreaming` exactly as freely as packaged bytes. Under the default CSP the fetch still succeeds — **compilation** is what is blocked, not retrieval. |
| Q3 | Can the bytes be **hash-pinned**, and does the pin refuse? | **YES**, all three contexts, both browsers. The refused module is one the browser would otherwise have executed (it computes `-1` if the pin is bypassed). |

**Consequence for Invariant E:** because the CSP token does not restrict provenance, the
only manifest-level control that does is **`connect-src`** — Invariant E enforcement
mechanism (3). **The CSP decision and Invariant E are coupled through one file.**

**Incidental FACT for the perception tier:** `chrome.*` is **not exposed inside a dedicated
worker** (`chromeApiAvailable: false`, 36/36), so `chrome.runtime.getURL()` is unavailable
in PratiBimb's actual inference context. Packaged assets must be addressed by relative URL,
or the URL passed in from the offscreen document.

| # | New question raised | Status | Blocks |
|---|---|---|---|
| S-02a-2a-2 | Does Firefox accept `'wasm-unsafe-eval'`, and is it equally narrow there? | **`FACT` — ANSWERED**, see below | Cross-browser parity of the ADR |
| S-02a-2a-3 | Does ORT Web expose its `.wasm` URL, so a pin can precede its own instantiation without patching the library? | **`FACT` — CONDITIONAL**, see below | Whether the pinning recommendation is implementable |
| S-02a-2a-4 | Does a pinned `connect-src` actually block WASM fetched from another origin, in all three contexts? | **`FACT` — YES, before the wire**, see below | Whether mechanism (3) really is the provenance control |

| S-02a-3 | Mozilla's 2026 ship status for `dom.webgpu.enabled` on Linux release | `UNKNOWN` | Slide accuracy |
| S-02a-4 | Confirm the backend is software by a route other than `adapterInfo` | `UNKNOWN` | Labelling of Linux figures |
| S-03 | Can an ONNX Runtime Web session be **created and run** in each context, on each backend? | **ANSWERED 2026-09-08 — `CONDITIONAL`.** Yes in the offscreen document, the dedicated worker inside it, and the Firefox MV3 event page, on both backends — and **only because `'wasm-unsafe-eval'` is declared**. **NO** in the Chrome MV3 service worker: ORT loads its WASM glue by dynamic `import()`, which the HTML specification forbids there — specification-level, unfixable by configuration. Measured on a 174-byte two-op synthetic model, which is why it did NOT satisfy QG-03. Evidence: `artifacts/experiments/W1-S03-ort-web-feasibility/`. *(This row was deferred in PR #13/#15/#16 to avoid a conflict and is landed here.)* | — |
| S-03c | Repeat S-03 with a **real detector** before any latency figure is quoted | **ANSWERED 2026-09-11 — `CONDITIONAL`.** The actual trained T1 artifact (302,960 bytes, `ba6d9e93695b`) runs correctly and bitwise-deterministically in 7 of 8 Windows cells, ~100× inside a pre-registered numerical criterion, with zero foreign network arrivals and no runtime model download. **Firefox WebGPU headless: no GPU adapter at release defaults, `REJECT`.** Latency is comfortably inside the dossier budget on 3 of 4 backends. **But when the BROWSER does the letterboxing — the only thing production can do — 16–34% of detections are lost**, because canvas resampling is not PIL BILINEAR and Chromium and Firefox do not agree with each other either. Tracked as **QG-03a**; it blocks adoption. Evidence: `artifacts/experiments/W1-QG03-t1-detector-runtime/`. | **QG-03 (one row of five now filled)** |
| QG-03b | Reconcile the two letterbox implementations — the preprocessing blocker QG-03 left open | **ANSWERED 2026-09-11 — `ACCEPT`.** The dossier specifies **no** preprocessing semantics (verified), so the authority is the trained artifact, whose weights encode PIL's rasterisation. `preprocess.ts` reproduces PIL `BILINEAR` exactly — separable support-scaled triangle filter, 22-bit fixed-point coefficients, horizontal pass first. **Byte-identical at every stage in 8/8 cells**, 15 fixtures x 3 runs; PNG decode was never the problem. Detection agreement **74%/66% -> 100%** with exact counts and worst CSS delta **1.10e-03 px** against 98-145 px. **No retrain required.** Uncovered, and NOT fixed: the training pipeline labels by the continuous rule and rasterises by the integer one, affecting **42% of training samples** by up to 0.667 model px — recorded in `docs/architecture/preprocessing-contract.md` §6 with the exact change and its consequences. Evidence: `artifacts/experiments/W1-QG03b-letterbox-conformance/`. | — |
| QG-03b-2 | Conformance for the remaining capture formats — JPEG and WebP | **ANSWERED 2026-09-12 — `ACCEPT`, per browser × format.** `captureVisibleTab` produces PNG or JPEG; WebP is the T2 egress encoding and is measured but scoped out as a capture format. Browser decode is **bitwise identical** to Pillow for every format in both browsers — max abs **0**, against a pre-registered lossy bound of 2 that was never approached, because Pillow and both browsers share libjpeg-turbo and libwebp. Colour management isolated and not involved. Detector conformance **100%**, exact counts, worst CSS delta ~1e-03 px. Separately measured and NOT a conformance result: the detector loses **8–9% of detections at JPEG q62** against a lossless frame — that belongs to **QG-03a**. Product change: a **non-opaque frame is refused** (`FRAME_NOT_OPAQUE`), because the canvas premultiply round trip is not invertible (15/255 Chromium, 27/255 Firefox, 31/255 WebP) and `premultiplyAlpha: "none"` is ignored by Firefox. **No retrain required.** Evidence: `artifacts/experiments/W1-QG03b2-capture-format-conformance/`. | — |
| QG-03b-2a | Does the JPEG from Chromium's OWN `captureVisibleTab` follow the same decode/preprocessing assumptions? | **ANSWERED 2026-09-11 — `CONDITIONAL`, per backend × display × format.** The capture path is **ACCEPT in all 8 cells**: 40 fixtures from the real API decode **bitwise identically** to Pillow (max abs **0**), geometry exact, tensor digests match — including 4:2:0 chroma and a 456-byte embedded sRGB ICC profile that QG-03b-2's fixtures never carried. Colour management isolated and not involved. Backend labels **observed** via `GPUQueue.submit` (wasm 0, webgpu 120). Encoder measured from the files: baseline JPEG, 4:2:0, IJG quality **exactly 90**, deterministic across repeats and across headful/headless. **API findings:** omitting `format` yields **JPEG**; `{format:"webp"}` is **rejected at schema validation**; `quality` is ignored for PNG; `captureVisibleTab` **ignores CDP device-metrics emulation**. The gate is CONDITIONAL, not ACCEPT, because the pre-registered **detector** bound (2.0 CSS px) is exceeded on **1 of 20 fixtures in the 2 WASM cells** (15.95 px). That is **not** a capture-format result: the tensor is bitwise identical there, and the same bytes give 0.002 px on WebGPU — the cause is NMS ordering sensitivity, and it belongs to **QG-03a**. **No retrain.** Evidence: `artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/`. | — |
| QG-03b-2c | Make the T1 production capture-format policy explicit | **`PASS` 2026-09-11. [ADR-0002](../../docs/adr/ADR-0002-t1-capture-format-policy.md) was APPROVED by ronitsaha11, by merging PR #41 (`27d71e3`), which implemented it. QG-03 itself remains `CONDITIONAL`.** Policy: **explicit PNG only.** The adapter keeps `captureVisibleTab({format:"png"})` and now **refuses** any non-PNG payload (JPEG returned for a PNG request, WebP/GIF/SVG/AVIF, or a MIME label the bytes contradict) with `CAPTURE_FAILED`, **with no re-request in another format and no fallback**. `CaptureFrame.format` is narrowed to `"png"`, which **closes QG-03b-2d**. Tradeoff stated, not hidden: **JPEG captured faster** on workstation 1 (median 21.5 vs 37.0 ms headful, 19.7 vs 37.7 ms headless). It is not adopted because capture cadence is bounded by the 500 ms quota spacing, not by encode time; JPEG is lossy, larger on 9 of 10 real UI captures, and costs 8–9% of detections at q62. Neither format meets the projected 18 ms capture budget (QG-03b-3). No new measurement; 10 behaviour tests plus a compile-time guard, each shown to fail under a targeted mutation. **T2 WebP egress untouched. Detector still UNADOPTED; QG-03 still CONDITIONAL.** Evidence: `artifacts/adr/ADR-0002/`. | QG-03a scope (compression item) |
| QG-03a | T1 production-path robustness: A preprocessing, B inference noise / NMS, C label↔raster | **MEASURED 2026-09-11 (workstation 2) — `OPEN`. No model was run and the held-out split was not evaluated.** **A = `PASS` after one fix.** The shipped raster rounded exact-half extents up (`Math.round`) where training rounds them to even (Python `round()`). 6 of 40 fixtures failed identically in Node, Chrome 153 and Firefox 155 (for example 1024×644 gave 403 rows where training drew 402, with 21% of tensor bytes differing). `roundHalfEven` fixed it, and all three runtimes are now **40/40 bitwise**. Browser PNG decode was bitwise throughout. The DPR × zoom round trip is exact to 3.4e-13 CSS px. Windows, page context; Linux UNKNOWN. **B = `OPEN`.** Hard greedy NMS flips at any representable near-tie, which is the root cause. No survivor swap moved the centre off the element, and recall was never lost in synthetic scenes. The real-model magnitude needs the absent artifact, and the pre-registered 2.0 CSS px bound is incompatible with hard NMS, so a criterion decision is raised. **C = `CONDITIONAL`.** 84/200 reproduced; ≤ 0.681 model px; worst-case mAP@0.5, recall and grounding stay 1.000 on train and dev; no retrain is justified on its own. **QG-03 remains `CONDITIONAL`; detector UNADOPTED; threshold 0.55.** Evidence: `artifacts/experiments/W1-QG03a-t1-production-robustness/`. | detector adoption |
| QG-03a-B2 | The real T1 artifact under REAL backend noise, through the shipped decode/NMS | **MEASURED 2026-09-12 (workstation 2): B2 `PASS` here; QG-03a-B `CONDITIONAL`.** The exact artifact (sha256 `ba6d9e93…`, 302,960 B, never committed) ran under ORT Web 1.29.0 in Chrome 153 and Firefox 155, on WASM and WebGPU, with the backend proven by GPU submits (180 per WebGPU cell, 0 per WASM cell; Chrome adapter amd/rdna-3), plus native ORT CPU, all through the production pin and session factory. WASM is bitwise identical across browsers; WebGPU differs by ≤ 2.1e-3 model px on boxes and ≤ 1.8e-5 on scores. Through the shipped decode: **0 survivor swaps, 0 true failures, pre-registered detector criterion 20/20 in every pair and view**, worst displacement 0.0026 CSS px. The model has 1,402 overlapping exact score ties, reproduced by every backend; iid noise destroys them and is not a valid backend-noise model. Margin: the non-UI `gradients-edges` page fails at 2× the real delta, real UI at 50×. Still open: the extension context, other GPUs and ORT versions, and the criterion (ARCHITECT APPROVAL REQUIRED, QG-03a-B1). No NMS change. Evidence: `artifacts/experiments/W1-QG03a-B2-real-model-nms/`. | QG-03a-B |
| QG-03a-B1 / B4 | The acceptance criterion for backend-noise robustness, and the fixture scope | **APPROVED by ronitsaha11, 2026-09-12.** **B1:** the QG-03b-2 numbers (≥ 95% matched at IoU 0.5, |count Δ| ≤ 2, worst matched displacement ≤ 2.0 CSS px, **zero true failures**), pre-registered there as an *identical-input detector-equivalence* criterion, are approved for reuse on **backend-noise robustness**, evaluated at the actual measured difference in both the shipped and 0.55 views. **No numerical threshold was changed and no new criterion was created.** **B4:** the **18 UI fixtures are the gating corpus**; **all 20 fixtures are executed and reported**; **`gradients-edges` (2 fixtures) is STRESS-ONLY** and **does not decide the UI adoption gate**. The 20-fixture result is analytical, never the gate. Recorded in `artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/decision.md`. | QG-03a-B |
| QG-03a-B3-1 | The exact T1 artifact in the REAL MV3 extension, per backend and per realm, on workstation 1 | **MEASURED 2026-09-12 (workstation 1, `LAPTOP-6E14K34L`, Intel): B3-1 `PASS`; QG-03a-B stays `CONDITIONAL`.** The exact artifact (`ba6d9e93…`, 302,960 B, never committed, re-verified **inside every realm**) ran under **ORT Web 1.29.0** with the production pin `db816fad…` and session factory, inside the real MV3 extension, in **four independent cells** — offscreen document and its dedicated worker × WASM and WebGPU — in **Chrome for Testing 151.0.7922.34**, against a **native onnxruntime 1.29.0 CPU** reference (the script refuses any other version). Backend proved by counted `GPUQueue.submit`: **180 per WebGPU cell, 0 per WASM cell**, adapter **`intel / gen-12lp`**, not a fallback adapter. Input tensors identical to the committed digests **20/20** across all five cells, so every difference is backend arithmetic, not preprocessing. 3 repetitions per fixture, all byte-identical. Against the reference, **every cell**: **100% matched at IoU 0.5, count change 0, 0 survivor swaps, 0 true failures**, worst displacement **0.002893 CSS px** against a 2.0 px bound. **Approved 18-fixture UI gate: 18/18 in every cell.** Complete 20-fixture corpus also 20/20 (analytical, not the gate). `gradients-edges` **STRESS-ONLY**: passes at the real difference, first fails at **5×** (workstation 2 recorded 2×); real UI at 50–100×. The two realms are **bitwise identical**. **`QG-03a-B3-2` (NVIDIA) is `NOT MEASURED / OPEN`** — Chrome chose the Intel adapter, so the RTX 5050 was never exercised; that is absent evidence, not a failure, and no NVIDIA cell was simulated. Raw `.f32` dumps gitignored and archived outside Git. No NMS, threshold, model or registry change; **detector still UNADOPTED**. Evidence: `artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/logs/workstation-1/`. | QG-03a-B |
| QG-03a-B3-2 | The same four cells on an **NVIDIA-backed** browser | **`NOT MEASURED / OPEN`.** Workstation 1 has an RTX 5050, but Chrome selected the Intel `gen-12lp` adapter for WebGPU in the extension realm, so the discrete GPU was never exercised by B3-1. Forcing it is a **distinct cell**, not a re-run of B3-1. No NVIDIA evidence exists, none was simulated or inferred, and its absence is **not** recorded as a failure. | — |
| S-04 | Can **three ORT Web sessions coexist** in one WebAssembly heap inside an extension offscreen document, and does teardown reclaim memory? | `UNKNOWN` | — |
| S-05 | What are the **real `tabs.captureVisibleTab` rate limits** under `activeTab`? | `CONDITIONAL` | **MEASURED 2026-09-10 (W1-S05-rate) — `CONDITIONAL`.** Chromium 151 MV3 service worker with `<all_urls>`: a hard, reproducible quota. 500 ms spacing gives 100% success (12/12 in all 6 ladder passes, 40/40 sustained, twice); failures begin between 2 Hz and 3 Hz; the ceiling is ~2.6 successes/sec no matter how fast you ask; a zero-delay burst yields exactly 2, 5-way concurrency also exactly 2, and recovery takes ~1.15 s. Stateful, consistent with a per-second budget of about 2 — mechanism inferred from observed behaviour plus the browser's own error string, not from internals. Firefox 155: **no throttle observed at or below 10 Hz**, which is an absence of observation and not a proof of absence. **`activeTab` is NOT MEASURED** — it needs a user gesture the harness cannot drive, and the dossier singles out that exact cell as the more restrictive one, which is why this is `CONDITIONAL` rather than `ACCEPT`. Windows only. Evidence: `artifacts/experiments/W1-S05rate-capture-limits/`. Production consequence: `CAPTURE_THROTTLED` is now a distinct typed refusal and `minCaptureIntervalMs` moved 250 ms -> 500 ms, the one constant this bounds. The adapter still contains **no retry, backoff or queueing** — it reports and the refresh scheduler decides. `fullFrameHashIntervalMs`, `dynamicRegionPollMs` and `maxDynamicRegions` remain **policy**, unbounded by this measurement. |
| S-06 | Does the coordinate contract hold at DPR 1.0 / 1.5 / 2.0 and 100% / 125% zoom? | `UNKNOWN` | — |

### S-01 result — recorded 2026-09-07

**ACCEPT.** Chrome **152.0.7977.82** (stable, headful, Windows 11). WebGPU is fully
functional in all four probed contexts — ordinary page (control), MV3 background service
worker, `chrome.offscreen` document, and a **dedicated Worker inside the offscreen
document**, which is PratiBimb's real inference context. Adapter returned, device created,
WGSL compute shader output **element-exact against a CPU reference**, device destroyed and
re-acquired cleanly. Identical across **3 runs**, zero uncaptured GPU errors.

Target context (offscreen dedicated worker), min/median/max over 3 runs:
`requestAdapter` 17.5 / 17.8 / 22.9 ms · `requestDevice` 9.3 / 9.8 / 18.7 ms ·
cold dispatch 5.8 / 6.2 / 6.3 ms · warm p50 4.6 / 4.8 / 5.0 ms · warm p95 5.7 / 6.0 / 6.2 ms.
End-to-end submit-to-readback on a trivial shader, **not** a model and **not** kernel time.

Two constraints attached to the acceptance:

1. **Integrated graphics only.** Chrome returned `intel / gen-12lp` in every context and
   run, under both default and `high-performance` power preferences, despite an NVIDIA
   RTX 5050 Laptop GPU being present. Every WebGPU figure measured on this machine is an
   integrated-graphics figure. → **S-01a**
2. **Chrome 152 stable refuses `--load-extension`.** Extensions load only via CDP
   `Extensions.loadUnpacked`. Affects the CI plan for the Playwright egress interception
   suite. → **S-01b**

**S-01 does NOT fill any of the twenty model cells, and does not answer S-03.** Raw WebGPU
working is not ONNX Runtime Web's WebGPU backend working.

| # | New question raised by S-01 | Status | Blocks |
|---|---|---|---|
| S-01a | Can Chrome be made to select the discrete NVIDIA adapter, and what does that do to the numbers? | `UNKNOWN` | Nothing; affects labelling |
| S-01b | Does Playwright's bundled Chromium still honour `--load-extension`, so the egress suite can run in CI? | **still `UNKNOWN`** — see the S-01b result below | QG-04 enforcement plan |

### S-01b result — recorded 2026-09-07

**CONDITIONAL.** Playwright **1.63.0**, branded **Edge 152.0.4191.66** and branded **Chrome
152.0.7977.77**, headful, Windows 11, on **workstation 2** (AMD Ryzen AI 7 350 / Radeon 860M
— *a different machine from S-01*; see `artifacts/environment/ENV-0002-workstation-omen-audit.md`).

The spike was deliberately widened beyond its original wording, because *"does the extension
load"* is a precondition for the Invariant E suite rather than the capability it needs. The
suite must also **observe** and **block**. It cannot.

| Question | Result |
|---|---|
| Does a Playwright-driven browser load the unpacked MV3 extension? | **Edge 152: YES · Chrome 152: NO** |
| Does Playwright's **own bundled** Chromium load it? | **`UNKNOWN`** — the binary would not execute here |
| Can Playwright observe egress from the MV3 **service worker**? | **YES** |
| Can Playwright observe egress from the MV3 **offscreen document**? | **NO** — 3 of 3 runs |
| Can Playwright **block** offscreen-document egress? | **NO** — the POST reached the wire under an abort-everything route, 3 of 3 runs |

`docs/architecture/constitution.md` section 5 places payload assembly and inference in the
**offscreen document**. `context.route()` is therefore blind to the context PratiBimb sends
from, and a suite written on it would assert *zero outbound requests*, pass, and prove
nothing. **QG-04 cannot be signed off on the current enforcement plan.** No invariant was
weakened; the replacement vehicle is an ADR decision and is not made here. See issue #5.

Root cause: CDP reports the offscreen document as a `background_page` target; Playwright's
`BrowserContext` does not surface it, so the route handler never attaches to it.

**Three variants could not be run**, and are recorded rather than glossed: Playwright's
browser CDN returns **HTTP 400** on this network, and the Chrome for Testing 153.0.8010.12
build it names **will not start** on this machine (side-by-side configuration error).
**The literal S-01b question therefore remains `UNKNOWN`.**

Evidence: [`W1-S01b`](../../artifacts/experiments/W1-S01b-playwright-extension-loading/README.md)

| # | New question raised by S-01b | Status | Blocks |
|---|---|---|---|
| S-01b-1 | Does the interception gap reproduce on **`ubuntu-latest` with Playwright's own Chromium** — the real CI cell? | `UNKNOWN` | **QG-04 enforcement plan** |
| S-01b-2 | Which vehicle enforces Invariant E mechanism (2)? **Requires an ADR.** | `UNKNOWN` | **QG-04 sign-off** |
| S-01b-3 | Is the gap a Playwright limitation or specific to Edge? | `UNKNOWN` | Scope of S-01b-2 |

### B-02 result — recorded 2026-09-07

**CONDITIONAL.** Same machine and browser as S-01b (workstation 2, Playwright 1.63.0,
branded Edge 152, MV3 offscreen document). Answers the question S-01b left open: *what
mechanism can this project actually trust?*

Four mechanisms, five cases, checked against a loopback collector that recomputes SHA-256
over the bytes it actually received:

| Mechanism | Observes offscreen egress | Blocks it | Proves bytes on the wire |
|---|---|---|---|
| **M1** Playwright `context.route()` | **NO** — 0 of 5 | **NO** — blocked 0 while the payload arrived | no |
| **M2** CDP `Fetch` on the offscreen target | **YES** — 5 of 5 | **YES** — collector confirmed zero arrivals | attempt only |
| **M3** independent loopback collector | **YES** — 8 of 8 arrivals | no (cannot block) | **YES — recomputed hash** |
| **M5** extension self-audit log | self-reported | no | no |

Three results carry the finding:

- An **unauthorised sender** that bypassed the egress module arrived with **no correlation id
  and no declared hash**. Absent provenance is detectable from outside the browser.
- A **tampered send** — declaring the verified artifact's hash but transmitting different
  bytes — was caught by the collector as **`hashMatches: false`**. **The payload pin
  (INV-02/INV-03) is externally checkable, not merely an internal control.**
- **Playwright, told to abort every request, blocked none and the payload reached the wire.**

**No single mechanism answers all five sub-questions (A–E). `M2 + M3` does**, and their
failure modes are independent — M2 is instrumentation inside the process under test, M3
adjudicates from outside it.

A deterministic **regression guard** now encodes the exact false-green failure mode
(3 of 3 runs, verdict PASS): *Playwright reports no offscreen request while the independent
arrival check sees it reach the wire.*

**`docs/security/security-invariants.md` is unchanged. Invariant E is not weakened. QG-04
remains unsigned** — adopting a mechanism changes how a frozen invariant is enforced and
requires an ADR. See issue #5.

Evidence: [`W1-B02`](../../artifacts/experiments/W1-B02-invariant-e-observation/README.md)

| # | New question raised by B-02 | Status | Blocks |
|---|---|---|---|
| B-02-1 | Does this reproduce on **`ubuntu-latest` with Playwright's own Chromium** — the real CI cell? | **PARTLY ANSWERED — see below** | **QG-04 sign-off** |



### B-02-1 result (Linux) — recorded 2026-09-07

**CONDITIONAL.** Re-run inside **WSL2 Ubuntu 26.04** against **Chrome for Testing
153.0.8010.12** — the build Playwright 1.63.0 names for chromium v1243 — **headful and
headless**. 66 runs, every cell unanimous, **headless identical to headful in every one**.

Evidence: [`W1-B02-1`](../../artifacts/experiments/W1-B02-1-linux-observation/README.md)

| Case | mechanism | ground truth | false green |
|---|---|---|---|
| Playwright enforcing | **`NOT_OBSERVED`** 3/3 both modes | ARRIVED | **YES** |
| CDP `auto-attach` enforcing | **`BLOCKED_CONFIRMED`** 3/3 both modes | NO_ARRIVAL | no |
| race, `late-attach` | **`NOT_OBSERVED`** 5/5 both modes | ARRIVED | **YES** |
| race, `auto-attach` | **`BLOCKED_CONFIRMED`** 5/5 both modes | NO_ARRIVAL | no |
| injected: CDP endpoint unreachable | `NOT_OBSERVABLE` 3/3 | NO_ARRIVAL | no |
| **injected: `Fetch.enable` skipped** | **`NOT_OBSERVED`** 3/3 | **ARRIVED** | **YES** |

**The finding that changes the wording of the recommendation: CDP auto-attach does NOT fail
closed on its own.** With `Fetch.enable` skipped while attachment still succeeded, it
reported nothing while the payload reached the wire — from CDP's side indistinguishable from
a clean run in which nothing was sent. **Only the independent collector caught it.** A
connection failure is loud (`NOT_OBSERVABLE`); a *partial* failure is silent, and partial
failures are the common kind in CI. The collector is therefore **not redundancy — it is what
makes the pair fail-closed**, and the ADR (B-02-2) should say so in those terms.

**CI is NOT validated and is not claimed.** `ubuntu-latest` resolves to **`ubuntu-24.04`**
(image `20260831.293`, observed in this repository's own Actions run); this ran on **Ubuntu
26.04 under WSL2** — a different release and kernel, with no GPU and no WSLg on a hosted
runner. Recorded as **CI-relevant evidence**; the CI result itself stays `UNKNOWN`.

**QG-04 remains unsigned.**

| # | New question raised by B-02-1 | Status | Blocks |
|---|---|---|---|
| B-02-1a | Run the matrix in the **real GitHub Actions cell** (`ubuntu-24.04`, hosted runner) | `UNKNOWN` | **QG-04 sign-off** |
| B-02-1b | Capture `fetchEnabledMs` directly — key on target **type** plus `Target.targetInfoChanged`, so `instrumentationBeforeSend` is measured rather than inferred from the outcome | `UNKNOWN` | Confidence in the ordering claim |
| B-02-1c | Add the **partial-instrumentation-failure** case to the permanent regression suite — it is the failure mode that fails open | `UNKNOWN` | **QG-04 enforcement design** |
| B-02-2 | **ADR** adopting or rejecting M2 + M3 as Invariant E mechanism (2) | `UNKNOWN` | **QG-04 sign-off** |
| B-02-3 | Does `Target.setAutoAttach` + `waitForDebuggerOnStart` close M2's target-discovery race? | `UNKNOWN` | Confidence in M2 |
| B-02-4 | What bounds M3's blind spot for destinations it does not host? | `UNKNOWN` | Completeness of mechanism (3) |

---

> **GPU adapter availability from extension background contexts has been inconsistent.**
> If S-01 or S-02 returns null, **every WebGPU number in the dossier becomes the WASM
> number and the entire performance story changes.**
>
> The spike does not stop at the adapter. **"WebGPU when available, WASM always" is an
> objective, not an observed fact** — a specific model on a specific backend either works
> or it does not, and finding out in week five is finding out too late. **Every model is
> run in every context before the build commits to it.**

---

## The WebGPU position, stated precisely

The engineering rule is simple: feature-detect `navigator.gpu`, always ship a benchmarked
WASM path, and show which one is live. **But give the accurate reason.**

- WebGPU is **not** missing from Firefox. It shipped by default on **Windows in Firefox
  141**, reached **Apple Silicon macOS in 145** and the remaining macOS versions in **147**.
- **Chrome** has had it since **113**; **Safari** since version **26**.
- **The real gap is Firefox on Linux**, where it remains disabled by default and is
  enabled through `dom.webgpu.enabled` in `about:config` on the release channel, with
  Mozilla targeting a **2026** ship.
- **Android Firefox is later still**, and **driver blocklists affect older hardware
  everywhere**.

> Saying "Firefox doesn't support WebGPU" to a panel that has read the release notes costs
> credibility on a point where the engineering was right.

**Note:** the browser-version facts above are **quoted from the dossier**. They are
`INFERENCE` from a document, not `FACT` observed in this environment, and should be
re-checked against release notes before they appear on a slide.

---

## Related risk (dossier section 13)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Judging machine has no WebGPU — Firefox on Linux | **High** | WASM path built and benchmarked from week one; both budgets published; live backend shown in the ledger; **never ship WebGPU-only** |
| WebAssembly heap exhaustion with several models | **High** | Per-worker isolation, WebGPU provider, lazy loading, measured teardown, explicit thread count |
| Panel reads the build as a DOM scraper, not a vision agent | **High** | T1 vision on every changed frame; a scanned-ID segment in the demo where the DOM is empty by construction; the local-decision path shown as vision-driven; tier firing distribution on the slide |
