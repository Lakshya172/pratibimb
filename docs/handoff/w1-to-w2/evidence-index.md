---
id: HANDOFF-W1-W2-EVIDENCE
title: "W1 → W2 handoff — experiment and evidence index"
status: handoff record
date: 2026-09-13
---

# Evidence index

Every row is copied from the record that established it. **No conclusion was changed, softened or
upgraded to make this handoff read better.** Where a record is silent on provenance, this index
says UNKNOWN rather than guessing.

All 40 experiment directories are contained in the handoff source commit `75e5cd16`.

## How to read the provenance column

| Label | Meaning |
|---|---|
| **W1** | the record itself states workstation 1, or names `LAPTOP-6E14K34L` |
| **W2** | the record itself states workstation 2, or names `LAPTOP-SRCINK2B` |
| **UNKNOWN** | **the record states no workstation.** Do not assume either machine |

**The `W1-` directory prefix is a naming convention and is not provenance.** Several
`W1-`prefixed experiments state workstation 2. If you need the machine for a directory not listed
below, read its `decision.md` header and its `environment.json`; do not read the folder name.

Discriminators that work, if a record is ambiguous: hostname, GPU UUID, GPU driver version (W1
610.74 / W2 592.82), integrated GPU vendor (W1 Intel / W2 AMD), CPU vendor (W1 Intel / W2 AMD).

## Evidence class

| Class | Meaning |
|---|---|
| **engineering proof** | a property of code in this repository, defended by tests |
| **instrument proof** | a measuring tool works. Says nothing about the product |
| **experimental proof** | measured on a synthetic fixture, on one machine, one browser |
| **production proof** | would justify shipping. **Nothing in this repository has it** |

## The current workstream — E-series, MVP, Track G

