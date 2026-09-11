# Preprocessing Contract — screenshot pixels to detector tensor

> **AUTHORITATIVE. One mathematical definition, implemented twice and checked byte for byte.**
> Conformance: [`preprocessConformance.test.ts`](../../packages/perception/test/preprocessConformance.test.ts)
> Evidence: [`W1-QG03b`](../../artifacts/experiments/W1-QG03b-letterbox-conformance/README.md)

---

## 0. Why this document exists

`letterbox.ts` specified the **geometry** of the fit and nothing else — no resize rule, no
rounding rule, no interpolation kernel, no padding allocation, no channel order. Two
competent implementers read it and produced different pixels:

| | resize | placement |
|---|---|---|
| `tools/detector/data.py` | PIL `Image.resize(BILINEAR)` | integer paste at `(S−n)//2` |
| the browser (QG-03) | canvas `drawImage` scaling | fractional offset from `computeLetterbox` |

**Measured cost: 16–34% of detections changed** depending on browser and frame, and the two
browsers did not agree with each other either — Chromium honours `imageSmoothingQuality`,
Firefox ignores it outright.

**A contract that does not determine the bytes is not a contract.** This is the missing half.

> **The dossier does not specify any of this.** v4.0 names "capture + downscale" as a
> pipeline stage with an 18 ms budget and "~12 MB at 640 px" for a candidate model. It
> contains no resize, padding, interpolation or normalisation semantics. The authority below
> is therefore derived from **the trained artifact** — see §3 — and not from the dossier, and
> that is recorded here rather than implied.

---

## 1. The authoritative definition

Given a decoded source image of `W × H` pixels and a square model input of `S` (currently
**640**):

```
scale    s  = min(S/W, S/H)                        exact real, never rounded

extent   nw = max(1, round(W · s))                 INTEGER
         nh = max(1, round(H · s))                 INTEGER

offset   padLeft = floor((S − nw) / 2)             INTEGER
         padTop  = floor((S − nh) / 2)             INTEGER
         padRight  = S − nw − padLeft
         padBottom = S − nh − padTop

resample  PIL BILINEAR  — separable convolution, support-scaled triangle filter,
                          horizontal pass first, 22-bit fixed-point coefficients  (§2)

fill      padByte = round(padValue · 255) = round(114/255 · 255) = 114

compose   the resampled nw × nh image is written at (padLeft, padTop) into an S × S
          canvas pre-filled with padByte on all three channels

channels  RGB. Alpha is DROPPED, never blended against an assumed background.

normalise value / 255, producing float32 in 0..1

layout    NCHW — [1, 3, S, S], channel-planar
```

### Consequences, stated rather than discovered

- **Padding is asymmetric whenever `S − n` is odd.** The extra pixel goes to the **right**
  and **bottom**. This follows from flooring the left/top offset and is not a free choice.
- **The content extent is an integer number of pixels**, so the realised scale is `nw/W`,
  which differs from `s` by up to `0.5/W`.
- **`round()` must agree across languages.** JavaScript's `Math.round` rounds half *away
  from zero*; Python's built-in `round` rounds half *to even*. They differ only when `dim · s`
  is exactly `.5`. The conformance suite enumerates every fixture and **fails** if one lands
  in that regime, rather than letting the tensor shift by a row.
- **`max(1, …)`** means a source thinner than `S/max(W,H)` still yields one row or column
  rather than an empty image.

---

## 2. The resampling kernel, exactly

"Bilinear" is not sufficient. PIL's `BILINEAR` **is not** a 2-tap bilinear sample when
downscaling — the filter widens with the reduction factor so it averages the pixels being
discarded. A naive 2-tap implementation, a GPU sampler, and canvas `drawImage` all produce
different bytes.

```
scale       = in / out
filterscale = max(1, scale)
support     = 1.0 · filterscale
ksize       = ceil(support) · 2 + 1

for each output index xx:
    center = (xx + 0.5) · scale
    xmin   = clamp(floor(center − support + 0.5), 0, in)
    xmax   = clamp(floor(center + support + 0.5), 0, in) − xmin
    w[x]   = triangle((x + xmin − center + 0.5) / filterscale)     for x in 0..xmax
    w[]   /= Σw
    k[x]   = trunc(0.5 + w[x] · 2^22)                              22-bit fixed point

accumulate  acc = 2^21;  acc += pixel · k[x];  out = clamp(acc >> 22, 0, 255)
```

where `triangle(x) = 1 − |x|` for `|x| < 1`, else `0`.

**Horizontal pass first, then vertical.** The order is observable: each pass quantises to
8 bits, so resampling height-first can differ in the last bit.

