---
id: W1-QG03-t1-detector-runtime
title: "QG-03 — the real T1 detector, in real browsers"
status: recorded
date: 2026-09-11
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
workstation: 1 (LAPTOP-6E14K34L)
---

# QG-03 — the actual trained detector, executed in four browser/backend cells

> **S-03 measured that an ORT Web session can be created and run, using a 174-byte two-op
> synthetic model, and said so plainly: it did *not* satisfy QG-03, and it raised
> **S-03c — "repeat with a real detector before any latency figure is quoted"**.
>
> **This is S-03c.** The model is the real 302,960-byte artifact at revision
> `ba6d9e93695b`, and nothing is substituted for it.

## The verdict in one paragraph

**The ONNX graph runs correctly in every cell that has a backend at all** — agreement with
the Python reference of **5.6e-06 on class channels** and **1.6e-03 model pixels on box
channels**, bitwise-deterministic across repeated calls, in 7 of 8 cells. **The eighth,
Firefox WebGPU headless, has no GPU adapter at release defaults and is `REJECT`.**

**But the detector is still not adoptable, and QG-03 is `CONDITIONAL` rather than `ACCEPT`,
for a reason none of the correctness numbers show:** when the browser performs the
letterboxing *itself* — which is the only thing it can do in production, because
`captureVisibleTab` hands it a PNG and not a tensor — **16% to 34% of the reference
detections disappear.** The arithmetic is right. The pixels are not the pixels the model was
trained on, and no browser can make them so.

---

## Hypothesis

**Only one thing here was formally pre-registered, and it is important to say which.**

**Pre-registered, before any browser was launched** — written into
`tools/detector/qg03_reference.py` and recorded in `reference-summary.json` as
`criterion.preRegistered`:

> **H1.** Browser ORT output will agree with the Python reference within **1e-4** on class
> channels and **0.25 model pixels** on box channels, with **bitwise-identical** repeated
> inference. Bounds derived from the model's own arithmetic — sigmoid outputs against fp32
> SIMD noise, and `exp()` amplification on the box channels — not from any observed run.

**Also fixed in advance, inherited from earlier spikes rather than chosen here:**

> **H2.** Firefox is measured at **release defaults**. `dom.webgpu.enabled` is not touched.
> A result requiring an `about:config` change is `CONDITIONAL`, never `ACCEPT` (S-02a).
>
> **H3.** A WebGPU cell may only claim the GPU ran if **GPU command submissions are counted**
> during inference. ORT reporting `"webgpu"` is configuration, not execution.

**Not pre-registered, and acknowledged as a process shortfall:** no expectation was recorded
in advance for latency, memory, backend ranking, or the preprocessing-parity measurement —
the last of which did not exist until the harness was being written. Those are reported as
observations without a prior, and the honest consequence is that **none of them can be
described as confirming or refuting anything.** S-04a-1 did this properly; this experiment
did not, and the next one should.

## Expected result

Stated as what was actually believed going in, with the pre-registration status of each
attached, so a surprise is visible as a surprise:

- **Expected (H1, pre-registered):** correctness within the criterion. **Met** — roughly two
  orders of magnitude inside it.
- **Expected, not pre-registered:** WebGPU faster than WASM; the WASM columns to pass
  everywhere; no network arrivals beyond ADR-0001's pinned artifact. All held.
- **Not expected, and therefore flagged where it happened:**
  - **Firefox WebGPU headless has no adapter at all** at release defaults — and CI is headless.
  - **Firefox WebGPU is slower than Firefox WASM** (100 ms against 33 ms), and 8.6× slower
    than Chromium WebGPU on the same machine.
  - **The browser's own letterboxing loses 16–34% of detections.** This is the result that
    decides the verdict, and no prior existed for it because the measurement was invented
    while building the harness.
  - **Chromium and Firefox canvas resampling disagree with each other**, and Firefox ignores
    `imageSmoothingQuality` entirely.

## Environment

Full detail in [`environment.json`](environment.json). Summary: **workstation 1**
(`LAPTOP-6E14K34L`), Windows 11 build 26200, Intel Core 7 240H, Intel iGPU + RTX 5050.
Unbranded Chromium **151.0.7922.34** (branded Chrome 152 refuses `--load-extension`) and
Firefox **155.0.1** release. ORT Web **1.29.0**, `numThreads = 1`. **Linux not used;
Firefox on Linux remains `UNKNOWN`.**

## Actual result

