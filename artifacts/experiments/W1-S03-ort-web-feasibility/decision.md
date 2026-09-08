---
id: W1-S03-decision
spike: S-03
verdict: CONDITIONAL
date: 2026-09-08
decided_by: ml-engineer + browser-engineer + evaluation-qa-engineer (privacy-security-engineer review required for the CSP dependency)
---

# S-03 decision — CONDITIONAL

## Verdict

**CONDITIONAL.** ONNX Runtime Web **works** in PratiBimb's intended execution contexts —
**and only because the extension declares `'wasm-unsafe-eval'`.**

| Question | Answer |
|---|---|
| Session created and run in the offscreen document? | **YES** — both backends, headful and headless |
| In the **dedicated worker** inside it (the stated target)? | **YES** — both backends |
| In the **MV3 service worker**? | **NO — specification-level, unfixable by configuration** |
| Firefox MV3 event page? | **YES** — both backends on Windows; WASM on Linux |
| Output correct? | **YES** — 0 mismatches of 262,144, every successful cell |
| Without network access? | **YES** — runtime and model both packaged |

## The finding that matters most for architecture

```
[wasm] TypeError: import() is disallowed on ServiceWorkerGlobalScope
       by the HTML specification.
```

**ORT Web cannot run in an MV3 service worker.** It loads its WASM glue by dynamic
`import()`, which the HTML specification forbids there.

`docs/architecture/constitution.md` §5 already puts inference in an offscreen document,
citing the absence of a DOM and idle termination. **This is a third reason, harder than
both, and it would force the same design on its own.** The architecture is **confirmed, not
amended** — no ADR is required for it.

## The finding that matters most for the open decision

**Everything here required `'wasm-unsafe-eval'`.** Without it, nothing runs on either
browser (S-02a-2, S-02a-2b).

**S-03 changes what ADR S-02a-2a is deciding.** It was *"do we accept a CSP relaxation to
work around a browser restriction?"* It is now *"do we accept a CSP relaxation that is
demonstrably the difference between having a perception tier and not having one, given the
runtime behind it is proven to work?"*

And it supplies a constraint the ADR was explicitly asked to investigate:

> *"whether only local packaged WASM is permitted"*

**Measured: yes.** `wasmPaths` pointed at the extension's own URL and the model embedded as
base64. **No network fetch for the runtime or the model.** The ADR can require
packaged-only origins as a condition of the grant, rather than hoping it is possible.

## What this decision does NOT do

- ❌ **Adopt the CSP directive.** Used in a throwaway harness to make measurement possible.
  There is no product code, and the decision remains **S-02a-2a**.
- ❌ **Satisfy QG-03.** That needs the **twenty model cells**. This is one 174-byte, two-op
  synthetic model. **QG-03 stands entirely open.**
- ❌ **Rank the backends.** WASM measured faster than WebGPU here, on a two-op elementwise
  graph where GPU transfer cannot be amortised. A real detector would very likely invert it.
  **These figures show viability, not ranking, and must not be quoted as a comparison.**
- ❌ **Establish anything about threads.** `numThreads` was pinned to 1 throughout.
- ❌ Change any frozen contract, or sign any gate.

## Recommendation

1. **Do not raise an ADR for the execution context.** S-03 confirms the constitution rather
   than contradicting it. Finding 1 should be recorded as supporting evidence in
   `constitution.md` §5 when something else touches that file — not as a change.
2. **S-02a-2a can now be written.** The problem is universal (S-02a-2b), there is no narrower
   directive (S-02a-2b-1), the payoff is demonstrated (S-03), and packaged-only origin is
   proven feasible (S-03 Finding 3). The remaining open question for the ADR is **hash-pinning
   the WASM bytes**, which is a design decision this spike does not touch.
3. **S-04 is now unblocked and should be next.** Three concurrent sessions in one WASM heap is
   the dossier's named landmine, and S-03 built the harness that can test it.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-03a | **S-04** — three concurrent ORT sessions in one WASM heap; does teardown reclaim? | **p1** | Perception tier design |
| S-03b | `numThreads > 1` on Chrome, where `SharedArrayBuffer` is present | **p1** | The WASM budget |
| S-03c | Repeat with a **real detector** before any latency figure is quoted | **p1** | **QG-03** |
| S-03d | Chrome offscreen WebGPU where the discrete GPU is selected (S-01a) | p2 | WebGPU figures |

## Registry effect

**`agentos/registry/feasibility-matrix.md` is deliberately NOT edited by this PR.** The S-03
row sits in the prerequisite-spike table that open **PR #13** rewrites, and the surrounding
rows are touched by **PR #15** and **PR #16**. Editing here would conflict with all three.

**The row lands in a follow-up once that queue clears.** Stated rather than claimed — this
project has twice had a `decision.md` assert a registry effect that was never made, and both
needed correcting afterwards.

- `agentos/blockers.md`: **not edited here**, same reason.
- `docs/security/security-invariants.md`, `docs/architecture/constitution.md`: **unchanged.**
- **Model registry: unchanged.** No production model was downloaded, adopted or benchmarked.
  The 174-byte synthetic model is a test fixture, not a registry entry.
