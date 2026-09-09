---
id: W1-S04a
title: "S-04a — ORT session lifecycle with a real model, in the WASM growth regime"
status: recorded
date: 2026-09-08
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-04a — the growth regime, reached

> S-04 found three sessions sharing a flat 16 MB arena and no leak, and stated plainly that
> **its 174-byte fixture never forced `WebAssembly.Memory.grow()`**, so the memory-risk regime
> the dossier actually worries about was untested.
>
> **This experiment reaches that regime.** YuNet forces three `grow()` calls.

## Hypothesis

Pre-registered before the model was fetched:

> **H1.** A real perception model will force `WebAssembly.Memory.grow()` where S-04's
> 174-byte fixture did not.
> **H2.** Once the heap has grown, additional ORT sessions in the same context will still
> share the arena rather than each requiring their own growing heap.
> **H3.** Repeated create/infer/destroy cycles after growth will NOT increase the footprint
> without bound.
> **H4.** Output will remain numerically correct against native ONNX Runtime across growth.

**H1 is a gate, not a result:** if no `grow()` occurs, the lifecycle numbers are void and the
experiment fails to reach its own subject. That check is §2 below and is reported separately.

## Environment

| | |
|---|---|
| Browsers | Chrome for Testing **153.0.8010.12**, Firefox **155.0.1** |
| Platforms | Windows 11 Home Single Language 10.0.26200; WSL2 Ubuntu 26.04 on the same host |
| Contexts | Chrome MV3 service worker, offscreen document, dedicated worker inside the offscreen document; Firefox MV3 event page |
| Runtime | ONNX Runtime Web **1.29.0** (MIT), `wasm` and `webgpu` backends, `numThreads: 1` |
| Reference | native `onnxruntime` **1.29.0** (Python, CPUExecutionProvider) |
| Modes | headful and headless, both compared |
| Network | loopback `127.0.0.1:8908` only; no egress; model inlined at build time |
| Data | synthetic deterministic input; **no PII, no secrets, no production model** |

Full detail in `environment.json`.

## Expected result

Stated before the runs, so that a surprise is visible as a surprise:

- **Expected:** one or more `grow()` calls from a single session (**H1**); sessions 2 and 3
  adding little or nothing (**H2**, carrying S-04 forward); a plateau across repeated cycles
  (**H3**); correct output throughout (**H4**).
- **Expected to differ:** Firefox using more than one `Memory` instance, as in S-04.
- **Expected to fail:** the Chrome MV3 service worker, which cannot load ORT at all (S-03).
- **Not expected, and therefore worth flagging when it happened:** that growth would be driven
  by *inference* rather than by session creation, and that the WebGPU backend would need
  **less** WASM heap rather than the same amount.

## The model

| Field | Value |
|---|---|
| Model | **YuNet face detector** — `face_detection_yunet_2023mar.onnx` |
| Source | `opencv/opencv_zoo`, `models/face_detection_yunet/` |
| **Revision** | **`47534e27c9851bb1128ccc0102f1145e27f23f98`** |
| **Licence** | **Apache License 2.0**, read **from that revision**, not from a README |
| Size | **232,589 bytes** |
| **SHA-256** | **`8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`** |
| Graph | opset 11, ir_version 6, **106 nodes**, 112 initializers, **53 Conv** + 15 Relu + 12 Transpose + 12 Reshape + 6 Sigmoid + 4 MaxPool + 2 Resize + 2 Add |
| Input | `[1, 3, 640, 640]` — **4.7 MB per input tensor** |
| Outputs | **12**, 134,400 floats total |

**Dossier-consistent:** YuNet is the `FaceDetector` pinned default in
`docs/architecture/constitution.md` §8. A real perception model, not a fixture.

> **Weights are NOT committed.** `harness/fetch-model.sh` records the revision, licence, size
> and hash, and refuses to proceed on a hash mismatch.

## Correctness reference

