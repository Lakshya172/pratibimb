# M4 — the real gesture route, and what a local text tier would actually cost

> **W1 evidence, 2026-09-24.** M3.1 built a worker-free capture route and could not run it. **It has
> now run.** A person clicked the extension's toolbar button; the grant minted an opaque
> 24-character handle; the offscreen realm turned that handle into pixels itself through
> `getUserMedia`; perception ran on the result; and the worker's own recording of everything it saw
> was 7 messages, 2 152 bytes, no PNG signature, no `data:` URL, no base64 run at all.
>
> **The first click found a real defect**, which is the argument for the product cell existing. An
> unconstrained tab stream returns **1920×1200 for a 1280×720 viewport** — 16:10 against 16:9 — and
> the coordinate guard refused it, correctly, because a single `scale_to_css` cannot describe two
> axes that differ by ten percent. `captureVisibleTab` never showed this.
>
> **No text model was integrated, and the reason is a rule this repository froze before the
> milestone.** See [`ocr-audit.md`](ocr-audit.md).

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runners:** [`run-gesture-capture.mjs`](../../../tests/browser/extension/run-gesture-capture.mjs)
  (**HUMAN-IN-THE-LOOP**, new) · [`run-extension-loop.mjs`](../../../tests/browser/extension/run-extension-loop.mjs)
  (71 → **72** checks) · [`run-detector-eval.mjs`](../../../tests/browser/extension/run-detector-eval.mjs)
- **Logs:** [`logs/w1-cft153-gesture-capture.json`](logs/w1-cft153-gesture-capture.json) ·
  [`M3.1/logs/w1-cft153-detector-eval.json`](../M3.1-visual-evidence/logs/w1-cft153-detector-eval.json)
- **Audit:** [`ocr-audit.md`](ocr-audit.md) · **Verdict:** [`decision.md`](decision.md)

## Hypothesis

That the gesture capture route could be verified by a real browser user action rather than argued
for; and that a local text tier could be chosen on the repository's own evidence rather than on
popularity.

**What would falsify it:** a grant obtained by anything other than a person's invocation; a pixel in
the worker; an evidence run taken on the degraded build and reported as the product route; a model
adopted past a frozen blocking rule; a text seam that could carry a recognised string upward.

## Expected result

1. Before the click: the authority refuses, there are no grants, the build has no capture path.
2. The click grants, the grant mints an opaque handle, and only the handle crosses.
3. The offscreen realm turns the handle into an `ImageBitmap` and perception runs on it.
4. The worker's own recording contains no pixels.
5. The text tier reports its **absence** on every pass rather than returning no findings.
6. The three acts and the single-action invariant are unchanged.

## Environment

| | |
|---|---|
| Product build | `permissions: [offscreen, sidePanel, activeTab, tabCapture]`, `host_permissions: ["http://127.0.0.1/*"]`; **0** `captureVisibleTab` calls |
| Gesture evidence | taken on the **product build**; the harness reads the built manifest and worker and refuses to start on any other |
| Automated evidence | the same plus `M3_WORKER_FRAME=1`, recorded as `routeCategory: DEGRADED_TEST_ROUTE` |
| Invocation | **a person clicked the extension's toolbar action.** Nothing in the harness produced, simulated or substituted for it |
| Detector | `pratibimb-t1-ui-head` rev `ba6d9e93695b`, 302 960 B, unchanged |
| Text tier | **none adopted.** `TEXT_PERCEPTION_UNAVAILABLE` on every pass |

## Actual result

### Part A — the gesture route, HUMAN-IN-THE-LOOP: **PASS, 12 of 12**

| step | measured |
|---|---|
| before the click | `NO_ACTIVE_TAB_GRANT`, 0 grants, `workerFrameEnabled: false` |
| the click | grant recorded after 138 627 ms of waiting (second run) |
| mint | opaque handle, **24 characters** |
| consume | `getUserMedia` 71 ms + `grabFrame` 97 ms → `ImageBitmap` |
| perceive | **`GESTURE_STREAM`**, 1280×720, 102 109 B, 65 detections, 2 fused |
| worker | **7 messages, 2 152 bytes**, png `false`, data-url `false`, longest base64 `0` |

**The first click's failure is part of the evidence, not an embarrassment before it.** The
unconstrained stream came back 1920×1200 against a 1280×720 viewport, giving x-scale 0.667 and
y-scale 0.600, and `assertGeometryConsistent` refused with `CAPTURE_DIMENSION_MISMATCH`. Every
coordinate from that frame would have been wrong on one axis. The stream now asks for the viewport's
dimensions — `max` rather than `min`+`max`, so it is a request and not an assumption — and the
geometry is still built from the bitmap that actually arrived.

### Part B — the two kinds of evidence are not mixed

