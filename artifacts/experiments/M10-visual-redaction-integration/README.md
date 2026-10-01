# M10 — visual redaction integration (in progress)

> **Status: IN PROGRESS.** M10 is being delivered as separately committed units. Product visual-only
> PII protection remains **NOT VERIFIED**: nothing recorded here encodes or sends a frame. From M10.6
> the product perception pass on the gesture route captures, runs TR-01 and masks in place, and keeps
> the sanitized RGBA frame in the offscreen document; encoding and the test loopback are the next unit.

| unit | commit | what it established |
|---|---|---|
| M10.1 | `9af71b7` | TR-01 detector contract (`packages/perception/src/textRegion.ts`), golden-equal to M8.1 |
| M10.2 | `6386abd` | fail-closed `TextFinding` and `planVisualRedaction` (`packages/privacy/src/textFinding.ts`) |
| M10.3 | `6121081` | visual-only region enumeration in OBSERVE (`visualRegions`) |
| M10.4 | `67e0509` | TR-01 in a dedicated worker owned by the offscreen document; external 2,000 ms deadline |
| M10.5 | `4e8fbfb` | full-frame TR-01 → fail-closed plan → canonical geometry → opaque pixel mask, in place |
| M10.6 | this unit | that chain wired into the product perception pass, on the real toolbar-gesture stream |

## Hypothesis

**M10.3.** The content script can enumerate every rendered `<canvas>` and `<img>` as a positional id
and a CSS rectangle, deliver it through the existing strict OBSERVE path, and hand it to the privacy
planner unchanged. The ordinary element graph is unaffected, and no pixel, URL or text crosses.

**M10.4.** TR-01 can run in a dedicated worker owned by the offscreen document, with:

- the pinned ORT runtime and a runtime-verified model;
- geometry-only output identical to M8.1's recorded boxes and scores;
- a deadline that `worker.terminate()` actually enforces;
- recovery by recreating the worker;
- combined WASM linear memory within the 200 MB engineering gate.

**M10.5.** A real captured frame can be sanitized in memory, with:

- TR-01 run on the FULL frame, never a crop;
- detector boxes mapped to CSS and offered to every visual region, as RE-1's scorer does;
- the canonical geometry planned fail-closed;
- the mask rounded outward into capture pixels and filled opaquely in place.

It should cover every fixture ink pixel and change no pixel outside the mask. Detector failure should
mask every region whole, and REFUSED should leave no frame.

**M10.6.** The product perception pass can run that chain on a frame from the real gesture route:

- a person's toolbar click → `activeTab` → `getMediaStreamId` → offscreen `getUserMedia` → `grabFrame`;
- then the UI head, then TR-01 on the full frame (sequential, M9), then association with the
  observation's `visualRegions`, `UNREAD_REGION` findings, the fail-closed plan, the canonical geometry
  and the opaque fill in place;
- leaving only the sanitized RGBA frame in the offscreen document, with the raw bitmap closed.

The worker and the service worker should receive nothing beyond what M10.4 and M3.1 allow, and the
detector's output on frozen frames should be unchanged from M8.1.

## Environment

W1 (`LAPTOP-6E14K34L`), Windows 11, Chrome for Testing (Playwright `chromium-1243`), headed, built
MV3 host from this commit's tree. Full provenance is in each log.

- **M10.3:** loopback fixture `tests/browser/extension/fixture/visual-regions.html` at 1280×720 CSS
  px, `deviceScaleFactor` 1, 1.25, 1.5 and 2.
- **M10.4:** the evidence build `TR01_PROBE=1`, which carries the step-by-step probe and the
  memory/network instrument. The product build carries neither. Frames are M8.2's seven fixed
  screenshots (dev, H1–H6, 1280×720), which are git-ignored.
- **M10.5:** the evidence build `M3_WORKER_FRAME=1 TR01_PROBE=1`, with one real frame per step
  through the existing no-gesture route (`captureVisibleTab` in the worker). Each cell launches
  Chrome with `--force-device-scale-factor` 1, 1.25, 1.5 and 2 on the loopback fixture
  `tests/browser/extension/fixture/visual-mask.html` at 1280×720 CSS px. Node tests use the frozen
  synthetic RGBA fixture (`apps/extension/test/support/maskFixture*`) and the 90 canonical golden
  vectors.