`harness/mkref.py` runs the identical deterministic input (`x[i] = ((i*37) % 255) / 255`)
through **native onnxruntime 1.29.0 (Python, CPUExecutionProvider)** — deliberately the same
version as ORT Web 1.29.0 — and records, per output: count, min, max, sum and four values at
fixed sampled indices.

Bit-equality across native ORT and ORT Web is not guaranteed, so comparison uses a relative
tolerance of 2e-3. **Measured worst relative error: 3.62e-05 (wasm), 7.36e-06 (webgpu)** — one
to two orders of magnitude inside tolerance.

## §2 pre-check — does one session actually force growth?

**Required before any lifecycle claim. Answer: YES.**

| Snapshot | pages | MB | grow count |
|---|---|---|---|
| baseline | 0 | 0 | 0 |
| after-create-1 | 256 | **16** | **0** |
| **after-infer-1** | 452 | **28.3** | **2** |

**Growth is triggered by inference, not by session creation.** Creating the session allocates
ORT's 16 MB arena and nothing more; the 4.7 MB input tensor and the convolution intermediates
force the growth.

## Actual result — FACT

### The WASM backend — Chrome and Firefox, Windows and Linux, headful and headless

**Every cell below produced the identical table:**

| Snapshot | pages | MB | **grows** |
|---|---|---|---|
| baseline | 0 | 0 | 0 |
| after-create-1 | 256 | 16 | 0 |
| after-infer-1 | 452 | 28.3 | **2** |
| **after-create-2** | 452 | **28.3** | **2** |
| **after-create-3** | 452 | **28.3** | **2** |
| after-infer-all-3 | 543 | **33.9** | **3** |
| after-destroy-1/2/3 | 543 | 33.9 | 3 |
| **after-cycle-1 … after-cycle-5** | 543 | **33.9** | **3** |

```
grow  +96 pages   16   -> 22   MB
grow  +100 pages  22   -> 28.3 MB
grow  +91 pages   28.3 -> 33.9 MB
```

**19 inferences × 12 outputs per cell, all correct, worst relative error 3.62e-05.**

Cells: Chrome offscreen document and offscreen dedicated worker (Windows + WSL2 Linux,
headful + headless), **and the Firefox MV3 event page**. Chrome's MV3 service worker still
cannot run ORT at all (S-03: `import() is disallowed on ServiceWorkerGlobalScope`).

**Firefox differs in exactly one respect and it is cosmetic:** it uses **2** `WebAssembly.Memory`
instances where Chrome uses **1**, with the same total, the same three grow steps, the same
plateau and the **same worst relative error to seven significant figures**. `SharedArrayBuffer`
is absent, so Firefox is necessarily single-threaded.

> The Firefox cell reads `INCONCLUSIVE` in earlier drafts of this experiment. **It is now
> filled.** The reason it was not is a defect in this harness, diagnosed and fixed — see
> **"The Firefox result was nearly a false negative"** below.

### The WebGPU backend — measured from a cold heap

**This is the headline number, and it is 43% lower.**

| Snapshot | pages | MB | grows |
|---|---|---|---|
| baseline | 0 | 0 | 0 |
| after-create-1 | 256 | 16 | 0 |
| **after-infer-1** | 308 | **19.3** | **1** |
| after-create-2/3, after-infer-all-3 | 308 | **19.3** | **1** |
| after-destroy-1/2/3 | 308 | 19.3 | 1 |
| **after-cycle-1 … after-cycle-5** | 308 | **19.3** | **1** |

| Backend | grows | final WASM heap |
|---|---|---|
| `wasm` | **3** | **33.9 MB** |
| `webgpu` | **1** | **19.3 MB** |

**A single +52-page grow, then completely flat** across 3 concurrent sessions, 19 inferences
and 5 further lifecycles. Identical headful and headless. Worst relative error **7.36e-06** —
*better* than the WASM path.

> **This had to be measured twice.** In the default run order both backends share one context
> with `wasm` first, so the `webgpu` cell inherits an already-grown 33.9 MB arena and appears
> to add *zero*. That looked like the stronger result and was **confounded**. Re-running
> WebGPU alone from a cold heap (`COLD_START_BACKEND=webgpu`) gives the honest figure:
> **19.3 MB, one grow.**

