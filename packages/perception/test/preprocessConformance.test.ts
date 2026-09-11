/**
 * Preprocessing conformance — the shipped TypeScript against the Python reference, byte for
 * byte, at every stage.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE DISAGREEMENT THIS EXISTS TO MAKE IMPOSSIBLE
 *
 * `computeLetterbox` said the vertical padding for a 960×640 frame was **106.667**.
 * `data.py` placed the pixels at **106**. Both were reasonable readings of a contract that
 * specified geometry and not rasterisation, nobody was wrong, and the result was a 0.667
 * model-pixel disagreement affecting 42% of the training set that no metric could see —
 * a sub-pixel constant offset is far inside an IoU 0.5 matching threshold.
 *
 * A test that only checked "both produce 640×640" would have passed throughout.
 *
 * So these tests compare **bytes**, stage by stage, and report the FIRST stage that
 * diverges. A resize difference, a padding difference and a normalisation difference are
 * indistinguishable in the final tensor; they are trivially distinguishable here.
 *
 * The fixtures come from `tools/detector/qg03b_fixtures.py` and are deliberately hostile to
 * resampling — 1px rules, a Nyquist checkerboard, exact corner markers. A smooth gradient is
 * the image on which two different kernels agree.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEAD_CONTRACT,
  computeLetterbox,
  preprocessToTensor,
  rasterLetterbox,
  rgbaToRgb,
} from "@pratibimb/perception";

const REPO = fileURLToPath(new URL("../../..", import.meta.url));
const EXP = join(REPO, "artifacts/experiments/W1-QG03b-letterbox-conformance");
const GEN = join(EXP, "harness/generated");
const MANIFEST = join(EXP, "fixtures.json");

interface Fixture {
  name: string;
  /** Procedural fixtures can be regenerated from a seed; real rendered frames cannot. */
  procedural?: boolean;
  source: { w: number; h: number };
  geometry: {
    scale: number;
    resizedW: number;
    resizedH: number;
    padLeft: number;
    padTop: number;
    padRight: number;
    padBottom: number;
    padByte: number;
  };
  digests: Record<string, string>;
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
const fixtures: Fixture[] = manifest?.fixtures ?? [];

// The reference pixel files are generated, not committed — they are ~16 MB across the set.
// When they are absent (a fresh clone, or CI) the geometry and property tests still run and
// the byte-level ones report the reason rather than passing vacuously.
const havePixels = fixtures.length > 0 && existsSync(join(GEN, `${fixtures[0]!.name}.decoded.u8`));

function u8(name: string, stage: string): Uint8Array {
  return new Uint8Array(readFileSync(join(GEN, `${name}.${stage}.u8`)));
}

function firstDifference(a: Uint8Array, b: Uint8Array): { index: number; a: number; b: number } | null {
  if (a.length !== b.length) return { index: -1, a: a.length, b: b.length };
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return { index: i, a: a[i]!, b: b[i]! };
  return null;
}

/**
 * The fixture images, REGENERATED here rather than read from disk.
 *
 * This mirrors `make_image` in tools/detector/qg03b_fixtures.py exactly, for one reason
 * that matters: the reference pixel files are ~100 MB and are gitignored, so a
 * file-dependent conformance test would SKIP in CI — and a byte-level guard that skips
 * wherever it would matter most is not a guard.
 *
 * Regenerating instead means CI compares the full pipeline against the committed Python
 * digests with no large files at all. It also turns the generator agreement itself into a
 * tested property: if the Python and TypeScript image construction ever drift, the
 * `decoded` digest fails first and names the cause.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RGB, row-major, `w * h * 3`. Write order must match the Python line for line. */
