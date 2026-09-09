---
id: W1-S04
title: "S-04 — three concurrent ORT Web sessions in one WASM heap, and whether teardown reclaims"
status: recorded
date: 2026-09-08
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-04 — ORT session lifecycle and the shared WASM heap

> This is the dossier's named landmine — *"budget a day"* — and the reason the constitution
> isolates the local VLM in its own worker and forbids loading it beside the sanitisation
> tier.

## Hypothesis

`docs/architecture/constitution.md` and dossier §11 both treat **WebAssembly heap exhaustion
with several resident models** as a **High** risk. S-03 proved one session runs. **Can three
coexist, and does destroying them give the memory back?**

## The measurement rule, stated before any number

> **A `WebAssembly.Memory` cannot shrink.** The specification provides `grow()` and no
> inverse. **So the heap returning to baseline after teardown is NOT the success criterion,
> and its failure to do so is NOT a leak.**
>
> The real question is whether **repeated** create/infer/destroy cycles keep growing the
> heap, or whether it plateaus because ORT reuses its arena.

WASM heap is measured **directly**, by wrapping `WebAssembly.Memory` before ORT loads and
summing the `byteLength` of every instance it constructs. That is far more trustworthy than
`performance.memory`, which is Chrome-only, JS-only, unavailable in workers, and — as this
experiment demonstrates — dominated by GC timing.

## Environment

| | |
|---|---|
| ORT Web | **1.29.0** (npm, pinned, MIT) |
| Chrome | Chrome for Testing **153.0.8010.12** — native Windows and WSL2 Ubuntu 26.04 |
| Firefox | **155.0.1** release — native Windows and WSL2 Ubuntu 26.04 |
| Model | the S-03 fixture: 174 bytes, `y = x*2+1` over `float32[1,262144]`, sha256 `2718406b…` |
| Backends | `wasm` (threads pinned to 1) and `webgpu` |
| Cycles | 3 sessions × 5 create/infer/destroy cycles per cell (3 cycles in the threading run) |

Harness extensions declare `'wasm-unsafe-eval'` — required (S-02a-2b), **throwaway harness
only, not adoption**.

## Expected result

Three sessions expected to coexist and the heap to grow roughly linearly with session count,
since the dossier treats concurrent residency as the risk. **The heap was expected to stay
put after teardown** (WASM cannot shrink), so the interesting signal was the repeated cycles.

## Actual result — FACT

### A. Can multiple sessions coexist? — **Yes, everywhere ORT runs at all**

| Browser / platform | Backend | 3 concurrent | 5 cycles | Correctness |
|---|---|---|---|---|
| Chrome Windows — offscreen document | wasm | ✅ | ✅ | 18/18 correct |
| Chrome Windows — offscreen document | webgpu | ✅ | ✅ | 18/18 correct |
| Chrome Windows — offscreen **dedicated worker** | wasm | ✅ | ✅ | 18/18 correct |
| Chrome Windows — offscreen **dedicated worker** | webgpu | ✅ | ✅ | 18/18 correct |
| Chrome Linux (WSL2) — both offscreen contexts | wasm | ✅ | ✅ | 18/18 correct |
| Chrome Linux (WSL2) | webgpu | ❌ no GPU adapter (environmental) | — | — |
| Firefox Windows — event page | wasm | ✅ | ✅ | 18/18 correct |
| Firefox Windows — event page | webgpu | ✅ | ✅ | 18/18 correct |
| Firefox Linux (WSL2) — event page | wasm | ✅ | ✅ | 18/18 correct |
| Firefox Linux (WSL2) | webgpu | ❌ `dom.webgpu.enabled` off (S-02a) | — | — |
| **Chrome MV3 service worker** | both | ❌ **cannot run ORT at all** (S-03) | — | — |

**Every single inference in every successful cell was element-exact** against the CPU
reference — **0 mismatches of 262,144**, 18 inferences per cell. Chrome headless was
identical to headful in every cell.

