# QG-03a-B3-1 — the exact T1 artifact in the REAL MV3 extension, per backend

> **QG-03a-B3-1 = PASS**, measured on **workstation 1** (`LAPTOP-6E14K34L`, Intel) on 2026-09-12.
> The evidence is `logs/workstation-1/`. See [decision.md](decision.md).
>
> **This does NOT close QG-03a or QG-03, and the detector remains UNADOPTED.** `QG-03a-B3-2`
> (an NVIDIA-backed cell) is **NOT MEASURED / OPTIONAL COVERAGE**: Chrome selected the Intel `gen-12lp`
> adapter here, so the RTX 5050 was never exercised.
>
> This directory also holds the harness and a **workstation-2 DEVELOPMENT run** under
> `logs/development-laptop-srcink2b/`, which is **not** B3-1 evidence. The harness labels it
> **DEVELOPMENT / NON-W1 EVIDENCE** itself, and so does every file in it.
>
> **QG-03a-B1 and QG-03a-B4 are APPROVED by ronitsaha11.** The criterion numbers were
> pre-registered in QG-03b-2 as an **identical-input detector-equivalence** criterion; B1 approves
> applying them to **backend-noise robustness**. **They are not changed here.** B4 approves the
> fixture scope: **18 UI fixtures gate**, all 20 are executed and reported, and `gradients-edges`
> is **STRESS-ONLY** and does not decide the UI adoption gate.

## Why B3-1 exists, and why B2 cannot close it

B2 measured the exact artifact (`ba6d9e93…`, 302,960 B) under real backend differences on
**workstation 2**, in a **plain `http://127.0.0.1` page** that used the production ORT pin and
session factory. B2 is `PASS` there; QG-03a-B is `CONDITIONAL` on coverage, context, margin and
the criterion.

Workstation 1 already has extension-context evidence (QG-03b-2a: these same 20 PNG captures, the
same artifact, the criterion met in all four Chromium PNG cells). It **cannot be re-audited**:

| what QG-03b-2a kept | why B3-1 needs more |
|---|---|
| reference detections from **Python ORT 1.20.1** | a different ORT version mixes a version difference into a backend difference |
| per-fixture **summaries only** (matched, count delta, worst displacement) | survivor swaps and true failures cannot be told apart after the fact |
| GPU **submit counts** | which GPU executed the cell was not recorded |

So B3-1 = B2's measurement, performed inside the real MV3 extension, against a **native ORT
1.29.0 CPU** reference, keeping the **raw outputs**.

## The extension-context difference

| | B2 (plain page) | B3-1 (MV3 extension) |
|---|---|---|
| realm | `http://127.0.0.1` page | `chrome-extension://…` **offscreen document**, or its **dedicated worker** |
| ORT runtime | production pin, hash-verified | identical, hash-verified **in the realm** |
| model | inlined, hash-checked | identical, inlined, hash-checked in the realm |
| preprocessing / decode / NMS | shipped `dist/` | identical shipped `dist/`, copied verbatim |
| what can differ | — | **which GPU adapter serves WebGPU**, which is why the context is measured rather than assumed |

`apps/extension/entrypoints/ortRuntime.ts` states that inference runs in a **dedicated worker**;
QG-03 and QG-03b-2a ran ORT in the **offscreen document** itself. B3-1 treats the two as
**separate cells** (`--realm=document`, `--realm=worker`) and transfers nothing between them.

## Hypothesis

**H1.** Inside the MV3 extension, on one machine, with the same artifact, the same ORT 1.29.0 and
the same shipped preprocessing, decode and NMS, the WASM and WebGPU cells agree with the native
ORT 1.29.0 CPU reference well inside the candidate criterion, as they did in B2's page context.

**H0 (what would refute it).** A cell whose detections breach the candidate bound at the measured
difference, or a realm in which the adapter or the runtime differs from the page context in a way
that changes the outputs.

