---
id: W1-S02
title: "S-02 — WebGPU adapter inside a Firefox MV3 event page"
status: recorded — executed 2026-09-07
date: 2026-09-07
label: FACT (observations) / INFERENCE (assessment)
verdict: ACCEPT (with two recorded constraints)
---

# S-02 — WebGPU in a Firefox MV3 event page

> # ✅ EXECUTED 2026-09-07 — VERDICT: ACCEPT
>
> Firefox 155.0.1 was installed on workstation 2, resolving blocker **B-01**, and the
> protocol below was run **unchanged**.
>
> **The sections Hypothesis, Environment required, Procedure and Acceptance / rejection
> criteria are preserved exactly as they were pre-registered, before any data existed.**
> They have not been edited in the light of the result — that is the entire value of
> pre-registration. Only *Actual result* and *Conclusion* are new, plus a *Findings*
> section between them.
>
> **This result is Firefox on WINDOWS.** Firefox on **Linux** is a separate cell and stays
> `UNKNOWN`.

## Hypothesis

`navigator.gpu.requestAdapter()` returns a real, usable GPU adapter inside a **Firefox MV3
event page**, and a WebGPU device created there can execute a compute shader with correct
output.

The dossier states the stakes (§11, quoted in `agentos/registry/feasibility-matrix.md`):

> *"GPU adapter availability from extension background contexts has been inconsistent. If
> it returns null, every WebGPU number in this document becomes the WASM number and the
> entire performance story changes."*

`agentos/workflows/spike.md` makes S-01 and S-02 the two spikes that gate all other work.
S-01 is answered. **S-02 is the one still standing between the project and downstream
implementation.**

### Why the Chrome result does not answer this

S-01 measured Chrome. It says nothing here, and per `AGENTS.md` §5 it may not be
generalised. Three things differ, not one:

| | Chrome (S-01) | Firefox (S-02) |
|---|---|---|
| Extension background context | MV3 service worker + **`chrome.offscreen` document** | **MV3 event page** — Firefox implements no `offscreen` API |
| WebGPU implementation | Dawn | **wgpu** |
| Platform status | shipped since Chrome 113 | **shipped on Windows in Firefox 141; on Linux it remains off by default behind `dom.webgpu.enabled`, with Mozilla targeting 2026** |

The offscreen document is PratiBimb's Chrome inference context and **has no Firefox
equivalent**. Whatever S-02 finds, the Firefox execution context is architecturally
different, and that difference is the point of running it.

## Environment required

**None of this is available yet.** Listed so the blocker is actionable rather than vague.

| Requirement | Why | Status on the current workstation |
|---|---|---|
| Mozilla Firefox, release channel, version recorded exactly | The measurement is meaningless without the build | **ABSENT** |
| A machine with a working GPU adapter and its driver version recorded | The question is about the adapter | Present — AMD Radeon 860M + NVIDIA RTX 5050, `ENV-0002` |
| `web-ext`, or `about:debugging` temporary-add-on loading | Firefox has no `--load-extension` equivalent | Not installed |
| **Firefox on Linux** — separately, and this is the one that matters | The dossier calls Firefox-on-Linux the most likely judging configuration, and it is the cell where WebGPU is off by default | **ABSENT — no Linux environment at all (no WSL, no Docker), see `ENV-0002`** |

> **Two cells, not one.** *Firefox on Windows* and *Firefox on Linux* are separate rows of
> the feasibility matrix. Running S-02 on Windows alone leaves the Linux cell `UNKNOWN`,
> and the Linux cell is the one the risk register calls **High**.

## Procedure

Fixed in advance. Deviations are recorded as corrections, not edits.

1. Record the environment **before running anything** — OS, machine, CPU, both GPUs and
   driver versions, exact Firefox version and channel, and the value of
   `dom.webgpu.enabled` **as found**, before any change.
2. Build a throwaway MV3 extension whose **event page** performs, in order:
   `navigator.gpu` presence → `requestAdapter()` under **both** `default` and
   `high-performance` power preferences → `requestDevice()` → record `adapterInfo`
   (vendor, architecture, device, description) → compile and dispatch a trivial WGSL
   compute shader over a synthetic array → **verify output element-by-element against a
   CPU reference** → destroy the device → re-acquire it to prove teardown is clean.
   Capture `uncapturedErrors` and shader compilation errors throughout.
3. Probe a **content-script / ordinary page context as a control**, so a null adapter can
   be attributed to the extension context rather than to the machine.
