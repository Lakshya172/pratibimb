---
id: W1-S04-decision
spike: S-04
verdict: CONDITIONAL
date: 2026-09-08
decided_by: ml-engineer + browser-engineer + performance-engineer + evaluation-qa-engineer (pratibimb-architect review for the tier implication)
---

# S-04 decision — CONDITIONAL

## Verdict

**CONDITIONAL.** The lifecycle mechanics are sound. **The landmine is not cleared.**

| Question | Answer |
|---|---|
| Can three ORT sessions coexist? | **YES** — every context where ORT runs at all |
| Memory per session? | **One shared 16 MB heap. Sessions 2 and 3 added nothing.** |
| Does it grow linearly? | **NO** — for this model |
| Does teardown reclaim? | **NO — and that is spec-correct**, not a leak |
| Do repeated cycles leak? | **NO WASM growth** over 15 further lifecycles per cell |
| Does backend affect lifecycle? | **NO** — WebGPU shares the same heap |
| Does Firefox differ? | **YES** — 2 `Memory` instances vs 1, same total, same behaviour |
| Multi-threaded WASM (S-03b)? | **Feasible on Chrome**; unavailable on Firefox |

**All 18 inferences per cell element-exact — 0 mismatches of 262,144.**

## The distinction this spike exists to protect

> **A `WebAssembly.Memory` cannot shrink.** The heap staying at 16 MB after teardown is
> **correct behaviour**, not a leak, and reporting it as one would have been the easy and
> wrong conclusion.

The leak question lives in **repeated cycles**, and there the answer is clean: **flat at
16 MB**, every context, both backends, both platforms.

## Why this is CONDITIONAL and not ACCEPT

**The 16 MB is almost certainly ORT's initial arena, and three trivial sessions fit inside it
without ever forcing a `grow()`.**

The dossier's risk is **~120 MB of resident real models** — UI detector, YuNet, PP-OCRv5,
GLiNER. **Nothing here exercises that.** The first `grow()` is precisely where the
interesting behaviour would start, and this experiment never reached it.

**S-04 establishes that the mechanism is healthy. It does not establish that the mechanism
survives the real workload.** Treating it as clearance would be exactly the "toy model
benchmarked as if it were the product" error.

## Honest limits recorded rather than smoothed over

- **The JS heap is inconclusive and is reported as `UNKNOWN`.** It rose 12.4 → 24.7 MB in one
  cell, which looks like a leak — and in another cell it fell **25.9 → 10.8 MB in a single
  step**, i.e. it was collected. `performance.memory` is GC-timing-dominated with no forced
  GC available. **No retention conclusion is drawn in either direction.**
- **GPU memory is not measured.** Not visible to this instrumentation. No VRAM claim is made.
- **Threading is feasibility only.** ORT *reporting* `numThreads: 4` is not proof four
  pthreads materialised, and the two-op model would not show benefit even if they did. **No
  performance claim.**
- **`performance.memory` does not exist in Firefox or in workers**, so those cells have WASM
  heap figures only. Recorded, not estimated.

## Architecture implication — evidence, no change proposed

Two things support existing design decisions **without requiring an ADR**:

1. **The shared arena is real.** All sessions in a context share one `WebAssembly.Memory`.
   The constitution's instruction to isolate the local VLM in its own worker and never load
   it beside the sanitisation tier is **the right shape** — a separate worker is a separate
   heap, which is what makes teardown able to reclaim anything at all.
2. **Teardown reclaims nothing within a heap.** That strengthens the same rule: for the T3
   local VLM, **the only way to give memory back is to tear down the worker**, exactly as
   `constitution.md` §7 already specifies. **Confirmed, not amended.**

**No frozen contract is changed. `docs/security/security-invariants.md` and
`docs/architecture/constitution.md` are untouched.**

## Security implication of multiple sessions (task §7)

**None found.** Session count does not change the trust boundary: the same packaged WASM
bytes, the same origin, the same CSP requirement, no additional network access, and no new
executable input. **Three sessions grant no capability one session does not.**

The CSP question is unchanged by S-04 and remains **S-02a-2a**.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-04a | **Repeat with models large enough to force `grow()`** — where the landmine actually is | **p1** | QG-03, tier design |
| S-04b | Instrument `WebAssembly.Memory.prototype.grow` to record every growth event | p2 | Heap analysis |
| S-04c | Find a trustworthy JS-retention measure (`measureUserAgentSpecificMemory()` needs cross-origin isolation — can an extension page get it?) | p2 | The JS-heap `UNKNOWN` |
| S-04d | Verify the pthread pool actually materialises rather than trusting ORT's report | p2 | Threading claims |

## Registry effect

**`agentos/registry/feasibility-matrix.md` is deliberately NOT edited by this PR.** The S-04
row sits in the prerequisite-spike table that open **PR #13** rewrites, with neighbours
touched by **#15**, **#16** and **#18**. Editing here would conflict with all four.

**The row lands in a follow-up once that queue clears.** Stated rather than claimed — this
project has twice had a `decision.md` assert a registry effect that was never made, and both
needed correcting afterwards.

- `agentos/blockers.md`: **not edited here**, same reason.
- **Model registry: unchanged.** No production model downloaded, adopted or benchmarked.
- **QG-03: untouched and entirely open. QG-04: unsigned.**
