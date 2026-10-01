/**
 * M10.8 — THE VERIFIER'S OWN TR-01 RUNTIME. Test-only; never part of any extension build.
 *
 * It shares no code with the product's detector path. The chain is M8.1's screened one:
 *   - the pinned ORT Web build (`node_modules/onnxruntime-web/dist`, the `db816fad…` WASM), wasm EP,
 *     one thread, in a PLAIN page served from its own loopback server — not the extension;
 *   - the pinned model file, re-hashed here against the pin before any session exists;
 *   - M8.1's in-page preprocessing (bilinear, BGR, ImageNet mean/std), with PaddleOCR's type-2 resize
 *     (`target_size` in M8.1's `prep-native.py`): long side to `resizeLong`, each side rounded UP to
 *     a multiple of the stride;
 *   - M8.1's own `dbPostprocess` (`text-detector-screening.mjs`), run here in Node.
 *
 * The verifier's configuration is DIFFERENTIAL, as the frozen verifier requires ("LOW threshold,
 * HIGHER resolution"; "the second pass differs from the first in scope and threshold"), and was set by
 * the owner for M10.8: `resizeLong` 1920 (2 × the product's 960) and `boxThresh` 0.3 (the product's
 * 0.6, lowered to the DB pixel threshold 0.3 that already exists). Nothing here is fed back into
 * the product.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { ROOT } from "../demo/server.mjs";
import { DB_POSTPROCESS, dbPostprocess } from "./text-detector-screening.mjs";

export const MODEL_PATH = join(ROOT, "artifacts", "models", "tr01-ppocrv4-mobile-det", "tr01-ppocrv4-mobile-det.onnx");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
/** The pinned ONNX, read from the product's pin file as text (a constant, not product code). */
export const MODEL_SHA256 = /onnx:[\s\S]*?sha256:\s*"([0-9a-f]{64})"/.exec(readFileSync(join(ROOT, "apps", "extension", "host-lib", "tr01-pin.ts"), "utf8"))?.[1] ?? null;

/** The product's frozen configuration (M8.1, `textRegion.ts`), for reference and comparison only. */
export const PRODUCT_CONFIG = Object.freeze({ name: "product", resizeLong: 960, stride: 128, db: DB_POSTPROCESS });
/** The verifier's differential configuration (owner decision, M10.8). */
export const VERIFIER_CONFIG = Object.freeze({ name: "verifier-differential", resizeLong: 1920, stride: 128, db: Object.freeze({ ...DB_POSTPROCESS, boxThresh: DB_POSTPROCESS.thresh }) });

