/**
 * PNG pixels → the detector's input tensor, specified exactly enough to be reproduced.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * QG-03 measured that the browser and the training pipeline produce different tensors from
 * the same screenshot, and that 16–34% of detections change as a result. The cause was not
 * a bug in either implementation. It was that **`letterbox.ts` specified the geometry and
 * nothing else** — no resize rule, no rounding rule, no interpolation kernel, no padding
 * allocation. Two competent implementers read that contract and produced different pixels,
 * and they did:
 *
 *   the trainer     `tools/detector/data.py` → PIL `Image.resize(BILINEAR)`, integer paste
 *   the browser     canvas `drawImage` scaling, whose kernel is unspecified and which
 *                   Chromium and Firefox do not implement identically — Chromium honours
 *                   `imageSmoothingQuality`, Firefox ignores it outright
 *
 * A contract that does not determine the bytes is not a contract. This module is the
 * missing half, written so the Python reference and the browser compute the SAME tensor,
 * and guarded by a conformance test that compares them byte for byte.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE BROWSER MATCHES PIL AND NOT THE OTHER WAY ROUND
 *
 * The trained weights encode the rasterisation they were trained on. Changing the Python
 * side would invalidate the artifact and force a retrain; changing the browser side costs
 * nothing but code. So PIL's `BILINEAR` resampling is the authority, and it is reproduced
 * here exactly — including its fixed-point arithmetic — rather than approximated.
 *
 * That is only possible because PIL's algorithm is fully specified: a separable convolution
 * with a support-scaled triangle filter, coefficients quantised to 22-bit fixed point, and
 * a rounding term of `1 << 21` added before the shift. Canvas `drawImage` has no such
 * specification, which is precisely why it cannot be used here.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THIS IS THE RASTER GEOMETRY, AND IT IS NOT `computeLetterbox`
 *
 * `computeLetterbox` returns REAL-valued padding — 106.667 for a 960×640 frame. That is
 * the right answer for a coordinate transform and an impossible one for a rasteriser: you
 * cannot draw two thirds of a row of pixels. So the two coexist deliberately:
 *
 *   `computeLetterbox`   CONTINUOUS. The coordinate space the model's TRAINING LABELS were
 *                        expressed in, and therefore the space its predictions come back
 *                        in. It owns the inverse transform. Do not "fix" it to match this
 *                        module — that would move every box the detector emits.
 *
 *   `rasterLetterbox`    INTEGER. Where the PIXELS actually land. It owns preprocessing.
 *
 * The gap between them is real and is measured, not hidden: for 42% of the training set it
 * is non-zero, up to 0.667 model px. It is a defect in the training pipeline — `data.py`
 * places pixels by one rule and `targets.py` labels them by another — and it is recorded in
 * `docs/architecture/preprocessing-contract.md` §6 as requiring a retrain to close. It is
 * NOT closed here, because closing it changes the model.
 */
import type { Size } from "./coordinates.js";
import { PerceptionError } from "./failure.js";
import type { HeadTensorContract } from "./uiDetectorHead.js";

/** Decoded image pixels. RGBA, 4 bytes per pixel — the shape `getImageData` returns. */
export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Row-major RGBA, length `width * height * 4`. */
  readonly rgba: Uint8ClampedArray | Uint8Array;
}

/**
 * Where the pixels actually land. Every field is an integer, because every field describes
 * a count of pixels.
 */
export interface RasterLetterbox {
  readonly modelSize: number;
  readonly source: Size;
  /** `min(modelSize/w, modelSize/h)` — the real-valued scale the extents are derived from. */
  readonly scale: number;
  /** Resized content extent, `max(1, round(dim * scale))`. */
  readonly resizedW: number;
  readonly resizedH: number;
  readonly padLeft: number;
  readonly padTop: number;
  readonly padRight: number;
  readonly padBottom: number;
  /** The fill byte, `round(padValue * 255)`. */
  readonly padByte: number;
}

/**
 * Python's built-in `round()` on a positive float: the nearest integer, and on an EXACT .5,
 * the even neighbour.
 *
 * This is what `tools/detector/data.py` rasterised the training set with. `Math.round`
 * is not: it sends every .5 up. W1-QG03a measured the difference on realistic capture sizes.
 * At 1024×644 the height extent is exactly 402.5. Training drew 402 rows; the shipped raster
 * drew 403 and moved the top padding by a row, so 21% of tensor bytes differed from the
 * reference.
 *
 * `x - Math.floor(x)` is exact in binary floating point at these magnitudes, so the tie test
 * is exact rather than approximate. It reproduces Python's decision on the same double.
 */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * The raster geometry.
 *
 * `round()` on the extent and floor-division on the offset, matching
 * `tools/detector/data.py`. The consequences are stated rather than left to be discovered:
 *
 *   * padding is ASYMMETRIC whenever `modelSize - resized` is odd. The extra pixel goes to
 *     the RIGHT and BOTTOM, because `(S - n) / 2` is floored for the left/top offset.
 *   * `round()` here is PYTHON's built-in `round()`, i.e. half to EVEN, reproduced by
 *     `roundHalfEven`, because that is what data.py rasterised the training set with and the
 *     trained weights are the authority. JavaScript's `Math.round` sends every .5 UP. The two
 *     disagree whenever `dim * scale` lands exactly on .5 with an even lower neighbour.
 *     QG-03a found real capture sizes that do (1280×641, 1280×721, 1024×644, 2560×1442,
 *     641×1280). With `Math.round` the shipped raster diverged from the reference on every
 *     one of them, in Node, Chrome and Firefox alike.
 */