- **M10.6:** the evidence build `TR01_PROBE=1` only: no `M3_WORKER_FRAME`, so the capture route is
  the product's. The harness refuses to run unless the evidence build's `background.js`,
  `content.js` and `manifest.json` are byte-identical to the product build's. Each of four windows
  launches Chrome with `--force-device-scale-factor` 1, 1.25, 1.5 and 2 and a fresh profile, on the
  M10.5 fixture `/mask/` at 1280×720 CSS px, and waits for **one real toolbar click by the owner**.
  Nothing in the harness produces, simulates or substitutes for the click. Machine state at launch
  (read, not changed): on AC power, Windows power plan Balanced, CPU load 23%.

## Expected result

**M10.3:**

- Regions `canvas:0`, `canvas:3`, `img:0` and `img:2` are present.
- `canvas:1` (display:none), `canvas:2` (visibility:hidden) and `img:1` (zero size) are absent.
- Each rectangle equals the live DOM's `getBoundingClientRect`, and `img:2` keeps its full, partly
  off-screen rectangle.
- Rectangles are identical at every DPR.
- The element graph still contains `#name` and `#submit`.
- None of the fixture's synthetic strings, and no image data, appears in the observation.

**M10.4:**

- The model hash is verified at runtime (`18aaccf9…`, 4,766,440 B).
- All seven frames give boxes and scores exactly equal to M8.1's recorded WASM output.
- Output is deterministic across warm runs and across fresh workers.
- A second concurrent request is refused with `DETECTOR_BUSY`.
- A run whose deadline is tightened to 50 ms gives `DETECTOR_TIMEOUT`: the worker is terminated, and
  the next run recreates it and matches the earlier output.
- Every run's end-to-end time is under 2,000 ms.
- Combined WASM linear memory (TR-01 worker plus the UI head in the offscreen realm) is at most
  200 MB.
- There are no foreign network arrivals in the worker.

**M10.5:**

- The observation carries exactly `canvas:0`, `canvas:1` and `img:0`.
- Every pixel wholly inside a fixture ink rectangle is the fill.
- Both controls (DOM text, a colour swatch) are byte-identical.
- Every mask pixel is the fill, and nothing outside the mask changed; at DPR 1 this is re-checked in
  the harness from the raw and sanitized buffers.
- A 50 ms deadline gives `DETECTOR_TIMEOUT`, and every region's visible area is filled.
- A region corrupted inside the realm (NaN width, duplicate id) gives REFUSED: no frame, and the
  buffer is wiped.
- In Node, the 90 golden vectors reproduce the pre-registered masks and exactly the pixels they
  cover.

**M10.6**, in each window:

- **Before the click:** the capture authority refuses (`NO_ACTIVE_TAB_GRANT`), and so does the
  browser (`getMediaStreamId` fails). There is no grant, no TR-01 host and no held frame.
- **After the click:** every pass runs on a stream id the browser minted. Its timeline shows the
  stages in M9 order, with the worker given the full frame.
- **Masking:** the model hash is verified at runtime. Every fixture ink pixel is filled, and the
  controls and everything outside the mask are unchanged.
- **Failure paths:** a 50 ms deadline gives `DETECTOR_TIMEOUT` and masks the regions whole, and the
  next pass recovers on a fresh worker. A corrupted region gives REFUSED with no frame.
- **Boundaries:**
  - the worker receives only `TR01_INIT` and `TR01_DETECT {protocol, runId, width, height, rgba}`;
  - the service worker records no pixels;
  - there are no foreign-origin arrivals;
  - warm TR-01 stays under 2,000 ms, and combined WASM memory is at most 200 MB.
- **RE-1:** on the frozen frames, the product path's boxes, masks and RE-1 scores equal M8.1's.

## Actual result

**M10.3: PASS** at all four DPRs, with rectangles identical across DPRs:
`logs/w1-cft-visual-regions.json`.

