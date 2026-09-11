---
id: W1-QG03b2a-chromium-jpeg-capture
title: "QG-03b-2a — real Chromium captureVisibleTab JPEG conformance"
status: recorded
date: 2026-09-11
label: FACT (observations) / INFERENCE (assessment)
verdict: CONDITIONAL
workstation: 1 (LAPTOP-6E14K34L)
---

# QG-03b-2a — the browser's own encoder, not a stand-in for it

> QG-03b-2 established that the browser decodes JPEG exactly the way the reference decoder
> does. Every file it tested was written by **Pillow** — and Pillow's encoder and Chromium's
> decoder are both libjpeg-turbo, so that agreement was partly structural. The result rested
> on an assumption nobody had tested: that the browser's *own* encoder behaves the same way.
>
> **Result: the capture path is `ACCEPT` in all 8 cells — bitwise identical, max abs 0 —
> including the 4:2:0 chroma subsampling and embedded sRGB ICC profile that the synthetic
> fixtures never carried. No retraining required.**
>
> **The gate is nevertheless `CONDITIONAL`**, because the pre-registered *detector* bound is
> exceeded on 1 of 20 fixtures in the 2 WASM cells. That is measurably **not** a
> capture-format result — see [decision.md](decision.md).
>
> A finding the question was not asking for: **omitting `format` yields JPEG, not PNG.** The
> shipped adapter passes `{format:"png"}` explicitly, and deleting it would silently switch
> the product to lossy capture.

## Hypothesis

Pre-registered, before any capture was decoded — and inherited verbatim from QG-03b-2 so the
two results are directly comparable:

- a **lossless** capture must decode **bitwise identically** to the reference;
- a **lossy** capture must decode within **max abs 2 / mean abs 0.2** (ITU-T T.83 allows a
  compliant JPEG decoder a peak error of 1 against the reference IDCT; 2 is one level of
  slack). Exceeding it means the difference is not ordinary decoder variance and a specific
  cause must be named;
- **letterbox geometry must be exact** — it is arithmetic on dimensions, not a codec
  question, so there is no tolerance;
- **primary criterion: detector output** — ≥95% matched at IoU 0.5, count delta ≤2, worst
  CSS displacement ≤2.0 px.

## Expected result

JPEG within the lossy bound; PNG bitwise. Colour management was expected to be the most
likely source of divergence, because a real Chromium JPEG embeds an ICC profile and Pillow
does not apply one — a difference the Pillow-written fixtures could not have exposed.

## Environment

Workstation 1 (`LAPTOP-6E14K34L`), Windows 11 build 26200. Chromium **151.0.7922.34**
(Playwright 1.63.0 bundled — branded Chrome 152 refuses `--load-extension`). Pillow 12.3.0
on libjpeg-turbo. onnxruntime 1.20.1 (Python reference) / ORT Web 1.29.0 (browser). Full
detail in [environment.json](environment.json). **Firefox is deliberately absent** — see
below.

## Actual result

**Capture path `ACCEPT` in all 8 cells**: 40 fixtures, both formats, decoded pixels bitwise
identical (max abs **0**), geometry exact, tensor digests matching. Colour management had no
effect anywhere. The lossy bound was never approached.

**Detector bound exceeded on 1 of 20 fixtures in the 2 WASM cells** (15.95 CSS px against
2.0). Attributed by measurement to NMS ordering sensitivity downstream of a bitwise-identical
tensor — not to the capture format.

## Conclusion

**`CONDITIONAL`.** The real Chromium JPEG capture path produces defensible model inputs; the
assumption QG-03b-2 rested on holds. The condition is a detector-stability property that
belongs to **QG-03a**, and it is stated rather than reclassified away. **No retrain. No
registry change. QG-03 stays CONDITIONAL.**

---

## What was actually exercised

`chrome.tabs.captureVisibleTab`, in a real Chromium 151 extension, against real rendered
pages. The capture harness contains **no image encoder of any kind**: no canvas, no
`toDataURL`, no library. It asserts before each run that the binding it is about to call
stringifies as `function captureVisibleTab() { [native code] }`, and a permanent test
asserts that the file has not grown an encoder since.

That distinction is the whole experiment. A canvas `toDataURL("image/jpeg")` would also
produce a real browser JPEG, from a different component with a different configuration, and
every number would look equally plausible while answering a question nobody asked.

## What the encoder does — measured, not assumed

Read out of the captured files' own DQT and APP2 markers:

| property | measured |
|---|---|
| MIME | `image/jpeg`, magic `ff d8 ff e0` (JFIF) |
| **format when `format` is omitted** | **JPEG** — not PNG |
| chroma subsampling | **4:2:0** on every file |
| progressive | no — baseline |
| quantization tables | 2 (luma + chroma), IJG Annex K scaled |
| implied IJG quality | **exactly 90**, unique match, on every file |
| `quality` honoured? | yes for JPEG (q100 → 372 KB, q50 → 96 KB); **ignored for PNG** |
| ICC profile | **456 bytes, sRGB, "Google Inc. 2016"** — on every JPEG |
| ICC profile on PNG captures | **none** |
| `{format:"webp"}` | **rejected at schema validation** |
| determinism | byte-identical across repeats *and* across headful/headless |

The quality number is **derived from the tables**, not assumed: the IJG quality whose scaled
Annex K table reproduces the observed one exactly. If a future Chromium changes tables the
match goes false and the test fails rather than reporting a nearest guess.

