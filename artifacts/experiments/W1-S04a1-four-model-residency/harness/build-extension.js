/**
 * S-04a-1 build step. Assembles the throwaway four-model probe extensions.
 *
 * Unlike S-04a, the models are NOT base64-inlined: ~116 MB of weights would become ~155 MB
 * of JavaScript string literal. They are copied in as extension RESOURCE FILES and read at
 * runtime through the extension's own URL -- a same-origin extension read, not network.
 *
 * Neither the weights nor ORT's .wasm artifacts are ever committed.
 *
 * Run:  node build-extension.js
 */
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "node_modules", "onnxruntime-web", "dist");
const MODELS = path.join(__dirname, "models");
const OUT_CHROME = path.join(__dirname, "ext-chrome");
const OUT_FIREFOX = path.join(__dirname, "ext-firefox");

// The four DIFFERENT models. Key -> packaged filename.
const MODEL_FILES = {
  face: "yunet.onnx",
  ocr_det: "ppocrv5_mobile_det.onnx",
  ocr_rec: "ppocrv5_mobile_rec.onnx",
  vlm_vision: "smolvlm_vision_encoder_int8.onnx",
};

const reference = fs.readFileSync(path.join(__dirname, "reference.json"), "utf8");
let probeSrc = fs.readFileSync(path.join(__dirname, "s04a1-probe.js"), "utf8");
// PRESSURE=1 appends the section-10 failure-behaviour probe alongside the main one.
if (process.env.PRESSURE) {
  probeSrc += "\n" + fs.readFileSync(path.join(__dirname, "pressure-probe.js"), "utf8");
}
const probe = probeSrc
  .replace(/__REFERENCE_JSON__/g, reference)
  .replace(/__MODEL_URLS_JSON__/g, JSON.stringify(MODEL_FILES));

const NEEDED = [
  "ort.all.min.js",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

let totalModelBytes = 0;
for (const out of [OUT_CHROME, OUT_FIREFOX]) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of NEEDED) {
    const src = path.join(DIST, f);
    if (!fs.existsSync(src)) { console.error("MISSING in dist:", f); process.exit(1); }
    fs.copyFileSync(src, path.join(out, f));
  }
  for (const key of Object.keys(MODEL_FILES)) {
    const src = path.join(MODELS, MODEL_FILES[key]);
    if (!fs.existsSync(src)) { console.error("MISSING model:", MODEL_FILES[key], "- run fetch-models.py"); process.exit(1); }
    fs.copyFileSync(src, path.join(out, MODEL_FILES[key]));
  }
  fs.writeFileSync(path.join(out, "probe.js"), probe);
}
for (const key of Object.keys(MODEL_FILES)) {
  totalModelBytes += fs.statSync(path.join(MODELS, MODEL_FILES[key])).size;
}

// cycles: 3 complete four-model lifecycles after the first teardown sweep.
const CONFIGS = [{
  backend: process.env.BACKEND || "wasm",
  numThreads: 1,
  cycles: Number(process.env.CYCLES === undefined ? 3 : process.env.CYCLES),
  phase: process.env.PHASE || "full",
  only: process.env.ONLY ? process.env.ONLY.split(",") : undefined,
}];

const CSP_NOTE =
  "Required: S-02a-2b measured that Chrome MV3 blocks WebAssembly without this, and that " +
  "'wasm-unsafe-eval' is the ONLY token it accepts. Used here in a THROWAWAY HARNESS to make " +
  "the measurement possible. NOT adopted in any product manifest -- the decision is ADR S-02a-2a.";

// ---- Chrome MV3 ----------------------------------------------------------------------
fs.writeFileSync(path.join(OUT_CHROME, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "PratiBimb S-04a-1 four-model residency probe (Chrome)",
  version: "1.0.0",
  description: "Throwaway spike harness. Four DIFFERENT ONNX models resident in one MV3 extension context.",
  minimum_chrome_version: "116",
  background: { service_worker: "background.js" },
  permissions: ["offscreen"],
  host_permissions: ["http://127.0.0.1:8908/*"],
  _csp_note: CSP_NOTE,
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
}, null, 2));

