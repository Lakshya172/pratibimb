---
id: W1-QG03b2-capture-format-conformance
title: "QG-03b-2 — capture-format preprocessing conformance"
status: recorded
date: 2026-09-12
label: FACT (observations) / INFERENCE (assessment)
verdict: ACCEPT
workstation: 1 (LAPTOP-6E14K34L)
---

# QG-03b-2 — JPEG and WebP, decoded and preprocessed

> QG-03b proved the PNG path byte-identical end to end. PNG is lossless and both sides run
> the same resampler, so that was achievable. This asks the same question of the formats
> that are **not** lossless.
>
> **Result: `ACCEPT` for every format in every cell. JPEG decoding is BITWISE IDENTICAL to
> the reference — better than the pre-registered bound allowed. No retraining required.**
>
> Two findings the question was not asking for: **a non-opaque frame silently corrupts the
> tensor** (now refused), and **PNG is smaller than JPEG on every fixture**, which settles
> which format the capture path should use.

## Hypothesis

Pre-registered, before any browser was launched:

> **H1.** JPEG decoders will differ between browser and reference by a small bounded amount.
> ITU-T T.83 allows a compliant decoder a peak IDCT error of 1, so **max 2 / mean 0.2** per
> channel was registered as the bound, with the classification decided by **detector output**
> rather than by the tensor bound.
>
> **H2.** WebP will be closer than JPEG, because Pillow and both browsers use libwebp.
>
> **H3.** Colour management is a plausible confounder and must be isolated, not assumed away.
>
> **H4.** Geometry is arithmetic on dimensions and is **not** a codec question, so it must be
> exact with no tolerance for any format.

## Expected result

- **Expected:** H1–H4 to hold, with JPEG showing ±1–2 levels of decoder variance.
- **Wrong, and better than expected:** **H1's bound was never needed.** JPEG decoded
  **bitwise identically**, max abs **0**, on every fixture at both qualities in both
  browsers. Pillow and the browsers all use libjpeg-turbo with the same default IDCT, so
  there is no variance to bound.
- **Not expected, and the reason the alpha fixture existed:** that a **non-opaque** frame
  would be corrupted by the browser pipeline itself, before preprocessing ever runs.
- **Not expected at all:** that **PNG would be smaller than JPEG on every fixture**.

## Environment

Workstation 1, Windows 11 build 26200. Unbranded Chromium **151.0.7922.34**, Firefox
**155.0.1**. Pillow **12.3.0** (libjpeg-turbo, libwebp **1.6.0**). Model `ba6d9e93695b`,
unchanged. **Linux not used; Firefox on Linux remains `UNKNOWN`.**

## Actual result

Sections 1–7. **45 fixture/encoding pairs × 8 cells, all ACCEPT.**

## Conclusion

`ACCEPT`. See [`decision.md`](decision.md).

---

## 1. Scope — what the capture path can actually produce

**JPEG is a real capture format. WebP is not.**

`chrome.tabs.captureVisibleTab` accepts `format: "png" | "jpeg"`, and `TabsCaptureApi` in
`capture.ts` declares exactly that. Every WebP reference in dossier v4.0 is the **T2 egress**
encoding — *"Encode WebP q62, then decode the bytes back"* is the redaction verification
pass, and *"the encoded WebP frame and the serialized manifest"* is the egress payload. **T2
does not exist yet.**

> **An inconsistency this closes:** `CaptureFrame.format` permits `"webp"` while the adapter
> that populates it cannot produce one. WebP is measured here anyway — the cost is small, the
> inconsistency deserved evidence rather than an assumption, and the T2 verification pass will
> want the answer already on the shelf.

## 2. How the reference was defined, and why that is the whole experiment

JPEG is lossy. A JPEG-decoded tensor will never equal the original PNG's tensor, and
reporting that as a failure would be reporting that JPEG is JPEG.

So the reference is **not** the original image:

> **the EXACT ENCODED BYTES, decoded by Pillow, preprocessed by the authoritative contract.**

The encoded file's SHA-256 is recorded and **re-verified inside the browser** before anything
else runs, so "both sides decoded the same file" is a measurement. Whatever difference
survives is decoder implementation variance and nothing else.

The compression effect is measured too — separately, as `vsPngDecoded` and as
*compression sensitivity* in §5 — and is never a pass/fail. No ICC profiles are embedded, so
colour management cannot masquerade as decoder variance.

## 3. Conformance — the matrix

| browser | formats | fixtures | decoded pixels | geometry | classification |
|---|---|---|---|---|---|
| Chromium 151, wasm + webgpu, headful + headless | png, jpeg-q95, jpeg-q62, webp-lossy-q62, webp-lossless | 18 per format per cell | **bitwise identical, max abs 0** | exact | **ACCEPT** |
| Firefox 155.0.1, wasm + webgpu, headful + headless | as above | 18 per format per cell | **bitwise identical, max abs 0** | exact | **ACCEPT** |