## §6 — the critical question, answered

**Q: Does each additional ORT session require a new growing WASM heap?**

**No.** **Sessions 2 and 3 added zero pages and zero grows** — 28.3 MB before and after both.
The third grow came only when **three sessions inferred concurrently**, as one +91-page step.

**Q: After growth, does repeated teardown/recreation grow the footprint without bound?**

**No.** After the initial growth, **five further create-3/infer/destroy-3 cycles — 15 more
session lifecycles — produced zero additional grows.** Flat in every context, both browsers,
both platforms, both backends, headful and headless.

> **The footprint is bounded by the working set, not by the number of sessions or the number
> of lifecycles.**

## Findings

**Finding 1 — growth is bounded and plateaus.** 0 → 16 → 28.3 → 33.9 MB, then stops. 18
sessions and 19 inferences produce **3 grows**, all inside the first second.

**Finding 2 — sessions genuinely share the arena under real allocation pressure.** S-04 showed
sharing with a trivial model, where it could have been an artefact of nothing being allocated.
**It holds when real convolution workspaces are in play.**

**Finding 3 — the WebGPU EP relieves WASM heap pressure, and the size of the effect is now
measured: 19.3 MB vs 33.9 MB, 1 grow vs 3.** `constitution.md` §11's stated mitigation —
*"prefer the WebGPU execution provider so allocations live GPU-side"* — is **confirmed by
cold-start measurement**. What moved GPU-side is **not** measured; no VRAM claim is made.

**Finding 4 — teardown reclaims nothing within a heap**, exactly as in S-04, and exactly as
the WASM specification requires (`Memory` has `grow()` and no inverse). **Not a leak.** The
mitigation remains worker teardown (`constitution.md` §7).

**Finding 5 — Chrome/Firefox parity is essentially exact** on this workload: same steps, same
plateau, same relative error. The only difference is instance count (2 vs 1).

## The Firefox result was nearly a false negative

Three Firefox runs reported `timedOut: true` at 120 s and twice at 900 s. The draft assessment
was that YuNet inference is too slow in a Firefox event page — with a named basis (S-04 had
completed 18 tiny-model inferences in the same harness inside 120 s).

**That was wrong, and the data already contained the refutation.** The one Firefox run that
did complete shows `after-create-1` at 1162 ms and `after-infer-1` at 1207 ms: **a YuNet
inference takes 45 ms.** The entire Chrome suite — 12 contexts × 19 inferences — finishes in
**15 seconds**. Nothing was slow.

**Root cause:** the Firefox event page cannot `fetch` (host permissions are gated behind MV3
origin controls, S-02a-2), so it reports through a tab-navigation beacon — the payload rides
**in the HTTP request line**. A full report is ~80 KB encoded. **Node's `http.createServer()`
defaults to a 16,384-byte `maxHeaderSize`** and rejects anything larger with
`HPE_HEADER_OVERFLOW` **before the request handler runs**. The collector recorded nothing, so
the runner waited out its deadline. Both failures carried `liveness: true` — the event page was
fine all along.

**Reproduction, no browser, under a second** — `harness/repro-collector-header-overflow.js`:

```
-- DEFAULT server options (what the S-04a collector used) --
{"payloadBytes":16000, "handlerRan":true,  "status":200}
{"payloadBytes":80000, "handlerRan":false, "clientError":"HPE_HEADER_OVERFLOW"}
-- WITH maxHeaderSize: 2,000,000 --
{"payloadBytes":80000, "handlerRan":true,  "status":200}
```

**Fixed by chunked delivery** — 8 KB pieces through one reused tab, confirmed in order,
concatenated raw and decoded once — **plus a collector that asserts completeness** and reports
any incomplete chunk set. The last part matters most: the original defect was not that
delivery failed, but that failure and "nothing to report" looked identical. The fixed run
logs `chunk 1/9 … 9/9`, `incompleteChunkSets: []`, `timedOut: false`.