| ID | Purpose | Location | Commit | Prov. | Status | Class | Limits — what it does NOT license |
|---|---|---|---|---|---|---|---|
| **E2** | class binding: can a field class be bound without leaking? | `artifacts/experiments/E2-class-binding/` | `0658687` (PR #66) | **W2** | **PASS** on the pre-registered criterion | experimental | **Not generalisation evidence** — rules and cases share one author and one session. Mutation 17/19 killed; **B5 and B7 survive**. D-C and D-D not taken. **Does not license a production binder**; needs an independently authored held-out table |
| **E4** | is the leak instrument trustworthy? | `artifacts/experiments/E4-leak-instrument/` | `64bc451` (PR #65) | **W2** | **PASS on attempt 2** (attempt 1 FAILED; both kept) | **instrument** | **PASS means the instrument can measure leakage. It is NOT a privacy claim about PratiBimb** — no product component was involved. Node → loopback only, says nothing about browser-originated egress. **Must be re-validated in the MV3 offscreen document before use** |
| **E6** | MV3 dispatch mechanisms | `artifacts/experiments/E6-mv3-dispatch/` | `9ed71c9` (PR #70) | **W2** | **TYPE: GO** · **CLICK: PARTIAL** · `chrome.debugger`: **NOT RUN** | experimental | Extension clicks are **untrusted**: `isTrusted`-checking pages refuse them, 0/10. Mechanism A went through an overlay. **TYPE GO is not "browser ACT solved."** D-E6-4: MVP-1/MVP-2 used trusted CDP input and must be re-based on the extension transport before being quoted for the product |
| **E7** | would the pipeline dispatch a visual deception? | `artifacts/experiments/E7-visual-deception/` | `37869a2` (PR #67) | **W2** | **GO NOT MET** (and NO-GO not met either) | experimental | **6/10 deceptions would dispatch.** Deterministic candidates close 5 of 6; **D4b is caught by nothing**. Detector caught nothing the checks missed and saw ordinary buttons **0/30**. The existing gate refuses **15/15 icon-only buttons**. **9/10 is not production security coverage** |
| **E8** | do click postconditions mean anything? | `artifacts/experiments/E8-click-postconditions/` | `0c35ad2` (PR #68) | **W2** | UNKNOWN does not dominate; **existing kinds confirm landing, not effect** | experimental | **10 of 80 CONFIRMED runs had the effect absent.** A cancelled checkbox toggle confirmed 10/10. **"80 CONFIRMED" is not universal verification success.** D-E8-1..3 open |
| **E9** | can the frozen model serve on an allowed host? | `artifacts/experiments/E9-server-feasibility/` | `03b5350` (PR #64) | **W2** (metadata retrieval only) | **BLOCKED — NOT RUN**, stopped at the weight-download boundary | none — no run | **No weights downloaded, no package installed, no serving, no latency, no memory figure.** The one derived fact: BF16 totals **8,887,292,732 B** > **8151 MiB**. FP8 fit at E1's context is **UNKNOWN**. Nothing here says "Qwen3-VL-4B cannot run" |
| **Track G** | does the architecture run in MV3 at all? | `artifacts/experiments/G-mv3-host/` | `46550bf` (PR #69) | **W2** | **RUNS** in Chrome for Testing 153 and Edge 153 | experimental | **Experimental host, not the product.** Natural service-worker termination **UNKNOWN**; real side-panel context **UNMEASURED**; Firefox out of scope (D-J undecided) |
| **MVP-0** | is the agent loop demonstrable? | `artifacts/experiments/MVP-0-dom-sufficiency/` | `bbd6f88` (PR #58) | **W2** | DOM insufficiency demonstrated · vision contributes · **TASK FAILED** | experimental | 9 of 11 loop stages unbuilt. DOM grounding 0/7, vision 4/7. **No task completed** |
| **MVP-1** | does a validated click reach a browser? | `artifacts/experiments/MVP-1-act-executor/` | `25327e4` (PR #60) | **W2** | ACT dispatches; ten refusals touch nothing | experimental | **Trusted CDP input, not the extension transport** (D-E6-4). No TYPE, no vault, no fallback targeting |
| **MVP-2** | hit-test + verify result against a real browser | `artifacts/experiments/MVP-2-hit-test-verify-result/` | `e98d807` (PR #61); `logs/fixture-geometry.json` added `48bde93` (PR #62) | **W1** | **AS DESIGNED** — 8 demos, 1 CONFIRMED, 0 clicks in every refusing demo | experimental | **Trusted CDP input**, one synthetic fixture, one overlay shape. **No iframe, shadow-DOM, `pointer-events` or animation coverage.** No task completed |

## Detector and evaluation evidence

| ID | Location | Prov. | Status | Limits |
|---|---|---|---|---|
| **QG-03a-B3-1** | `artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/` | **W1** | **PASS**, four cells | Chrome selected the **Intel iGPU**; the RTX 5050 was never exercised. **QG-03a-B3-2 (NVIDIA) NOT MEASURED / OPEN** |
| **Track B** | `artifacts/experiments/W1-TrackB-geometry-appearance/` | **W1** | **H-GEOMETRY SUPPORTED** (72.8%) | 20 synthetic screens per cell, this project's own generator. **Nothing about real websites.** No mechanism, no boundary located |
| **W-1 precision/scale** | `artifacts/experiments/W1-detector-precision-scale/` | **W2** | arm A partly recoverable; arm B scale implicated | synthetic; stride not shown to be the mechanism |
| **QG-03a-C3 / C3b** | `…C3-label-raster-generalisation/`, `…C3b-letterbox-inverse-attribution/` | **W2** | **INCONCLUSIVE** / **NOT ATTRIBUTED** | confounded capture scale and label geometry |
| **W-A item 11** | `artifacts/experiments/WA-item11-real-ui-evaluation/` | **W2** | **NOT RUN — design pre-registered, approval required** | gate **CLOSED**; 0 of 11 substantive conditions; **no source has evidence permitting capture** |
| Gate records | `artifacts/gates/{QG-02,QG-05-t1-evaluation,T1-detector-fusion,T1-detector-training}/` | see each | frozen | **Detector remains UNADOPTED.** T1 training item 12 "only Python onnxruntime CPU" is **stale** — superseded by B3-1, see AUDIT-0002 |

## Earlier spike series — provenance caution

`W1-S01` … `W1-S05`, `W1-B02*`, `W1-QG03b*` predate the current labelling discipline.

**Seven directories carry no workstation statement in any tracked file:**
`W1-S01-chrome-webgpu-context` · `W1-S03-ort-web-feasibility` · `W1-S04-ort-session-lifecycle` ·
`W1-S04a-real-model-lifecycle` · `W1-S04a1-four-model-residency` ·
`W1-S04a1b-webgpu-int8-root-cause` · `W1-S05rate-capture-limits`.

Their `environment.json` files *do* carry hardware detail — for example `W1-S01`'s records GPU
driver `610.74`, and `W1-S03`'s names an *AMD Ryzen AI 7 350* host. Those are **hints, not
labels**. This handoff does **not** assign a machine to any of them; doing so would be inventing
provenance. If a future experiment needs one of these as a baseline, re-derive the machine from
its own `environment.json` and record the derivation.

**Three `W1-`prefixed directories explicitly state workstation 2:**
`W1-S01b-playwright-extension-loading` · `W1-S02a-firefox-linux-webgpu` ·
`W1-S02a2b-chrome-mv3-wasm-csp`. There are others; read each record.

## Conclusions that must survive this handoff

- **E4 PASS is an instrument property, not a production privacy claim.**
- **E2's pass still requires the independent held-out protocol** before it is generalisation evidence.
- **E7 did not reach GO.** 9/10 is not production security coverage.
- **E8 demonstrated that landing is not necessarily the final UI effect.**
- **E9 has not been run.**
- **E1 has not been run** — and has no directory, no protocol, and no pre-registration.
- **The MV3 host is experimental** unless explicitly promoted by an owner decision.
- **Server/model execution is not claimed** merely because metadata artifacts exist.
- **Green CI is not architecture approval.** **TYPE GO is not a browser agent.**
- **The detector is UNADOPTED**; threshold 0.55; the shipped constant remains 0.25.