**The pre-registered lossy bound (max 2 / mean 0.2) was never approached.** The measured
value is **0**. Pillow and both browsers use libjpeg-turbo and libwebp with the same
defaults, so there is no variance to bound. The bound stays in the contract because a
different build could reintroduce it, and the test would then say so.

**Colour management is not involved anywhere.** `colorSpaceConversion: "none"` changed
nothing on any fixture in any cell — H3 isolated and answered.

## 4. The finding the question was not asking for: non-opaque frames

The alpha fixture was included to test a mechanism, and the mechanism fired.

A canvas stores **premultiplied** colour; `getImageData` un-premultiplies. That round trip is
**not invertible** below alpha 255 — at alpha 8 the colour has been quantised to 8/255 steps
and the original is gone. Measured:

| format | max abs vs reference | mean | cause |
|---|---|---|---|
| PNG with alpha | **15/255** | 1.63 | canvas premultiply round trip |
| WebP lossless with alpha | **29/255** | 4.28 | the above **plus a second premultiply during decode** |
| WebP lossy with alpha | **31/255** | 4.25 | as above |
| JPEG | **0** | 0 | JPEG has no alpha channel |

The two browsers differ, and neither offers a way out:

| | PNG with alpha | WebP with alpha | does `premultiplyAlpha: "none"` help? |
|---|---|---|---|
| **Chromium** | max **15** | max **31** → **15** | **yes** — removes one of WebP's two premultiplies |
| **Firefox** | max **27** | max **31** → **31** | **no** — the option is ignored outright |

So Chromium double-premultiplies WebP and the option removes one of them; Firefox is worse on
PNG (27 vs 15) and **ignores the mitigation entirely** — the same pattern as
`imageSmoothingQuality`, which QG-03b measured it ignoring. **Neither browser can be
configured into correctness here**, which is what makes a guard the right answer rather than
a decode option.

**Product change made:** `preprocessToTensor` now **refuses** a frame containing any pixel
with alpha < 255, with `FRAME_NOT_OPAQUE`. Captures are opaque so this never fires in
production; the guard exists because the alternative is a tensor that looks entirely normal
and is wrong by up to 31 levels, from which the detector would return confident boxes. The
check is folded into the existing RGBA→RGB pass and costs nothing measurable.

> Two pre-existing tests were built on RGBA buffers whose alpha channel was not 255. They
> were testing opaque preprocessing and did not know it. Fixed to be explicitly opaque —
> **not** by weakening the guard.

## 5. Detector output — two different questions, kept apart

| | what it compares | result |
|---|---|---|
| **CONFORMANCE** | this browser vs the reference decode of **the same bytes** | **100%, exact counts, worst CSS Δ ~1e-03 px** — every format, every cell |
| **COMPRESSION SENSITIVITY** | this encoding vs the **lossless** frame | png / webp-lossless **100%**; jpeg-q95 **96–98%**; **jpeg-q62 91–92%**; webp-lossy-q62 **92%** |

**These must not be merged.** The first is what QG-03b-2 asks, and it is exact. The second is
how much the detector minds being compressed — a real finding, and **not a conformance
result**. An earlier aggregation combined them and reported "jpeg-q62 91% MISS", which read
as a browser defect and is nothing of the kind.

> **INFERENCE.** Losing **8–9% of detections** at JPEG q62 is a detector robustness property,
> in the same family as QG-03a: the model was trained with `augmentation: "none"` and has
> never seen a compressed frame. It belongs to QG-03a's scope, not to preprocessing.

## 6. Performance

Measured on a **clean heap, before** the comparison loop. Position is load-bearing: taken
afterwards, the same measurement reported a preprocess p50 of **108 ms** for an image QG-03b
measured at 17–24 ms, because by then the probe had fetched ~180 MB of reference dumps and
run 135 decode cycles. That figure measured GC pressure and is discarded.

`text-edges`, 1152×800. p50 within a run; range **across** runs and cells:

| format | decode p50 | preprocess p50 | combined |
|---|---|---|---|
| **PNG** | **8–13 ms** | 26–31 ms | **35–44 ms** |
| JPEG q62 | 13–16 ms | 27–29 ms | 40–45 ms |
| WebP lossy q62 | **22–25 ms** | 27–29 ms | 49–54 ms |

**Decode cost is format-dependent and PNG is the cheapest**, consistently, in both browsers.
Preprocessing is format-independent, as it must be — by then the pixels are just pixels.

> **One outlier, disclosed rather than smoothed:** the very first run of the batch
> (`chromium/wasm/headful/run1`) reported decode 34.5 ms and preprocess 107.7 ms. Every other
> run of the identical code on the same machine reported 8–13 and 26–31. It is browser launch
> and JIT warm-up, not a preprocessing cost.
>
> It nearly became the headline: a median over two runs is whichever of the two the index
> lands on, so the aggregator reported 107.7 ms as *the* Chromium figure. The aggregator now
> reports **min/median/max across runs**, which makes an outlier visible instead of letting it
> become the result.

**Combined decode + preprocess is ~35–54 ms against the dossier's 18 ms for "capture +
downscale"** — roughly 2–3× over, consistent with the 28–44 ms already recorded for PNG in
QG-03b. Unchanged as an open item (**QG-03b-3**); not optimised here.