**Pre-registered, before any cell ran:** the criterion below, the fixture set (the 20 committed
lossless captures), the reference (native ORT 1.29.0 CPU), the repetition count (3, B2's), and the
rule that a result holds only for the cell that produced it.

## Acceptance criterion (APPROVED — QG-03a-B1, by ronitsaha11)

Per machine × browser × backend × realm cell, at the **actual measured** difference, in **both**
the shipped and the 0.55 operating-point views:

- ≥ 95% of reference detections matched at IoU 0.5
- |detection count change| ≤ 2
- worst matched displacement ≤ 2.0 CSS px
- **zero true failures** (element lost, class change, wrong element, off target, material count change)

Survivor swaps within the displacement bound are not failures; they are reported. Synthetic iid
noise is **never** an acceptance input — B2 showed it destroys the model's 1,402 exact score ties,
which every real backend reproduces, so it does not model backend behaviour.

## Environment

| | |
|---|---|
| **Required for B3-1** | **workstation 1** — `LAPTOP-6E14K34L`, Intel Core 7 240H, Intel Graphics + RTX 5050, Windows 11 |
| **This run (development)** | **workstation 2** — `LAPTOP-SRCINK2B`, AMD Ryzen AI 7 350 / Radeon 860M + RTX 5050, Windows 11 build 26200 |
| Browser | **Chrome for Testing 153.0.8010.12** (unbranded), headful, fresh profile in the OS temp directory, launched by Playwright 1.63.0 with `--load-extension`. Branded Chrome refuses that switch, which makes the extension silently absent (QG-03, S-01) |
| Runtime | ORT Web **1.29.0** (`ort.env.versions.web` read in each realm), production pin `ort-wasm-simd-threaded.jsep.wasm` `db816fad…` verified in the realm, `numThreads = 1`, `proxy = false` |
| Model | `artifacts/models/t1-ui-head/t1-ui-head.onnx`, 302,960 B, sha256 `ba6d9e93…5179d0`, re-hashed in each realm. **Never committed, never regenerated** |
| Fixtures | the 20 `capture-png` fixtures of `W1-QG03b2a-chromium-jpeg-capture`, each verified against its committed digest. **Never regenerated** |
| Reference | native `onnxruntime` **1.29.0** CPU, 1 thread, via B2's `b2_native_reference.py`, which now refuses any other version |
| Extension | `chrome-extension://leokajpegcpdbneebahniocbbjgpiccf`, CSP from the shipped builder: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' http://127.0.0.1:8971` |

**A browser-install quirk, recorded because it cost a run.** Workstation 2's Playwright browser
directory (`%LOCALAPPDATA%\ms-playwright\chromium-1243`) is unusable: `INSTALLATION_COMPLETE` is
absent and the binary fails to start with a Windows side-by-side error (*"Dependent Assembly
153.0.8010.12 could not be found"*), and `npx playwright install chromium` fails on a download
timeout. The **same Chrome for Testing 153.0.8010.12 bytes extracted to another directory launch
normally**, so this is specific to that location, not to the machine or the build. The cells below
ran with `CHROME_PATH` pointing at the working copy.

## Expected result

**For the harness:** every guard fires on the condition it describes; the native reference refuses
a non-1.29.0 ORT; the extension builds from the shipped `dist/` under ADR-0001's CSP; a cell that
cannot produce full evidence is **rejected**, never reported as a pass.

**For B3-1:** the criterion above, per cell — **on workstation 1**, which this run is not.

## Actual result

### Harness validation

| check | outcome |
|---|---|
| unit tests, `packages/perception/test/qg03aB3Harness.test.ts` | **21 passed** — identity, ORT version, fixture count and bytes, output shape and finiteness, submit counting, adapter identity, extension-context assertion, determinism, a 20-case fail-closed matrix, the criterion's own behaviour, and the Python guard |
| fail-closed, runner | with an unusable browser, all four cells were **REJECTED** with the cause recorded (`spawn UNKNOWN`, no extension id, no offscreen document, 0 rows). Nothing was reported as measured |
| fail-closed, analysis | refused every pair as `UNAVAILABLE`, verdict **EVIDENCE INCOMPLETE OR REJECTED**, exit 1 |
| native reference | 20/20 fixtures, ORT 1.29.0, input tensors equal to the committed reference digests, deterministic, dumps verified |

### The four MV3 cells — DEVELOPMENT / NON-W1 EVIDENCE (workstation 2)

Every cell passed its guard: extension loaded, realm confirmed from three places (runner, service
worker `getContexts`, and the realm's own location), ORT 1.29.0 and the pinned artifact verified
in the realm, model re-hashed, 20/20 fixtures, 3 runs each bitwise equal, every raw dump verified
against its logged digest, and no network arrival other than the loopback collector.

| cell | realm | GPU submits during inference | adapter | session create | warm median / p95 | decode + NMS |
|---|---|---|---|---|---|---|
| `chromium-document-wasm` | offscreen document | **0** (hook installed) | — | 425 ms | 30.5 / 32.8 ms | 3.9 ms |
| `chromium-document-webgpu` | offscreen document | **180** | `amd / rdna-3`, not a fallback adapter | 531 ms | 13.3 / 20.3 ms | 4.7 ms |
| `chromium-worker-wasm` | dedicated worker | **0** (hook installed) | — | 319 ms | 31.7 / 35.3 ms | 4.4 ms |
| `chromium-worker-webgpu` | dedicated worker | **180** | `amd / rdna-3`, not a fallback adapter | 486 ms | 12.9 / 21.4 ms | 4.6 ms |

Preprocessing was 14.0–14.4 ms median in every cell; the native reference's first inference was
9.1 ms. **The input tensor was identical across all five cells and equal to the committed
reference digest on 20 of 20 fixtures.**

**Gating pairs — native ORT 1.29.0 CPU as the reference** (4,848 reference detections in the
shipped view, 2,500 at the 0.55 operating point):

| pair | raw max (box / class) | identical | same anchor | swaps | true failures | worst displacement | criterion |
|---|---|---|---|---|---|---|---|
| native vs document WASM | 1.099e-3 / 5.126e-6 | 96 | 4,752 | **0** | **0** | **0.0013 CSS px** | **20/20 and 18/18** |
| native vs document WebGPU | 2.029e-3 / 1.442e-5 | 32 | 4,816 | **0** | **0** | **0.0028** | **20/20 and 18/18** |
| native vs worker WASM | 1.099e-3 / 5.126e-6 | 96 | 4,752 | **0** | **0** | **0.0013** | **20/20 and 18/18** |
| native vs worker WebGPU | 2.029e-3 / 1.442e-5 | 32 | 4,816 | **0** | **0** | **0.0028** | **20/20 and 18/18** |

In the 0.55 view every pair gives 0 swaps, 0 true failures, a count change of 0, matched fraction
1.000, minimum matched IoU ≥ 0.99998 and worst displacement ≤ 0.0028 CSS px.

**Reported, not gating:**

- **WASM vs WebGPU** in both realms: 2.136e-3 box, 1.761e-5 class, worst displacement 0.0025 CSS
  px, 0 swaps, 0 true failures. These are **the same figures B2 measured in the page context** on
  this machine, which is the continuity check between the two contexts.
- **Document vs worker**, same backend: **bitwise identical on 20 of 20 fixtures**, both backends.
  On this machine, with this adapter, the realm does not change the outputs. That is a FACT about
  workstation 2 only; it is the reason the realm stays part of the cell identity rather than being
  assumed away.

**Margin (scaled native→WebGPU difference, reporting only).** `gradients-edges` first fails at
**5×** the measured difference, `realistic-ui` at **50×**, and no fixture fails at 1×, so nothing
was escalated. B2 reported `gradients-edges` failing from 2× — that figure scaled the
**WASM→WebGPU** difference against a **WASM** reference, so the two margins are not the same
quantity and are recorded separately rather than merged.

## Conclusion

**The harness is implemented, its guards are tested, and it has been exercised end to end.**
**QG-03a-B3-1 is still NOT STARTED**: the cells above are workstation 2, and B3-1 is a
workstation-1 cell. **QG-03a-B stays CONDITIONAL, QG-03a stays OPEN, QG-03 stays CONDITIONAL, and
the detector stays UNADOPTED** at threshold 0.55. The model, NMS, decoder, threshold, fixtures,
held-out split, model registry and every security invariant are untouched.

The development run does add one thing the project did not have: the exact artifact is now known
to run through the production pin and the shipped decode **inside the real MV3 extension**, in
both the offscreen document and its dedicated worker, with the backend proved by counted GPU
submits and the adapter identified. On this machine that context makes no difference to the
outputs. **Whether that holds on Intel is exactly what B3-1 has to measure.**

Both gates on the B3-1 measurement are now satisfied:

1. **QG-03a-B1 and B4 — APPROVED by ronitsaha11.** The criterion is unchanged; the gate reads the
   **18 UI fixtures**, while all 20 are still executed and reported and nothing is dropped.
2. **Workstation 1** — the four cells ran there on 2026-09-12. Evidence: `logs/workstation-1/`.

What remains open is **QG-03a-B3-2** (NVIDIA), which B3-1 does not and cannot supply.

## Limitations

**The measured B3-1 result** (`logs/workstation-1/`) carries these limitations:

- **Intel only.** The WebGPU cells ran on `intel / gen-12lp`; the RTX 5050 in the machine was not
  selected and no flag was used to force it. `QG-03a-B3-2` is **NOT MEASURED / OPTIONAL COVERAGE**,
  and **no NVIDIA claim is made**.
- **One browser version.** Chrome for Testing **151.0.7922.34**. Every cell records its own
  version and cells are not merged across versions.
- **Windows only.** Linux and Firefox extension realms are unmeasured.

**The workstation-2 run** under `logs/development-laptop-srcink2b/` is **development evidence, not
B3-1 evidence**: Chrome for Testing 153.0.8010.12 on the `amd / rdna-3` integrated adapter. It is
kept because it is what validated the harness, and it says nothing about Intel, NVIDIA, Linux or
Firefox.
- **Firefox has no offscreen document.** B3-1 is Chromium-only by construction; a Firefox cell
  would be a different realm and a separate decision.
- **Headful only.** `--headless` exists and is recorded in the cell name, but headless WebGPU has
  no adapter in some configurations (S-02), so it was not used.
- **The OS GPU list is not evidence** of which GPU executed a cell; only the adapter record is.
- **The raw dumps are gitignored** (~6 MB per cell). They are reproducible from the harness, but a
  workstation-1 operator should archive them, because losing them is precisely what made
  QG-03b-2a unauditable.

## Reproducibility

```bash
# prerequisites: npm ci && npm run typecheck; the model in place (hash-checked, never committed);
# an unbranded Chromium: npx playwright install chromium
E=artifacts/experiments/W1-QG03a-B3-1-mv3-extension-backends/harness

node $E/build-b3-extension.mjs                                  # assemble ext-chrome (gitignored)
node $E/run-b3-native.mjs                                       # native ORT 1.29.0 CPU reference
node $E/run-b3-chrome.mjs --realm=document --backend=wasm        # one realm and backend per launch
node $E/run-b3-chrome.mjs --realm=document --backend=webgpu
node $E/run-b3-chrome.mjs --realm=worker   --backend=wasm
node $E/run-b3-chrome.mjs --realm=worker   --backend=webgpu
node $E/analyze-b3.mjs                                          # guards, comparison, criterion, margin
```

Each runner refuses to start unless the model, the ORT version, the fixture digests, the build and
this machine's native reference all check out, and exits non-zero if any guard fails.
`CHROME_PATH` overrides the browser (needed on workstation 2, see Environment); `PYTHON` overrides
the interpreter; `--log-dir` lets the analysis read another machine's logs. Logs land in
`logs/<machine>/`; raw `.f32` dumps and the assembled extension are gitignored and rebuilt per run.

## Files

| path | purpose |
|---|---|
| `design.md` | the component mapping, written before implementation |
| `harness/b3-guards.mjs` | every fail-closed guard, unit-tested |
| `harness/b3-criterion.mjs` | B2's comparison and classification, plus the candidate criterion |
| `harness/b3-instrument.js` | GPU submit, adapter and network observers; loads before ORT |
| `harness/b3-probe.js` | the realm: `bootstrapOrtRealm`'s calls, then B2's per-fixture path |
| `harness/build-b3-extension.mjs` | assembles the MV3 extension from the shipped `dist/` |
| `harness/run-b3-native.mjs` · `run-b3-chrome.mjs` | native reference · one browser cell |
| `harness/analyze-b3.mjs` | comparison, criterion, margin, decoded detections |
| `logs/development-laptop-srcink2b/` | **the workstation-2 development run. NOT B3-1 evidence.** Five cell logs, `b3-analysis.json`; the decoded detections of a development run are gitignored |