function makeFixtureImage(w: number, h: number, seed: number): Uint8Array {
  const rnd = mulberry32(seed);
  const a = new Uint8Array(w * h * 3);
  const at = (x: number, y: number) => (y * w + x) * 3;

  const bw = Math.max(1, Math.floor(w / 8));
  const bh = Math.max(1, Math.floor(h / 8));
  for (let by = 0; by < h; by += bh) {
    for (let bx = 0; bx < w; bx += bw) {
      // Three draws per block, in R,G,B order. The PRNG is consumed in this exact
      // sequence; reordering the loops would produce a different image from the same seed.
      const r = Math.floor(rnd() * 256);
      const g = Math.floor(rnd() * 256);
      const b = Math.floor(rnd() * 256);
      for (let y = by; y < Math.min(by + bh, h); y += 1) {
        for (let x = bx; x < Math.min(bx + bw, w); x += 1) {
          const p = at(x, y);
          a[p] = r;
          a[p + 1] = g;
          a[p + 2] = b;
        }
      }
    }
  }

  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 11))) {
    for (let x = 0; x < w; x += 1) {
      const p = at(x, y);
      a[p] = 255;
      a[p + 1] = 255;
      a[p + 2] = 255;
    }
  }
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 13))) {
    for (let y = 0; y < h; y += 1) {
      const p = at(x, y);
      a[p] = 0;
      a[p + 1] = 0;
      a[p + 2] = 0;
    }
  }

  const qh = Math.floor(h / 2);
  const qw = Math.floor(w / 2);
  for (let y = 0; y < qh; y += 1) {
    for (let x = 0; x < qw; x += 1) {
      const v = (y + x) % 2 === 0 ? 255 : 0;
      const p = at(x, y);
      a[p] = v;
      a[p + 1] = v;
      a[p + 2] = v;
    }
  }

  const set = (x: number, y: number, rgb: [number, number, number]) => {
    const p = at(x, y);
    a[p] = rgb[0];
    a[p + 1] = rgb[1];
    a[p + 2] = rgb[2];
  };
  set(0, 0, [255, 0, 0]);
  if (h > 1 && w > 1) {
    set(w - 1, 0, [0, 255, 0]);
    set(0, h - 1, [0, 0, 255]);
    set(w - 1, h - 1, [255, 255, 0]);
  }
  return a;
}

const FIXTURE_SEED_BASE = manifest?.seed ?? 20260911;
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const rgbToRgba = (rgb: Uint8Array, n: number) => {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i += 1) {
    out[i * 4] = rgb[i * 3]!;
    out[i * 4 + 1] = rgb[i * 3 + 1]!;
    out[i * 4 + 2] = rgb[i * 3 + 2]!;
    out[i * 4 + 3] = 255;
  }
  return out;
};

describe("the fixture set exists and is hostile enough to be worth running", () => {
  it("the manifest is committed", () => {
    expect(manifest, `${MANIFEST} missing — run: python tools/detector/qg03b_fixtures.py`).toBeTruthy();
    expect(fixtures.length).toBeGreaterThanOrEqual(10);
  });

  it("covers square, wide, tall, odd, tiny, upscale and asymmetric-padding cases", () => {
    const names = fixtures.map((f) => f.name).join(" ");
    for (const required of ["square", "wide", "tall", "odd", "tiny", "upscale"]) {
      expect(names, `no ${required} fixture`).toContain(required);
    }
    // Asymmetric padding is the case the old contract could not even express.
    expect(
      fixtures.some((f) => f.geometry.padLeft !== f.geometry.padRight || f.geometry.padTop !== f.geometry.padBottom),
      "no fixture produces asymmetric padding — the rounding rule would be untested"
    ).toBe(true);
    // And at least one where the continuous convention disagrees with the raster one.
    expect(
      fixtures.some((f) => {
        const s = Math.min(640 / f.source.w, 640 / f.source.h);
        return Math.abs((640 - f.source.h * s) / 2 - f.geometry.padTop) > 1e-9;
      }),
      "no fixture exercises the fractional-vs-integer padding disagreement"
    ).toBe(true);
  });
});

describe("raster geometry matches the Python reference exactly", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const t = rasterLetterbox(f.source, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.padValue);
    // Every field, not just the output size. "Both are 640×640" is exactly the check that
    // would have passed while the pixels sat a row apart.
    expect(t.resizedW).toBe(f.geometry.resizedW);
    expect(t.resizedH).toBe(f.geometry.resizedH);
    expect(t.padLeft).toBe(f.geometry.padLeft);
    expect(t.padTop).toBe(f.geometry.padTop);
    expect(t.padRight).toBe(f.geometry.padRight);
    expect(t.padBottom).toBe(f.geometry.padBottom);
    expect(t.padByte).toBe(f.geometry.padByte);
    expect(t.scale).toBeCloseTo(f.geometry.scale, 12);
  });
});