Two of these are easy to get backwards, and both are now guarded by tests:

- **Omitting `format` yields JPEG.** The shipped adapter passes `{format: "png"}`
  explicitly. Deleting that argument would not raise and would not fall back to lossless —
  it would silently switch the product to lossy capture at q90 with 4:2:0 chroma.
- **WebP is refused by the API**, not merely absent from our type. QG-03b-2 inferred this
  from the declaration; here Chromium says so itself.

## The fixtures

Ten pages, each rendered and captured at a chosen size. `captureVisibleTab` captures the
real window surface and **ignores CDP device-metrics emulation** — a page told it was
1023×641 still captured at 1264×805 — so the runner resizes the actual window and verifies
what it achieved. All ten targets were hit exactly.

| page | capture size | why |
|---|---|---|
| `text-heavy` | 1264×800 | highest spatial frequency a screenshot can carry |
| `controls` | 1264×800 | buttons, inputs, selects |
| `small-controls` | 1264×800 | 572 controls at 40×13 px |
| `dense-ui` | 1264×800 | 40×11 table |
| `gradients-edges` | 1264×800 | conic gradient beside a 1px Nyquist checkerboard |
| `wide` | 1600×600 | wide letterbox |
| `tall` | 700×1000 | tall letterbox, padding on the left/right |
| `odd-dims` | 1023×641 | both axes odd → pad 119/120, an uneven split |
| `fractional-letterbox` | 960×640 | continuous pad 106.667 vs raster 106 |
| `realistic-ui` | 1264×800 | nav + cards + table |

Each captured twice, in headful and headless, in PNG and JPEG: **80 captures, 40 fixtures**.

## The comparison

```
Chromium JPEG bytes ──> browser decode ──> production preprocessing ──> tensor
       │                                                                  ║ compared
       └──────────────> Pillow decode  ──> reference preprocessing ─────> tensor
```

Both sides verify the file's SHA-256 — the browser recomputes it in-page before anything
else runs — so *"both sides decoded the same file"* is a measurement, not an assumption.

**The JPEG capture is never compared against the PNG capture to decide conformance.** Those
are two images of one paint and their difference is compression. That quantity is measured,
reported as `compressionSensitivity`, and belongs to QG-03a.

## Results

All eight cells, all 40 fixtures, both formats:

- decoded pixels **bitwise identical** (max abs **0**) — including 4:2:0 JPEG with an
  embedded ICC profile
- letterbox geometry **exact**, no tolerance anywhere
- tensor SHA-256 **matches** the reference
- colour management: **no effect** (`colorSpaceConversion:"none"` changes nothing; the
  embedded profile is sRGB-identity to within 1 level on the widest-gamut fixture only)
- premultiplication: no effect — captures are opaque

Detector agreement is exact (1.5e-03 CSS px) on 39 of 40 rows. The 40th is discussed in
[decision.md](decision.md) and [saturation-control.json](saturation-control.json).

## Reproducibility

```bash
npm run typecheck
CHROME_PATH=<unbranded chromium> node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/capture-chromium.mjs
python tools/detector/qg03b2a_fixtures.py
node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/build-qg03b2a-extension.mjs
CHROME_PATH=<...> BACKEND=wasm   node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/run-qg03b2a-chrome.mjs
CHROME_PATH=<...> BACKEND=webgpu node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/run-qg03b2a-chrome.mjs
node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/aggregate-qg03b2a.mjs
python tools/detector/qg03b2a_saturation_control.py
CHROME_PATH=<...> node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/negative-controls.mjs
```

The captured bytes are **machine-bound**: font rasterisation belongs to the installed fonts
and the compositor, so another machine produces different files. That is why the committed
hashes are evidence rather than a CI assertion, and why no permanent test re-renders a page.

## Deviations, stated rather than hidden

- **The harness holds `<all_urls>`; production holds `activeTab`.** `activeTab` is granted
  only after a user gesture on the extension's own toolbar action, which Playwright cannot
  deliver. This was measured, not guessed: a host permission scoped to the fixture origin
  alone is refused by Chromium 151 with *"Either the '<all_urls>' or 'activeTab' permission
  is required."* The gate decides **whether** the call runs and has no path to the bytes it
  returns. The product's permission is unchanged.
- **The harness paces and retries around the capture quota.** The shipped adapter must never
  do that — there, throttling is reported to the tier that owns capture cadence. Zero
  throttle retries were needed in the recorded run.

## Files

| path | what |
|---|---|
| `harness/pages.mjs` | the ten fixture pages |
| `harness/capture-ext/` | the capture extension — one API call, no encoder |
| `harness/capture-chromium.mjs` | phase 1: real captures, window-size calibration |
| `harness/captured/` | the exact returned bytes + `manifest.json` |
| `tools/detector/qg03b2a_fixtures.py` | phase 2: the reference, from those bytes |
| `harness/qg03b2a-probe.js` | phase 3: browser decode + preprocess + detect |
| `harness/aggregate-qg03b2a.mjs` | per-cell classification |
| `harness/negative-controls.mjs` | evidence the harness can fail |
| `tools/detector/qg03b2a_saturation_control.py` | attribution of the one CONDITIONAL |
| `packages/perception/test/realCaptureConformance.test.ts` | the permanent guards |