Sections 2 through 6 below are the actual result. In brief: **7 of 8 cells ACCEPT on
correctness, determinism, latency and memory; Firefox WebGPU headless REJECT; and the
browser-side preprocessing measurement in §4 is what makes the overall verdict
`CONDITIONAL` rather than `ACCEPT`.**

## Conclusion

**`CONDITIONAL`.** The artifact executes correctly, deterministically and cheaply in real
browsers, through ADR-0001's pinned runtime, with no egress and no runtime model download.
**It is still not adoptable**, because the preprocessing a browser can actually perform
changes 16–34% of its detections — an input-distribution robustness failure that is neither
an ORT defect nor a capacity limit. Full reasoning and recommendations in
[`decision.md`](decision.md).

---

## 1. What was measured, and against what

| | |
|---|---|
| Model | `pratibimb-t1-ui-head`, revision **`ba6d9e93695b`** |
| Artifact | `t1-ui-head.onnx`, **302,960 bytes**, sha256 `ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0` |
| Input | `images` `[1, 3, 640, 640]` `tensor(float)`, NCHW, RGB, 0..1, pad 114/255 |
| Output | `output` `[1, 12, 6400]` `tensor(float)` — `[1, 4+C, A]`, cx/cy/w/h in model px then 8 class scores |
| Runtime | ONNX Runtime Web **1.29.0**, `ort.all.min.js`, `numThreads = 1` |
| Loading | **ADR-0001's own path** — `installVerifiedOrtRuntime()` then `createPinnedInferenceSession()`, from the shipped `@pratibimb/security` |
| Postprocessing | **the shipped compiled `@pratibimb/perception`**, copied into the extension verbatim — no bundler, no re-implementation |
| Reference | `onnxruntime` 1.20.1 CPU + torch 2.14.0, **eval mode asserted on every submodule, before and after** |

The artifact is **not committed** (`artifacts/models/` is gitignored and `verify-repo.py`
bans `.onnx`). The tracked authority on which artifact the project has published evidence
for is `artifacts/gates/T1-detector-training/qg05-detector-evaluation.json`, and
`qg03_reference.py` **refuses to run** if the local file's hash disagrees with it.

### The correctness criterion was pre-registered

Fixed **before any browser was launched**, and derived from the model's own arithmetic
rather than from whatever the first run produced:

| | bound | why |
|---|---|---|
| class channels | **1e-4** absolute | sigmoid outputs; fp32 SIMD accumulation noise is ~1e-6, so this is ~100× noise |
| box channels | **0.25** model px | `w = exp(clamp(tw, max=6)) · 8`, so `exp` turns a 1e-5 logit error into a 1e-5 *relative* error — 4.4e-3 absolute at w≈440. The torch-vs-ORT export figure on that channel was 5.6e-3. |
| shape | exact | — |
| determinism | **bitwise** across repeated calls | not a tolerance. Output that moves between identical calls cannot be regression-tested, and the change gate downstream would fire on noise. |

---

## 2. The matrix

**Unit of evidence: browser × backend × model artifact × display mode.** Nothing is merged
across those axes, because the Firefox WebGPU rows *disagree* and an average would describe
neither.

| browser | backend | display | LOAD | CORRECT | warm p50 | warm p95 | cold session | first inference | WASM heap | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Chromium 151 | wasm | headful | 3/3 | ✅ | 41.0 ms | 107.5 ms | 372 ms | 53.5 ms | 26.4 MB | **ACCEPT** |
| Chromium 151 | wasm | headless | 3/3 | ✅ | **28.2 ms** | 30.1 ms | 329 ms | 48.8 ms | 26.4 MB | **ACCEPT** |
| Chromium 151 | webgpu | headful | 3/3 | ✅ | 11.6 ms | 14.7 ms | 417 ms | 287 ms | 16.0 MB | **ACCEPT** |
| Chromium 151 | webgpu | headless | 3/3 | ✅ | **10.9 ms** | 13.0 ms | 411 ms | 260 ms | 16.0 MB | **ACCEPT** |
| Firefox 155.0.1 | wasm | headful | 3/3 | ✅ | 33.0 ms | 41.0 ms | 161 ms | 40.0 ms | 26.4 MB | **ACCEPT** |
| Firefox 155.0.1 | wasm | headless | 3/3 | ✅ | 36.0 ms | 44.0 ms | 169 ms | 45.0 ms | 26.4 MB | **ACCEPT** |
| Firefox 155.0.1 | webgpu | headful | 3/3 | ✅ | **100 ms** | 102 ms | 1,198 ms | **3,134 ms** | 16.0 MB | **ACCEPT** |
| Firefox 155.0.1 | webgpu | headless | **0/3** | — | — | — | — | — | — | **REJECT** |