One harness correction was made after the first run and before the recorded one. The first run
failed only its own DPR check at 1, 1.5 and 2. Under emulation, Chrome reports `devicePixelRatio`
with float32 noise (for example `1.5000000596046448`), and the observation carries that value
verbatim. The check now requires:

- the observation's `dpr` to equal the page's own value exactly;
- the page's value to be within 1e-6 of the requested factor.

No product code changed between the two runs.

**M10.4: PASS**, `logs/w1-cft-tr01-worker.json`. Latency is in `performance.now()` ms, measured on W1,
with 38 warm runs (20 × dev, 3 × each held-out frame) and 10 fresh workers.

| measure | n | median | p90 | min | max |
|---|---|---|---|---|---|
| runtime pin install | 10 | 73.6 | 86.4 | 67.6 | 157.7 |
| model fetch + SHA-256 | 10 | 15.0 | 17.3 | 13.6 | 17.8 |
| session create | 10 | 161.5 | 189.7 | 148.1 | 205.3 |
| first inference, end to end (fresh worker) | 10 | 380.6 | 411.2 | 360.6 | 442.8 |
| warm preprocess | 38 | 13.1 | 15.2 | 12.3 | 18.0 |
| warm inference | 38 | 295.1 | 320.6 | 283.8 | 324.7 |
| warm postprocess | 38 | 1.8 | 4.5 | 1.5 | 4.9 |
| warm end to end (host, post → result) | 38 | 311.7 | 336.9 | 299.1 | 341.3 |
| UI head warm inference (offscreen) | 10 | 32.4 | 40.3 | 30.2 | 40.8 |

These are the second recorded run's figures. The first recorded run, before the 10 cold cycles were
added, also passed every check; its log was overwritten.

Memory is WASM linear memory, measured by M8.2's method: the `WebAssembly.Memory` constructor is
wrapped before ORT creates its memory, and size is read from `buffer.byteLength`. It is not RSS and
not the JS heap.

| realm and stage | linear memory |
|---|---|
| worker: before creation | none |
| worker: after model load | 29,097,984 B |
| worker: after first inference, after warm runs (peak) | 137,494,528 B (131.1 MiB) |
| worker: after termination | none |
| worker: recreated after load, then after inference | 29,097,984 B, then 137,494,528 B |
| offscreen: UI head loaded and warm | 27,656,192 B (26.4 MiB) |
| **combined peak** | **165,150,720 B = 157.5 MiB = 165.2 MB** |

The combined peak is within the 200 MB gate whether a MB is read as 10⁶ or 2²⁰ bytes.

The timeout run returned in 66 ms of wall time. It produced `DETECTOR_TIMEOUT`, the worker was
terminated, and it had no `detections` field. The next run was on generation 2 with a new run id and
gave identical output.

The worker's network arrivals were three fetches, all from the extension's own origin: the ORT
bundle via `importScripts`, the WASM artifact, and the model. There were no foreign arrivals. The
glue `.mjs` is loaded by dynamic `import()`, which the instrument does not wrap; packaging and
`script-src 'self'` are its control (ADR-0001 C-3).

**M10.5: PASS** in all four cells, `logs/w1-cft-visual-mask.json`. TR-01 found 6 text lines on the
full frame: the fixture's 5 synthetic lines and the DOM control line. The control line was offered to
every region and clipped away by the canonical geometry.

| DPR (forced) | capture | mask pixels, all fill | changed outside mask | ink uncovered | controls changed | fail-closed pixels (= whole visible regions) |
|---|---|---|---|---|---|---|
| 1 | 1280×720 | 56,401 | 0 | 0 of 30,065 | 0 | 231,800 |
| 1.25 | 1600×900 | 86,087 | 0 | 0 of 46,143 | 0 | 362,400 |
| 1.5 | 1920×1080 | 121,644 | 0 | 0 of 67,094 | 0 | 521,550 |
| 2 | 2560×1440 | 217,520 | 0 | 0 of 120,334 | 0 | 927,200 |

The first recorded run had two harness defects. No product code changed between runs.

- Emulated `deviceScaleFactor` does not change what `captureVisibleTab` returns: every cell captured
  at this display's physical 1.25. The product built its geometry from the frame's measured size and
  masked correctly. The harness now forces the browser's scale.