## 7. PNG is smaller than JPEG on every fixture

Not what anyone expects from a photographic-compression intuition, and decisive for UI
content — flat colour, sharp edges, text — which is what a screenshot is.

| source | PNG | JPEG q62 | PNG advantage |
|---|---|---|---|
| **real-dev-0000** (UI) | 11,743 | 23,615 | **2.01×** |
| **real-dev-0003** (UI) | 20,652 | 38,464 | **1.86×** |
| simple | 3,417 | 12,375 | 3.62× |
| small-controls | 4,520 | 16,141 | 3.57× |
| text-edges | 12,504 | 348,410 | **27.9×** |
| hostile-odd | 9,453 | 111,604 | 11.8× |

**9 of 9 fixtures.** So for this workload JPEG is **larger, slower to decode, and loses 8–9%
of detections.** It offers nothing.

> **RECOMMENDATION (inference, not a gate):** capture as **PNG**. JPEG remains supported and
> is measured conformant, so nothing breaks if it is used — but there is no reason to.

## 8. Harness defects found and fixed

| # | Defect | How it presented | Fix |
|---|---|---|---|
| 1 | The letterboxed reference was fetched **inside the variant loop** — three times per fixture | Firefox aborted same-origin reads under the IO load, and the aggregator scored the aborted fixture as **non-conformant**. That would have published a Firefox WebP decoding defect **that does not exist** | fetch once per fixture; retry once; and a harness error now yields **`UNKNOWN`, never `REJECT`** — guarded by a test |
| 2 | Latency measured **after** the comparison loop | preprocess p50 of 108 ms against QG-03b's 17–24 ms for the same image size | measurement moved to the start, on a clean heap |
| 3 | The probe treated a `FRAME_NOT_OPAQUE` refusal as a failure | three formats scored 8/9 for **doing the right thing** | refusal recorded as the conformant outcome |

Defect 1 is the one worth dwelling on. *"The evidence is missing"* and *"the thing is
wrong"* are different claims, and an aggregator that cannot tell them apart will eventually
publish the second when it means the first.

## 9. What this does NOT establish

- ❌ **QG-03 is not promoted.** Still `CONDITIONAL`. **Firefox WebGPU headless remains
  `REJECT`.**
- ❌ **The detector is NOT adopted.** Registry unchanged. This closes a preprocessing
  question, not an accuracy one.
- ❌ **No retraining is justified by this experiment.** The artifact is unchanged and valid.
- ❌ **Firefox on Linux remains `UNKNOWN`.**
- ❌ **The training label/raster inconsistency is still open** (QG-03b-1).
- ❌ **Nothing about progressive JPEG, 4:4:4 at low quality, animated WebP, or ICC-tagged
  captures.** All absent from the fixture set.
- ❌ **Nothing about a real `captureVisibleTab` frame.** The fixtures are encoded by Pillow,
  not by Chrome's own encoder.

## 10. Open questions raised

| # | Question | Status | Blocks |
|---|---|---|---|
| QG-03b-2a | Does a frame from Chrome's **own** JPEG encoder decode identically? The encoder here is Pillow's. | `UNKNOWN` | completeness of the capture story |
| QG-03b-2b | Progressive JPEG and ICC-tagged captures — neither is in the fixture set | `UNKNOWN` | robustness of the conformance claim |
| QG-03b-2c | Should the capture format be **pinned to PNG** in the adapter, given §7? | `UNKNOWN` | capture policy |
| QG-03b-2d | `CaptureFrame.format` permits `"webp"` that no adapter can produce — narrow the type, or keep it for T2? | `UNKNOWN` | type/adapter consistency |

## 11. Reproducibility

```bash
python tools/detector/qg03b2_fixtures.py
node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/build-qg03b2-extension.mjs
CHROME_PATH=".../chromium-1234/chrome-win64/chrome.exe" BACKEND=wasm RUNS=2 \
  node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/run-qg03b2-chrome.mjs
BACKEND=wasm RUNS=2 \
  node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/run-qg03b2-firefox.mjs
node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/aggregate-qg03b2.mjs
```

**What is and is not reproducible, stated precisely:**

- **The geometry, the digests and the conformance verdicts are reproducible** from the
  committed `fixtures.json` on any machine with the same Pillow and browser versions.
- **The encoded bytes depend on the encoder.** Pillow 12.3.0 with the pinned settings
  produced the files whose SHA-256 is committed. A different Pillow may encode differently;
  the browser re-verifies the digest before comparing, so a mismatch is reported rather than
  silently compared against the wrong file.
- **The latency figures are not reproducible as absolute numbers** — they are machine- and
  load-dependent, and one cold-start run in this very batch differed by 4×. The *ordering*
  (PNG < JPEG < WebP for decode) held in every cell of both browsers and is the part worth
  carrying forward.
- **The reference pixel dumps and the assembled extensions are gitignored** — ~180 MB, and
  regenerated by the two commands above. `fixtures.json`, `metrics.json` and `logs/` are the
  kept evidence.