export function rasterLetterbox(source: Size, modelSize: number, padValue: number): RasterLetterbox {
  if (!Number.isFinite(modelSize) || modelSize <= 0 || !Number.isInteger(modelSize)) {
    throw new PerceptionError(
      `Raster letterbox model size must be a positive integer, got ${String(modelSize)}.`,
      "COORDINATE_TRANSFORM_AMBIGUOUS"
    );
  }
  if (
    !Number.isFinite(source.w) ||
    !Number.isFinite(source.h) ||
    source.w <= 0 ||
    source.h <= 0 ||
    !Number.isInteger(source.w) ||
    !Number.isInteger(source.h)
  ) {
    throw new PerceptionError(
      `Raster letterbox source must be positive integer dimensions, got ${source.w}x${source.h}.`,
      "COORDINATE_TRANSFORM_AMBIGUOUS"
    );
  }

  const scale = Math.min(modelSize / source.w, modelSize / source.h);
  const resizedW = Math.max(1, roundHalfEven(source.w * scale));
  const resizedH = Math.max(1, roundHalfEven(source.h * scale));
  const padLeft = Math.floor((modelSize - resizedW) / 2);
  const padTop = Math.floor((modelSize - resizedH) / 2);
  return {
    modelSize,
    source: { w: source.w, h: source.h },
    scale,
    resizedW,
    resizedH,
    padLeft,
    padTop,
    padRight: modelSize - resizedW - padLeft,
    padBottom: modelSize - resizedH - padTop,
    padByte: Math.round(padValue * 255),
  };
}

// ─────────────────────────── PIL's resampler, reproduced ───────────────────────────

/**
 * PIL quantises filter coefficients to this many fractional bits before accumulating in
 * integers. `32 - 8 - 2` in `Resample.c`. The value is load-bearing: change it and every
 * output byte can move by one.
 */
const PRECISION_BITS = 32 - 8 - 2;

/** Triangle filter, support 1.0. PIL calls this `bilinear_filter`. */
function triangle(x: number): number {
  const a = x < 0 ? -x : x;
  return a < 1.0 ? 1.0 - a : 0.0;
}

interface Coeffs {
  readonly bounds: Int32Array;
  readonly kk: Int32Array;
  readonly ksize: number;
}

/**
 * Precompute per-output-pixel filter taps, exactly as `precompute_coeffs` does.
 *
 * The two details that matter and are easy to get wrong:
 *
 *   * `filterscale` is `max(1, in/out)`. For DOWNSCALE the filter widens so it averages the
 *     pixels being discarded; for upscale it stays at support 1. This is why PIL's
 *     "bilinear" downscale is not a 2-tap bilinear sample and why a naive 2-tap
 *     implementation — or a GPU sampler — cannot match it.
 *   * the tap window uses `(int)(center ± support + 0.5)`, a C truncation of a
 *     non-negative value, i.e. `Math.floor`. Not `Math.round`, despite the `+ 0.5`.
 */
