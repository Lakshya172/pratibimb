# M10 — visual redaction integration (in progress)

> **Status: IN PROGRESS.** M10 is being delivered as separately committed units. Product visual-only
> PII protection remains **NOT VERIFIED**: no frame is captured, masked, encoded or sent by anything
> recorded here, and no product path calls TR-01.

| unit | commit | what it established |
|---|---|---|
| M10.1 | `9af71b7` | TR-01 detector contract (`packages/perception/src/textRegion.ts`), golden-equal to M8.1 |
| M10.2 | `6386abd` | fail-closed `TextFinding` and `planVisualRedaction` (`packages/privacy/src/textFinding.ts`) |
| M10.3 | `6121081` | visual-only region enumeration in OBSERVE (`visualRegions`) |
| M10.4 | this unit | TR-01 in a dedicated worker owned by the offscreen document; external 2,000 ms deadline |

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

## Environment

W1 (`LAPTOP-6E14K34L`), Windows 11, Chrome for Testing (Playwright `chromium-1243`), headed, built
MV3 host from this commit's tree. Full provenance is in each log.

- **M10.3:** loopback fixture `tests/browser/extension/fixture/visual-regions.html` at 1280×720 CSS
  px, `deviceScaleFactor` 1, 1.25, 1.5 and 2.
- **M10.4:** the evidence build `TR01_PROBE=1`, which carries the step-by-step probe and the
  memory/network instrument. The product build carries neither. Frames are M8.2's seven fixed
  screenshots (dev, H1–H6, 1280×720), which are git-ignored.

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

## Conclusion

Region enumeration works through the real extension on this fixture. That supplies the regions the
privacy planner needs. It says nothing yet about capture, masking or egress, which are later M10
units.

M10.4: the TR-01 worker works as specified on W1, and meets both engineering gates on this fixture
set. Nothing in the product calls it yet. Capture, crop, masking, encode and egress are later units.

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
