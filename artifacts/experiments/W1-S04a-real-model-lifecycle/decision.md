---
id: W1-S04a-decision
experiment: W1-S04a-real-model-lifecycle
date: 2026-09-08
---

# S-04a — decision record

## What was asked

S-04 closed as `CONDITIONAL` for one stated reason: its 174-byte fixture **never forced
`WebAssembly.Memory.grow()`**, so the memory regime the dossier actually warns about was
never entered. S-04a exists to enter it with a real model, and the instruction was explicit:

> *"Do not call S-04 ACCEPT unless the real-model growth regime has actually been tested."*

## Decision 1 — the growth regime was reached, so the result counts

**Evidence:** `logs/results-s04a-chrome-linux-precheck.json`, snapshot `after-infer-1`:
`growCount: 2`, 256 → 452 pages (16 → 28.3 MB).

The §2 pre-check was run **before** any lifecycle claim and is reported separately, so the
lifecycle numbers cannot be read as meaningful by accident.

**Where growth comes from is itself a finding:** creating the session grew nothing at all
(`after-create-1`: 16 MB, `growCount: 0`). Both grows happened during **inference**. The
4.7 MB input tensor and the convolution intermediates force it, not the weights.

## Decision 2 — S-04's central claim survives contact with a real model

Sessions 2 and 3 added **zero pages and zero grows**, and fifteen further session lifecycles
added **zero grows**. This is what S-04 could not establish: with a trivial model, "sessions
share the arena" was indistinguishable from "nothing was ever allocated".

**Bounded by the working set, not by session count or lifecycle count.**

## Decision 3 — the Firefox "timeouts" were MY harness, and are now fixed

This is the part worth recording carefully, because the first reading was wrong.

**What I first concluded (WRONG):** Firefox could not complete 7–19 YuNet inferences within
900 s, and the likely cause was per-inference cost on a conv-heavy model. I had a named basis
for it — S-04 completed 18 *tiny*-model inferences in the same harness inside 120 s — and I
was about to record it as an `INFERENCE`.

**What the data actually said.** The one Firefox run that *did* complete
(`results-s04a-firefox-windows-ffprobe.json`) reports `after-create-1` at `at: 1162` ms and
`after-infer-1` at `at: 1207` ms. **A YuNet inference took 45 ms.** Nineteen of them is about
a second. Per-inference cost could not possibly explain a 900 s timeout, and the whole Chrome
suite — 12 contexts, 19 inferences each — finished in **15 seconds** end to end.

So the runs were not slow. **The reports were being thrown away.**

### Root cause

The Firefox event page cannot `fetch` (host_permissions are gated behind Firefox MV3 origin
controls — established in S-02a-2), so it reports through a **tab-navigation beacon**:
`tabs.create({ url: "/sink?d=" + encodeURIComponent(...) })`. The payload therefore travels
**in the HTTP request line**.

- A `growth-only` report is ~1.5 KB encoded. **Fits.**
- A full-lifecycle report is **~80 KB encoded per context**, ~160 KB for two.

**Node's `http.createServer()` defaults to `maxHeaderSize` of 16,384 bytes.** A request line
above that is rejected with `HPE_HEADER_OVERFLOW` **before the request handler is ever
invoked**. The collector's handler never ran, so it recorded nothing, so the runner waited out
its full deadline and reported `timedOut: true`.

Both prior "timeouts" carried `liveness: true` — the event page ran fine. **The only thing
that failed was my collector, and it failed silently.**

**Reproduction — no browser, under one second:** `harness/repro-collector-header-overflow.js`,
output in `logs/repro-collector-header-overflow.txt`:

```
-- DEFAULT server options (what the S-04a collector used) --
{"payloadBytes":1500,  "handlerRan":true,  "status":200}
{"payloadBytes":16000, "handlerRan":true,  "status":200}
{"payloadBytes":80000, "handlerRan":false, "clientError":"HPE_HEADER_OVERFLOW"}
{"payloadBytes":160000,"handlerRan":false, "clientError":"HPE_HEADER_OVERFLOW"}

-- WITH maxHeaderSize: 2,000,000 (the fix) --
{"payloadBytes":80000, "handlerRan":true,  "status":200}
{"payloadBytes":160000,"handlerRan":true,  "status":200}
```

The 16,000 / 80,000 pair straddles the 16,384-byte default exactly as the mechanism predicts.

### The fix — three changes, because raising the limit alone is not enough

1. **`maxHeaderSize: 2000000` on the collector.** Removes the wall. **Defence in depth only** —
   a bigger number is still a number, and four resident models will produce bigger reports.
2. **Chunked delivery (the actual fix).** The report is split into 8 KB pieces sent through
   **one reused tab**, in order, each confirmed loaded before the next. Chunks are
   concatenated **raw** and decoded once, so a percent-escape split across a boundary is
   harmless — which is why the collector reads the payload straight off `req.url` instead of
   through `URLSearchParams`.