fs.writeFileSync(path.join(OUT_CHROME, "offscreen.html"),
  '<!doctype html><meta charset="utf-8"><title>s04a1 offscreen</title>' +
  '<script src="ort.all.min.js"></script><script src="probe.js"></script><script src="offscreen.js"></script>');

fs.writeFileSync(path.join(OUT_CHROME, "offscreen.js"), [
  'chrome.runtime.onMessage.addListener((msg) => {',
  '  if (!msg || msg.type !== "s04a1-go") return;',
  '  (async () => {',
  '    const base = chrome.runtime.getURL("");',
  '    const results = [];',
  '    for (const cfg of msg.configs) {',
  '      results.push(await globalThis.runS04a1Probe("chrome-offscreen-document", Object.assign({}, cfg, { wasmPaths: base, modelBase: base })));',
  '    }',
  '    if (globalThis.runPressureProbe) {',
  '      results.push(await globalThis.runPressureProbe("chrome-offscreen-document", { wasmPaths: base, modelBase: base, numThreads: 1 }));',
  '    }',
  '    const workerResults = await new Promise((resolve) => {',
  '      const t = setTimeout(() => resolve([{ context: "chrome-offscreen-dedicated-worker", conclusion: "worker timeout", error: { message: "no reply" } }]), 1800000);',
  '      try {',
  '        const w = new Worker("worker.js");',
  '        w.onmessage = (e) => { clearTimeout(t); resolve(e.data); };',
  '        w.onerror = (e) => { clearTimeout(t); resolve([{ context: "chrome-offscreen-dedicated-worker", conclusion: "worker error", error: { message: String(e.message || e).slice(0, 300) } }]); };',
  '        w.postMessage({ configs: msg.configs, base: base });',
  '      } catch (e) {',
  '        clearTimeout(t);',
  '        resolve([{ context: "chrome-offscreen-dedicated-worker", conclusion: "worker ctor threw", error: { message: String((e && e.message) || e).slice(0, 300) } }]);',
  '      }',
  '    });',
  '    results.push.apply(results, workerResults);',
  '    chrome.runtime.sendMessage({ type: "s04a1-offscreen-results", results: results });',
  '  })();',
  '});',
].join("\n"));

fs.writeFileSync(path.join(OUT_CHROME, "worker.js"), [
  '// Dedicated worker inside the offscreen document -- PratiBimb stated inference target.',
  'importScripts("ort.all.min.js", "probe.js");',
  'self.onmessage = async (e) => {',
  '  const cfgs = e.data.configs, base = e.data.base;',
  '  const results = [];',
  '  for (const cfg of cfgs) {',
  '    results.push(await globalThis.runS04a1Probe("chrome-offscreen-dedicated-worker", Object.assign({}, cfg, { wasmPaths: base, modelBase: base })));',
  '  }',
  '  self.postMessage(results);',
  '};',
].join("\n"));

fs.writeFileSync(path.join(OUT_CHROME, "background.js"), [
  'importScripts("ort.all.min.js", "probe.js");',
  'const BASE = "http://127.0.0.1:8908";',
  '',
  'async function ensureOffscreen() {',
  '  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });',
  '  if (has.length) return;',
  '  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "S-04a-1 four-model residency probe" });',
  '}',
  '',
  'globalThis.__s04a1_run = async function (configs) {',
  '  const all = [];',
  '  const base = chrome.runtime.getURL("");',
  '  for (const cfg of configs) {',
  '    all.push(await globalThis.runS04a1Probe("chrome-mv3-service-worker", Object.assign({}, cfg, { wasmPaths: base, modelBase: base })));',
  '  }',
  '  await ensureOffscreen();',
  '  const off = await new Promise((resolve) => {',
  '    const t = setTimeout(() => resolve([{ context: "chrome-offscreen-document", conclusion: "offscreen timeout", error: { message: "no reply" } }]), 2400000);',
  '    chrome.runtime.onMessage.addListener(function h(m) {',
  '      if (m && m.type === "s04a1-offscreen-results") { clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.results); }',
  '    });',
  '    chrome.runtime.sendMessage({ type: "s04a1-go", configs: configs }).catch(() => {});',
  '  });',
  '  all.push.apply(all, off);',
  '  try {',
  '    await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contexts: all }) });',
  '  } catch (e) {}',
  '  return all;',
  '};',
].join("\n"));

