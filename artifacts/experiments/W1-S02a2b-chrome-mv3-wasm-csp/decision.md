---
id: W1-S02a-2b-decision
spike: S-02a-2b
verdict: REJECT at defaults / CONDITIONAL with a manifest CSP change — BOTH BROWSERS
date: 2026-09-07
decided_by: browser-engineer + evaluation-qa-engineer — ESCALATED to privacy-security-engineer and the human architect
---

# S-02a-2b decision — the WASM CSP restriction is cross-browser

## Verdict

**REJECT at defaults. CONDITIONAL with a manifest CSP change. On Chrome as well as Firefox.**

```
CompileError: WebAssembly.compile(): Compiling or instantiating WebAssembly module
violates the following Content Security policy directive because neither 'wasm-eval'
nor 'unsafe-eval' is an allowed source of script in the following Content Security
Policy directive: "script-src 'self'".
```

All three contexts — service worker, offscreen document, **and the dedicated worker inside
the offscreen document, which is PratiBimb's stated inference target** — on **Linux and
native Windows**, **headful and headless**.

## What changed

S-02a-2 filed this as a Firefox finding, and filed S-02a-2b with an explicit instruction
not to assume Chrome behaved the same. **It does.**

The consequence is scope, not direction:

> **S-02a-2a is not a Firefox accommodation. It is a project-wide p0. Without it there is
> no perception tier on any browser.**

PratiBimb's entire perception tier is WebAssembly — ONNX Runtime Web and Transformers.js.
Neither browser will compile it in an extension context at stock settings.

## New information for the S-02a-2a security analysis

**Chrome's error names `'wasm-eval'`, which is narrower than `'unsafe-eval'`.** It permits
WebAssembly compilation without permitting JavaScript `eval`.

That matters, because S-02a-2 framed the choice as *"declare `'wasm-unsafe-eval'` or have no
perception tier"*. **There may be a narrower option**, and the security decision should be
made with the full set of tokens on the table rather than the first one that worked.

**This was not tested here.** Filed as **S-02a-2b-1 (p0)**, blocking S-02a-2a. It is cheap
to test and should precede the ADR.

## The second finding — a real cross-browser asymmetry

| | `SharedArrayBuffer` | `crossOriginIsolated` | WASM threads |
|---|---|---|---|
| **Chrome MV3**, all 3 contexts, both platforms | **`true`** | `false` | **available** |
| **Firefox MV3** event page (S-02a-2) | **`false`** | `false` | **unavailable** |

Chrome extension contexts get `SharedArrayBuffer` without cross-origin isolation; Firefox
does not.

**The project publishes one WASM budget. On this evidence there may need to be two** — a
threaded Chrome number and a single-threaded Firefox number. That is a measurement question
(S-03, S-02a-2c), not a decision, but no budget currently reflects it.

## What this decision does NOT do

- ❌ Adopt `'wasm-unsafe-eval'`, `'wasm-eval'`, or edit any CSP anywhere.
- ❌ Claim anything about **ORT Web**. **S-03**, still `UNKNOWN`. A compiling substrate does
  not imply ORT Web initialises, allocates or runs a model.
- ❌ Claim threads help. `SharedArrayBuffer` being present is not evidence the threaded
  backend works or is faster.
- ❌ Sign QG-04 or alter any gate.
- ❌ Change any frozen contract.

## Recommendation for S-02a-2a — evidence, not a decision

The ADR now has what it needs on the *problem* side, and one gap on the *solution* side:

1. **The problem is universal.** Both browsers, all contexts, both platforms, both display
   modes. Not negotiable by tooling choice.
2. **A remedy is proven to work** — `'wasm-unsafe-eval'`, fully, everywhere tested.
3. **A narrower remedy may exist and is untested** — `'wasm-eval'` (S-02a-2b-1). **Test this
   before writing the ADR**, so it can choose the minimum sufficient privilege rather than
   the first token that worked.
4. The ADR should also address what S-02a-2 raised and this spike does not answer: whether
   WASM bytes can be **hash-pinned**, whether only **packaged local** WASM is permitted, and
   whether ORT Web requires **runtime** compilation at all.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| ~~S-02a-2b-1~~ | ~~Is `'wasm-eval'` accepted and sufficient?~~ **RESOLVED — NO.** Both `'wasm-eval'` and `'unsafe-eval'` make the extension **fail to load entirely** (no service worker), 2/2 on Windows and 2/2 on Linux. **`'wasm-unsafe-eval'` is the only token Chrome MV3 accepts.** See `S02a2b1-NARROWER-DIRECTIVE.md`. | ✅ | — |
| S-02a-2b-2 | Does the Chrome/Firefox `SharedArrayBuffer` asymmetry hold on native Linux? | **p1** | The WASM budget |

## Registry effect

**`agentos/registry/feasibility-matrix.md` is deliberately NOT edited by this PR**, and this
is stated rather than claimed: the S-02a-2 follow-up rows live in a table added by open
**PR #13**, and the S-02a-2 row itself by open **PR #15**. Editing here would conflict with
both.

**The rows land in a follow-up once #13 and #15 merge.** Recorded this way because the
"decision.md claimed a registry effect that never happened" slip has already occurred twice
in this project, and both instances needed correcting afterwards.

- `agentos/blockers.md`: **not edited here**, same reason.
- `docs/security/security-invariants.md`, `docs/architecture/constitution.md`: **unchanged.**
- No model cell affected. No model downloaded. No product code written.