Windows 11 build 26200, workstation 1, Intel Core 7 240H. **Linux is NOT MEASURED and
Firefox on Linux remains `UNKNOWN`, exactly as S-02a-1 left it.**

### Against the dossier's projected budget

The benchmark contract projects **35 ms (WebGPU) / 140 ms (WASM)** for UI element detection.

| cell | measured | projected | |
|---|---|---|---|
| Chromium WebGPU | 10.9–11.6 ms | 35 ms | **3× inside budget** |
| Chromium WASM | 28.2–41.0 ms | 140 ms | **3.4–5× inside budget** |
| Firefox WASM | 33.0–36.0 ms | 140 ms | **3.9× inside budget** |
| Firefox WebGPU | 100 ms | 35 ms | **2.9× OVER the WebGPU budget** — though still inside the WASM one |

> **This is not a validation of the dossier's budget.** A 61,468-parameter model is supposed
> to be fast. The figure that would test the budget is a detector good enough to adopt, and
> that does not exist yet. What these numbers *do* establish is that **latency is not the
> constraint on this model** — which is worth knowing before anyone optimises it.

### Firefox WebGPU is the odd cell in three separate ways

1. **Headless has no adapter at all.** `Failed to get GPU adapter`, 3/3, reproducible.
   `dom.webgpu.enabled` was **deliberately not touched** — S-02a fixed that rule in advance:
   *a result requiring an `about:config` change on the release channel is CONDITIONAL, never
   ACCEPT*. **CI is headless, so this cell is the one CI would hit.**
2. **Headful is slower than its own WASM** — 100 ms against 33 ms, and **8.6× slower than
   Chromium WebGPU**. A GPU backend that loses to the CPU backend on the same machine is a
   finding, not a footnote.
3. **First inference costs 3,134 ms** — shader compilation, paid once. Chromium pays 287 ms
   for the same thing. Warm-start compilation at extension startup (benchmark contract,
   Rule 5) is not optional on this cell.

### Backend identity was observed, not configured

`GPUQueue.prototype.submit` was wrapped **before ORT loaded** and counted during inference.
ORT reporting `"webgpu"` is a configuration; a submit count is an execution.

- Both WebGPU browsers: **CONFIRMED** — 15 submissions and 15 compute pipelines during
  inference. No cell was accepted on ORT's own say-so.
- Both WASM browsers: **0 submissions**, as expected. A WASM cell that submitted GPU work
  would be flagged, not quietly accepted.
- **Chromium selected the Intel `gen-12lp` integrated GPU**, not the RTX 5050 also present on
  this machine. Every Chromium WebGPU figure above is an **integrated-GPU** figure; the
  discrete adapter is unmeasured (S-01a).
- **Firefox returned an empty `adapterInfo`** — `identified: false`, measured rather than
  assumed from S-02. Every Firefox WebGPU figure is **"adapter unidentified"**.

---

## 3. Correctness — the part that went right

Worst case across 3 runs × 3 input cases per cell, box and class channels reported
separately because they live on different scales:

| cell | box channels (model px) | class channels | non-finite | CSS coordinate Δ |
|---|---|---|---|---|
| Chromium wasm | 1.42e-03 | 4.59e-06 | 0 | 1.10e-03 px |
| Chromium webgpu | 1.62e-03 | 5.42e-06 | 0 | 1.06e-03 px |
| Firefox wasm | 1.42e-03 | 4.59e-06 | 0 | 1.10e-03 px |
| Firefox webgpu | 1.62e-03 | 5.60e-06 | 0 | 1.05e-03 px |

Against bounds of 0.25 model px and 1e-4 — **roughly two orders of magnitude inside the
pre-registered criterion on both axes**, and identical between the two browsers on the same
backend, which is itself evidence that the divergence is the backend's and not the browser's.

**Determinism: bitwise identical, every run, every cell.** Not "within tolerance".

### The whole path, not just the tensor

Every successful cell ran the complete chain through the **shipped typed contract** —
`createUiElementDetector(...).detect(frame, backend)`, then `validateDetections`, then
`toVisualDetections`:

- `decodeHeadOutput` → per-class NMS → `clipToContent` → `modelToCapture` → `captureToCss`
- **Detection counts, classes and emission order matched the reference exactly** (0 label
  mismatches), with worst CSS coordinate divergence **1.1e-03 px**.
