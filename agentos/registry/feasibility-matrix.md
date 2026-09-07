# Model Feasibility Matrix — PratiBimb

> **Twenty cells. Filled in week one, re-run in CI thereafter.**
> Source: dossier v4.0 section 10 ("Model feasibility matrix", new in v4.0).
>
> **No model enters the build until its row is complete across all four combinations.**
> **A model that fails the WASM columns is not shipped whatever it does on WebGPU** — the
> judging machine is more likely to be the WASM one.

---

## What each cell must record

Four things, all four required for the cell to count as filled:

1. **Does the session load?** (`LOAD: yes/no`)
2. **p50 latency on a fixed fixture** (`P50: N ms`)
3. **Peak heap** (`HEAP: N MB`)
4. **Output correctness against a known-good reference** (`CORRECT: yes/no`)

Plus provenance: machine, OS, browser version, ORT/Transformers.js version, date, and the
artifact path under `artifacts/experiments/`.

---

## The matrix

**Status of every cell: `UNKNOWN`. Nothing has been run.**

| Model | Chrome WebGPU | Chrome WASM | Firefox WebGPU | Firefox WASM (Linux) |
|---|---|---|---|---|
| UI element detector | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| YuNet faces | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| PP-OCRv5-mobile | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| GLiNER-PII | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |
| SmolVLM (offline path) | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` |

---

## Prerequisite spike — must pass before the matrix can be filled

**This is the first thing the project does. Nothing else starts until it resolves.**

| # | Question | Status | Evidence |
|---|---|---|---|
| S-01 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Chrome `chrome.offscreen` document? | **`FACT` — YES** | [`W1-S01`](../../artifacts/experiments/W1-S01-chrome-webgpu-context/README.md) |
| S-02 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Firefox MV3 event page? | `UNKNOWN` | — |
| S-03 | Can an ONNX Runtime Web session be **created and run** in each context, on each backend? | `UNKNOWN` | — |
| S-04 | Can **three ORT Web sessions coexist** in one WebAssembly heap inside an extension offscreen document, and does teardown reclaim memory? | `UNKNOWN` | — |
| S-05 | What are the **real `tabs.captureVisibleTab` rate limits** under `activeTab`? | `UNKNOWN` | — |
| S-06 | Does the coordinate contract hold at DPR 1.0 / 1.5 / 2.0 and 100% / 125% zoom? | `UNKNOWN` | — |

### S-01 result — recorded 2026-09-07

**ACCEPT.** Chrome **152.0.7977.82** (stable, headful, Windows 11). WebGPU is fully
functional in all four probed contexts — ordinary page (control), MV3 background service
worker, `chrome.offscreen` document, and a **dedicated Worker inside the offscreen
document**, which is PratiBimb's real inference context. Adapter returned, device created,
WGSL compute shader output **element-exact against a CPU reference**, device destroyed and
re-acquired cleanly. Identical across **3 runs**, zero uncaptured GPU errors.

Target context (offscreen dedicated worker), min/median/max over 3 runs:
`requestAdapter` 17.5 / 17.8 / 22.9 ms · `requestDevice` 9.3 / 9.8 / 18.7 ms ·
cold dispatch 5.8 / 6.2 / 6.3 ms · warm p50 4.6 / 4.8 / 5.0 ms · warm p95 5.7 / 6.0 / 6.2 ms.
End-to-end submit-to-readback on a trivial shader, **not** a model and **not** kernel time.

Two constraints attached to the acceptance:

1. **Integrated graphics only.** Chrome returned `intel / gen-12lp` in every context and
   run, under both default and `high-performance` power preferences, despite an NVIDIA
   RTX 5050 Laptop GPU being present. Every WebGPU figure measured on this machine is an
   integrated-graphics figure. → **S-01a**
2. **Chrome 152 stable refuses `--load-extension`.** Extensions load only via CDP
   `Extensions.loadUnpacked`. Affects the CI plan for the Playwright egress interception
   suite. → **S-01b**

**S-01 does NOT fill any of the twenty model cells, and does not answer S-03.** Raw WebGPU
working is not ONNX Runtime Web's WebGPU backend working.

| # | New question raised by S-01 | Status | Blocks |
|---|---|---|---|
| S-01a | Can Chrome be made to select the discrete NVIDIA adapter, and what does that do to the numbers? | `UNKNOWN` | Nothing; affects labelling |
| S-01b | Does Playwright's bundled Chromium still honour `--load-extension`, so the egress suite can run in CI? | **still `UNKNOWN`** — see the S-01b result below | QG-04 enforcement plan |

### S-01b result — recorded 2026-09-07

**CONDITIONAL.** Playwright **1.63.0**, branded **Edge 152.0.4191.66** and branded **Chrome
152.0.7977.77**, headful, Windows 11, on **workstation 2** (AMD Ryzen AI 7 350 / Radeon 860M
— *a different machine from S-01*; see `artifacts/environment/ENV-0002-workstation-omen-audit.md`).

The spike was deliberately widened beyond its original wording, because *"does the extension
load"* is a precondition for the Invariant E suite rather than the capability it needs. The
suite must also **observe** and **block**. It cannot.

| Question | Result |
|---|---|
| Does a Playwright-driven browser load the unpacked MV3 extension? | **Edge 152: YES · Chrome 152: NO** |
| Does Playwright's **own bundled** Chromium load it? | **`UNKNOWN`** — the binary would not execute here |
| Can Playwright observe egress from the MV3 **service worker**? | **YES** |
| Can Playwright observe egress from the MV3 **offscreen document**? | **NO** — 3 of 3 runs |
| Can Playwright **block** offscreen-document egress? | **NO** — the POST reached the wire under an abort-everything route, 3 of 3 runs |

`docs/architecture/constitution.md` section 5 places payload assembly and inference in the
**offscreen document**. `context.route()` is therefore blind to the context PratiBimb sends
from, and a suite written on it would assert *zero outbound requests*, pass, and prove
nothing. **QG-04 cannot be signed off on the current enforcement plan.** No invariant was
weakened; the replacement vehicle is an ADR decision and is not made here. See issue #5.

Root cause: CDP reports the offscreen document as a `background_page` target; Playwright's
`BrowserContext` does not surface it, so the route handler never attaches to it.

**Three variants could not be run**, and are recorded rather than glossed: Playwright's
browser CDN returns **HTTP 400** on this network, and the Chrome for Testing 153.0.8010.12
build it names **will not start** on this machine (side-by-side configuration error).
**The literal S-01b question therefore remains `UNKNOWN`.**

Evidence: [`W1-S01b`](../../artifacts/experiments/W1-S01b-playwright-extension-loading/README.md)

| # | New question raised by S-01b | Status | Blocks |
|---|---|---|---|
| S-01b-1 | Does the interception gap reproduce on **`ubuntu-latest` with Playwright's own Chromium** — the real CI cell? | `UNKNOWN` | **QG-04 enforcement plan** |
| S-01b-2 | Which vehicle enforces Invariant E mechanism (2)? **Requires an ADR.** | `UNKNOWN` | **QG-04 sign-off** |
| S-01b-3 | Is the gap a Playwright limitation or specific to Edge? | `UNKNOWN` | Scope of S-01b-2 |

---

> **GPU adapter availability from extension background contexts has been inconsistent.**
> If S-01 or S-02 returns null, **every WebGPU number in the dossier becomes the WASM
> number and the entire performance story changes.**
>
> The spike does not stop at the adapter. **"WebGPU when available, WASM always" is an
> objective, not an observed fact** — a specific model on a specific backend either works
> or it does not, and finding out in week five is finding out too late. **Every model is
> run in every context before the build commits to it.**

---

## The WebGPU position, stated precisely

The engineering rule is simple: feature-detect `navigator.gpu`, always ship a benchmarked
WASM path, and show which one is live. **But give the accurate reason.**

- WebGPU is **not** missing from Firefox. It shipped by default on **Windows in Firefox
  141**, reached **Apple Silicon macOS in 145** and the remaining macOS versions in **147**.
- **Chrome** has had it since **113**; **Safari** since version **26**.
- **The real gap is Firefox on Linux**, where it remains disabled by default and is
  enabled through `dom.webgpu.enabled` in `about:config` on the release channel, with
  Mozilla targeting a **2026** ship.
- **Android Firefox is later still**, and **driver blocklists affect older hardware
  everywhere**.

> Saying "Firefox doesn't support WebGPU" to a panel that has read the release notes costs
> credibility on a point where the engineering was right.

**Note:** the browser-version facts above are **quoted from the dossier**. They are
`INFERENCE` from a document, not `FACT` observed in this environment, and should be
re-checked against release notes before they appear on a slide.

---

## Related risk (dossier section 13)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Judging machine has no WebGPU — Firefox on Linux | **High** | WASM path built and benchmarked from week one; both budgets published; live backend shown in the ledger; **never ship WebGPU-only** |
| WebAssembly heap exhaustion with several models | **High** | Per-worker isolation, WebGPU provider, lazy loading, measured teardown, explicit thread count |
| Panel reads the build as a DOM scraper, not a vision agent | **High** | T1 vision on every changed frame; a scanned-ID segment in the demo where the DOM is empty by construction; the local-decision path shown as vision-driven; tier firing distribution on the slide |