describe("Math.round and Python round() agree on every fixture extent", () => {
  it("no fixture lands on an exact .5 boundary where the two rounding rules differ", () => {
    // JavaScript rounds half AWAY from zero; Python rounds half to EVEN. They differ only
    // when dim*scale is exactly representable at .5. This asserts that no fixture is in that
    // regime — and will fail loudly if one ever is, rather than the tensor shifting by a row.
    const offenders: string[] = [];
    for (const f of fixtures) {
      const s = Math.min(640 / f.source.w, 640 / f.source.h);
      for (const dim of [f.source.w, f.source.h]) {
        const v = dim * s;
        if (Math.abs(v - Math.floor(v) - 0.5) < 1e-12) offenders.push(`${f.name}: ${dim}*${s} = ${v}`);
      }
    }
    expect(offenders, "a fixture lands on a .5 boundary — JS and Python rounding may diverge here").toEqual([]);
  });
});

describe("geometry invariants hold for every fixture", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const t = rasterLetterbox(f.source, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.padValue);
    // Padding accounts for exactly the space the content does not occupy, in both axes.
    expect(t.padLeft + t.resizedW + t.padRight).toBe(HEAD_CONTRACT.inputSize);
    expect(t.padTop + t.resizedH + t.padBottom).toBe(HEAD_CONTRACT.inputSize);
    // The extra pixel, when there is one, goes right/bottom. Never left/top.
    expect(t.padRight - t.padLeft).toBeGreaterThanOrEqual(0);
    expect(t.padBottom - t.padTop).toBeGreaterThanOrEqual(0);
    expect(t.padRight - t.padLeft).toBeLessThanOrEqual(1);
    expect(t.padBottom - t.padTop).toBeLessThanOrEqual(1);
    // At least one axis fills the square: that is what "fit, preserving aspect" means.
    expect(Math.max(t.resizedW, t.resizedH)).toBe(HEAD_CONTRACT.inputSize);
  });
});

describe.skipIf(!havePixels)("every pipeline stage matches the Python reference BYTE FOR BYTE", () => {
  it.each(fixtures.map((f) => [f.name, f] as const))("%s", (_name, f) => {
    const decoded = u8(f.name, "decoded");
    const rgba = new Uint8Array(f.source.w * f.source.h * 4);
    for (let i = 0; i < f.source.w * f.source.h; i += 1) {
      rgba[i * 4] = decoded[i * 3]!;
      rgba[i * 4 + 1] = decoded[i * 3 + 1]!;
      rgba[i * 4 + 2] = decoded[i * 3 + 2]!;
      rgba[i * 4 + 3] = 255;
    }

    const got = preprocessToTensor({ width: f.source.w, height: f.source.h, rgba }, HEAD_CONTRACT);

    // Stage order matters: the first failing assertion names the first diverging stage.
    const stages: [string, Uint8Array, Uint8Array][] = [
      ["decoded", got.decoded, decoded],
      ["resized", got.resized, u8(f.name, "resized")],
      ["letterboxed", got.letterboxed, u8(f.name, "letterboxed")],
    ];
    for (const [stage, mine, reference] of stages) {
      const d = firstDifference(mine, reference);
      expect(
        d,
        d && d.index === -1
          ? `${stage}: length ${d.a} vs reference ${d.b}`
          : d
            ? `${stage}: FIRST divergence at byte ${d.index} — got ${d.a}, reference ${d.b}`
            : ""
      ).toBeNull();
    }

    // The tensor, as float32 bits. Exact: integer/255 rounds identically in both languages.
    const refTensor = new Float32Array(readFileSync(join(GEN, `${f.name}.tensor.f32`)).buffer.slice(0));
    expect(got.tensor.length).toBe(refTensor.length);
    let maxAbs = 0;
    let bitwise = true;
    for (let i = 0; i < refTensor.length; i += 1) {
      const d = Math.abs(got.tensor[i]! - refTensor[i]!);
      if (d > maxAbs) maxAbs = d;
      if (got.tensor[i] !== refTensor[i]) bitwise = false;
    }
    expect(maxAbs, "tensor differs from the Python reference").toBe(0);
    expect(bitwise, "tensor is not bitwise identical to the Python reference").toBe(true);
  });
});