- `validateDetections` **accepted** every detection: finite, positive extent, score in 0..1,
  inside the frame, string label.
- Provenance survived: every `VisualDetection` carried `frameId`, `modelId` and `revision`.

> The Python side of this comparison is a **line-for-line mirror** of `decodeHeadOutput`,
> including the tie-breaks that look incidental — strictly-greater class selection, NMS
> sorted by score with ties on original index, and the max-detections break landing *after*
> the push so the 300th box suppresses nothing. Those are reproduced rather than tidied,
> because a "cleaner" mirror would report mismatches that were really differences between
> the mirror and the shipped code.

### ADR-0001 held, and no model was fetched

Every cell installed the pin before any session existed, and every cell's **entire network
log is one arrival**:

```
<ext>/ort-wasm-simd-threaded.jsep.wasm     (27,797,172 bytes, sha256 db816fad…)
```

**Foreign-origin arrivals: 0. Model fetched at runtime: false**, in all 8 cells — the weights
are inlined as base64, so this is observable in the arrival log rather than asserted from
configuration. `fetch`, XHR, `WebSocket`, `EventSource` and `importScripts` were all wrapped.

---

## 4. The finding that blocks adoption

**Everything above fed the browser a tensor that Python had already letterboxed.** That was
deliberate — it isolates ORT's arithmetic from image resampling. But it is not what
production does. In production the browser receives a **PNG** from `captureVisibleTab` and
must letterbox it itself, with canvas resampling rather than PIL's.

So the browser was made to do exactly that, four ways, and the results compared against the
trainer's own letterboxed pixels:

| browser | sample | best variant | max Δ (0–255) | mean Δ | reference dets | browser dets | **matched @ IoU 0.5** |
|---|---|---|---|---|---|---|---|
| Chromium | dev-0000 | integer + high | 87 | 0.253 | 50 | 53 | **42 (84%)** |
| Chromium | dev-0003 | float + high | 88 | 0.436 | 53 | 52 | **39 (74%)** |
| Firefox | dev-0000 | integer + low | 110 | 0.276 | 50 | 54 | **39 (78%)** |
| Firefox | dev-0003 | float + low | 132 | 0.693 | 53 | 59 | **36 (68%)** |

**Between 16% and 32% of the detections change**, at the *best* available setting, purely
because the browser resampled the image instead of PIL.

Three things make this worse than it first looks:

1. **Chromium honours `imageSmoothingQuality`; Firefox ignores it.** Setting it `high` moved
   Chromium's mean error from 0.893 to 0.870 (and 0.633 → 0.436 on dev-0003). On Firefox the
   low and high figures are **bit-identical** — the hint does nothing. So the two browsers
   cannot even be made to agree with *each other*, let alone with the trainer.
2. **There are two letterboxes in the project and they disagree.** `computeLetterbox()` in
   the shipped package places content at a **fractional** offset (`padY = (640 − h·s)/2`);
   `letterbox_image()` in `tools/detector/data.py` pastes a rounded bitmap at an **integer**
   offset. For a 960×640 capture that is 106.67 against 106 — **the pixels the model was
   trained on are offset from the coordinates its labels were expressed in.** Sub-pixel is
   not zero, and it is invisible to a metric computed at IoU 0.5.
3. **The model has never seen anything else.** `augmentation: "none"` in the model card. It
   was trained on exactly one resampler's output and does not generalise across resamplers.

> **INFERENCE.** This is a *robustness* failure, not a browser defect and not a capacity
> failure. The most likely fix is training-side — augment with multiple resamplers, and make
> the two letterbox implementations agree — and it costs nothing in model size. It is
> recorded here and **not acted on**, because acting on it means retraining, which
> invalidates the frozen regression baseline and belongs in its own change.

---

## 5. Memory

Three quantities, never conflated.

| | Chromium wasm | Chromium webgpu | Firefox wasm | Firefox webgpu |
|---|---|---|---|---|
| model file | 0.30 MB | 0.30 MB | 0.30 MB | 0.30 MB |
| WASM heap, baseline | 0 MB | 0 MB | 0 MB | 0 MB |
| after session create | 16.0 MB | 16.0 MB | 16.0 MB | 16.0 MB |
| after first inference | **26.4 MB** | **16.0 MB** | **26.4 MB** | **16.0 MB** |
| steady state | 26.4 MB | 16.0 MB | 26.4 MB | 16.0 MB |
| after `release()` | 26.4 MB | 16.0 MB | 26.4 MB | 16.0 MB |
| JS heap, steady | 74–80 MB | 74–77 MB | *unavailable* | *unavailable* |