4. Load the extension via `about:debugging` (temporary add-on) or `web-ext run`, recording
   which, and record whether the loading mechanism itself constrains automation — the
   Firefox counterpart of S-01's `--load-extension` finding.
5. **Three complete runs.** A single run does not establish repeatability.
6. Post results to a **loopback-only** collector. No external host.
7. Write `decision.md`, `environment.json`, `commands.md`, `metrics.json` and raw per-run
   logs, matching the layout of `W1-S01-chrome-webgpu-context/`.
8. Update `agentos/registry/feasibility-matrix.md` and `agentos/state.md`.
9. Delete the browser profile. Commit no profile, capture or personal data.

## Acceptance / rejection criteria

Fixed before measurement. **The verdict is read off this table, not argued for afterwards.**

| Verdict | Condition |
|---|---|
| **ACCEPT** | `requestAdapter()` returns a non-null adapter **in the Firefox MV3 event page**, `requestDevice()` succeeds, the compute shader output is **element-exact** against the CPU reference, and this holds in **3 of 3 runs** with zero uncaptured GPU errors. |
| **REJECT** | The adapter is null, or the device cannot be created, or output is incorrect, in the event page — **while the ordinary-page control succeeds on the same machine**. This is a real result and is merged with its evidence. Consequence: **every WebGPU figure in the dossier becomes the WASM figure for Firefox**, and the performance story is rewritten rather than quietly kept. |
| **CONDITIONAL** | It works only under a stated constraint — for example only with `dom.webgpu.enabled` flipped manually, only on the discrete adapter, only on Windows, or only headful. **The constraint is recorded in the verdict line itself**, and any figure measured under it is labelled with it. A result that needs an `about:config` change on the release channel is CONDITIONAL, never ACCEPT, because the judging machine will not have that change. |
| **INCONCLUSIVE** | The harness did not answer the question — the extension would not load, the control also failed, or the runs disagreed. **The write-up must state what would answer it.** Not a soft REJECT. |

**Fixed in advance so it cannot be argued later:**

- A **null adapter is a valid, publishable result**, not a spike failure. Per
  `agentos/workflows/spike.md`: *"A null result is a result."*
- **No fallback rescues the verdict.** If WebGPU is unavailable, the answer is that it is
  unavailable; the WASM path is the architecture's response, not a way to record ACCEPT.
- **The result fills the cell measured and no other** — Windows or Linux, that Firefox
  version, that GPU. Not both cells, not "Firefox".
- Raw WebGPU working is **not** ONNX Runtime Web working. That remains S-03, whatever S-02
  returns.

## Expected result

Stated in advance to make an unwelcome outcome visible rather than absorbable:
`navigator.gpu` is expected **present on Firefox ≥ 141 on Windows** and **absent by default
on Linux**. The adapter's availability *inside the MV3 event page specifically* is the open
question, and the honest prior is that it is genuinely uncertain — which is why the spike
gates the project.

## Actual result — FACT

**Executed 2026-09-07. Three complete runs. Firefox 155.0.1 release, headful, Windows 11,
workstation 2. `dom.webgpu.enabled` was NOT touched — these are release defaults.**

| | **Firefox MV3 event page** | ordinary page (CONTROL) |
|---|---|---|
| `navigator.gpu` present | **true** 3/3 | true 3/3 |
| `requestAdapter()` non-null | **true** 3/3 | true 3/3 |
| `requestDevice()` succeeded | **true** 3/3 | true 3/3 |
| Compute shader ran | **true** 3/3 | true 3/3 |
| **Output element-exact vs CPU reference** | **true 3/3 — 0 mismatches of 262,144** | true 3/3 — 0 mismatches |
| Shader compilation errors | **0** 3/3 | 0 3/3 |
| Uncaptured GPU errors | **0** 3/3 | 0 3/3 |
| Device destroy then re-acquire | **clean** 3/3 | clean 3/3 |

Timings, event page, min / median / max over 3 runs:
`requestAdapter` 376 / 409 / 1864 ms - `requestDevice` 111 / 127 / 146 ms -
cold dispatch 99 / 99 / 100 ms - warm p50 100 / 100 / 100 ms.

> **These figures must not be compared with S-01's Chrome numbers.** That was a different
> browser **and** a different machine. A Chrome-versus-Firefox claim needs both measured on
> the *same* workstation, and that has not been done.

## Findings