> **`floor`, not `round`, despite the `+ 0.5`.** The `+ 0.5` is inside a C cast that
> truncates a non-negative value. Reading it as rounding shifts the tap window by one on
> roughly half the output pixels.

This is implemented in [`preprocess.ts`](../../packages/perception/src/preprocess.ts) and is
**bitwise identical** to Pillow across all 15 conformance fixtures, in Node and in both
browsers.

---

## 3. Why PIL is the authority

Not because it is better. Because **the trained weights encode the rasterisation they were
trained on**, and that rasterisation was PIL's.

| option | cost |
|---|---|
| browser reproduces PIL | a few hundred lines of specified arithmetic. **No retrain.** |
| Python adopts canvas semantics | canvas has no specification to adopt, differs per browser, and **invalidates the artifact** |

The second is not a real option: there is nothing to write down. Canvas `drawImage` scaling
is implementation-defined, and QG-03 measured the two engines disagreeing with each other.

> **This makes PIL a dependency of the CONTRACT, not just of the trainer.** If Pillow ever
> changes its resampling implementation, the conformance suite fails and this document must
> be revisited. That is the intended behaviour and the reason the coefficients are written
> out above rather than referenced.

---

## 4. Two letterboxes, deliberately

They are not duplicates and **must not be unified**.

| | `computeLetterbox` (`letterbox.ts`) | `rasterLetterbox` (`preprocess.ts`) |
|---|---|---|
| padding | **real-valued** — 106.667 for 960×640 | **integer** — 106 |
| owns | the coordinate transform, and its inverse | where pixels land |
| why | the space the model's **training labels** were expressed in, and therefore the space its **predictions come back in** | the only space a rasteriser can actually draw into |

You cannot draw two-thirds of a row of pixels, so the continuous convention is not
realisable as a raster operation. And the model predicts in label space, so the inverse must
use the continuous convention or every emitted box moves.

**Changing `computeLetterbox` to match the rasteriser would move every detection the
detector emits.** It is guarded by a test that says so.

---

## 5. Verification

| check | where |
|---|---|
| geometry, every field, against the Python reference | `preprocessConformance.test.ts` |
| `Math.round` vs Python `round()` on every fixture extent | same |
| invariants — padding sums to `S`, extra pixel right/bottom, one axis fills | same |
| **every stage byte for byte** — decoded, resized, letterboxed, tensor | same |
| the same, with **no generated files**, via SHA-256 against committed digests | same |
| **browser** PNG decode, resize, padding and tensor against the same digests | `W1-QG03b` harness |
| determinism, malformed input, alpha handling, pad fill | `preprocessConformance.test.ts` |

The conformance test compares stages **in order** and names the **first** that diverges. A
decode difference, a resize difference and a padding difference are indistinguishable in the
final tensor and trivially distinguishable stage by stage — QG-03 could only report that the
tensors differed, which is why the cause took a separate experiment to find.

---

## 6. KNOWN DEFECT — the training pipeline labels by one rule and rasterises by another

**Not fixed. Fixing it requires a retrain.**

`data.py` places the **pixels** using the raster convention (§1). `targets.py` places the
**labels** using the continuous convention (§4). For a 960×640 frame the content occupies
rows `106..532` while every label is expressed as though it occupied `106.667..533.333`.

| | |
|---|---|
| training samples affected | **84 of 200 — 42%** |
| worst offset | **0.667 model px** (960×640) |
| offsets present | 0.222, 0.333, 0.500, 0.667 model px |
| visible to the loss? | **no** |
| visible to mAP@0.5? | **no** — a sub-pixel constant offset is far inside an IoU 0.5 match |
| visible to the micro-overfit gate? | **no**, for the same reason |

The model therefore learned a small, geometry-dependent nuisance mapping instead of an
identity. **End-to-end it cancels**, provided inference rasterises exactly as training did —
which, after this work, it does. So this is not currently producing wrong coordinates.

It is still a defect, because it makes the model's behaviour depend on a coincidence rather
than on a contract.

**The exact change required, for the next task:**

```python
# tools/detector/data.py — make the label transform use the RASTER geometry
scale, pad_x, pad_y = letterbox_params(cap["w"], cap["h"])      # REMOVE
nw, nh, pad_x, pad_y = raster_letterbox(cap["w"], cap["h"])     # ADD
# and css_box_to_model must scale by nw/cap_w and nh/cap_h, not by the uniform s
```

**Consequences of making it:**