- Capturing four frames in quick succession hit the browser's capture rate limit, so the REFUSED
  steps never ran and the harness did not surface the error. Captures are now paced and probe errors
  fail the run.

Mask-only latency, in `performance.now()` ms (n = 50 per series, detector excluded). This realm's
timer is coarsened to 0.1 ms, so the individual stages read 0–0.3.

| DPR | detected: total median / p90 / min / max | worst case (fail-closed) fill median / p90 / min / max | pixels written |
|---|---|---|---|
| 1 | 0.3 / 0.5 / 0.1 / 0.5 | 0.4 / 0.5 / 0.3 / 0.7 | 231,800 |
| 1.25 | 0.4 / 0.5 / 0.1 / 3.3 | 0.7 / 1.0 / 0.5 / 1.4 | 362,400 |
| 1.5 | 0.4 / 0.7 / 0.2 / 3.5 | 1.0 / 1.1 / 0.8 / 2.3 | 521,550 |
| 2 | 0.6 / 1.0 / 0.4 / 3.8 | 1.7 / 2.0 / 1.6 / 3.7 | 927,200 |

Memory:

- **WASM linear memory, the gate metric:** unchanged by masking. TR-01 worker 137,494,528 B plus UI
  head 27,656,192 B = 165,150,720 B (157.5 MiB).
- **Masking allocates no second frame:** the fill is in place, and the mask is a list of 5 pixel
  rectangles.
- **JS buffers that exist anyway:** the captured frame (3,686,400 B at DPR 1, 14,745,600 B at DPR 2),
  and M10.4's copy transferred to the worker (the same size).
- **Even counting those buffers against the WASM gate,** the total is 172,523,520 B (164.5 MiB) at
  DPR 1 and 194,641,920 B (185.6 MiB, 194.6 MB) at DPR 2, both under 200 MB.

**M10.6: PASS on the real gesture route in all four windows**, `logs/w1-cft-gesture-redaction.json`
(verdict `EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)`, every check true in every window). **One
finding is recorded below rather than passed over: on gesture-stream frames, TR-01's boxes are not
byte-equal to M8.1's.**

Gesture evidence, per window:

| requested scale | page `devicePixelRatio` | click waited for | stream ids minted after the click | stream frame | CSS viewport | scale to CSS |
|---|---|---|---|---|---|---|
| 1 | 1 | 56,368 ms | 22 | 1280×720 | 1280×720 | 1 |
| 1.25 | 1.25 | 231,086 ms | 16 | 1280×720 | 1280×720 | 1 |
| 1.5 | 1.5 | 4,578 ms | 16 | 1280×720 | 1280×720 | 1 |
| 2 | 2 | 11,703 ms | 16 | 1280×720 | 1280×720 | 1 |

- **Before each click, both gates refused.** The authority gave `NO_ACTIVE_TAB_GRANT`, and Chrome
  refused `getMediaStreamId`.
- **After it, every pass's ticket was a `GESTURE_STREAM` handle**, recorded by the service worker:
  none refused, none on any other route. The extra passes in the DPR-1 window are RE-1's.
- **The stream frame is CSS-sized at every scale.** The product requests the CSS viewport as
  `maxWidth`/`maxHeight` (M4), so at device scales above 1 the browser downscales; the geometry is
  built from the frame that arrived.

The stream frame differs from M10.5, whose `captureVisibleTab` frames were device-sized
(1600×900 … 2560×1440).

Each window's observation carried `canvas:0` (40, 60, 520×200), `img:0` (640, 60, 480×160) and
`canvas:1` (−80, 330, 420×150), identical at every scale. TR-01 found 6 lines on the full frame in
every window.

- **At DPR 1,** the boxes and the pixel mask equal M10.5's DPR-1 cell exactly: 5 rectangles, 56,401
  pixels.
- **At 1.25, 1.5 and 2,** the first `img:0` line's box differs slightly: (659.30, 98.37, 398.89×24.88)
  against (658.42, 97.58, 400.66×27.59). Its mask rectangle is therefore (655, 94, 408×34), and the
  mask is 55,103 pixels.
