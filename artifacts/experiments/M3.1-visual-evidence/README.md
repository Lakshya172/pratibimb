# M3.1 — visual evidence, honestly held and honestly described

> **W1 evidence, 2026-09-24.** M3 connected the perception substrate to the extension and left two
> things open: a page's pixels transited the service worker, and nobody knew what the detector's
> hundred boxes meant. This closes the first architecturally and answers the second with numbers.
>
> **There is a worker-free pixel route and it is now the product path.** `getMediaStreamId` returns
> an opaque ~40-character handle; the worker carries the string and the offscreen document redeems
> it for pixels itself. A product build contains **zero** calls to `chrome.tabs.captureVisibleTab`
> and asks only for `http://127.0.0.1/*`.
>
> **It requires a human invoking the extension on that tab, and nothing substitutes for it.** Seven
> routes were measured. No automated harness can produce that invocation — so the evidence below was
> taken on the degraded build, every record says so in a field, and the milestone does not claim
> worker-free capture was exercised.

- **Workstation:** **W1** (`LAPTOP-6E14K34L`, Intel Core 7 240H, 16 cores, Windows 11 10.0.26200) ·
  **Node** v24.19.0 · **Playwright** 1.63.0
- **Cell:** **Chrome for Testing 153.0.8010.12**, headed, `--load-extension` · GPU not used
- **Runners:** [`run-extension-loop.mjs`](../../../tests/browser/extension/run-extension-loop.mjs)
  (68 → **71** checks) · [`run-detector-eval.mjs`](../../../tests/browser/extension/run-detector-eval.mjs) (new)
- **Logs:** [`logs/w1-cft153-detector-eval.json`](logs/w1-cft153-detector-eval.json) ·
  three acts in [`M2-page-value-boundary/logs/`](../M2-page-value-boundary/logs/w1-cft153-extension-loop.json)
- **Verdict:** [`decision.md`](decision.md) · **Predecessor:** [`M3`](../M3-local-visual-perception/README.md)

## Hypothesis

That the raw-pixel worker transit could be closed with a real capture authority rather than a
broader permission, and that the detector's output could be characterised rather than either
trusted or dismissed.

**What would falsify it:** a product build that can still capture into the worker; a fallback that
quietly restores it; a claim of worker-free capture the evidence did not exercise; a detector number
that came from tuning against the run it describes; a vision-only box becoming something a plan can
name or a vault can hold.

## Expected result

1. A product build has no capture-into-the-worker path at all, not merely an unreachable one.
2. Without a grant the authority refuses, and does not fall back.
3. Every perception pass records which route it took and whether the worker saw pixels.
4. The detector's output on a page with declared ground truth is measured, at the shipped
   thresholds, with nothing tuned.
5. A visual-only region is counted and never becomes a target or a reference.
6. The three acts and the single-action invariant are unchanged.

## Environment

| | |
|---|---|
| Product build | `permissions: [offscreen, sidePanel, activeTab, tabCapture]`, `host_permissions: ["http://127.0.0.1/*"]` |
| Evidence build | the same plus `M3_WORKER_FRAME=1`, which compiles in `captureVisibleTab` and brings `<all_urls>` on the same single flag |
| Perception realm | the offscreen document: decode/grab, letterbox, ORT session, head decode, fusion |
| Runtime | ONNX Runtime Web **1.29.0**, wasm, `numThreads = 1`, via ADR-0001's pinned path; WASM pin `db816fad…a44dea` re-hashed before any session |
| Detector | `pratibimb-t1-ui-head` rev **`ba6d9e93695b`**, 302 960 B, sha256 `ba6d9e93…a05179d0`, in `[1,3,640,640]` f32 → out `[1,12,6400]` |
| Fixtures | the demo's `application.html` **untouched**; a new `tests/browser/extension/fixture/visual.html` at its own route |
| Not present | no OCR, no VLM, no cloud vision, no second detector, no image persistence, no raw screenshot egress |

## The route table — measured on W1 before anything was designed

| route | mints | pixels avoid the worker | a harness can trigger it |
|---|---|---|---|
| `captureVisibleTab`, worker, `<all_urls>` | yes | **no** | yes |
| `captureVisibleTab`, worker, `activeTab` | yes | no | no |
| `captureVisibleTab`, extension page | yes | no | no |
| **`getMediaStreamId`, worker, `activeTab`** | **yes** | **YES** | **no** |
| `getMediaStreamId`, extension page + a real in-page click | **no** | — | yes |
| `getMediaStreamId`, offscreen document | **no such API** | — | — |
| `_execute_action` keyboard command over CDP | **no** | — | yes |

`<all_urls>` does **not** unlock `getMediaStreamId` — it still answers *"Extension has not been
invoked for the current page"*. A real click inside an extension page does not either: `activeTab`
is about the tab a person pointed at, not about where the click happened. A CDP keyboard command
never reaches Chrome's accelerator table.

## Actual result

### Part A — the worker no longer has a way to capture

| | product build | `M3_WORKER_FRAME=1` |
|---|---|---|
| `chrome.tabs.captureVisibleTab` in `background.js` | **0** | 1 |
| `host_permissions` | `["http://127.0.0.1/*"]` | `+ <all_urls>` |
| no grant → | **`NO_ACTIVE_TAB_GRANT`** | falls to `WORKER_FRAME` |

`captureVisibleTab` is an *optional property* of the browser adapter, supplied only behind the flag,
so the bundler drops the reference with it. The degraded path is **absent** from a product artifact,
not present and refused. Eight tests hold the authority's logic with the browser faked, because the
granted branch cannot be reached from a harness; every one asserts the same thing — what comes back
on the product path is a string with no image in it.