/** PaddleOCR type-2 resize, as M8.1's `prep-native.py` `target_size` computes it. */
export function targetSize(cfg, h, w) {
  const ratio = cfg.resizeLong / (h > w ? h : w);
  const rh = Math.trunc(h * ratio);
  const rw = Math.trunc(w * ratio);
  return [Math.ceil(rh / cfg.stride) * cfg.stride, Math.ceil(rw / cfg.stride) * cfg.stride];
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const PAGE = `<!doctype html><meta charset="utf-8"><title>m10.8 verifier</title>
<script>window.__wasmMemories=[];const N=WebAssembly.Memory;function T(d){const m=new N(d);window.__wasmMemories.push(m);return m}T.prototype=N.prototype;WebAssembly.Memory=T;</script>
<script src="/ort/ort.all.min.js"></script>`;

/**
 * Start the runtime in a NEW page of `context` (a plain page, not the extension).
 * @returns {Promise<{ detect: (frame: {width:number,height:number,rgba:Uint8Array|Buffer}, cfg: object) => Promise<object>, origin: string, model: object, close: () => Promise<void> }>}
 */
export async function startVerifierRuntime(context) {
  if (!existsSync(MODEL_PATH)) throw new Error(`the TR-01 model is not provisioned at ${MODEL_PATH}`);
  const modelBytes = readFileSync(MODEL_PATH);
  const model = { sha256: sha256(modelBytes), bytes: modelBytes.length, pinned: MODEL_SHA256 };
  if (model.sha256 !== MODEL_SHA256) throw new Error("the TR-01 model does not match its pin");
  const served = { wasmSha256: null };
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = null;
    let type = "application/octet-stream";
    if (url.pathname === "/") {
      body = Buffer.from(PAGE);
      type = "text/html";
    } else if (url.pathname === "/model.onnx") body = modelBytes;
    else if (url.pathname.startsWith("/ort/") && !url.pathname.includes("..")) {
      const file = join(ORT_DIST, url.pathname.slice(5));
      if (existsSync(file)) {
        body = readFileSync(file);
        type = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" }[extname(file)] ?? type;
        if (file.endsWith(".wasm")) served.wasmSha256 = sha256(body);
      }
    }
    if (!body) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await context.newPage();
  await page.goto(`${origin}/`, { waitUntil: "load" });
  const load = await page.evaluate(async () => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/ort/";
    const bytes = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
    const t0 = performance.now();
    window.__session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
    return { sessionMs: performance.now() - t0, ortVersion: ort.env.versions?.common ?? null, inputs: window.__session.inputNames, outputs: window.__session.outputNames };
  });

  async function detect(frame, cfg) {
    const [oh, ow] = targetSize(cfg, frame.height, frame.width);
    const t0 = performance.now();
    const out = await page.evaluate(
      async ({ b64, w, h, oh, ow }) => {
        const MEAN = [0.485, 0.456, 0.406].map(Math.fround);
        const STD = [0.229, 0.224, 0.225].map(Math.fround);
        const bin = atob(b64);
        const rgba = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
        const t0 = performance.now();
        const x = new Float32Array(3 * oh * ow);
        const plane = oh * ow;
        const wx = new Float64Array(ow), x0s = new Int32Array(ow), x1s = new Int32Array(ow);
        for (let i = 0; i < ow; i++) {
          const sx = Math.min(Math.max((i + 0.5) * (w / ow) - 0.5, 0), w - 1);
          x0s[i] = Math.floor(sx);
          x1s[i] = Math.min(x0s[i] + 1, w - 1);
          wx[i] = sx - x0s[i];
        }
        for (let j = 0; j < oh; j++) {
          const sy = Math.min(Math.max((j + 0.5) * (h / oh) - 0.5, 0), h - 1);
          const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, h - 1), wy = sy - y0;
          for (let i = 0; i < ow; i++)
            for (let c = 0; c < 3; c++) {
              const ch = 2 - c;
              const a = rgba[(y0 * w + x0s[i]) * 4 + ch], b = rgba[(y0 * w + x1s[i]) * 4 + ch];
              const d = rgba[(y1 * w + x0s[i]) * 4 + ch], e = rgba[(y1 * w + x1s[i]) * 4 + ch];
              const v = Math.fround(((a * (1 - wx[i]) + b * wx[i]) * (1 - wy) + (d * (1 - wx[i]) + e * wx[i]) * wy) / 255);
              x[c * plane + j * ow + i] = Math.fround(Math.fround(v - MEAN[c]) / STD[c]);
            }
        }
        const t1 = performance.now();
        const s = window.__session;
        const res = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, oh, ow]) });
        const t2 = performance.now();
        const y = res[s.outputNames[0]];
        const u8 = new Uint8Array(y.data.buffer, y.data.byteOffset, y.data.byteLength);
        let str = "";
        for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return { dims: y.dims, prob: btoa(str), ms: { preprocess: t1 - t0, infer: t2 - t1 }, wasmBytes: window.__wasmMemories.reduce((n, m) => n + m.buffer.byteLength, 0) };
      },
      { b64: Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength).toString("base64"), w: frame.width, h: frame.height, oh, ow }
    );
    const t1 = performance.now();
    const pb = Buffer.from(out.prob, "base64");
    const prob = new Float32Array(pb.buffer, pb.byteOffset, pb.byteLength / 4);
    const H = out.dims[2];
    const W = out.dims[3];
    const { boxes } = dbPostprocess(prob, H, W, oh / frame.height, ow / frame.width, frame.height, frame.width, cfg.db);
    const t2 = performance.now();
    return { config: cfg.name, input: [oh, ow], boxes, ms: { ...out.ms, postprocess: t2 - t1, total: t2 - t0 }, wasmBytes: out.wasmBytes };
  }

  return {
    detect,
    origin,
    model: { ...model, ortWasmSha256: () => served.wasmSha256, ortVersion: load.ortVersion, sessionMs: load.sessionMs },
    close: async () => {
      await page.close();
      // The browser keeps idle keep-alive sockets open; `close` alone would wait for them forever.
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
}