- **In every window,** all 30,065 pixels wholly inside the five fixture ink rectangles are filled.
  The two controls are byte-identical and no pixel outside the mask changed.

**Order, measured on the real pass.** A test-build stage seam (`onStage`, absent from the product)
records the stages, and the instrumented spawn records the worker's DETECT. Every pass (cold, 10
warm, recovery; 12 per window) ran in this order:

> frame → UI head start → UI head end → TR-01 start → DETECT posted → worker reply → TR-01 end →
> findings → mask planned → fill done

Every DETECT carried the full frame: 1280×720, `rgba` length 3,686,400. The worker verified the
model at runtime: `18aaccf9…`, 4,766,440 B.

**Timeout and REFUSED, every window:**

- **Timeout:** a 50 ms deadline gave `DETECTOR_TIMEOUT` with 1 termination. Every region's visible
  area was filled whole (231,800 pixels, all fill), nothing outside changed, and the sanitized frame
  was kept. The recovery pass ran on generation 2 with 6 detections and 0 stale replies dropped.
- **REFUSED:** a NaN-width region and a duplicate region id each gave `REFUSED` (`REGION_INVALID`),
  with no frame held.

**Boundaries, every window:**

- **Worker:** it received only `TR01_INIT {protocol, type}` and `TR01_DETECT {height, protocol, rgba:
  Uint8ClampedArray(3686400), runId, type, width}`. Its arrivals were from the extension's own origin
  only.
- **Instrument scope:** the instrument records the worker instance it lives in. After the timeout's
  termination that is generation 2, so the counts (11 at DPR 1, 5 elsewhere) cover the recovered
  worker. Generation 1 runs the same code.
- **Offscreen document:** 2 arrivals, 0 foreign.
- **Service worker:** its own record of every message (112 at DPR 1, 82 elsewhere) contains no PNG
  signature, no data URL and no base64 run of 200 characters or more.
- **What it receives from the plain product `PERCEIVE_ONCE`:** the redaction summary and no pixels.

Latency on the real pass, in ms (n = 10 warm passes per window). Every stage is timed by the
perception realm's own clock, `Date.now()`, so each reading is a whole millisecond and a median can
end in .5.

| stage (median / p90 / min / max) | DPR 1 | DPR 1.25 | DPR 1.5 | DPR 2 |
|---|---|---|---|---|
| capture (`getUserMedia` → `grabFrame` → RGBA) | 94 / 97 / 93 / 103 | 134 / 176 / 36 / 186 | 99 / 103 / 93 / 110 | 95 / 104 / 94 / 104 |
| UI head preprocess | 16.5 / 24 / 15 / 26 | 17 / 26 / 14 / 35 | 15.5 / 26 / 14 / 27 | 14 / 22 / 13 / 23 |
| UI head inference | 30.5 / 33 / 28 / 34 | 28.5 / 32 / 27 / 33 | 29 / 33 / 27 / 35 | 28.5 / 31 / 26 / 31 |
| TR-01 (host, post → result) | 349 / 405 / 331 / 410 | 340.5 / 385 / 310 / 426 | 348 / 378 / 315 / 506 | 296 / 306 / 282 / 338 |
| association + findings | 0 / 1 / 0 / 1 | 0 / 0 / 0 / 1 | 0 / 0 / 0 / 0 | 0 / 1 / 0 / 1 |
| plan / pixel mapping / fill | ≤ 1 each | ≤ 1 each | ≤ 1 each | ≤ 1 each |
| **whole local pass** | **500.5 / 571 / 484 / 575** | **549 / 618 / 429 / 647** | **504 / 545 / 470 / 678** | **445.5 / 463 / 436 / 496** |
| cold pass (includes TR-01 initialisation) | 1,285 | 1,248 | 1,093 | 1,090 |
| TR-01 initialisation: runtime / model / session | 82 / 28.1 / 336.2 | 81.2 / 14.8 / 306.1 | 66.3 / 13.8 / 286.7 | 61.5 / 13 / 244.4 |