### B, C. Memory per session, and does it grow linearly? — **It did not grow at all**

Chrome, offscreen document, `wasm` (representative; every Chrome cell identical):

| Snapshot | Memory instances | **WASM MB** | JS used MB |
|---|---|---|---|
| baseline | 0 | **0** | 3.5 |
| after-create-1 | **1** | **16** | 5.4 |
| after-create-2 | **1** | **16** | 5.4 |
| after-create-3 | **1** | **16** | 5.4 |
| after-infer-all-3 | 1 | **16** | 5.4 |

> **All three sessions share ONE `WebAssembly.Memory`, and adding sessions two and three
> grew it by nothing.** The heap is allocated once, at ~16 MB, on first session creation.

**The dossier's structural premise is confirmed — they really do share one heap — but the
feared linear growth did not occur for this model.**

### D. Does teardown reclaim? — **No, and that is correct behaviour**

| Snapshot | WASM MB |
|---|---|
| after-destroy-1 | 16 |
| after-destroy-2 | 16 |
| after-destroy-3 | 16 |

Exactly as the specification requires: `WebAssembly.Memory` has no shrink. **This is not a
leak and must not be reported as one.**

### E. Do repeated cycles leak? — **No evidence of a WASM leak**

Five further create-3 / infer / destroy-3 cycles, i.e. **15 more session lifecycles**:

| Cycle | WASM MB | JS used MB |
|---|---|---|
| 1 | **16** | 12.4 |
| 2 | **16** | 12.4 |
| 3 | **16** | 12.4 |
| 4 | **16** | 12.4 |
| 5 | **16** | 24.7 |

**The WASM heap was flat at 16 MB across every cycle, in every context, on both backends, on
both platforms.** ORT reuses its arena.

**The JS heap is a different story, and it is inconclusive — deliberately reported as such.**
It rose 12.4 → 24.7 MB above. It would be easy to call that a leak. **It is not evidence of
one**, and this experiment contains its own counter-example: in the `webgpu` cell the JS heap
went **25.9 → 10.8 MB across a single step**, i.e. it was collected. `performance.memory` is
GC-timing-dominated, there is no forced-GC available, and no conclusion about JS retention
can be drawn from it either way. **Recorded as `UNKNOWN`.**

### F. Does backend choice affect lifecycle? — **No, and WebGPU shares the same heap**

The `webgpu` cells start at `1 instance / 16 MB` because the `wasm` cell ran first in the
same context — **ORT's WebGPU (JSEP) backend runs through the same WASM module and does not
allocate a second heap.** Lifecycle behaviour is otherwise identical.

**GPU-side memory is not visible to this instrumentation and is not measured.** Any
VRAM claim would be unfounded.

### G. Does Firefox differ from Chrome? — **Yes, in one measurable way**

| | Memory instances | Total WASM MB | Behaviour across cycles |
|---|---|---|---|
| **Chrome** | **1** | 16 | flat |
| **Firefox** | **2** | 16 | flat |

Firefox constructs **two** `WebAssembly.Memory` instances totalling the same 16 MB. Total
size, growth behaviour and correctness are identical. `performance.memory` does not exist in
Firefox, so no JS-heap figure is available there — recorded, not guessed.

## S-03b — threading (Chrome, where `SharedArrayBuffer` exists)

| Context | Requested threads | ORT reported | SAB | WASM MB | Correctness |
|---|---|---|---|---|---|
| offscreen document | 1 | 1 | true | 16 | 12/12 correct |
| offscreen document | **4** | **4** | true | 16 | **12/12 correct** |
| offscreen dedicated worker | 1 | 1 | true | 16 | 12/12 correct |
| offscreen dedicated worker | **4** | **4** | true | 16 | **12/12 correct** |

**Multi-threaded WASM is FEASIBLE in Chrome extension contexts** — ORT accepted
`numThreads: 4`, sessions created, output correct, heap unchanged.