**This is a harness defect, not a product finding.** It is recorded because it nearly became a
false capability claim about Firefox, and because *"the instrument failed open"* is the same
failure mode the CDP/collector pairing in B-02 exists to prevent. That parallel should carry
into **B-02-2**.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Was the growth regime reached? | **FACT — yes**, 3 grows |
| Per-session new heap? | **FACT — no**, sessions 2 and 3 added zero pages |
| Unbounded growth on repeated cycles? | **FACT — no**, 15 further lifecycles, zero grows |
| Does teardown reclaim? | **FACT — no, and that is spec-correct** |
| Correctness under growth? | **FACT — yes**, 19 × 12 outputs per cell |
| Does WebGPU relieve heap pressure? | **FACT — yes, 19.3 MB vs 33.9 MB** (cold start) |
| Firefox lifecycle? | **FACT — identical to Chrome** |
| GPU memory? | **`UNKNOWN`** — not visible to this instrumentation |
| Failure behaviour under memory constraint? | **`UNKNOWN`** — never reached |

## Conclusion

**CONDITIONAL — the mechanism is healthy, and the risk is narrowed but not cleared.**

The growth regime was genuinely entered, and inside it the behaviour is **bounded and
correct**: sessions share one arena, additional sessions cost nothing, growth stops at
33.9 MB (19.3 MB on WebGPU), and fifteen further lifecycles add nothing at all. Every
inference stayed correct against native ORT, in every context on both browsers.

**It stays CONDITIONAL for three concrete reasons:**

1. **One model, not four.** The dossier's risk is **~120 MB resident across the UI detector,
   YuNet, PP-OCRv5 and GLiNER** — *different* models coexisting. Three YuNet sessions share
   weights and workspace shapes; four distinct graphs will not. **That is the real test and it
   has not been run.**
2. **Failure-under-constraint (§8) was never reached.** Nothing came close to exhausting the
   heap, so the explicit-failure behaviour the task asks about **could not be observed.**
3. **GPU-side memory is invisible** to this instrumentation, so the WebGPU saving is a
   *WASM-heap* saving, not a total-memory saving.

## What this does NOT establish

- **Nothing about four different models resident together** — the actual dossier risk.
- **No latency or accuracy claim.** Runtime feasibility, memory and lifecycle only.
  **QG-03 remains open** — one model does not fill the model matrix.
- **Nothing about GPU memory**, so no total-footprint claim for the WebGPU path.
- **Nothing about behaviour under memory pressure.**

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-04a-1 | **Four *different* models resident together** — the actual dossier risk. Needs PP-OCRv5 and GLiNER pinned first | **p1** | Tier design, QG-03 |
| S-04a-3 | Drive the heap to actual exhaustion and observe failure behaviour (§8): explicit failure, no state corruption, no silently invalid output | **p1** | Fail-closed guarantees |
| S-04a-4 | Measure GPU-side memory for the WebGPU EP — the 19.3 MB saving is only half the picture | p2 | The WebGPU budget |

## Reproducibility

```bash
bash harness/fetch-model.sh            # refuses on sha256 mismatch
python3 harness/mkref.py               # CPU reference from native ORT 1.29.0
node harness/build-extension.js
PLATFORM_LABEL=windows CHROME_PATH='...' RUNS=1 node harness/run-s04a-chrome.js
COLD_START_BACKEND=webgpu PLATFORM_LABEL=windows-webgpu-coldstart ... node harness/run-s04a-chrome.js
PLATFORM_LABEL=windows-fixed FIREFOX_PATH='...' RUNS=1 node harness/run-s04a-firefox.js
```

`commands.md` records which configuration produced which log. Loopback only, `127.0.0.1:8908`.

## Scope

**YuNet `8f2383e4…` · ORT Web 1.29.0 · Chrome for Testing 153.0.8010.12 and Firefox 155.0.1 ·
native Windows 11 and WSL2 Ubuntu 26.04 · single-threaded WASM and WebGPU.** Per `AGENTS.md`
§5 this fills the cells it tested and no others.
