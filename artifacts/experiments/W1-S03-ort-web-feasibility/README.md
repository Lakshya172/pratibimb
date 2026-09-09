---
id: W1-S03
title: "S-03 — a real ONNX Runtime Web session in the extension contexts"
status: recorded
date: 2026-09-08
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
---

# S-03 — ORT Web, measured rather than inferred

> **This is the question every previous spike refused to answer.** `navigator.gpu` returning
> an adapter is not ORT Web's WebGPU backend working. `WebAssembly.compile()` succeeding is
> not ORT Web's WASM backend working. **A real session is created, run, verified and torn
> down here, or nothing is claimed.**

## Hypothesis

S-01/S-02 established raw WebGPU; S-02a-2/S-02a-2b established that WASM is CSP-blocked by
default on both browsers and that `'wasm-unsafe-eval'` unblocks it. **Does ONNX Runtime Web
actually initialise and run in PratiBimb's execution contexts?**

## The model

**174 bytes.** `y = x*2 + 1` over `float32[1, 262144]`, opset 13, IR version 9.

```
sha256  2718406b3ef228c72455dea388cd26569d462102f5a642a3bcbba1cedafe49b4
```

**Deliberately the same arithmetic as the S-02a WebGPU kernel and the S-02a-2 WASM kernel**,
so all three paths verify against one CPU reference and are comparable. Built by the
committed `harness/build_model.py`. It exists to answer *"does a session initialise and
run"*, **not** to represent a workload. Embedded as base64, so the probe performs **no fetch
for the model**.

> **`tiny.onnx` is deliberately NOT committed.** `scripts/verify-repo.py` bans `.onnx` from
> the repository, and that rule is right: model weights are referenced by pinned revision,
> never vendored. This fixture needs no exception — it is **fully reproducible from the
> committed `build_model.py`**, and the SHA-256 above pins the result. Regenerate it with
> `python3 build_model.py` and check the hash.

**No Qwen. No production model. Nothing downloaded beyond the pinned npm package.**

## Environment

| | |
|---|---|
| ORT Web | **1.29.0** (npm, pinned) |
| Chrome | **Chrome for Testing 153.0.8010.12** — native Windows **and** WSL2 Ubuntu 26.04 |
| Firefox | **155.0.1** release — native Windows **and** WSL2 Ubuntu 26.04 |
| Backends | `wasm` (numThreads pinned to 1) and `webgpu` |
| Modes | Chrome headful **and** headless; Firefox headful |

**The harness extensions declare `'wasm-unsafe-eval'`.** Without it nothing runs at all
(S-02a-2b). That is a **throwaway harness** using a measured remedy to make measurement
possible — **it is not adoption**, there is no product code, and the decision remains ADR
S-02a-2a.

> **ORT Web's `.wasm` artifacts are 14–28 MB and are NOT committed.** `harness/build-extension.js`
> pulls them from the pinned npm package. CI blocks files over 5 MB and `SECURITY.md` requires
> large binaries be referenced by pinned revision, not vendored.

## Expected result

Stated before the runs, so an unwelcome outcome could not be absorbed:

- **WASM expected to work in every context** once the CSP permits it, since WebAssembly needs
  no hardware and S-02a-2/S-02a-2b showed the substrate compiles.
- **WebGPU expected to work where an adapter exists** (Windows) and fail on WSL2, which has no
  `/dev/dri`, 0 Vulkan ICDs and `llvmpipe`.
- **The MV3 service worker was expected to work.** It did not, and that is the most
  architecturally significant result here.

## Actual result — FACT

| Context | Backend | Chrome Windows | Chrome Linux (WSL2) | Firefox Windows | Firefox Linux (WSL2) |
|---|---|---|---|---|---|
| **MV3 service worker** | wasm | **FAIL** 3/3 | **FAIL** | — | — |
| **MV3 service worker** | webgpu | **FAIL** 3/3 | **FAIL** | — | — |
| **offscreen document** | wasm | **✅ correct** 3/3 | **✅ correct** | — | — |
| **offscreen document** | webgpu | **✅ correct** 3/3 | ❌ no adapter | — | — |
| **offscreen dedicated worker** | wasm | **✅ correct** 3/3 | **✅ correct** | — | — |
| **offscreen dedicated worker** | webgpu | **✅ correct** 3/3 | ❌ no adapter | — | — |
| **Firefox MV3 event page** | wasm | — | — | **✅ correct** 2/2 | **✅ correct** 2/2 |
| **Firefox MV3 event page** | webgpu | — | — | **✅ correct** 2/2 | ❌ not supported |