- **Deadline gate:** the slowest warm TR-01 run was 506 ms, against the 2,000 ms gate.
- **Memory gate:** WASM linear memory in every window was TR-01 worker 137,494,528 B plus UI head
  27,656,192 B, so 165,150,720 B (157.5 MiB) against the 200 MB gate.

**RE-1 on the product path, frozen frames: PASS**, `logs/w1-cft-re1-product.json`. The six frozen
held-out frames (H1–H6) were run through the product's TR-01 host, `reportFromFullFrame` and
`sanitizeFrame`:

- TR-01's boxes and scores equal M8.1's recorded run 1;
- the product's CSS mask equals the canonical `redactionMask`;
- the RE-1 scores equal M8.1's, field for field;
- 0 sensitive glyphs were exposed, out of 40, 64, 47, 45, 51 and 59.

**RE-1 on gesture-stream frames (M9 J7): every RE-1 gate passes, but the boxes are not
byte-equal.** In the DPR-1 window, each frozen frame was shown 1:1 at (0, 0) in the granted document
(no navigation, so the same grant held) and captured through the gesture stream.
`logs/w1-cft-re1-stream-analysis.json` re-reads the formal record with deep equality:

| | H1 | H2 | H3 | H4 | H5 | H6 |
|---|---|---|---|---|---|---|
| boxes (stream / M8.1) | 11 / 11 | 11 / 11 | 7 / 7 | 8 / 8 | 7 / 7 | 13 / 13 |
| boxes byte-equal to M8.1 | no | no | no | no | no | no |
| largest coordinate difference, px | 0 | 2.71 | 2.70 | 2.65 | 2.71 | 2.71 |
| largest score difference | 0.009 | 0.106 | 0.091 | 0.140 | 0.099 | 0.101 |
| RE-1 score equal to M8.1's | yes | yes | yes | no (`strings`, over-mask fields) | yes | yes |
| every RE-1 gate | pass | pass | pass | pass | pass | pass |
| exposed sensitive glyphs | 0 / 40 | 0 / 64 | 0 / 47 | 0 / 45 | 0 / 51 | 0 / 59 |

The same frames shown the same way, but captured by the degraded `captureVisibleTab` route (PNG),
reproduced M8.1's boxes and scores exactly (the dry run below). So did the frozen-frame product run.

- **INFERENCE** (resting on those two facts and this one): the difference enters with the tab-capture
  stream's pixels, not with the product's geometry or post-processing.
- **UNKNOWN:** the stream frame's pixel difference itself was not measured, because no raw stream
  frame is kept.

The owner reviewed this result and directed that it be recorded as a finding, not tuned away.

**Attempt history, disclosed:**

- **Attempt 1 (no evidence),** `logs/w1-cft-gesture-redaction-attempt1-noclick.log`:
  - Window 1 waited the then-default 15 minutes with no click and failed.
  - Window 2 then received a click.
  - The run had been stopped at that point, so no record was written and the attempt counts for
    nothing.
- **Dry runs (degraded route, never gesture evidence),** `logs/w1-cft-gesture-redaction-dryrun.json`:
  the same passes and audits on `M3_WORKER_FRAME=1` with no click, labelled as such.
  - The first passed with TR-01 warm median 313 ms.
  - Two later reruns measured every stage about 3.5–4.5× slower on unchanged code:
    UI head 129.5 ms, TR-01 warm median 1,099.5 and 1,226.5 ms, max 1,456 ms. Unrelated stages
    slowed too, so this is recorded as machine state; its cause was not determined.
  - The kept dry run, after the harness changes below, measured TR-01 308.5 ms and UI head 28.5 ms.
    It matched M10.5's DPR-1 masks exactly, and its RE-1 boxes and scores equalled M8.1's exactly.
- **Harness corrections before the formal run.** No product code changed between attempts except the
  stage seam, which is test-only and tested.
  - The dry-run record said a gesture was recorded; its check names now say no gesture and the
    degraded route.
  - The model check read the upstream `.pdiparams` hash instead of the ONNX pin.
  - The prompt banner's text was in the measured frame, adding two detections that the canonical
    clip removed. It now leaves the page once the click is acknowledged.
