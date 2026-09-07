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
| S-01 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Chrome `chrome.offscreen` document? | `UNKNOWN` | — |
| S-02 | Does `navigator.gpu.requestAdapter()` return a **real adapter** inside a Firefox MV3 event page? | `UNKNOWN` | — |
| S-03 | Can an ONNX Runtime Web session be **created and run** in each context, on each backend? | `UNKNOWN` | — |
| S-04 | Can **three ORT Web sessions coexist** in one WebAssembly heap inside an extension offscreen document, and does teardown reclaim memory? | `UNKNOWN` | — |
| S-05 | What are the **real `tabs.captureVisibleTab` rate limits** under `activeTab`? | `UNKNOWN` | — |
| S-06 | Does the coordinate contract hold at DPR 1.0 / 1.5 / 2.0 and 100% / 125% zoom? | `UNKNOWN` | — |

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
