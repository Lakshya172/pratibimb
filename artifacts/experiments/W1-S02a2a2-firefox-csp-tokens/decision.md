---
id: W1-S02a-2a-2-decision
spike: S-02a-2a-2
verdict: ACCEPT
date: 2026-09-10
decided_by: browser-engineer + privacy-security-engineer (see reviews below)
---

# S-02a-2a-2 decision — ACCEPT

## Verdict

**ACCEPT.** Firefox 155.0.1 MV3, real browser, 24/24 context-observations unanimous across
the event page and a dedicated worker spawned from it.

| Token | Loads? | WASM compile | `eval` / `new Function` / string-`setTimeout` |
|---|---|---|---|
| *(default)* | yes | **no** | blocked |
| **`'wasm-unsafe-eval'`** | yes | **YES** | **blocked** |
| `'wasm-eval'` | **yes** | **no** | blocked |
| `'unsafe-eval'` | **yes** | **no** | blocked |

## The security conclusion is the same as Chrome

**`'wasm-unsafe-eval'` is the only token that enables WebAssembly on either engine, and on
neither engine does it widen a JavaScript execution sink.** One policy serves both browsers.

## The failure mode is NOT the same, and it is the operationally important difference

| Wrong token | Chrome | Firefox |
|---|---|---|
| `'wasm-eval'` / `'unsafe-eval'` | **extension does not load** — loudly broken | **extension loads, WASM silently absent** |

A misconfiguration that is instantly obvious on Chrome is **silent on Firefox**: the
perception tier simply never runs, with no load error to explain it.

Compounding it: **`WebAssembly.validate()` succeeds in every variant, including the
default**, because validation does not compile to machine code. **A startup capability check
that calls `validate` would report WASM as available when compilation is blocked.**

## What this unblocks

S-02a-2b-1 left Firefox's token vocabulary explicitly `UNKNOWN`. **It is now measured, on a
real browser, not inferred from Chrome or from documentation.** ADR-0001 can state a single
cross-browser policy on evidence.

## What this does NOT do

- **No manifest or policy was changed.**
- Windows only. **Firefox on Linux remains `UNKNOWN`** (S-02a-1) and is not upgraded by this.
- Says nothing about ORT Web, or about `connect-src` on Firefox (**S-02a-2a-4b**).

## AgentOS specialist review

### browser-engineer — PASS

Real Firefox, driven by the same `web-ext` mechanism the existing W1-S02a-2 harness uses —
no duplicate infrastructure. The `/alive` beacon separates "did not load" from "loaded and
blocked", which is essential here because that is exactly where Chrome and Firefox diverge.
WASM bytes are inline rather than fetched, so Firefox's origin-control gating cannot
confound the CSP result. Both Firefox MV3 contexts measured.

### privacy-security-engineer — PASS, with one requirement carried into the ADR

The `setTimeout(string)` check verifies the string actually executed rather than that the
call did not throw — the S-02a-2a-1 correction is preserved, and without it Firefox would
have reported an eval-equivalent sink as open in all four variants.

**Requirement for ADR-0001:** because a wrong or withdrawn directive fails *silently* on
Firefox, the ADR must specify **runtime assertion of the CSP capability at startup**, and
that assertion must use **`compile`, not `validate`**. Fail-closed cannot rest on a
directive being present in a file.

**Standing veto not exercised — and not waived.**