1. The artifact must be **retrained**. Labels move by up to 0.667 model px on 42% of samples.
2. `computeLetterbox` must then become the **raster** transform at inference too, because the
   labels would no longer be in continuous space — a coordinated change to both.
3. The frozen regression baseline in `artifacts/gates/T1-detector-training/` is invalidated
   by construction and must be re-frozen deliberately.
4. Expected benefit is **small and should be stated as unmeasured**: the offset already
   cancels end to end. The gain is that the model no longer has to learn around it, which
   may help small controls most, where 0.667 px is a larger fraction of the object.

**It is not worth a retrain on its own.** It should be bundled with the next training change
— the resampler-robustness work (QG-03a) is the obvious candidate.

---

## 7. Capture formats — what the contract covers

`chrome.tabs.captureVisibleTab` produces **PNG or JPEG only**. `TabsCaptureApi` in
`capture.ts` declares exactly that. Measured in
[`W1-QG03b-2`](../../artifacts/experiments/W1-QG03b2-capture-format-conformance/README.md),
45 fixture/encoding pairs across 8 browser cells:

| format | capture path? | browser decode vs Pillow | status |
|---|---|---|---|
| **PNG** | **yes** | **bitwise identical** | **ACCEPT** |
| **JPEG q95** | **yes** | **bitwise identical — max abs 0** | **ACCEPT** |
| **JPEG q62** | **yes** | **bitwise identical — max abs 0** | **ACCEPT** |
| WebP lossless | no — see below | bitwise identical | ACCEPT (not a capture format) |
| WebP lossy q62 | no — see below | bitwise identical | ACCEPT (not a capture format) |

**JPEG decoding is bitwise identical**, which is better than the pre-registered bound
required. Both Pillow and both browsers use libjpeg-turbo with the same default IDCT, so
there is no decoder variance to bound. The bound stays in the contract because a different
build could reintroduce it and the test would then say so.

**Colour management is not involved**: `colorSpaceConversion: "none"` changed nothing on any
fixture. Fixtures embed no ICC profile, deliberately — a browser applies colour management
from one and Pillow does not, which would show up as decoder variance while being something
else entirely.

### WebP is NOT a capture format

`captureVisibleTab` cannot produce it. Every WebP reference in dossier v4.0 is the **T2
egress** encoding — *"Encode WebP q62, then decode the bytes back"* is the redaction
verification pass, and *"the encoded WebP frame and the serialized manifest"* is the egress
payload. **T2 does not exist yet.**

It is measured anyway because `CaptureFrame.format` permits `"webp"` while the adapter that
populates it cannot produce one. That inconsistency is now closed with evidence rather than
an assumption, and the T2 verification pass will want the answer already on the shelf.

---

## 8. THE INPUT MUST BE FULLY OPAQUE, and this is enforced

`preprocessToTensor` **refuses** a frame containing any pixel with alpha < 255, with
`FRAME_NOT_OPAQUE`.

This is not defensive coding. By the time pixels reach the module they have been through a
canvas, which stores **premultiplied** colour and un-premultiplies on `getImageData`. That
round trip is **not invertible** below alpha 255: at alpha 8 the colour has been quantised to
8/255 steps and the original is gone.

Measured, on a PNG with an alpha ramp:

| format | max abs error vs reference | mean | attributable to |
|---|---|---|---|
| PNG (alpha) | **15/255** | 1.63 | canvas premultiply round trip |
| WebP lossless (alpha) | **29/255** | 4.28 | the above, **plus a second premultiply during decode** |
| WebP lossy (alpha) | **31/255** | 4.25 | the above |
| JPEG | 0 | 0 | JPEG has no alpha channel at all |

`createImageBitmap(..., {premultiplyAlpha: "none"})` recovers WebP to the PNG level (31 → 15)
but **cannot remove the last one**, because the canvas itself is premultiplied storage.

**Captures are opaque, so this never fires in production.** The guard exists because the
alternative is a tensor that looks entirely normal and is wrong by up to 31 levels per
channel, from which the detector would return confident boxes. The check is folded into the
existing RGBA→RGB pass and costs nothing measurable.

> A non-opaque frame means the capture path is not the one this contract describes. Refusing
> says so; dropping alpha anyway would not.

---

## 9. Change control

Any change to §1 or §2 changes the tensor every trained model sees. Such a change requires:

1. the new definition written **here** first,
2. the conformance fixtures regenerated and the digests updated **in the same commit**,
3. an explicit statement of whether existing artifacts remain valid, and
4. if they do not, a retrain — not a compatibility shim.

**A compatibility shim that makes two preprocessing paths "close enough" reintroduces
exactly the defect this document exists to close.**
