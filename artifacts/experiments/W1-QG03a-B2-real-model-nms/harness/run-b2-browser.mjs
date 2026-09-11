/**
 * QG-03a-B2 — the REAL T1 artifact through ORT Web in a real browser. One backend per launch.
 *
 *   node .../harness/run-b2-browser.mjs --browser=chrome|firefox --backend=wasm|webgpu
 *
 * WHAT RUNS, AND WHY IT IS THE PRODUCTION BOUNDARY
 *
 * The page performs the calls apps/extension/entrypoints/ortRuntime.ts makes to bring a
 * realm up, from the SHIPPED compiled packages:
 *   - assertWasmCompilationAllowed;
 *   - numThreads = 1 and proxy = false;
 *   - installVerifiedOrtRuntime, which fetches the packaged JSEP wasm, hashes it against the
 *     build-time pin, and hands ORT that exact buffer;
 *   - createPinnedInferenceSession.
 * The input is a captureVisibleTab PNG, decoded natively and preprocessed by the shipped
 * preprocessToTensor. The ORT output tensor is dumped whole, and that tensor is the boundary
 * that decodeHeadOutput consumes.
 *
 * The page is a plain http://127.0.0.1 page, not an MV3 extension. The runtime bytes, the
 * session options, the input bytes and the model bytes are the production ones, and each is
 * checked by hash. The page origin is the only thing that differs.
 *
 * WHAT IT REFUSES
 *   - A model whose size or SHA-256 differs from the documented artifact.
 *   - A fixture PNG whose SHA-256 differs from W1-QG03b-2a's committed digest.
 *   - A "webgpu" label without GPU work. GPUQueue.prototype.submit is wrapped BEFORE ORT
 *     loads, and a cell is labelled by the submits it actually made (QG-03's discriminator).
 *
 * The installed browser runs headful, with a throwaway profile and no flags. Loopback only;
 * nothing leaves the machine. Raw outputs go to harness/generated/ (gitignored). The log
 * records every digest.
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const LOGS = join(EXP, "logs");
const GEN = join(HERE, "generated");
const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).split("=")[1];
const which = arg("browser", "chrome");
const backend = arg("backend", "wasm");
const cell = `${which}-${backend}`;

const BROWSERS = {
  chrome: { exe: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", port: 8961 },
  firefox: { exe: "C:\\Program Files\\Mozilla Firefox\\firefox.exe", port: 8962 },
};
const B = BROWSERS[which];
if (!B || !existsSync(B.exe) || !["wasm", "webgpu"].includes(backend)) {
  console.error(`unsupported cell ${cell}`);
  process.exit(2);
}

const sha = (b) => createHash("sha256").update(b).digest("hex");
const MODEL_PATH = join(ROOT, "artifacts/models/t1-ui-head/t1-ui-head.onnx");
const MODEL_SHA = "ba6d9e93695b22d17d9dc2b8193966132af85a6a031b08eb453d1d20a05179d0";
const MODEL_BYTES = 302960;
const model = readFileSync(MODEL_PATH);
if (model.length !== MODEL_BYTES || sha(model) !== MODEL_SHA) {
  console.error(`MODEL IDENTITY MISMATCH: ${model.length} bytes, ${sha(model)} — refusing to run`);
  process.exit(2);
}

const QG = join(ROOT, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture");
const FIXTURES = JSON.parse(readFileSync(join(QG, "fixtures.json"), "utf8"))
  .fixtures.filter((f) => f.encoding === "capture-png")
  .map((f) => {
    const bytes = readFileSync(join(QG, "harness", "captured", f.file));
    if (sha(bytes) !== f.encodedSha256) throw new Error(`fixture ${f.file}: hash mismatch against fixtures.json`);
    return { name: f.source, file: f.file, sha256: f.encodedSha256, bytes: bytes.length, captureSize: f.captureSize, viewportCss: f.viewportCss, dpr: f.dpr };
  });

const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const ORT_FILES = new Set(["ort.all.min.js", "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]);
const ORT_VERSION = JSON.parse(readFileSync(join(ROOT, "node_modules/onnxruntime-web/package.json"), "utf8")).version;

const bundle = (
  await build({ entryPoints: [join(HERE, "b2-entry.mjs")], bundle: true, format: "iife", globalName: "B2", write: false, platform: "browser", target: "es2022" })
).outputFiles[0].text;

const PAGE = `<!doctype html><meta charset=utf-8><title>qg03a-b2</title><pre id=o>running</pre>
<script>
  // Installed BEFORE ORT loads. A "webgpu" label is an observation only if work was submitted.
  window.__gpu = { submits: 0, hookError: null };
  try {
    if (typeof GPUQueue === "function") {
      const s = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (b) { window.__gpu.submits += 1; return s.call(this, b); };
    } else { window.__gpu.hookError = "GPUQueue is not defined in this context"; }
  } catch (e) { window.__gpu.hookError = String(e); }
</script>
<script src="/ort/ort.all.min.js"></script>
<script src="/bundle.js"></script>
<script>
(async () => {
  const cfg = await (await fetch("/config.json")).json();
  const out = { ua: navigator.userAgent, backend: cfg.backend, rows: [] };
  const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
  const sha = async (u8) => hex(await crypto.subtle.digest("SHA-256", u8));
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h; return c;
  }
  async function decodeNative(pngBytes) {
    const bmp = await createImageBitmap(new Blob([pngBytes], { type: "image/png" }));
    const canvas = makeCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    if (bmp.close) bmp.close();
    return { width: img.width, height: img.height, rgba: new Uint8Array(img.data.buffer.slice(0)) };
  }
  try {
    out.capability = await B2.assertWasmCompilationAllowed("qg03a-b2-page");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = "error";
    out.pin = await B2.installVerifiedOrtRuntime({ ort, resolveAssetUrl: (n) => new URL("/ort/" + n, location.href).href });
    const modelBytes = new Uint8Array(await (await fetch("/model.onnx")).arrayBuffer());
    out.modelSha256 = await sha(modelBytes);
    const t0 = performance.now();
    const session = await B2.createPinnedInferenceSession(ort, modelBytes, { executionProviders: [cfg.backend], graphOptimizationLevel: "all" });
    out.sessionCreateMs = performance.now() - t0;
    if (cfg.backend === "webgpu") {
      try {
        const a = ort.env.webgpu && ort.env.webgpu.adapter;
        const info = a && (a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : null));
        out.ortAdapter = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null;
      } catch (e) { out.ortAdapterError = String(e).slice(0, 200); }
    }
    const submitsBefore = window.__gpu.submits;
    for (const f of cfg.fixtures) {
      const rec = { name: f.name };
      try {
        const png = new Uint8Array(await (await fetch("/png/" + f.file)).arrayBuffer());
        rec.pngSha256 = await sha(png);
        const d = await decodeNative(png);
        const pre = B2.preprocessToTensor(d, B2.HEAD_CONTRACT);
        rec.tensorSha256 = await sha(new Uint8Array(pre.tensor.buffer));
        const feeds = {};
        feeds[session.inputNames[0]] = new ort.Tensor("float32", pre.tensor, [1, 3, 640, 640]);
        const outs = [];
        const ms = [];
        for (let k = 0; k < 3; k++) {
          const t = performance.now();
          const r = await session.run(feeds);
          const o = r[session.outputNames[0]];
          ms.push(performance.now() - t);
          const data = o.data instanceof Float32Array ? o.data : Float32Array.from(o.data);
          outs.push({ dims: Array.from(o.dims), bytes: new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)) });
        }
        rec.dims = outs[0].dims;
        rec.outputBytes = outs[0].bytes.length;
        rec.outputSha256 = await sha(outs[0].bytes);
        rec.repeatSha256 = [await sha(outs[1].bytes), await sha(outs[2].bytes)];
        rec.deterministic = rec.repeatSha256.every((s) => s === rec.outputSha256);
        rec.inferMs = ms.map((v) => Math.round(v * 100) / 100);
        const td = performance.now();
        const dec = B2.decodeHeadOutput({ data: new Float32Array(outs[0].bytes.buffer), dims: rec.dims });
        rec.decodeNmsMs = Math.round((performance.now() - td) * 100) / 100;
        rec.decoded = dec.ok ? dec.value.length : dec.code;
        rec.outputB64 = b64(outs[0].bytes);
      } catch (e) { rec.error = String((e && e.message) || e).slice(0, 300); }
      out.rows.push(rec);
      document.getElementById("o").textContent = out.rows.length + "/" + cfg.fixtures.length;
    }
    out.gpu = { submitsDuringInference: window.__gpu.submits - submitsBefore, submitsTotal: window.__gpu.submits, hookError: window.__gpu.hookError };
    if (typeof session.release === "function") await session.release();
  } catch (e) { out.error = String((e && e.stack) || e).slice(0, 800); }
  await fetch("/result", { method: "POST", body: JSON.stringify(out) });
  document.getElementById("o").textContent = "done";
})();
</script>`;

const profile = join(HERE, "profiles", cell);
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
function closeBrowser() {
  const image = which === "chrome" ? "chrome.exe" : "firefox.exe";
  const marker = profile.replace(/'/g, "''");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='${image}'" | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  } catch { /* best effort; the profile path is unique to this cell */ }
}