// ---- Firefox MV3 event page ----------------------------------------------------------
fs.writeFileSync(path.join(OUT_FIREFOX, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "PratiBimb S-04a-1 four-model residency probe (Firefox)",
  version: "1.0.0",
  description: "Throwaway spike harness. Four DIFFERENT ONNX models resident in a Firefox MV3 event page.",
  browser_specific_settings: { gecko: { id: "pratibimb-s04a1@example.invalid", strict_min_version: "128.0" } },
  background: { scripts: ["ort.all.min.js", "probe.js", "ff-background.js"] },
  // "tabs" is REQUIRED, not a host permission, so Firefox MV3 grants it at install rather
  // than gating it behind user origin controls -- which is what makes tabs.get().url
  // readable and therefore makes per-chunk delivery confirmation possible at all. (S-04a)
  permissions: ["tabs"],
  host_permissions: ["http://127.0.0.1:8908/*"],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
}, null, 2));

fs.writeFileSync(path.join(OUT_FIREFOX, "ff-background.js"), [
  '// Firefox MV3 event page. Reports through a CHUNKED tab beacon as well as fetch, because',
  '// Firefox MV3 gates host_permissions behind user-granted origin controls (S-02a-2), and',
  '// a single beacon URL overflows the collector request line (S-04a root cause).',
  'const api = typeof browser !== "undefined" ? browser : chrome;',
  'const BASE = "http://127.0.0.1:8908";',
  'const CONFIGS = ' + JSON.stringify(CONFIGS) + ';',
  '',
  'function beacon(q) { try { return api.tabs.create({ url: BASE + q, active: false }); } catch (e) { return Promise.resolve(); } }',
  '',
  'let sinkTabId = null;',
  'async function beaconOnce(url, seq) {',
  '  if (sinkTabId === null) { const t = await api.tabs.create({ url: url, active: false }); sinkTabId = t.id; }',
  '  else { await api.tabs.update(sinkTabId, { url: url }); }',
  '  for (let k = 0; k < 200; k++) {',
  '    try { const t = await api.tabs.get(sinkTabId);',
  '      if (typeof t.url !== "string" || t.url === "") { await new Promise(function (r) { setTimeout(r, 120); }); return "unconfirmed"; }',
  '      if (t.status === "complete" && t.url.indexOf("seq=" + seq + "&") !== -1) return true;',
  '    } catch (e) { await new Promise(function (r) { setTimeout(r, 120); }); return "unconfirmed"; }',
  '    await new Promise(function (r) { setTimeout(r, 25); });',
  '  }',
  '  return false;',
  '}',
  'async function report(obj) {',
  '  const enc = encodeURIComponent(JSON.stringify(obj));',
  '  const id = "r" + Date.now();',
  '  const MAX = 8000;',
  '  const n = Math.max(1, Math.ceil(enc.length / MAX));',
  '  for (let i = 0; i < n; i++) {',
  '    const ok = await beaconOnce(BASE + "/chunk?id=" + id + "&i=" + i + "&n=" + n + "&seq=" + i + "&x=1&d=" + enc.slice(i * MAX, (i + 1) * MAX), i);',
  '    if (ok === false) { await beacon("/alive?stage=chunk-stalled&i=" + i + "&n=" + n); return false; }',
  '  }',
  '  return true;',
  '}',
  '',
  '(async () => {',
  '  await beacon("/alive?stage=start");',
  '  const base = api.runtime.getURL("");',
  '  const results = [];',
  '  for (const cfg of CONFIGS) {',
  '    try { results.push(await globalThis.runS04a1Probe("firefox-mv3-event-page", Object.assign({}, cfg, { wasmPaths: base, modelBase: base }))); }',
  '    catch (e) { results.push({ context: "firefox-mv3-event-page", requestedBackend: cfg.backend, conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 300) } }); }',
  '  }',
  '  let delivered = false;',
  '  try {',
  '    await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contexts: results }) });',
  '    delivered = true;',
  '  } catch (e) { delivered = false; }',
  '  if (!delivered) { await report({ contexts: results }); }',
  '})();',
].join("\n"));

console.log("built ext-chrome and ext-firefox");
console.log("four models packaged, total weights:", (totalModelBytes / 1048576).toFixed(2), "MB");
