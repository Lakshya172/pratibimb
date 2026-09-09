---
id: W1-S02a-2a-1-decision
spike: S-02a-2a-1
verdict: ANSWERED — measurement complete; the CSP ADR is prepared, NOT approved
date: 2026-09-09
decided_by: browser-engineer + ml-engineer (measurement) · privacy-security-engineer review REQUIRED · human architect approves the ADR
---

# S-02a-2a-1 decision

## Verdict

**ANSWERED.** The three facts the CSP ADR was missing are now measured, 36/36
observations unanimous across two browsers and three MV3 contexts.

| | Question | Answer |
|---|---|---|
| Q1 | Does `'wasm-unsafe-eval'` widen JavaScript execution? | **NO.** `eval`, `new Function` and string-`setTimeout` stay blocked, identically to default. It unlocks WebAssembly compilation and nothing else. |
| Q2 | Does it constrain WASM provenance? | **NO.** Network-origin bytes compile and stream-instantiate exactly as freely as packaged bytes. |
| Q3 | Can the bytes be hash-pinned, and does the pin refuse? | **YES**, in all three contexts, both browsers — and the refused module is one that would otherwise have executed. |

## What this unblocks

**Issue #17's ADR (S-02a-2a) now has its technical inputs.** Three of the checklist items
in that issue are answered:

- *"What exactly does the chosen directive enable?"* → Q1.
- *"Can WASM bytes originate from the network, or only from the packaged extension?"* → Q2.
- *"Can the WASM bytes be hash-pinned, the way the payload artifact is under INV-02/INV-03?"* → Q3.

## What this does NOT decide — and why I stopped here

**Adopting a CSP directive changes the extension manifest that also carries Invariant E's
`connect-src` pin.** Under `AGENTS.md` §4 and the session's §26 boundary that is an
architecture-and-security decision, not a measurement. **No manifest in this repository was
changed, and no product code exists to change.**

The ADR still has to answer, and this experiment deliberately did not:

- Whether the perception tier is worth the directive at all.
- What the fail-closed behaviour is if the directive is later withdrawn.
- Whether extension **dependencies** could introduce untrusted WASM.
- Whether **model output** could ever reach a WASM compilation path. (It must not.)
- Rollback.

## Recommendation for the ADR — a recommendation, not an approval

> Declare `'wasm-unsafe-eval'`; keep `connect-src` pinned to the configured server origin;
> package the WASM; hash-pin the bytes before instantiation.

Grounded in the measurements: Q1 shows the directive is narrow enough not to breach
INV-15/INV-16, Q2 shows the directive **alone is not sufficient** because it permits
network-origin WASM, and Q3 shows the compensating control works and is load-bearing.

**`privacy-security-engineer` holds a standing veto here and has not reviewed this.**

## Security invariants — status unchanged

| Invariant | Effect of this experiment |
|---|---|
| INV-15 (no arbitrary JS) | **Not weakened.** Q1 shows the directive does not open a JS execution path. |
| INV-16 (no `eval`) | **Not weakened.** `eval` remains blocked under the directive. |
| INV-02 / INV-03 (payload hash pin) | **Unaffected.** Q3 shows the same *technique* is available for WASM bytes; it does not alter the egress payload pin. |
| Invariant E mechanism (3), `connect-src` | **Newly implicated.** Q2 makes `connect-src` the only manifest-level control over WASM provenance. |

**Nothing was relaxed to make anything pass.** Three harness defects were fixed instead —
including one that would have reported a blocked eval-equivalent sink as open.

## Follow-up raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-02a-2a-2 | Does Firefox accept `'wasm-unsafe-eval'`, and is it equally narrow? | p1 | Cross-browser parity of the ADR |
| S-02a-2a-3 | Does ORT Web expose its `.wasm` URL so a pin can precede its own instantiation? | **p1** | Whether the pinning recommendation is implementable |
| S-02a-2a-4 | Does a pinned `connect-src` actually block WASM fetched from another origin, in all three contexts? | **p1** | Whether mechanism (3) really is the provenance control |

## Registry effect

Prerequisite-spike rows only. **No model cell changes; no model was involved.**