- **The 0.30 MB model accounts for essentially none of the 26.4 MB.** The arena is ORT's.
  Anyone quoting "0.30 MB on disk" as a memory figure would be out by roughly 90×.
- **WebGPU costs 10.4 MB less WASM heap** — allocations live GPU-side, which is exactly
  mitigation 1 of the benchmark contract's Rule 6 landmine, now observed rather than assumed.
- **`release()` returned nothing** — 26.4 MB before and after, in every cell. Consistent with
  S-04's finding that disposing a session does not reliably return linear memory. One model
  is comfortable; this is the number that matters when the fourth model arrives.
- **`performance.memory` does not exist in Firefox**, so its JS heap is recorded as `null`
  rather than `0`. An absent measurement is not a measurement of zero.

---

## 6. Three harness defects found, and what they cost

Recorded because each one produced a *plausible* wrong answer, which is the dangerous kind.

| # | Defect | How it presented | Fix |
|---|---|---|---|
| 1 | `web-ext` spawns Firefox; killing `web-ext` does not kill Firefox | **90 browser processes** accumulated across two cells. Latency measured under that load | PID-set difference reaper, verified after each run. **Every cell re-measured from a clean machine.** |
| 2 | Reaping by profile path | reported `killed: 0` while **15 processes survived** — web-ext copies the profile, and content processes don't carry it in their command line | replaced with PID-set differencing; the reap result is *verified*, not assumed |
| 3 | An interrupted run left the backend baked into `ff-background.js` with no `__CONFIG__` placeholder | `.replace()` became a **silent no-op**, and a cell labelled `webgpu` throughout its own log **actually measured WASM** | runner **fails closed** if the placeholder is absent; aggregator **refuses** to emit a cell whose label disagrees with the backend the probe reported |

Defect 3 is the one worth dwelling on. Nothing about that run looked wrong — the log said
`backend: "webgpu"`, the runs succeeded, the numbers were plausible. It was caught only
because the probe *also* reports the backend it ran, from a different code path, and the two
were compared. **A mislabelled cell is worse than a missing one, because the matrix is the
project's authority on what is proven and nothing downstream would have questioned it.**

---

## 7. What this does NOT establish

- ❌ **QG-03 is not satisfied.** This fills **one row** of a twenty-cell matrix. YuNet,
  PP-OCRv5-mobile, GLiNER-PII and SmolVLM remain `UNKNOWN`.
- ❌ **The detector is NOT adopted.** The model registry is unchanged. Browser feasibility is
  adoption items 9–13; items 11 and 14 (acceptable metrics, usable grounding) are **not met**,
  and this experiment did nothing to meet them.
- ❌ **Firefox on Linux remains `UNKNOWN`.** Nothing here may be quoted about it.
- ❌ **No claim about the discrete GPU.** Chromium chose the Intel iGPU; the RTX 5050 is
  unmeasured.
- ❌ **No accuracy claim of any kind.** The synthetic held-out figures stand as published,
  under the rule recorded with them.
- ❌ **`numThreads > 1` untested** — pinned to 1 throughout, as in S-03.
- ❌ **The SmolVLM WebGPU int8 defect was NOT imported.** This detector is fp32 and a separate
  workload; it was tested independently and shows no such failure.

## 8. Open questions raised

| # | Question | Status | Blocks |
|---|---|---|---|
| QG-03a | Can the model be made robust to browser resampling — augmentation across resamplers, and the two letterboxes reconciled? | `UNKNOWN` | **detector adoption** |
| QG-03b | Which letterbox is correct — the shipped fractional offset or the trainer's integer paste? They must agree. | `UNKNOWN` | coordinate contract, training |
| QG-03c | Why is Firefox WebGPU 8.6× slower than Chromium WebGPU on the same graph and machine? | `UNKNOWN` | backend guidance |
| QG-03d | Firefox WebGPU headless has no adapter at release defaults. Is that fixable without `about:config`? | `UNKNOWN` | **CI coverage of the WebGPU path** |
| QG-03e | Does `release()` ever return the 26.4 MB, and what happens at four models? | `UNKNOWN` | Rule 6 landmine |
| QG-03f | Chromium selects the integrated GPU. What do the figures look like on the discrete one? | `UNKNOWN` (= S-01a) | WebGPU figure labelling |