The record names its route category once, at the top: `REAL_STREAM_ROUTE` or
`DEGRADED_TEST_ROUTE`. This run is the latter and says so. In a **product** build there is no
fallback to silence, because `captureVisibleTab` is an optional property of the browser adapter and
is absent from the bundle — no grant means `NO_ACTIVE_TAB_GRANT`, not a quieter way of getting a
frame.

### Part C — the text audit: **do not integrate**

Full reasoning in [`ocr-audit.md`](ocr-audit.md). The short form:

- A licence-verified (Apache-2.0 at the pinned revision), revision-pinned OCR path **already
  exists** in the registry. Nothing needed to be found, and nothing was downloaded.
- `PP-OCRv5_mobile_det` **fails its own stated correctness criterion on WASM** — 4.12e-02 against a
  2e-02 bound fixed before the run — and WASM is the only backend the extension uses.
- `agentos/workflows/model-adoption.md` blocking rule 2 is **FROZEN**: *"A model that fails the WASM
  columns is not shipped, whatever it does on WebGPU."* Declining is the default; adopting would
  need an ADR overriding it.
- Cost, if it were adoptable: **+313 ms inference per frame** and ~1 s of load, against a current
  budget of 138–248 ms per reading.
- **The finding that outlives this milestone:** a recognised string would be produced in the
  *perception* realm, and the vault lives in the *content script's* realm. Putting one in the other
  means crossing the worker — the exact thing M2 exists to prevent, in the other direction. A second
  vault is forbidden. The cheapest honest path is therefore to **detect a text region and redact it
  unread**, which produces no string and needs no vault — and which needs the half that fails WASM.

### Part D/E/F — the seam, and the fixture it cannot read

`host-lib/text-perception.ts` is the port. It is **absent by default and refuses**, in the same way
`createUiElementDetector(null)` refuses rather than returning an empty list: *"looked and found
nothing sensitive"* and *"never looked"* must not be the same record.

`TextFinding` has a box, a character **count**, and a class. **It has no field for the string.** A
future recogniser cannot hand one upward by forgetting to redact; it would have to change that file,
visibly. Five tests hold this with a stub recogniser that genuinely reads — the only honest way to
check a boundary whose model is absent.

On the fixture's canvas-rendered identifier: the DOM cannot read it, the UI detector fires **20
boxes inside the card and describes none of them** (best IoU 0.066), and there is no recogniser. So
**the identifier is neither read nor protected**, and no claim is made that it is.

### Part G/H — cost

| stage | worker-frame route | **gesture route** |
|---|---|---|
| capture | 61–72 ms | 133 ms |
| decode | 11–13 ms | **0** (a bitmap, not an encoded frame) |
| encode | 0 | **1 040 ms** |
| preprocess | 29–30 ms | 24 ms |
| inference | 41–50 ms | 54 ms |
| **total** | 144–166 ms | **1 252 ms** |

**The encode is the whole difference and nothing reads its output.** It exists only so
`CaptureFrame.pixels` is a truthful PNG rather than a claim. It is **one sample** and probably
includes codec initialisation. It is recorded as the first thing to measure again — not the first
thing to delete, because deleting it means changing a package contract.

Text tier: **0 ms**, because it is absent.

### The three acts — automated, degraded route: **PASS, 72 of 72**

| Act | State | Verify | Route | Released | Wrote | Clicks |
|---|---|---|---|---|---|---|
| SUCCESS | `DONE` | CONFIRMED | `WORKER_FRAME` ×3 | 1 | 1 | 1 |
| REFUSAL | `REFUSED` | — | throttled, none | **0** | **0** | **0** |
| OUTAGE | `DONE` | CONFIRMED | ×2, 1 throttled | 1 | 1 | 1 |

`worker: 115 messages, 84 160 bytes, 0 fixture values, 0 pixels` · egress `leakCheck CLEAN` ·
single-action stress **25/25**.

## Conclusion

| | |
|---|---|
| **ARCHITECTURAL INVARIANT** | a product build has no pixel path into the worker; no grant means refusal, not a quieter frame; `TextFinding` cannot carry a string |
| **EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)** | the gesture route, end to end, 12/12, on the product build, from a real toolbar click |
| **EXPERIMENTALLY VERIFIED** | 72/72 acts, worker/reasoner/egress scans, 25/25 action counts — all on the **degraded** route, labelled as such |
| **CONDITIONAL / EXPERIMENTAL** | every detector number |
| **NOT YET VERIFIED** | the three acts on the gesture route; any local text perception at all |

**Not claimed:** perfect PII detection, perfect OCR, zero leakage in general, broad visual
understanding, production readiness. **The canvas identifier is not protected**, and M4 says so.

## Reproducibility

```bash
npm run build -w @pratibimb/extension     # product build — required for gesture evidence
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-gesture-capture.mjs
#   … then click the extension's toolbar button on the fixture tab.

M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
```