**Two honest limits.** ORT *reporting* 4 is not proof that four pthreads materialised; the
worker pool was not separately observed. And **no performance claim is made** — the model is
two elementwise ops and would not show threading benefit even if the pool were fully live.
**Feasibility only.**

Firefox remains **single-threaded by necessity**: `SharedArrayBuffer` is `false` there
(S-02a-2b), confirmed again here.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Can three sessions coexist? | **FACT — yes**, every context where ORT runs |
| Memory per session? | **FACT — one shared 16 MB heap; sessions 2 and 3 added nothing** |
| Linear growth? | **FACT — no**, for this model |
| Does teardown reclaim? | **FACT — no, and that is spec-correct.** Not a leak |
| Repeated-cycle leak? | **FACT — no WASM growth over 15 further lifecycles per cell** |
| JS-heap retention? | **`UNKNOWN`** — GC-dominated, self-contradicting, not measurable here |
| Backend affects lifecycle? | **FACT — no**; WebGPU shares the same heap |
| Firefox differs? | **FACT — 2 instances vs 1**, same total, same behaviour |
| Multi-threaded WASM feasible? | **FACT — yes on Chrome**; unavailable on Firefox |

## Conclusion

**CONDITIONAL.** The lifecycle mechanics are sound and the landmine did **not** detonate for
this model: three sessions share one arena, the arena does not grow with session count, and
fifteen further create/infer/destroy cycles per cell produced **no WASM heap growth at all**.

**But this does not clear the risk, and it must not be read as doing so.** The 16 MB is
almost certainly ORT's *initial arena*, and three trivial sessions fit inside it without ever
forcing a `grow()`. **The dossier's concern is about ~120 MB of resident real models** — the
UI detector, YuNet, PP-OCRv5 and GLiNER. **Nothing here exercises that**, and the first
`grow()` is exactly where the interesting behaviour would begin.

What S-04 *does* establish is that the **mechanism** is healthy: sessions coexist, the arena
is shared and reused, teardown is clean, output stays exact, and repeated cycling does not
degrade. That is the precondition for the real test, not a substitute for it.

## What this does NOT establish

- **Nothing about real models.** One 174-byte two-op fixture. **QG-03 untouched and open.**
- **Nothing about heap exhaustion**, because no allocation was large enough to force growth.
- **No latency or throughput claim.** No timing comparison is offered.
- **Nothing about GPU memory** — not visible to this instrumentation.
- **Nothing about JS-heap retention** — GC-dominated and inconclusive.
- **Nothing about threading performance** — feasibility only.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-04a | **Repeat with models large enough to force `grow()`.** This is where the landmine actually lives, and it needs S-03c's realistic model first | **p1** | QG-03, tier design |
| S-04b | Instrument `WebAssembly.Memory.prototype.grow` to record every growth event and its size | p2 | Heap analysis |
| S-04c | Establish a trustworthy JS-retention measure — `measureUserAgentSpecificMemory()` needs cross-origin isolation; determine whether an extension page can obtain it | p2 | The JS-heap `UNKNOWN` |
| S-04d | Verify the pthread pool actually materialises at `numThreads > 1`, rather than trusting ORT's report | p2 | Threading claims |

## Reproducibility

```bash
python3 build_model.py                       # -> tiny.onnx, sha256 2718406b...
npm install onnxruntime-web@1.29.0 playwright@1.63.0 web-ext@10.6.0
node build-extension.js
PLATFORM_LABEL=windows CHROME_PATH='...'  RUNS=1 node run-s04-chrome.js
PLATFORM_LABEL=windows FIREFOX_PATH='...' RUNS=1 node run-s04-firefox.js
```

See `commands.md` for which config produced which log. Loopback only, `127.0.0.1:8907`.

## Scope

**ORT Web 1.29.0 · one 174-byte model · Chrome for Testing 153 and Firefox 155.0.1 · native
Windows and WSL2 Ubuntu 26.04.** Per `AGENTS.md` §5 this fills the cells it tested and no
others.