3. **The collector asserts completeness.** It logs every chunk as it arrives and reports any
   chunk set that never completed as `incompleteChunkSets`. **This is the important one.**
   The original defect was not that delivery failed; it was that failure and "nothing to
   report" looked identical. Now they cannot.

A fourth change was needed to make (2) work at all: Firefox withholds `tab.url` without the
**`tabs`** permission, and `tabs` is a *required* permission rather than a host permission, so
Firefox MV3 grants it at install instead of gating it behind origin controls. Without it the
confirmation loop stalls; the first fixed run was killed for exactly this and the code now
degrades to a paced send rather than stalling, with the collector still guaranteeing
completeness.

### Outcome

With the fix in place the Firefox run completes: `chunk 1/9 … 9/9`,
`incompleteChunkSets: []`, `timedOut: false`, and the result is **identical to Chrome** —
16 → 22 → 28.3 → 33.9 MB, 3 grows with the same +96/+100/+91 deltas, flat across 5 cycles,
19 inferences correct, worst relative error 3.618001937866211e-05 matching Chrome's value to
every reported digit. The only difference is 2 `Memory` instances instead of 1.

**The Firefox cell is FILLED, not inferred from Chrome.**

**This is a harness defect, not a product finding.** It touches no product code, no invariant
and no CSP. It is recorded here because it nearly became a false capability claim about
Firefox — and because "the tool that measures the system failed open" is the same failure mode
the CDP/collector work in B-02 exists to prevent. That parallel is not a coincidence and is
worth carrying into B-02-2.

## Decision 4 — the WebGPU result was confounded, so it was measured again

The first WebGPU cell added **zero** pages across a full 19-inference lifecycle. That looked
like the strongest finding in the experiment. **It was an artefact of run order.**

Both backends run in the same context with `wasm` first, so the `webgpu` cell started from an
arena the `wasm` cell had already grown to 33.9 MB. "Added zero" therefore meant only
*"needed no more than wasm had already taken"* — not *"needs less"*.

Re-run alone from a cold heap (`COLD_START_BACKEND=webgpu`,
`logs/results-s04a-chrome-windows-webgpu-coldstart.json`):

| Backend | grows | final WASM heap |
|---|---|---|
| `wasm` | 3 | **33.9 MB** |
| `webgpu` | **1** | **19.3 MB** |

A single +52-page grow, then flat across 3 sessions, 19 inferences and 5 cycles, identical
headful and headless, with a *better* worst relative error (7.36e-06 vs 3.62e-05).

**The honest number is smaller than the confounded one and means more.** `constitution.md`
§11's mitigation is confirmed with a magnitude attached: **43% less WASM heap**. What moved
GPU-side is not measured, so this is a WASM-heap saving, not a total-memory saving.

## Decision 5 — verdict stays CONDITIONAL

The growth regime was entered and the behaviour in it is bounded and correct. That was the
open question from S-04 and it is now answered.

It is **not** ACCEPT, for reasons that are about scope rather than doubt:

1. **Three copies of one model is not four different models.** The dossier's ~120 MB risk is
   the UI detector, YuNet, PP-OCRv5 and GLiNER **coexisting**. Three YuNet sessions share
   weights and workspace shapes; four distinct graphs will not. **The real test has not been
   run** (S-04a-1).
2. **§8, failure under memory constraint, was never reached.** Nothing came near exhausting
   the heap, so the explicit-failure behaviour the task asks about **could not be observed**.
   Not claimed either way (S-04a-3).
3. **GPU-side memory is invisible** to this instrumentation, so the WebGPU saving is a
   WASM-heap saving and not a total-footprint claim (S-04a-4).

## What is deliberately NOT changed by this PR

- **`agentos/registry/feasibility-matrix.md` is NOT edited.** The S-04 row sits in a table
  rewritten by open PR #13 with neighbours touched by #15, #16 and #18. Editing it here would
  create the same conflict this branch exists to avoid. **Stated as an intent, not as an
  effect** — claiming a registry change that was never staged has happened twice on this
  project and both needed correcting forward.
- **`agentos/state.md` is NOT edited**, to keep this PR single-purpose.
- **No production CSP change. No product code. No new dependency. No invariant touched.**
- **No model weights committed.** `.onnx` remains a banned type in `scripts/verify-repo.py`
  and no exception was carved for it.

## Gates

| Gate | Status after S-04a |
|---|---|
| QG-01 | satisfied for S-04a — hypothesis pre-registered, artifact present, every claim labelled |
| QG-03 | **still open** — one model does not fill the model matrix |
| QG-04 | **still UNSIGNED** — B-02-1a, B-02-1c and B-02-2 remain |