function precomputeCoeffs(inSize: number, outSize: number): Coeffs {
  const scale = inSize / outSize;
  const filterscale = scale < 1.0 ? 1.0 : scale;
  const support = 1.0 * filterscale;
  const ksize = Math.ceil(support) * 2 + 1;

  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const w = new Float64Array(ksize);

  for (let xx = 0; xx < outSize; xx += 1) {
    const center = (xx + 0.5) * scale;
    const ss = 1.0 / filterscale;

    let xmin = Math.floor(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.floor(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;

    let ww = 0.0;
    for (let x = 0; x < xmax; x += 1) {
      const v = triangle((x + xmin - center + 0.5) * ss);
      w[x] = v;
      ww += v;
    }
    for (let x = 0; x < xmax; x += 1) {
      const v = ww !== 0.0 ? w[x]! / ww : w[x]!;
      // `normalize_coeffs_8bpc`: round half away from zero, then truncate toward zero.
      kk[xx * ksize + x] = Math.trunc(v < 0 ? -0.5 + v * (1 << PRECISION_BITS) : 0.5 + v * (1 << PRECISION_BITS));
    }
    for (let x = xmax; x < ksize; x += 1) kk[xx * ksize + x] = 0;

    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

/**
 * `clip8` — shift down, then clamp.
 *
 * `v * INV_PRECISION` rather than `v / (1 << PRECISION_BITS)`: the divisor is a power of
 * two, so multiplying by its reciprocal is EXACT in IEEE-754 (it only changes the
 * exponent), and `| 0` then truncates toward zero, which equals floor because the
 * accumulator is never negative for a triangle filter. Measurably faster than `Math.floor`
 * in the innermost loop, and not an approximation.
 */
const INV_PRECISION = 1 / (1 << PRECISION_BITS);

function clip8(v: number): number {
  const s = (v * INV_PRECISION) | 0;
  return s < 0 ? 0 : s > 255 ? 255 : s;
}

/**
 * Resample `src` (RGB, `srcW × srcH`) to `dstW × srcH`. Horizontal pass.
 *
 * Accumulation is in JavaScript numbers rather than Int32Array on purpose: the running sum
 * reaches `255 · 2^22 · taps`, which overflows 32-bit signed for anything but the narrowest
 * kernel. Doubles hold every integer below 2^53 exactly, so this is exact, not approximate.
 */
function resampleHorizontal(src: Uint8Array, srcW: number, srcH: number, dstW: number): Uint8Array {
  const out = new Uint8Array(dstW * srcH * 3);
  if (dstW === srcW) {
    out.set(src.subarray(0, dstW * srcH * 3));
    return out;
  }
  const { bounds, kk, ksize } = precomputeCoeffs(srcW, dstW);
  const round = 1 << (PRECISION_BITS - 1);

  for (let yy = 0; yy < srcH; yy += 1) {
    const rowIn = yy * srcW * 3;
    const rowOut = yy * dstW * 3;
    for (let xx = 0; xx < dstW; xx += 1) {
      const xmin = bounds[xx * 2]!;
      const xmax = bounds[xx * 2 + 1]!;
      const k = xx * ksize;
      let r = round;
      let g = round;
      let b = round;
      for (let x = 0; x < xmax; x += 1) {
        const kv = kk[k + x]!;
        const p = rowIn + (x + xmin) * 3;
        r += src[p]! * kv;
        g += src[p + 1]! * kv;
        b += src[p + 2]! * kv;
      }
      const o = rowOut + xx * 3;
      out[o] = clip8(r);
      out[o + 1] = clip8(g);
      out[o + 2] = clip8(b);
    }
  }
  return out;
}

/** Resample `src` (RGB, `srcW × srcH`) to `srcW × dstH`. Vertical pass. */
function resampleVertical(src: Uint8Array, srcW: number, srcH: number, dstH: number): Uint8Array {
  const out = new Uint8Array(srcW * dstH * 3);
  if (dstH === srcH) {
    out.set(src.subarray(0, srcW * dstH * 3));
    return out;
  }
  const { bounds, kk, ksize } = precomputeCoeffs(srcH, dstH);
  const round = 1 << (PRECISION_BITS - 1);
  const stride = srcW * 3;
  // Accumulate a whole output row at a time, taps in the OUTER loop.
  //
  // The obvious ordering — one output pixel at a time, walking its taps — strides by
  // `srcW * 3` bytes per tap and touches four rows per pixel, which misses cache on every
  // access. Accumulating row-wise makes both the reads and the writes sequential. Same
  // arithmetic, same result, and it was worth about a third of the total on a 1152x800
  // frame.
  const acc = new Float64Array(stride);

  for (let yy = 0; yy < dstH; yy += 1) {
    const ymin = bounds[yy * 2]!;
    const ymax = bounds[yy * 2 + 1]!;
    const k = yy * ksize;
    acc.fill(round);
    for (let y = 0; y < ymax; y += 1) {
      const kv = kk[k + y]!;
      if (kv === 0) continue;
      const rowP = (y + ymin) * stride;
      for (let i = 0; i < stride; i += 1) acc[i]! += src[rowP + i]! * kv;
    }
    const rowOut = yy * stride;
    for (let i = 0; i < stride; i += 1) out[rowOut + i] = clip8(acc[i]!);
  }
  return out;
}

/**
 * RGBA → RGB, dropping alpha. The detector is defined over RGB and the contract says so.
 *
 * Dropping rather than compositing, deliberately, and matching Pillow: `RGBA.convert("RGB")`
 * discards the alpha channel and does not blend against an assumed background. Compositing
 * would invent pixel values the training pipeline never produced.
 *
 * `minAlpha` is reported because the caller needs it: see `assertOpaque`.
 */
export function rgbaToRgb(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): Uint8Array {
  return rgbaToRgbWithAlpha(rgba, width, height).rgb;
}

/**
 * The same conversion, also reporting the minimum alpha seen.
 *
 * Folded into the existing pass rather than added as a second one: the loop already touches
 * every pixel, so the opacity check costs nothing measurable.
 */
export function rgbaToRgbWithAlpha(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): { rgb: Uint8Array; minAlpha: number } {
  const n = width * height;
  const out = new Uint8Array(n * 3);
  let minAlpha = 255;
  for (let i = 0, j = 0; i < n; i += 1, j += 4) {
    out[i * 3] = rgba[j]!;
    out[i * 3 + 1] = rgba[j + 1]!;
    out[i * 3 + 2] = rgba[j + 2]!;
    const a = rgba[j + 3]!;
    if (a < minAlpha) minAlpha = a;
  }
  return { rgb: out, minAlpha };
}

/** Every intermediate stage, so a conformance failure can name where it started. */
export interface PreprocessStages {
  readonly transform: RasterLetterbox;
  /** RGB, `source.w × source.h × 3`. */
  readonly decoded: Uint8Array;
  /** RGB, `resizedW × resizedH × 3`. */
  readonly resized: Uint8Array;
  /** RGB, `modelSize × modelSize × 3`. */
  readonly letterboxed: Uint8Array;
  /** float32 NCHW, `1 × 3 × modelSize × modelSize`, values in 0..1. */
  readonly tensor: Float32Array;
}

/**
 * The whole path, with every intermediate retained.
 *
 * Retaining the intermediates is not debug convenience. QG-03 compared only final tensors
 * and final boxes, which established that the paths disagreed and could not establish
 * where — a decode difference, a resize difference and a padding difference are
 * indistinguishable at the end. The conformance harness compares these stages in order and
 * reports the FIRST that diverges.
 */
export function preprocessToTensor(image: DecodedImage, contract: HeadTensorContract): PreprocessStages {
  const expected = image.width * image.height * 4;
  if (image.rgba.length !== expected) {
    throw new PerceptionError(
      `Decoded image declares ${image.width}x${image.height} but carries ${image.rgba.length} bytes, expected ${expected} (RGBA).`,
      "MODEL_OUTPUT_MALFORMED"
    );
  }

  const t = rasterLetterbox({ w: image.width, h: image.height }, contract.inputSize, contract.padValue);
  const { rgb: decoded, minAlpha } = rgbaToRgbWithAlpha(image.rgba, image.width, image.height);

  // FAIL CLOSED ON A NON-OPAQUE FRAME.
  //
  // By the time these pixels arrive they have been through a canvas, which stores
  // premultiplied colour and un-premultiplies on getImageData. That round trip is not
  // invertible below alpha 255: at alpha 8 the colour has been quantised to 8/255 steps and
  // the original is unrecoverable. MEASURED in QG-03b-2 — up to 15/255 per channel for PNG
  // and 31/255 for WebP, which premultiplies a second time during decode.
  //
  // Dropping alpha anyway would produce a tensor that looks entirely normal and is wrong,
  // and the detector would return confident boxes from it. captureVisibleTab produces
  // opaque frames, so refusing costs production nothing and removes a silent failure.
  if (minAlpha < 255) {
    throw new PerceptionError(
      `Frame is not fully opaque (minimum alpha ${minAlpha}). Its RGB values have already ` +
        "passed through a premultiply/un-premultiply round trip that is not invertible below " +
        "alpha 255, so they cannot be trusted. captureVisibleTab produces opaque frames; a " +
        "non-opaque one means the capture path is not the one this contract describes.",
      "FRAME_NOT_OPAQUE"
    );
  }

  // Horizontal then vertical, the order PIL uses. The order is observable: each pass
  // quantises to 8 bits, so resampling height-first can differ by one in the last bit.
  const horizontal = resampleHorizontal(decoded, image.width, image.height, t.resizedW);
  const resized = resampleVertical(horizontal, t.resizedW, image.height, t.resizedH);

  const S = t.modelSize;
  const letterboxed = new Uint8Array(S * S * 3).fill(t.padByte);
  for (let y = 0; y < t.resizedH; y += 1) {
    const from = y * t.resizedW * 3;
    const to = ((y + t.padTop) * S + t.padLeft) * 3;
    letterboxed.set(resized.subarray(from, from + t.resizedW * 3), to);
  }

  // NCHW, RGB, /255. Integer divided by 255 is exactly representable the same way in
  // Python float32 and a JavaScript Float32Array, so this stage cannot introduce drift.
  const plane = S * S;
  const tensor = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p += 1) {
    tensor[p] = letterboxed[p * 3]! / 255;
    tensor[plane + p] = letterboxed[p * 3 + 1]! / 255;
    tensor[2 * plane + p] = letterboxed[p * 3 + 2]! / 255;
  }

  return { transform: t, decoded, resized, letterboxed, tensor };
}