**Finding 1 — the dossier's stated failure case does not occur here.** WebGPU is available
and functional inside the Firefox MV3 event page on Windows, at release defaults, with no
`about:config` change. S-01 and S-02 were the two spikes gating all other work; **both now
have answers.**

**Finding 2 — Firefox reports an EMPTY `adapterInfo`.** `vendor`, `architecture`, `device`
and `description` are all empty strings. **We cannot tell which GPU Firefox used.** S-01
could identify Chrome's choice (`intel / gen-12lp`) and attach a constraint to it; here that
is impossible from inside the page. **Every Firefox WebGPU figure this project records must
therefore be labelled "adapter unidentified".**

**Finding 3 — the Firefox MV3 background is a `window`, not a service worker.** The probe
reports `globalKind: "window"` in all three runs. Chrome MV3 gives a service worker with no
DOM, which is exactly why `docs/architecture/constitution.md` section 5 introduces the
**offscreen document**. Firefox's event page already *is* a DOM context, so the offscreen
document has no Firefox counterpart and no Firefox need. **This is a platform asymmetry in
where inference runs. It is an architecture decision, not a spike conclusion, and nothing is
redesigned here.**

**Finding 4 — Firefox MV3 refuses the extension's `fetch` to the loopback origin.** The
event page got `TypeError: NetworkError when attempting to fetch resource` even with
`host_permissions` declared, and setting `extensions.originControls.grantByDefault=true` did
**not** change it. Firefox MV3 treats host permissions as **opt-in origin controls** granted
by the user, not at install time.

The harness worked around this **for reporting only**, through a tab-navigation beacon
carrying the full payload — no measurement was lost or altered. But the product implication
is not a harness detail: **PratiBimb's egress module must reach the server origin from an
extension context, and on Firefox MV3 that may require an explicit user grant.** That
interacts with Invariant E and with the CSP `connect-src` pin. **Not resolved here.**

**Finding 5 — the control passed**, so a null adapter would have been attributable to the
extension context rather than to the machine. It was not needed, but it is what makes the
positive result interpretable.

## Conclusion

**ACCEPT**, against the criteria fixed before any data existed: a non-null adapter in the
Firefox MV3 event page, a created device, element-exact compute output, **3 of 3 runs**,
zero uncaptured errors, with the ordinary-page control succeeding on the same machine.

Two constraints attached to the acceptance:

1. **Adapter unidentified.** Firefox returns an empty `adapterInfo`, so no Firefox WebGPU
   figure can be attributed to a specific GPU.
2. **Windows only.** `agentos/registry/feasibility-matrix.md` has separate Firefox cells for
   Windows and Linux. **This fills the Windows cell and no other.** Firefox-on-Linux — where
   WebGPU is off by default behind `dom.webgpu.enabled`, and which the dossier calls the most
   likely judging configuration — remains **`UNKNOWN`**.

### What this explicitly does NOT establish

These are three separate facts and are deliberately not collapsed:

| | Question | Status |
|---|---|---|
| **A** | Is the WebGPU **API** available in Firefox 155 on Windows? | **FACT — yes** |
| **B** | Does **ONNX Runtime Web's** WebGPU backend initialise and run a model there? | **`UNKNOWN` — NOT TESTED.** That is **S-03**, a separate spike. Raw WebGPU working is not ORT Web working. |
| **C** | Is it available in the **exact extension execution context** PratiBimb uses? | **FACT — yes** for the Firefox MV3 event page. See Finding 3: that context differs structurally from Chrome's. |

Also unaffected: S-04 (three ORT sessions in one WASM heap), S-05, S-06, S-07, and all
twenty model cells. **No model was downloaded. No product code was written.**

## Reproducibility

```bash
cd artifacts/experiments/W1-S02-firefox-webgpu-context/harness
npm install web-ext@10.6.0
RUNS=3 node run-s02.js        # -> results.json (committed as logs/results-3runs.json)
```

Requires Firefox at the default Windows install path. Each run creates a fresh temporary
profile under the system temp directory and deletes it afterwards. The harness contacts **no
host other than `127.0.0.1:8903`**, which also serves the ordinary-page control, so both
contexts run byte-identical probe code.

## Scope

**One machine - Windows - Firefox 155.0.1 release - MV3 event page - headful.**
Per `AGENTS.md` section 5 this fills the cell it tested and no other. It says nothing about
Firefox on Linux, nothing about ONNX Runtime Web, nothing about Chrome, and nothing about
workstation 1.
