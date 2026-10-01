#!/usr/bin/env node
/**
 * M7.1 DIAGNOSTIC — why does the reconstructed detector run ~10x slower in ORT Web than S-04a-1
 * recorded (234 ms infer, 474 ms create, same input, same bundle, one thread)?
 *
 * Two variables, crossed, on S-04a-1's synthetic input only:
 *   model   `as-converted` (313 Constant + 248 Identity nodes) vs `initializers` (the same weights
 *           lifted to initializers, Identity bypassed — proven byte-identical on native ORT)
 *   page    cross-origin isolated (COOP/COEP, as run-det-validation.mjs) vs not (as S-04a-1)
 *
 * This decides nothing about the candidate. Its only job is to say whether a latency number is a
 * property of the model or of how it was serialised or hosted, before that number is reported.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const MODELS = join(EXP, "models");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.error("REFUSING: set CHROME_PATH");
  process.exit(1);
}

const MODEL_FILES = { "as-converted": "ppocrv5_mobile_det.onnx", initializers: "diag-initializers.onnx" };
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm" };

function serve(isolated) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (isolated) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    }
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<!doctype html><script src="/ort/ort.all.min.js"></script>');
      return;
    }
    let file = null;
    if (url.pathname.startsWith("/ort/")) file = join(ORT_DIST, url.pathname.slice(5));
    else if (url.pathname.startsWith("/model/")) file = join(MODELS, MODEL_FILES[url.pathname.slice(7)] ?? "");
    else if (url.pathname === "/input") file = join(MODELS, "m7.1-input-synthetic.f32");
    if (!file || !existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const results = [];
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m71diag-")), {
  headless: false,
  executablePath,
});
try {
  for (const isolated of [false, true]) {
    const server = await serve(isolated);
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const model of Object.keys(MODEL_FILES)) {
      const page = await context.newPage();
      await page.goto(`${origin}/`, { waitUntil: "load" });
      const r = await page.evaluate(
        async ({ model }) => {
          ort.env.wasm.numThreads = 1;
          ort.env.wasm.wasmPaths = "/ort/";
          const bytes = new Uint8Array(await (await fetch(`/model/${model}`)).arrayBuffer());
          const x = new Float32Array(await (await fetch("/input")).arrayBuffer());
          const t0 = performance.now();
          const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
          const createMs = performance.now() - t0;
          const infer = [];
          let sumAbs = 0;
          for (let i = 0; i < 3; i += 1) {
            const t = performance.now();
            const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, 640, 640]) });
            infer.push(performance.now() - t);
            if (i === 0) for (const v of out[s.outputNames[0]].data) sumAbs += Math.abs(v);
          }
          return { crossOriginIsolated, createMs, infer, sumAbs };
        },
        { model }
      );
      results.push({ model, isolated, ...r });
      console.log(
        `${model.padEnd(13)} COI=${String(r.crossOriginIsolated).padEnd(5)} create ${r.createMs.toFixed(0).padStart(5)} ms  ` +
          `infer ${r.infer.map((v) => v.toFixed(0)).join(" / ")} ms  sumAbs ${r.sumAbs}`
      );
      await page.close();
    }
    server.close();
  }
} finally {
  await context.close();
}
writeFileSync(join(EXP, "logs", "m7.1-latency-diagnostic.json"), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
