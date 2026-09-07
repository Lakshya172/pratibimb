---
id: W1-S02-decision
spike: S-02
verdict: ACCEPT
date: 2026-09-07
decided_by: browser-engineer + ml-engineer (pending human architect review of Findings 3 and 4)
supersedes: the "NOT RUN — BLOCKED" decision recorded 2026-09-07 before Firefox was available
---

# S-02 decision — ACCEPT (with two recorded constraints)

> **This file previously read "there is no verdict".** That version is preserved in this
> file's git history. It is superseded rather than erased, because the pre-registration is
> the evidence that these criteria were not fitted to the result.

## Verdict

**ACCEPT.**

`navigator.gpu.requestAdapter()` returns a real adapter inside a **Firefox MV3 event page**.
A device was created, a WGSL compute shader executed, and its output was **element-exact
against a CPU reference over 262,144 elements** — in **3 runs of 3**, with **zero uncaptured
GPU errors** and **zero shader compilation errors**. Device destroy and re-acquire were clean
every time. The ordinary-page control passed on the same machine, so a null result would have
been attributable to the extension context rather than the hardware.

**No WebGPU preference was changed.** `dom.webgpu.enabled` was not touched. This is Firefox
155.0.1 release, Windows, at defaults.

The dossier's stated failure case —

> *"If it returns null, every WebGPU number in this document becomes the WASM number and the
> entire performance story changes."*

— **does not occur on this machine, in this browser, on this platform.**

## Against the pre-registered criteria

Every box the protocol required, checked against the raw runs:

| Criterion | Result |
|---|---|
| Non-null adapter in the MV3 event page | ✅ 3/3 |
| `requestDevice()` succeeds | ✅ 3/3 |
| Compute output element-exact vs CPU reference | ✅ 3/3, **0 mismatches** |
| 3 of 3 runs | ✅ |
| Zero uncaptured GPU errors | ✅ 3/3 |
| Ordinary-page control succeeds on the same machine | ✅ 3/3 |

**Not CONDITIONAL:** the protocol says a result requiring an `about:config` change on the
release channel is CONDITIONAL, never ACCEPT. **No such change was made**, so that clause
does not fire.

## Constraints attached to the acceptance

1. **The adapter cannot be identified.** Firefox returns an **empty `adapterInfo`** —
   `vendor`, `architecture`, `device`, `description` all empty. S-01 could say Chrome picked
   `intel / gen-12lp` and attach a constraint to it; here that is impossible from inside the
   page. **Every Firefox WebGPU figure must carry "adapter unidentified".** This is a *weaker*
   epistemic position than the Chrome cell, and it should be stated as such on any slide.

2. **Windows only.** The matrix has separate Firefox cells for Windows and Linux. **This
   fills the Windows cell and no other.** Firefox-on-Linux — WebGPU off by default behind
   `dom.webgpu.enabled`, and the configuration the dossier calls most likely for judging —
   remains **`UNKNOWN`**, and this workstation has no Linux environment.

## What this unblocks

- **S-01 and S-02 both now have answers.** `agentos/workflows/spike.md` says *"Nothing else
  in the project starts until S-01 and S-02 resolve."* That gate is satisfied — **for the
  cells measured.**
- **B-01 is RESOLVED**, with evidence: Firefox 155.0.1 installed, S-02 executed, artifacts
  committed.

## What this explicitly does NOT unblock

- **S-03** — ONNX Runtime Web's WebGPU backend is a **separate question and was not tested.**
  Raw WebGPU working is not ORT Web working. This is the single most likely place to
  mis-generalise, and the protocol warned about it in advance.
- **S-04, S-05, S-06, S-07** — untouched.
- **The twenty model cells** — all still `UNKNOWN`. No model was downloaded.
- **Firefox on Linux** — a different cell.
- **Any latency claim.** The figures recorded are end-to-end wall clock on a trivial shader,
  on one machine, and **cannot be compared with S-01's Chrome numbers**, which came from a
  different browser *and* a different machine.

## Architecture impact — TWO ITEMS FOR THE HUMAN ARCHITECT

**No frozen contract is touched by this spike, and nothing has been redesigned.** Two
findings, however, sit on an architecture/security decision boundary and are escalated
rather than resolved:

### Finding 3 — Firefox's MV3 background is a `window`, not a service worker

`globalKind: "window"` in 3/3 runs. Chrome MV3 gives a service worker with no DOM, which is
precisely why `docs/architecture/constitution.md` §5 introduces the **offscreen document**.
Firefox's event page is already a DOM context, so the offscreen document has no Firefox
counterpart and no Firefox need.

This is a **platform asymmetry in where inference runs**. It does not contradict the dossier
— the dossier names the Firefox MV3 event page correctly — but the constitution's execution
context is written Chrome-first, and a per-browser answer is now required. **That is an ADR,
not a spike conclusion.**

### Finding 4 — Firefox MV3 gates `host_permissions` behind user-granted origin controls

The event page's `fetch` to the declared loopback origin failed with
`TypeError: NetworkError when attempting to fetch resource`, and
`extensions.originControls.grantByDefault=true` did **not** change it.

For the harness this was cosmetic — reporting moved to a tab-navigation beacon carrying the
full payload, and no measurement was lost. **For the product it is not cosmetic.**
PratiBimb's egress module must reach the server origin from an extension context. If Firefox
MV3 requires an explicit user grant for that origin, it interacts directly with **Invariant E**
and with **enforcement mechanism (3), the manifest CSP `connect-src` pin**.

**This is a trust-boundary-adjacent question and is NOT resolved here.** No invariant was
changed, no permission model was weakened, and no workaround was applied to product code —
there is no product code.

## Follow-up items raised

| # | Item | Priority | Blocks |
|---|---|---|---|
| S-02a | **Firefox on Linux** — the cell the risk register rates High. Needs a Linux environment; none exists on this workstation. | **p1** | Firefox parity story; the judging configuration |
| S-02b | **ADR: per-browser execution context.** Offscreen document on Chrome, event page on Firefox? | **p1** | Perception tier implementation |
| S-02c | **ADR / spike: Firefox MV3 origin controls vs the egress path.** Does the server origin need a user grant, and what does that mean for Invariant E and the CSP pin? | **p1** | QG-04, Firefox parity |
| S-02d | Firefox reports no adapter identity — decide how Firefox figures are labelled in the benchmark contract | p2 | Reporting discipline |

## Registry effect

- `agentos/registry/feasibility-matrix.md`: prerequisite spike **S-02 → `FACT` (Windows
  cell only)**. Firefox-on-Linux stays `UNKNOWN`.
- `agentos/blockers.md`: **B-01 → `RESOLVED`**, with the artifact cited.
- `docs/security/security-invariants.md`: **unchanged.**
- `docs/architecture/constitution.md`: **unchanged** — Findings 3 and 4 are escalated, not applied.
- The twenty model cells: **unchanged, all `UNKNOWN`.**
