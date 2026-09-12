# QG-03a-B3-1 harness — design note (written before implementation)

> **Status: HARNESS DESIGN.** This note maps what B3-1 reuses and what it adds. It records no
> measurement. B3-1 itself is **NOT STARTED** until the harness runs on **workstation 1**, and
> B1 (the criterion) is **APPROVED by ronitsaha11**; the numbers are unchanged.

## Why B3-1 needs a new harness

B2 measured the exact T1 artifact on workstation 2 in a **plain `http://127.0.0.1` page**.
Workstation 1's existing extension evidence (QG-03b-2a) cannot close B because its reference was
Python ORT **1.20.1**, no raw outputs were kept (so swaps and true failures cannot be told
apart), and the GPU that ran each WebGPU cell was not recorded. B3-1 has to combine B2's
measurement with QG-03b-2a's real MV3 extension context.

## Component mapping

### From B2 (`W1-QG03a-B2-real-model-nms/harness/`)

| B2 component | In B3-1 | Why |
|---|---|---|
| `run-b2-browser.mjs`: model size + SHA refusal | **reused** as `b3-guards.mjs` `assertModelIdentity` | same artifact, same refusal, now unit-tested |
| `run-b2-browser.mjs`: fixture SHA check against QG-03b-2a `fixtures.json` | **reused** as `selectPngFixtures` + `assertFixtureBytes`, plus a count check (20) | B2 did not fail on a wrong count |
| `run-b2-browser.mjs` page: capability assert → `numThreads=1`, `proxy=false` → `installVerifiedOrtRuntime` → `createPinnedInferenceSession({executionProviders:[backend], graphOptimizationLevel:"all"})` | **reused, moved into the extension realm** (`b3-probe.js`); the resolved `numThreads`, `proxy` and pin are recorded and checked | the calls `apps/extension/entrypoints/ortRuntime.ts` makes; asset URLs resolve against `self.location`, exactly as `resolvePackagedAsset` does |
| page: native `createImageBitmap` decode → shipped `preprocessToTensor` → 3 runs per fixture → digests | **reused** (same 3 runs, B2's determinism count) | identical input path |
| page: `GPUQueue.prototype.submit` hook before ORT | **adapted** into `b3-instrument.js`, loaded first in every realm, plus a `requestAdapter` wrap that records the adapter's own identity | a WASM "0 submits" with no hook is NOT_OBSERVED, not zero |
| server: raw `.f32` dumps + digest check | **adapted**: dumps are posted per fixture as binary to the loopback collector and verified on arrival | extension messages are the wrong channel for ~6 MB per cell |
| `b2_native_reference.py` | **reused with a guard**: refuses unless `onnxruntime.__version__ == "1.29.0"`; output paths become arguments, defaulting to B2's | no silent substitution of the reference; B2's workflow is unchanged |
| `analyze-b2.mjs`: `rawDiff`, `classify` (identical / same anchor / survivor swap / off target / wrong element / class change / element lost / material count), `preRegisteredPass`, shipped + op055 views, scaled real delta | **reused unchanged in semantics** as `b3-criterion.mjs`, pure functions, unit-tested | the approved-candidate criterion must be measured exactly as B2 measured it |
| `analyze-b2.mjs`: iid perturbation | **not reused** | shown not to be a backend-noise model; never an acceptance input |

### From QG-03b-2a (`W1-QG03b2a-chromium-jpeg-capture/harness/`) and QG-03

| component | In B3-1 | Why |
|---|---|---|
| `build-qg03b2a-extension.mjs`: MV3 manifest, service worker → `chrome.offscreen` document, shipped `dist/` copied verbatim, ORT files copied, model inlined as base64, CSP from the shipped `buildExtensionPagesCsp` | **adapted** as `build-b3-extension.mjs` | the proven extension architecture; the CSP cannot drift from ADR-0001 |
| `run-qg03b2a-chrome.mjs`: Playwright unbranded Chromium with `--load-extension`, abort if the service worker never appears, one backend per launch | **adapted** as `run-b3-chrome.mjs` | branded Chrome refuses `--load-extension`; one backend per launch avoids arena inheritance (S-04a) |
| `qg03b2a-probe.js` detector loop | **replaced** by `b3-probe.js` | it kept only summaries and did not set `proxy=false`; B3-1 keeps raw outputs |
| `qg03-instrument.js` (GPU, `requestAdapter`, network arrival observers) | **adapted** as `b3-instrument.js` (GPU + adapter + network; no memory wrap) | independent observers, not ORT's self-report |

### New in B3-1

| component | Why it is needed |
|---|---|
| **worker realm** (`b3-worker.js`, a dedicated worker created by the offscreen document) | `ortRuntime.ts` says inference runs in a dedicated worker; QG-03 and QG-03b-2a ran ORT in the offscreen document itself. The two are **separate cells** (`--realm=document` / `--realm=worker`): the realm can change which adapter serves WebGPU, and results do not transfer between cells |
| **extension-context proof** | the realm records its origin, URL and realm kind; the service worker reports `chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"]})`; the runner records the service worker URL. A non-`chrome-extension://` origin fails the cell |
| **native-reference refusal in the runner** | the browser runner will not start unless this machine's native log exists, reports ORT 1.29.0, and matches the fixture tensors |
| **`verifyCellLog` / `verifyNativeLog`** | one fail-closed checker for every required field; the analysis refuses a cell it rejects |
| **evidence class** | every log carries `evidenceClass`. Anything not run on workstation 1 (`LAPTOP-6E14K34L`) is `DEVELOPMENT / NON-W1 EVIDENCE` and is written under `logs/development-<machine>/` |
| **native CPU as the reference** | native ORT 1.29.0 CPU is the reference; WASM and WebGPU are each compared against it, and against each other (B2's pair) |
| **decoded detections kept** | every cell's decoded detections (label, score, box, emission order) are written in full precision, so the matching can be recomputed without the raw dumps |
| **two fixture readings** | B4 (gradients-edges STRESS-ONLY) is **APPROVED by ronitsaha11**: the **18 UI** fixtures gate. The analysis still reports **all 20** and the 18, and never drops a fixture — the 20-fixture reading is analytical, not the gate |

## Criterion (APPROVED — QG-03a-B1, by ronitsaha11)

Per machine × browser × backend × realm cell, same model, same ORT version, same shipped
preprocessing, decode and NMS, at the actual measured difference: ≥ 95% matched at IoU 0.5,
|count change| ≤ 2, worst matched displacement ≤ 2.0 CSS px, and zero true failures, in both the
shipped and the 0.55 operating-point views, exactly as B2 computed them. The numbers originate in
QG-03b-2 as an identical-input detector-equivalence criterion. This harness does not change them.