Every ✅ is `outputCorrect: true`, **0 mismatches of 262,144**, verified element-by-element
against the CPU reference. Chrome headless was identical to headful in every cell.

## Findings

### Finding 1 — the MV3 service worker cannot run ORT Web at all

```
no available backend found. ERR: [wasm] TypeError: import() is disallowed on
ServiceWorkerGlobalScope by the HTML specification.
See https://github.com/w3c/ServiceWorker/issues/1356.
```

ORT Web 1.29.0 loads its WASM glue through a dynamic `import()`, and the HTML specification
forbids that in a service worker. **This is a specification-level constraint, not a
configuration one.** The `webgpu` failure in that context is consequent — `initWasm()`
already failed.

**This independently validates `docs/architecture/constitution.md` §5.** The constitution
put inference in an offscreen document because MV3 service workers have no DOM and terminate
when idle. Those reasons were correct; **this is a third, harder one the dossier does not
cite, and it alone would force the same design.** The architecture is confirmed, not amended.

### Finding 2 — ORT Web works in both offscreen contexts, on both backends

The offscreen document **and the dedicated worker inside it** — the context S-01 identified
as PratiBimb's real inference target — create sessions, run them, produce element-exact
output and release cleanly, on **both** `wasm` and `webgpu`, headful and headless.

**This is the first evidence in this project that the perception tier's runtime is viable at
all.** Everything before it was substrate.

### Finding 3 — ORT Web runs entirely from packaged local files

`ort.env.wasm.wasmPaths` was pointed at the extension's own URL, and the model is embedded as
base64. **No network fetch occurred for either the runtime or the model.**

This directly answers one of the questions the S-02a-2a ADR must settle — *"whether only
local packaged WASM is permitted"*. **It is, and it works.** That is a meaningful constraint
the ADR can rely on rather than hope for.

### Finding 4 — the Linux WebGPU failures are environmental, not ORT

Chrome on WSL2: `Failed to get GPU adapter`. Firefox on WSL2: `WebGPU is not supported`.
Both are explained by prior measurements — WSL2 has no `/dev/dri`, 0 Vulkan ICDs and
`llvmpipe` (B-02-1), and Firefox Linux has `dom.webgpu.enabled` off by default (S-02a).

**The same ORT code succeeds on Windows**, so these are environment results, not ORT results.

### Finding 5 — measured latency, and a warning about reading it

Chrome for Testing 153, Windows, min–max over 3 runs:

| Context | Backend | session create | cold run | **warm p50** | release | heap after runs |
|---|---|---|---|---|---|---|
| offscreen document | wasm | 290–301 ms | 7.3–8.4 ms | **0.3 ms** | 1.5–1.8 ms | 4 MB |
| offscreen document | webgpu | 115–160 ms | 24.9–30.2 ms | **5.0–6.4 ms** | 0.5–0.8 ms | 16–18 MB |
| offscreen dedicated worker | wasm | 74.2–78.2 ms | 1.8–2.1 ms | **0.3 ms** | 0.2–0.4 ms | n/a |
| offscreen dedicated worker | webgpu | 32.5–36.6 ms | 11.0–12.0 ms | **4.9–6.4 ms** | 0.4–0.7 ms | n/a |

Firefox 155.0.1 event page, 2 runs:

| Platform | Backend | session create | cold run | warm p50 |
|---|---|---|---|---|
| Windows | wasm | 265–293 ms | 2 ms | **1 ms** |
| Windows | webgpu | 427–3135 ms | 39–102 ms | **100 ms** |
| Linux (WSL2) | wasm | 416–426 ms | 2–5 ms | **1 ms** |

> **WASM is faster than WebGPU here, and that must not be generalised.** This model is
> **two elementwise ops**. GPU cost is dominated by upload/readback, which a two-op graph
> cannot amortise. A real detector with convolutions would very likely invert this. **These
> figures establish that the paths WORK. They are not a backend comparison and must not be
> quoted as one.**
>
> Session-create in the dedicated worker (~75 ms) is much lower than in the document
> (~295 ms). The worker runs **after** the document in the same session, so this is very
> likely warm-cache, **not** a property of the context. Confounded by run order and
> **not** a usable figure.