describe("preprocessing is deterministic and refuses malformed input", () => {
  it("the same pixels produce bitwise-identical tensors across calls", () => {
    const w = 37;
    const h = 23;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 37) % 256;
    const a = preprocessToTensor({ width: w, height: h, rgba }, HEAD_CONTRACT).tensor;
    const b = preprocessToTensor({ width: w, height: h, rgba }, HEAD_CONTRACT).tensor;
    // Compared with a plain loop and ONE assertion. toEqual() on a 4.9 MB typed array, or
    // an expect() per element, costs seconds — the test then fails on a timeout and looks
    // like a determinism failure, which is the opposite of informative.
    const av = new Uint8Array(a.buffer);
    const bv = new Uint8Array(b.buffer);
    let firstDiff = -1;
    for (let i = 0; i < av.length; i += 1) {
      if (av[i] !== bv[i]) {
        firstDiff = i;
        break;
      }
    }
    expect(firstDiff, "identical input produced a different tensor").toBe(-1);
  });

  it("a byte-count that disagrees with the declared size is refused, not truncated", () => {
    expect(() =>
      preprocessToTensor({ width: 10, height: 10, rgba: new Uint8Array(10 * 10 * 3) }, HEAD_CONTRACT)
    ).toThrow(/carries 300 bytes, expected 400/);
  });

  it("non-integer or non-positive source dimensions are refused", () => {
    for (const bad of [
      { w: 0, h: 10 },
      { w: 10, h: -1 },
      { w: 10.5, h: 10 },
      { w: Number.NaN, h: 10 },
    ]) {
      expect(() => rasterLetterbox(bad, 640, 114 / 255)).toThrow();
    }
  });

  it("alpha is dropped rather than blended", () => {
    // The detector is defined over RGB. Blending against an assumed background would
    // invent pixel values the training pipeline never produced.
    const rgba = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 128]);
    expect(Array.from(rgbaToRgb(rgba, 2, 1))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("the output tensor is NCHW with the contract's shape and range", () => {
    const w = 8;
    const h = 4;
    const rgba = new Uint8Array(w * h * 4).fill(200);
    const { tensor } = preprocessToTensor({ width: w, height: h, rgba }, HEAD_CONTRACT);
    const S = HEAD_CONTRACT.inputSize;
    expect(tensor.length).toBe(3 * S * S);
    let outOfRange = 0;
    let nonFinite = 0;
    for (let i = 0; i < tensor.length; i += 1) {
      const v = tensor[i]!;
      if (!Number.isFinite(v)) nonFinite += 1;
      else if (v < 0 || v > 1) outOfRange += 1;
    }
    expect(nonFinite).toBe(0);
    expect(outOfRange).toBe(0);
  });

  it("padding is filled with the contract's pad value, not black", () => {
    // Padding with 0 instead of 114/255 is a silent distribution shift: the model sees a
    // border it never met in training, and nothing anywhere reports it.
    const { tensor, transform } = preprocessToTensor(
      { width: 640, height: 320, rgba: new Uint8Array(640 * 320 * 4).fill(255) },
      HEAD_CONTRACT
    );
    expect(transform.padTop).toBeGreaterThan(0);
    const S = HEAD_CONTRACT.inputSize;
    // Compared against Math.fround: the tensor is float32 and padByte/255 is a float64
    // literal. Asserting equality between them without rounding would be a test bug, not a
    // finding — they differ by 3.2e-9 purely from the storage width.
    expect(tensor[0]).toBe(Math.fround(transform.padByte / 255));
    // A pixel inside the content band.
    expect(tensor[transform.padTop * S + 5]).toBe(1);
  });
});