const config = { backend, fixtures: FIXTURES.map((f) => ({ name: f.name, file: f.file })) };
const server = createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "POST" && url === "/result") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.end("ok");
      const got = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const dir = join(GEN, cell);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      for (const r of got.rows ?? []) {
        if (!r.outputB64) continue;
        const buf = Buffer.from(r.outputB64, "base64");
        r.dumpVerified = sha(buf) === r.outputSha256;
        writeFileSync(join(dir, `${r.name}.f32`), buf);
        delete r.outputB64;
      }
      const submits = got.gpu?.submitsDuringInference ?? null;
      const log = {
        experiment: "W1-QG03a-B2-real-model-nms",
        cell,
        browser: which,
        backendRequested: backend,
        backendObserved: submits === null ? "unknown" : submits > 0 ? "webgpu" : "cpu",
        backendLabelVerified: backend === "webgpu" ? submits > 0 : submits === 0,
        userAgent: got.ua,
        context: "plain http://127.0.0.1 page; installed browser; headful; throwaway profile; no flags; production ORT pin + createPinnedInferenceSession",
        ortVersion: ORT_VERSION,
        model: { path: "artifacts/models/t1-ui-head/t1-ui-head.onnx", bytes: MODEL_BYTES, sha256: MODEL_SHA, shaSeenByPage: got.modelSha256 },
        pin: got.pin ?? null,
        capability: got.capability ?? null,
        ortAdapter: got.ortAdapter ?? null,
        ortAdapterError: got.ortAdapterError ?? null,
        sessionCreateMs: got.sessionCreateMs ?? null,
        gpu: got.gpu ?? null,
        error: got.error ?? null,
        runAt: new Date().toISOString(),
        fixtures: FIXTURES.map(({ name, file, sha256, bytes, captureSize, viewportCss, dpr }) => ({ name, file, sha256, bytes, captureSize, viewportCss, dpr })),
        rows: got.rows ?? [],
      };
      mkdirSync(LOGS, { recursive: true });
      writeFileSync(join(LOGS, `b2-${cell}.json`), JSON.stringify(log, null, 1));
      const rows = log.rows;
      console.log(`${cell}: ${got.ua}`);
      console.log(`  backend observed ${log.backendObserved} (submits during inference ${submits}); label verified ${log.backendLabelVerified}`);
      console.log(`  adapter ${JSON.stringify(log.ortAdapter)} ${log.ortAdapterError ?? ""}`);
      console.log(`  rows ${rows.length}, errors ${rows.filter((r) => r.error).length}, deterministic ${rows.filter((r) => r.deterministic).length}, dumps verified ${rows.filter((r) => r.dumpVerified).length}, session ${Math.round(log.sessionCreateMs ?? -1)} ms`);
      if (log.error) console.log("  FATAL:", log.error);
      closeBrowser();
      setTimeout(() => process.exit(log.error ? 1 : 0), 300);
    });
    return;
  }
  if (url === "/") { res.setHeader("content-type", "text/html"); return res.end(PAGE); }
  if (url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); return res.end(bundle); }
  if (url === "/config.json") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(config)); }
  if (url === "/model.onnx") { res.setHeader("content-type", "application/octet-stream"); return res.end(model); }
  const o = /^\/ort\/([A-Za-z0-9._-]+)$/.exec(url);
  if (o && ORT_FILES.has(o[1])) {
    res.setHeader("content-type", o[1].endsWith(".wasm") ? "application/wasm" : "text/javascript");
    return res.end(readFileSync(join(ORT_DIST, o[1])));
  }
  const p = /^\/png\/([A-Za-z0-9._-]+\.png)$/.exec(url);
  if (p && FIXTURES.some((f) => f.file === p[1])) { res.setHeader("content-type", "image/png"); return res.end(readFileSync(join(QG, "harness", "captured", p[1]))); }
  res.statusCode = 404;
  res.end();
});
server.listen(B.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${B.port}/`;
  const args = which === "chrome" ? [`--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", url] : ["-no-remote", "-profile", profile, url];
  spawn(B.exe, args, { detached: true, stdio: "ignore" }).unref();
  console.log(`launched ${cell} on ${url}`);
});
setTimeout(() => { console.error(`TIMEOUT: ${cell} produced no result within 300 s`); closeBrowser(); process.exit(3); }, 300_000);
