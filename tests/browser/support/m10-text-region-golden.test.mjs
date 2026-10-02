/**
 * M10 — PRODUCT TR-01 == SCREENED TR-01. The golden equivalence for the first M10 commit.
 *
 * The product (`packages/perception/src/textRegion.ts`) must preprocess and post-process exactly as
 * the code TR-01 was screened with (M8.1 / M8.2 / M8.2a):
 *
 *   preprocessing   M8.2's `browser/m82-preprocess.js` — measured byte-identical to the screened
 *                   Python tensor in M8.2 — and, on real frames, the baseline's committed input sha256
 *   post-processing `tests/browser/support/text-detector-screening.mjs` `dbPostprocess` (M8.1)
 *   boxes           this workstation's baseline boxes (geometry)
 *
 * THE BASELINE IS PER MACHINE, and exactness is unchanged. M8.2's native reference is machine-local:
 * onnxruntime returns a different output for a byte-identical tensor and model on a different CPU,
 * and a different GPU rasterises the same DOM to different pixels. W1 keeps M8.1's historical record;
 * another machine uses its own; an unknown machine REFUSES rather than borrowing one. See
 * `m82-baseline.mjs` and `../../../artifacts/experiments/M8.2-qg03-visual-text-feasibility/logs/baseline-divergence-w1-vs-w2.md`.
 *
 * The comparison is EXACT: byte equality for tensors, deep equality for boxes and scores. Visual
 * similarity is never the criterion. If anything here fails, the port is wrong — the product is not
 * tuned to recover.
 *
 * Two layers:
 *   1. deterministic synthetic inputs — always run, committed data only;
 *   2. the real frozen frames and this machine's maps — run when M8.2's git-ignored fixtures exist
 *      for this workstation, and SKIPPED VISIBLY (never passed vacuously) when they do not.
 *
 * Nothing here imports the M9 reference model, and nothing in the product imports anything here.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { TEXT_REGION_LABEL, createTextRegionDetector, dbPostprocess, frameId, preprocessTextRegion, textRegionInputSize, TR01_RESIZE } from "@pratibimb/perception";

import { DB_POSTPROCESS as SCREENED_DB, dbPostprocess as screenedDbPostprocess } from "./text-detector-screening.mjs";
import { baselineWorkstation, fixturesDir, FIXTURE_NAMES, hasBaseline, loadBaseline } from "./m82-baseline.mjs";

const ROOT = new URL("../../../", import.meta.url);
const M82 = new URL("artifacts/experiments/M8.2-qg03-visual-text-feasibility/", ROOT);
const WS = baselineWorkstation();
const FIX = pathToFileURL(fixturesDir(WS) + "/");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const bytesOf = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);

// M8.2's in-browser preprocessing (screened, byte-identical to Python), loaded as the script it is.
await import(new URL("browser/m82-preprocess.js", M82).href);
const SCREENED_PRE = globalThis.M82_PREPROCESS;
const SCREENED_RULE = { type: 2, resize_long: 960, stride: 128 };

/** Deterministic pseudo-random numbers, so the synthetic layer is the same on every machine. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** A synthetic "page": light background, dark text-like bars, some noise. */
function syntheticImage(w, h, seed) {
  const r = lcg(seed);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 225 + Math.floor(r() * 30);
    rgba[i * 4 + 1] = 225 + Math.floor(r() * 30);
    rgba[i * 4 + 2] = 225 + Math.floor(r() * 30);
    rgba[i * 4 + 3] = 255;
  }
  for (let k = 0; k < 12; k++) {
    const bx = Math.floor(r() * (w - 60)), by = Math.floor(r() * (h - 14)), bw = 20 + Math.floor(r() * 40), bh = 6 + Math.floor(r() * 8);
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = Math.floor(r() * 60);
      rgba[i + 1] = Math.floor(r() * 60);
      rgba[i + 2] = Math.floor(r() * 60);
    }
  }
  return { width: w, height: h, rgba };
}

/** A synthetic probability map with blobs of varying probability, plus sub-threshold noise. */
function syntheticMap(W, H, seed) {
  const r = lcg(seed);
  const p = new Float32Array(W * H);
  for (let i = 0; i < p.length; i++) p[i] = r() * 0.25;
  for (let k = 0; k < 25; k++) {
    const x0 = Math.floor(r() * (W - 40)), y0 = Math.floor(r() * (H - 12)), bw = 2 + Math.floor(r() * 38), bh = 1 + Math.floor(r() * 11);
    const v = 0.2 + r() * 0.8;
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) p[y * W + x] = Math.fround(Math.min(1, v + (r() - 0.5) * 0.2));
  }
  return p;
}

/** Minimal PNG decoder (8-bit RGB / RGBA, non-interlaced) — enough for Playwright screenshots. */
function decodePng(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) throw new Error("not a PNG");
  let off = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG ${colorType}/${bitDepth}/${interlace}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error(`bad filter ${f}`);
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      rgba[o] = cur[x * bpp]; rgba[o + 1] = cur[x * bpp + 1]; rgba[o + 2] = cur[x * bpp + 2]; rgba[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return { width, height, rgba };
}

