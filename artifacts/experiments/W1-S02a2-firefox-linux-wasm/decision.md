---
id: W1-S02a-2-decision
spike: S-02a-2
verdict: REJECT at defaults / CONDITIONAL with a manifest CSP change
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer — ESCALATED to privacy-security-engineer and the human architect
---

# S-02a-2 decision — REJECT at defaults, CONDITIONAL with a CSP change

## Verdict

**REJECT at defaults. CONDITIONAL with a manifest CSP change.**

```
CompileError: call to WebAssembly.compile() blocked by CSP
```

3 of 3 runs, headful and headless, in the Firefox MV3 event page. The ordinary-page control
compiles and runs the **identical bytes** correctly, so this is the **extension CSP**, not
the browser and not the machine.

Declaring `'wasm-unsafe-eval'` in `content_security_policy.extension_pages` unblocks it
completely — scalar and SIMD both element-exact, 0 mismatches, 3/3.

## Why this matters more than the other spikes

S-02a found WebGPU off by default on Firefox Linux. The reason that was survivable is the
dossier's *"WebGPU when available, **WASM always**"*. **This spike shows the fallback is
also off by default in the extension context.**

**At stock settings, on the configuration the risk register rates High, neither acceleration
path is available where PratiBimb would run.** That is the most consequential finding to
date, and it is not a performance problem — it is an availability one.

## STOPPED — architecture and security decision boundary

The remedy is a **manifest CSP change**, and this spike does not make it.

1. **The manifest CSP is Invariant E enforcement mechanism (3)** — the `connect-src` pin.
   Editing that CSP touches a security control the submission rests on, even when the edit
   concerns `script-src`.
2. **`'wasm-unsafe-eval'` permits compiling arbitrary WebAssembly in the extension origin.**
   That may well be the right and necessary trade — the perception tier cannot exist without
   it — but it is a **trust-boundary judgement**, and it belongs in an **ADR** approved by
   the human architect with `privacy-security-engineer` review.

**Nothing was adopted. No product manifest was changed — there is no product code.
`docs/security/security-invariants.md` and `docs/architecture/constitution.md` are
untouched. QG-04 remains unsigned.**

## The second finding, which is easy to miss behind the first

**WASM threads are not usable in this context.** `SharedArrayBuffer` is `false` and
`crossOriginIsolated` is `false`, in every variant and both contexts.

ORT Web's WASM backend uses threads for performance. **Unless cross-origin isolation can be
obtained in an extension page, every WASM latency budget in this project should be built on
a single-threaded assumption.** `hardwareConcurrency` reporting 16 is irrelevant while
`SharedArrayBuffer` is absent. This has not been reflected in any budget yet.

## What this decision does NOT do

- ❌ Adopt `'wasm-unsafe-eval'`, or edit any CSP anywhere.
- ❌ Claim anything about **ORT Web**. **That is S-03**, still `UNKNOWN`. A working WASM
  substrate does not imply ORT Web initialises.
- ❌ Claim anything about **Chrome**. Chrome MV3 also gates WASM behind its CSP; **untested
  here, and not assumed** — filed as S-02a-2b.
- ❌ Claim WASM is faster than WebGPU. The S-02a WebGPU path was almost certainly software
  backed. **Neither figure may be quoted as a WASM-vs-WebGPU result.**
- ❌ Sign QG-04, or alter any gate.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-02a-2a | **ADR: declare `'wasm-unsafe-eval'` in the extension CSP?** | **p0** | The entire perception tier on Firefox |
| S-02a-2b | Does **Chrome MV3** have the same restriction? Untested; do not assume. | **p1** | Perception tier on Chrome |
| S-02a-2c | Can cross-origin isolation be obtained in an extension page, to enable WASM threads? If not, **all WASM budgets are single-threaded**. | **p1** | Every WASM latency figure |
| S-02a-2d | Re-measure WASM vs WebGPU where WebGPU is hardware-backed | p2 | The two published budgets |

## Registry effect

**`agentos/registry/feasibility-matrix.md` is deliberately NOT edited by this PR**, and this
is stated rather than claimed-and-forgotten: the S-02a-2 row lives in the S-02a follow-up
table, which is **added by open PR #13**. Editing it here would conflict.

**The row lands in a follow-up once PR #13 merges.** Recording it this way because the same
"decision.md claimed a registry effect that was never made" slip has already happened twice
in this project — with S-02 and with B-02-1 — and both had to be corrected afterwards.

- `agentos/blockers.md`: **not edited here** for the same reason; B-01's residual is touched
  by PR #13.
- `docs/security/security-invariants.md`: **unchanged.**
- No model cell affected. No model downloaded. No product code written.