- **One harness defect found after the formal run.** Its RE-1 score comparison used JSON text,
  which also compares key order, so the record reports `re1ScoresEqualM81: false` for all six
  images. The deep-equality re-reading above is the corrected comparison. The harness now uses deep
  equality, and the record is left as written.

M10.3, M10.4 and M10.5 were re-run on this tree: rectangles, checks, golden outputs and masks are
identical to their committed records, timing aside. Their committed logs were then restored
unchanged.

## Conclusion

Region enumeration works through the real extension on this fixture. That supplies the regions the
privacy planner needs. It says nothing yet about capture, masking or egress, which are later M10
units.

M10.4: the TR-01 worker works as specified on W1, and meets both engineering gates on this fixture
set. Nothing in the product calls it yet.

M10.5: on a real frame, the chain from full-frame TR-01 to an opaque in-place mask works as specified
at four capture scales, and fails closed as specified. It is exercised through the evidence build; the
product perception pass does not call it yet. Detector recall at capture scales other than the screened
1280×720 is not screened: these cells show TR-01 found every fixture line, and nothing more. Encoding,
verification of encoded bytes and egress are later units.

M10.6: the product perception pass now runs the M10.5 chain on frames from the real gesture route.
The chain is click → browser-minted stream → offscreen frame → UI head → full-frame TR-01 →
`UNREAD_REGION` → fail-closed plan → canonical geometry → opaque fill in place, and it ends with only
the sanitized RGBA frame held.

- **Verified:** on W1 in four real-click windows, on one synthetic fixture, with timeout and REFUSED
  behaving as specified. The worker and service-worker boundaries held, and both engineering gates
  were met with margin.
- **Stream frames are not byte-equal to screenshots.** TR-01's boxes on gesture-stream frames differ
  from its boxes on the frozen screenshots by up to 2.71 px. On the held-out set this costs no
  exposure (0 / 306) and fails no RE-1 gate, but it means M8.1's byte-level equivalence does not carry
  over to the stream route.
- **J7 remains open.** Bounding this needs more than six images and more than one capture scale, and
  is a measurement for a later unit.
- **Not yet verified:** visual-only PII protection in the product, until the sanitized frame is
  encoded, verified and sent through the test-only loopback sink.

## Reproducibility

```
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-visual-regions.mjs
```

Unit tests: `packages/extension-transport/test/visualRegions.test.ts` and
`apps/extension/test/visualRegionPlanning.test.ts`.

M10.4:

```
cp artifacts/experiments/M8.1-visual-text-screening/models/tr01_ppocrv4_mobile_det.onnx \
   artifacts/models/tr01-ppocrv4-mobile-det/tr01-ppocrv4-mobile-det.onnx
TR01_PROBE=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-tr01-worker.mjs
npm run build -w @pratibimb/extension
```

The last command restores the product build. Both the build and the worker refuse a model whose
SHA-256 or length differs from the pin. Unit tests: `apps/extension/test/tr01Worker.test.ts` and
`tests/browser/support/m10-worker-golden.test.mjs`.

M10.5:

```
M3_WORKER_FRAME=1 TR01_PROBE=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-visual-mask.mjs
npm run build -w @pratibimb/extension
```

Unit tests: `apps/extension/test/visualRedaction.test.ts` and
`tests/browser/support/m10-mask-golden.test.mjs`.

M10.6 (the harness builds the product and evidence variants itself and restores the product build):

```
TR01_PROBE=1 npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-re1-product.mjs
npm run build -w @pratibimb/extension
CHROME_PATH="<chrome for testing>" M106_DRY_RUN=1 M106_DPRS=1 node tests/browser/extension/run-gesture-redaction.mjs
CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-gesture-redaction.mjs
node tests/browser/extension/analyse-re1-stream.mjs
```

- **The fourth command needs a person.** It opens four windows in turn, and each waits up to 30
  minutes for one click on the PratiBimb toolbar action. It refuses to overwrite an existing formal
  record.
- **The first three commands need no click.** The dry run is the degraded-route rehearsal and is
  never gesture evidence.
- **Unit tests:** `apps/extension/test/perceptionPass.test.ts`.