describe("the full pipeline matches the Python digests, with no generated files", () => {
  // This is the CI-capable half. It regenerates the source pixels, runs the shipped
  // preprocessing, and compares SHA-256 of every stage against the digests the Python
  // reference committed. No 100 MB of fixtures, and nothing skips.
  //
  // Only the PROCEDURAL fixtures can take part: a real rendered frame cannot be rebuilt
  // from a seed. Those are covered by the byte-level block above when the generated files
  // are present, and by the browser harness against the real production path.
  const procedural = fixtures.map((f, i) => [f, i] as const).filter(([f]) => f.procedural !== false);
  it.each(procedural.map(([f, i]) => [f.name, f, i] as const))("%s", (_name, f, i) => {
    const rgb = makeFixtureImage(f.source.w, f.source.h, FIXTURE_SEED_BASE + i * 1013);

    // Stage 0 first: if the two generators disagree the image itself differs, and every
    // later digest would fail for a reason that has nothing to do with preprocessing.
    expect(
      sha256(rgb),
      `${f.name}: the TypeScript and Python fixture generators produced DIFFERENT source images. ` +
        "Every later stage is meaningless until that is fixed."
    ).toBe(f.digests.decoded);

    const got = preprocessToTensor(
      { width: f.source.w, height: f.source.h, rgba: rgbToRgba(rgb, f.source.w * f.source.h) },
      HEAD_CONTRACT
    );

    expect(sha256(got.decoded), `${f.name}: decoded`).toBe(f.digests.decoded);
    expect(sha256(got.resized), `${f.name}: RESIZE diverges — the resampling kernel disagrees with PIL`).toBe(
      f.digests.resized
    );
    expect(sha256(got.letterboxed), `${f.name}: PADDING diverges — placement or fill byte disagrees`).toBe(
      f.digests.letterboxed
    );
    expect(
      sha256(new Uint8Array(got.tensor.buffer, got.tensor.byteOffset, got.tensor.byteLength)),
      `${f.name}: TENSOR diverges — channel order or normalisation disagrees`
    ).toBe(f.digests.tensor);
  });
});

describe("the two letterboxes stay two letterboxes", () => {
  it("computeLetterbox remains CONTINUOUS and is not quietly aligned to the rasteriser", () => {
    // The tempting "fix" is to make computeLetterbox return integers so the two agree.
    // That would move every box the detector emits, because the model predicts in the
    // continuous space its TRAINING LABELS were expressed in. The disagreement is
    // deliberate and documented in docs/architecture/preprocessing-contract.md §4.
    const source = { w: 960, h: 640 };
    const cont = computeLetterbox(source, HEAD_CONTRACT.inputSize);
    const rast = rasterLetterbox(source, HEAD_CONTRACT.inputSize, HEAD_CONTRACT.padValue);

    expect(cont.padY).toBeCloseTo(106.6666666, 6);
    expect(rast.padTop).toBe(106);
    expect(Number.isInteger(cont.padY), "computeLetterbox must NOT round — it owns the inverse transform").toBe(
      false
    );
    expect(Number.isInteger(rast.padTop), "rasterLetterbox must be integral — it owns pixel placement").toBe(true);
    // And the gap is the documented one, not something new.
    expect(Math.abs(cont.padY - rast.padTop)).toBeCloseTo(2 / 3, 6);
  });

  it("the known training-pipeline offset is still documented rather than silently fixed", () => {
    const doc = readFileSync(join(REPO, "docs/architecture/preprocessing-contract.md"), "utf8");
    expect(doc).toMatch(/KNOWN DEFECT/);
    expect(doc, "the defect section must state the measured exposure").toMatch(/84 of 200/);
    expect(doc, "and must say a retrain is required to close it").toMatch(/requires a retrain/i);
  });
});

describe("the Python side still defines the authority this module reproduces", () => {
  it("data.py still resizes with PIL BILINEAR and pastes at an integer offset", () => {
    // If the trainer's resampler changes, this module is reproducing the wrong thing and
    // every conformance digest below becomes a check against a stale reference.
    const py = readFileSync(join(REPO, "tools/detector/data.py"), "utf8");
    expect(py).toMatch(/Image\.BILINEAR/);
    expect(py).toMatch(/\(size - nw\) \/\/ 2, \(size - nh\) \/\/ 2/);
    expect(py).toMatch(/max\(1, round\(w \* scale\)\), max\(1, round\(h \* scale\)\)/);
  });

  it("the pad value agrees across the contract, the trainer and the raster geometry", () => {
    const py = readFileSync(join(REPO, "tools/detector/head.py"), "utf8");
    expect(py).toMatch(/^PAD_VALUE = 114\.0 \/ 255\.0$/m);
    expect(HEAD_CONTRACT.padValue).toBeCloseTo(114 / 255, 12);
    expect(rasterLetterbox({ w: 100, h: 50 }, 640, HEAD_CONTRACT.padValue).padByte).toBe(114);
  });
});