### Part B — what the detector actually is

**Eight classes, none of them text:** `button, link, textbox, checkbox, radio, select, tab, icon`. A
`Detection` is a box, a label from that list, and a score. **There is no character information in
the model's output and no field for any**, so the strongest privacy property here is a shape that
cannot be built rather than a check that passed.

Its standing evaluation (`qg05-detector-evaluation.json`, held-out synthetic split — **not**
re-derived here):

```
mAP@0.5 0.796   element recall 0.923   grounding accuracy 0.055
button: 202 ground truth · 3947 predictions · 165 true positives · 3782 false positives
```

**High recall, roughly four percent precision.** The 94 vision-only boxes M3 saw are what this model
does; they are not distribution shift alone and they are not a bug in the integration.

### Part C/F — the detector on a page with declared ground truth

`visual.html` declares its own boxes from `getBoundingClientRect`. Nothing was tuned; the score
floor is the shipped 0.25. **Identical across two consecutive runs.**

```
6400 anchors → 63 after the package's filtering    {link 21, button 28, textbox 13, tab 1}
scores  min 0.251   median 0.436   max 0.934
boxes   median area 4817 px²   over half the viewport: 0

reference     HIT   IoU 0.621   as textbox @0.36
privacy-link  HIT   IoU 0.646   as link    @0.90
submit        miss  IoU 0.216
help-link     miss  IoU 0.208
the canvas    20 detections inside it, best IoU 0.066 — never as one region
regions with nothing interactable: 10 detections (9 in a paragraph, 1 in a status line)
```

Two of four DOM-described targets found at IoU ≥ 0.5, one correctly classed at 0.9. **That is real
work, and the flooding beside it is real too.** Both agree with QG-05.

**The canvas is the finding that matters.** Twenty boxes fire inside it and none describes it: the
detector reacts to the card's internal structure and has no class for "a document". Combined with
having no OCR, this means the identifier rendered there is **something this client can neither read
nor redact** — recorded as a limitation, not worked around.

### Part D — visual evidence stays visual evidence

`dom` / `vision` / `dom+vision` are a discriminated union with the detector's score *beside*
provenance rather than blended into it. A vision-only box has a synthetic id and is not in the
graph, so `sourceBySelector` cannot key it, the manifest cannot carry it, and no plan can name it.
Nothing in the perception adapter can reach a vault — asserted over its source. `NOT_DETECTED` and
`NO_DETECTOR` stay different answers.

### Part E/H — the three acts, and what crossed

**PASS — 71 of 71 checks.**

| Act | State | Verify | Route | Worker saw pixels | Released | Wrote | Clicks |
|---|---|---|---|---|---|---|---|
| SUCCESS | `DONE` | **CONFIRMED** | `WORKER_FRAME` ×3 | yes (degraded build) | 1 | 1 | 1 |
| REFUSAL | `REFUSED` | — | none — `CAPTURE_THROTTLED` | **no** | **0** | **0** | **0** |
| OUTAGE | `DONE` | **CONFIRMED** | `WORKER_FRAME` ×2, 1 throttled | yes (degraded build) | 1 | 1 | 1 |

```
worker: 115 messages · 84 127 bytes · fixture values 0
        PNG signature false · data:image URL false · longest base64 run 0
        in:CAPTURE_FRAME 7   to-tab:CAPTURE_TICKET 7
egress: leakCheck CLEAN · no pixels by scan and by type
```

Chrome's capture quota refused two passes again, and the client declared the DOM-only floor for the
act that saw nothing — the honesty property from M3, holding under the new transport.

### Part G — timings, and one decode instead of two

W1, per reading, degraded route (the only one a harness can run):

| stage | M3 | M3.1 |
|---|---|---|
| capture | 37–49 ms | 38–52 ms |
| decode | 10–17 ms | 11–22 ms |
| preprocess | 42–71 ms | 32–71 ms |
| inference | 42–86 ms | 45–103 ms |
| fusion | 0–1 ms | 0–1 ms |
| **total** | 133–225 ms | 138–248 ms |

**Decodes per pass went 2 → 1**, which is structural and verifiable by reading: M3 decoded once to
measure the frame and once to rasterise it. The wall-clock effect is *inside run-to-run variance at
three passes per act*, so this is reported as a structural change with the numbers beside it and
**not as a speedup**. On the gesture route there is no decode at all — `grabFrame` hands over an
`ImageBitmap` — and that route has not been exercised, so its timings are unmeasured.

## Conclusion

**EXPERIMENTALLY VERIFIED on W1**, with two parts held apart:

- **ARCHITECTURAL INVARIANT** (true by construction, checkable by reading and by artifact scan): a
  product build has no path from a page's pixels to the worker; the authority refuses rather than
  falling back; a vision-only box cannot become a target or a reference; the detector cannot emit
  text.
- **EXPERIMENTALLY VERIFIED**: 71/71 checks, the three acts, the worker/reasoner/egress scans, and
  the decode reduction.
- **CONDITIONAL / EXPERIMENTAL**: every detector number here. One page, one layout, one browser cell.
- **NOT YET VERIFIED**: the gesture capture route end to end. It is implemented and unit-tested; no
  automated harness can produce the invocation it needs, and this milestone does not claim it ran.

**Not claimed:** perfect PII detection, zero leakage in general, broad visual understanding, or
production readiness.

## Reproducibility

```bash
npm run build -w @pratibimb/extension                      # product: no worker capture path
M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension    # what the evidence below used
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-extension-loop.mjs
CHROME_PATH="<chrome for testing 153>" node tests/browser/extension/run-detector-eval.mjs
```
