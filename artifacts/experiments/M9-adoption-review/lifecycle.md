# M9 — model lifecycle, resources, and the Firefox correction (Parts F, G, H)

## F. Lifecycle for an adopted detector

### What the product does today, for the resident UI head (the pattern to follow)

`apps/extension/host/offscreen/main.ts` `ensurePerception()`:

- **lazy**: built on the first perception need, then kept;
- **one pinned session per offscreen document**, *"not one per observation"*;
- the pin is re-verified once at bootstrap (ADR-0001);
- there is no explicit `release()`, so the session lives as long as the document;
- a failed boot yields `acceptedBackends: []`, so the detector **refuses** rather than returning zero
  detections.

### Proposed lifecycle for the text-region detector

```
first pass that has ≥ 1 visual-only region
  → create   pinned session via createPinnedInferenceSession (same ORT, same pin, same document)
  → load     packaged model bytes (same-origin asset), hash-checked against the registry
  → infer    one run per pass, AFTER the UI head's run, never concurrently
  → consume  Detection[] → CSS → UNREAD_REGION → planRedaction → mask → opaque fill (perception realm)
  → keep     the session for the document's life, like the UI head
  → dispose  release() on any error; reclamation only by closing the offscreen document
  → recreate only in a NEW document (the offscreen document is the reset unit)
```

| question | answer | basis |
|---|---|---|
| when instantiated | on the first pass that has a visual-only region | pages with none never pay the cost (below). Depends on blocker G-4: the product cannot enumerate visual-only regions yet |
| lazy or eager | **lazy** | the UI head is lazy. The first use costs a cold load (M8.2 benchmark: 814–853 ms TR-01, 725–747 ms TR-02) plus a cold inference (621–635 / 681–702 ms), paid once per document |
| where memory lives | the offscreen document's ORT WASM linear memory, **one arena shared with the UI head** | M8.2 coexistence: peak with UI head + YuNet resident **equals** the candidate's own peak (131.1 / 152.4 MB) |
| teardown | `release()` frees sessions **within** the arena, but linear memory cannot shrink. Memory returns only when the document is closed | S-04 / S-04a meaning; M8.2 teardown: 0 grows after cycle 1 in 4/4 environments; a recreated offscreen document starts at **0 MB** |
| on error | create failure → the tier is `UNAVAILABLE` for the document's life → every pass masks each visual-only region whole (INV-23). An inference throw → that pass masks whole. **No silent retry** inside a pass | INV-23; `DetectorRegistry` has no fallback chain by design |
| on timeout | the pass masks each visual-only region whole. **The deadline value is an OWNER DECISION REQUIRED** (`privacy-review.md`, finding 1) | INV-23 |
| **enforcing** a timeout | **INFERENCE, NOT YET VERIFIED:** with `numThreads = 1` and no proxy worker, ORT WASM inference runs on the offscreen document's own thread. A timer in that same document therefore cannot fire until the run returns. A deadline would have to be enforced **by the caller in another realm** (the service worker awaiting the reply), with the offscreen document closed to stop the work. The integration must measure this before relying on any timeout | the single-threaded execution model (`numThreads = 1`, M8.2 runtime configuration). **No measurement of timer behaviour during a run exists** |
| concurrency | **none within a document**: UI head, then text detector, sequentially | M8.2 coexistence ran sequential rounds; no concurrent-run evidence exists |
| interaction with the UI head | UI-head output is **bit-identical** with the text detector resident (5/5 runs per candidate), the arena is shared, and the UI head's shipped decode was unaffected (23 detections every run) | M8.2 `coexistence/summary.json` |

## G. Resource evidence — measured, not thresholded

| | TR-01 `PP-OCRv4_mobile_det` | TR-02 `PP-OCRv3_mobile_det` | source |
|---|---|---|---|
| artifact | 4 766 440 B | 2 436 135 B | M8.1 conversion logs |
| declared input on a 720×1280 frame | 640×1024 | 736×1312 (1.47× the pixels) | M8.1 `prep-native.py` |
| WASM memory after load / after inference | 27.8 / **131.1 MB** | 19.3 / **152.4 MB** | M8.2 controlled benchmark (20 launches each) |
| with UI head + YuNet resident | 131.1 MB peak | 152.4 MB peak | M8.2 coexistence 5/5 |
| after teardown | arena stays at peak; zero further growth; fresh context 0 MB | same | M8.2 teardown 4/4 |
| Chromium WASM warm inference (n = 200 / mode) | median 470.5 / 471.1 ms, p90 493.7 / 487.1 | median 557.0 / 561.5 ms, p90 575.6 / 577.3 | M8.2 benchmark |
| total per pass (decode + preprocess + warm + post) | ~514 ms | ~614–622 ms | M8.2 benchmark |
| Firefox WASM (Linux) warm median, amended | 462 / 523 ms (6 launches, characterisation) | 616 / 613 ms | M8.2a |
| Chrome WebGPU p50 | 140 / 138 ms | 176 / 164 ms | M8.2 cells |

**Context, not a bound.** The resident UI head's own arena is **26.4 MB** (W1-QG03). A text-region
detector raises the perception document's arena to **~131 or ~152 MB**, roughly 5–6× the current
resident figure. The constitution's *"~120 MB resident across the four models"* is a **weights**
projection, not a runtime-memory budget: the candidates' weights are 4.8 and 2.4 MB. **No
runtime-memory budget exists** in QG-03 or the constitution, and none is created here. Whether one
is needed is part of the owner's adoption decision.

Per-pass time: the UI head's WASM inference is **~41 ms p50** headful (W1-QG03 matrix). A text
detector adds ~0.5–0.6 s per pass on W1 Chromium, roughly 11–14× the current inference cost, on
every pass that has a visual-only region. No latency budget exists for the text tier, and none is
created.

## H. The Firefox correction — harness mitigation is not product behaviour

| | |
|---|---|
| **M8.2 (historical)** | one TR-02 launch in the Firefox WASM (Linux) cell started and never reported. It was recorded as CONDITIONAL, making QG-03 FAIL |
| **diagnostic** | over-30 s probes: 0/4 reported at Firefox defaults, 4/4 with `extensions.background.idle.timeout` raised (both candidates) |
| **M8.2a** | the same cell re-run for **both** candidates with that one pref set **in each launch's temporary web-ext profile**. 6/6 and 6/6, outputs byte-identical to M8.1 and M8.2. One TR-02 probe ran 36.3 s and reported only because of the amendment |
| **what it was** | an **experimental-harness mitigation**: one pref, per launch, in a discarded profile. It is **not** product runtime behaviour |
| **the product** | **does not change any Firefox setting and must not.** The pref is not to be added to the product, which could not set it anyway (it is a browser pref, not an extension API) |

**Could a product path approach Firefox's event-page idle limit?**

- **Today, no product path runs in a Firefox event page.** The product build produces only
  `chrome-mv3` (`apps/extension/.output`). Its manifest needs `offscreen` and `tabCapture`
  (`wxt.config.ts`), and perception runs in a **Chromium offscreen document**. The Firefox limit
  governs no current product code.
- **Chromium offscreen, measured:** across 74 M8.2 offscreen launches, the longest uninterrupted probe
  ran **14.8 s** and none was terminated. No offscreen lifetime limit is claimed beyond that
  observation.
- **A future Firefox build of the perception path:** **UNKNOWN — NOT YET VERIFIED.** No such build
  exists. A single text pass is ~0.5–0.8 s in Firefox (M8.2a), far below 30 s. But whether a
  product run's sequence of passes and messages keeps an event page alive has never been measured.
  It must be measured in that build before any Firefox claim is made.