### Finding 6 — the `SharedArrayBuffer` asymmetry holds at the ORT level

`SharedArrayBuffer` is `true` in every Chrome context and `false` in Firefox, confirming
S-02a-2b at the runtime layer. **`numThreads` was pinned to 1 everywhere**, so this is a
controlled single-threaded comparison. **Whether ORT's threaded WASM backend works, or helps,
is untested** — S-02a-2c.

## Assessment — INFERENCE

| Question | Answer |
|---|---|
| Does ORT Web initialise in PratiBimb's inference context? | **FACT — yes**, offscreen document and its dedicated worker |
| Does it produce correct output? | **FACT — yes**, 0 mismatches of 262,144, every successful cell |
| Does it work in the MV3 service worker? | **FACT — no. Specification-level, unfixable by configuration** |
| Does the WASM backend work on Firefox Linux? | **FACT — yes**, given the CSP grant |
| Does the WebGPU backend work? | **FACT — yes on Windows**, both browsers. Linux failures are environmental |
| Can it run without network access? | **FACT — yes**, entirely from packaged files |
| Is a backend comparison established? | **No.** Two-op model; the numbers show viability, not ranking |
| Do threads work or help? | **`UNKNOWN`** — pinned to 1 throughout |

## Conclusion

**CONDITIONAL — and the condition is the CSP grant.**

ONNX Runtime Web genuinely works in PratiBimb's intended execution contexts, on both
backends, on both browsers, headful and headless, with element-exact output and clean
teardown, **and entirely from packaged local files with no network access**.

**It works only because the harness declares `'wasm-unsafe-eval'`.** Without it, nothing
runs on either browser (S-02a-2, S-02a-2b). **S-03 therefore converts ADR S-02a-2a from a
question about a browser restriction into a question with a demonstrated payoff:** granting
the directive is what makes the perception tier exist, and with it the runtime is proven
viable rather than assumed.

**No frozen contract is changed. `docs/security/security-invariants.md` and
`docs/architecture/constitution.md` are untouched. QG-04 remains unsigned. QG-03 is NOT
satisfied — that needs the twenty model cells, and this is one 174-byte synthetic model.**

## What this does NOT establish

- **Nothing about the twenty model cells.** This is a two-op synthetic model. **QG-03 stands
  entirely open.** Real detectors will exercise operators, memory and heap behaviour this
  does not touch.
- **Nothing about S-04** — three concurrent ORT sessions in one WASM heap, and whether
  teardown reclaims. One session was created and released at a time.
- **No backend ranking**, no latency budget, no accuracy claim.
- **Nothing about threads.**
- **Nothing about native Linux with a real GPU.**

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-03a | **S-04 is now runnable**: three concurrent ORT sessions in one WASM heap in the offscreen document, and whether teardown reclaims | **p1** | Perception tier design |
| S-03b | Re-run with `numThreads > 1` on Chrome (SAB present) to test the threaded WASM backend | **p1** | The WASM budget |
| S-03c | Repeat with a **real detector** (an actual matrix cell) before any latency figure is quoted | **p1** | QG-03 |
| S-03d | Chrome offscreen WebGPU on a machine where the discrete GPU is selected (S-01a) | p2 | WebGPU figures |

## Reproducibility

```bash
python3 build_model.py                       # -> tiny.onnx, sha256 2718406b...
npm install onnxruntime-web@1.29.0 playwright@1.63.0 web-ext@10.6.0
node build-extension.js                      # pulls .wasm from node_modules; NOT committed
PLATFORM_LABEL=windows CHROME_PATH='...' RUNS=3 node run-s03-chrome.js
PLATFORM_LABEL=windows FIREFOX_PATH='...' RUNS=2 node run-s03-firefox.js
```

The harness contacts no host other than `127.0.0.1:8906`. Browser profiles are temporary and
deleted after each run.

## Scope

**ORT Web 1.29.0 · Chrome for Testing 153.0.8010.12 · Firefox 155.0.1 · native Windows and
WSL2 Ubuntu 26.04 · one 174-byte two-op model.** Per `AGENTS.md` §5 this fills the cells it
tested and no others.