// ── 1. synthetic — always ─────────────────────────────────────────────────────────────────────
describe("synthetic golden: product == screened", () => {
  it("uses the screened post-processing parameters", async () => {
    const { DB_POSTPROCESS } = await import("@pratibimb/perception");
    expect(DB_POSTPROCESS).toEqual(SCREENED_DB);
  });

  it("computes the same input size as the screened rule, on many frame shapes", () => {
    for (const [h, w] of [[720, 1280], [900, 1600], [1080, 1920], [1440, 2560], [540, 960], [1200, 1920], [1280, 720], [333, 777]]) {
      expect(textRegionInputSize(TR01_RESIZE, h, w)).toEqual(SCREENED_PRE.targetSize(SCREENED_RULE, h, w));
    }
  });

  it("preprocesses byte-for-byte as the screened implementation", () => {
    for (const [w, h, seed] of [[160, 90, 1], [320, 180, 2], [97, 53, 3], [256, 256, 4]]) {
      const img = syntheticImage(w, h, seed);
      const product = preprocessTextRegion(img).tensor;
      const [oh, ow] = SCREENED_PRE.targetSize(SCREENED_RULE, h, w);
      const screened = SCREENED_PRE.resizeNormalise(img.rgba, h, w, oh, ow);
      expect(product.length).toBe(screened.length);
      expect(sha256(bytesOf(product))).toBe(sha256(bytesOf(screened)));
    }
  });

  it("post-processes box-for-box and bit-for-bit as the screened implementation", () => {
    let total = 0;
    for (const [W, H, ratio, seed] of [[256, 160, 1, 11], [512, 320, 0.8, 12], [320, 320, 1.6, 13], [640, 400, 0.5, 14]]) {
      const p = syntheticMap(W, H, seed);
      const srcH = H / ratio, srcW = W / ratio;
      const product = dbPostprocess(p, H, W, ratio, ratio, srcH, srcW);
      const screened = screenedDbPostprocess(p, H, W, ratio, ratio, srcH, srcW);
      expect(product).toEqual(screened);
      total += product.boxes.length;
    }
    expect(total).toBeGreaterThan(10); // the vectors exercise real boxes, not only empty maps
  });
});

// ── 2. real M8.1 frames and maps — when the fixtures exist ─────────────────────────────────────
const NAMES = FIXTURE_NAMES;
const haveFixtures = NAMES.every((n) => existsSync(new URL(`screenshots/${n}.png`, FIX)) && existsSync(new URL(`TR-01/native-${n}.f32`, FIX)));
const baseline = haveFixtures ? loadBaseline("TR-01", WS) : null;

describe.skipIf(!haveFixtures)(`real golden (frozen frames, ${WS.id} baseline): product == screened, end to end`, () => {
  const ref = haveFixtures ? JSON.parse(readFileSync(new URL("TR-01/native-reference.json", FIX), "utf8")) : null;

  for (const name of NAMES) {
    it(`${name}: same tensor, same map interpretation, same boxes, same scores`, async () => {
      const img = decodePng(readFileSync(new URL(`screenshots/${name}.png`, FIX)));
      expect([img.height, img.width]).toEqual(baseline.inputs[name].input.source_hw);

      // same input → same normalized input (M8.1's committed hash, and the screened tensor file)
      const tensor = preprocessTextRegion(img);
      expect(sha256(bytesOf(tensor.tensor))).toBe(baseline.inputs[name].inputSha256);
      expect(bytesOf(tensor.tensor).equals(readFileSync(new URL(`TR-01/input-${name}.f32`, FIX)))).toBe(true);
      expect(tensor.ratioH).toBe(ref.inputs[name].meta.ratio_h);
      expect(tensor.ratioW).toBe(ref.inputs[name].meta.ratio_w);

      // same probability interpretation → same post-processing → same boxes and scores
      const raw = readFileSync(new URL(`TR-01/native-${name}.f32`, FIX));
      const mapData = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const [, , H, W] = tensor.dims;
      const screened = screenedDbPostprocess(mapData, H, W, tensor.ratioH, tensor.ratioW, img.height, img.width);
      const detector = createTextRegionDetector({
        modelId: "PP-OCRv4_mobile_det",
        revision: "3cc09f3a5b424e8e010abc7a4271aea12999c2f7",
        acceptedBackends: ["wasm"],
        pixels: () => img,
        infer: async (t, dims) => {
          expect(sha256(bytesOf(t))).toBe(baseline.inputs[name].inputSha256);
          return { data: mapData, dims: [1, 1, dims[2], dims[3]] };
        },
      });
      const geometry = { dpr: 1, zoom: 1, viewportCss: { w: img.width, h: img.height }, captureSize: { w: img.width, h: img.height }, scroll: { x: 0, y: 0 }, origin: "https://fixture.invalid" };
      const out = await detector.detect({ id: frameId(name), capturedAt: 0, source: "live", geometry }, "wasm");
      expect(out.ok).toBe(true);
      const product = out.value.map((d) => ({ x: d.box.x, y: d.box.y, w: d.box.w, h: d.box.h, score: d.score }));
      expect(product).toEqual(screened.boxes);
      expect(out.value.every((d) => d.label === TEXT_REGION_LABEL)).toBe(true);

      // and the same box GEOMETRY the baseline recorded (its boxes came from the WASM map, on W1 and
      // on every later machine alike; the WASM-vs-native geometry difference is recorded per machine
      // in the baseline's `wasmVsNative` block, with scores differing in low digits — so geometry is
      // compared exactly and scores only against the screened function)
      const recorded = baseline.inputs[name].boxes.map((b) => [b.x, b.y, b.w, b.h]);
      expect(product.map((b) => [b.x, b.y, b.w, b.h])).toEqual(recorded);
    });
  }
});

describe("the real layer is not silently absent", () => {
  it("states whether it ran", () => {
    // A skipped real layer must be visible in the record rather than read as a pass.
    expect(typeof haveFixtures).toBe("boolean");
    if (haveFixtures) expect(hasBaseline("TR-01", WS)).toBe(true);
    if (!haveFixtures) console.warn(`m10 golden: M8.2 fixtures absent for ${WS.id} — the real-frame layer was SKIPPED`);
  });
});
