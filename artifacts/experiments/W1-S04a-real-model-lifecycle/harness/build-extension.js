/**
 * S-03 build step. Assembles the throwaway probe extensions from node_modules.
 *
 * ORT Web's .wasm artifacts are 14-28 MB, so they are NEVER committed -- CI blocks files
 * over 5 MB, and SECURITY.md says large binaries are referenced by pinned revision rather
 * than vendored. This script pulls them from the pinned npm package instead.
 *
 * Run:  npm install onnxruntime-web@1.29.0 && node build-extension.js
 */
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "node_modules", "onnxruntime-web", "dist");
const MODEL = path.join(__dirname, "models", "face_detection_yunet_2023mar.onnx");
const OUT_CHROME = path.join(__dirname, "ext-chrome");
const OUT_FIREFOX = path.join(__dirname, "ext-firefox");

const modelB64 = fs.readFileSync(MODEL).toString("base64");
const reference = fs.readFileSync(path.join(__dirname, "reference.json"), "utf8");
const probe = fs.readFileSync(path.join(__dirname, "s04a-probe.js"), "utf8")
  .replace("__MODEL_B64__", modelB64)
  .replace("__REFERENCE_JSON__", reference);

// ort.all.min.js carries every backend (wasm + webgpu). The wasm binaries it loads at
// runtime are copied alongside and pointed at with ort.env.wasm.wasmPaths.
const NEEDED = [
  "ort.all.min.js",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

for (const out of [OUT_CHROME, OUT_FIREFOX]) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of NEEDED) {
    const src = path.join(DIST, f);
    if (!fs.existsSync(src)) { console.error("MISSING in dist:", f); process.exit(1); }
    fs.copyFileSync(src, path.join(out, f));
  }
  fs.writeFileSync(path.join(out, "probe.js"), probe);
}

const CONFIGS = [
  { backend: "wasm", numThreads: 1, cycles: 5 },
];

// ---- Chrome MV3: service worker + offscreen document + dedicated worker --------------
fs.writeFileSync(path.join(OUT_CHROME, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "PratiBimb S-04a real-model lifecycle probe (Chrome)",
  version: "1.0.0",
  description: "Throwaway spike harness. Creates and runs a real ONNX Runtime Web session in Chrome MV3 extension contexts.",
  minimum_chrome_version: "116",
  background: { service_worker: "background.js" },
  permissions: ["offscreen"],
  host_permissions: ["http://127.0.0.1:8908/*"],
  // Required: S-02a-2b measured that Chrome MV3 blocks WebAssembly without this, and that
  // 'wasm-unsafe-eval' is the ONLY token it accepts. Used here in a THROWAWAY HARNESS to
  // make the measurement possible. NOT adopted in any product manifest -- there is no
  // product code, and the decision is ADR S-02a-2a.
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
}, null, 2));

fs.writeFileSync(path.join(OUT_CHROME, "offscreen.html"),
  '<!doctype html><meta charset="utf-8"><title>s03 offscreen</title>' +
  '<script src="ort.all.min.js"></script><script src="probe.js"></script><script src="offscreen.js"></script>');

fs.writeFileSync(path.join(OUT_CHROME, "offscreen.js"), [
  '// Runs the ORT probe in the offscreen document, then in a dedicated worker inside it.',
  'chrome.runtime.onMessage.addListener((msg) => {',
  '  if (!msg || msg.type !== "s04a-go") return;',
  '  (async () => {',
  '    const base = chrome.runtime.getURL("");',
  '    const results = [];',
  '    for (const cfg of msg.configs) {',
  '      results.push(await globalThis.runS04aProbe("chrome-offscreen-document", Object.assign({}, cfg, { wasmPaths: base })));',
  '    }',
  '    const workerResults = await new Promise((resolve) => {',
  '      const t = setTimeout(() => resolve([{ context: "chrome-offscreen-dedicated-worker", conclusion: "worker timeout", error: { message: "no reply" } }]), 180000);',
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
  '    chrome.runtime.sendMessage({ type: "s04a-offscreen-results", results: results });',
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
  '    results.push(await globalThis.runS04aProbe("chrome-offscreen-dedicated-worker", Object.assign({}, cfg, { wasmPaths: base })));',
  '  }',
  '  self.postMessage(results);',
  '};',
].join("\n"));

fs.writeFileSync(path.join(OUT_CHROME, "background.js"), [
  '// MV3 service worker: drives the offscreen document and reports to the loopback collector.',
  'importScripts("ort.all.min.js", "probe.js");',
  'const BASE = "http://127.0.0.1:8908";',
  '',
  'async function ensureOffscreen() {',
  '  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });',
  '  if (has.length) return;',
  '  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "S-04a real-model lifecycle probe" });',
  '}',
  '',
  'globalThis.__s04a_run = async function (configs) {',
  '  const all = [];',
  '  const base = chrome.runtime.getURL("");',
  '  for (const cfg of configs) {',
  '    all.push(await globalThis.runS04aProbe("chrome-mv3-service-worker", Object.assign({}, cfg, { wasmPaths: base })));',
  '  }',
  '  await ensureOffscreen();',
  '  const off = await new Promise((resolve) => {',
  '    const t = setTimeout(() => resolve([{ context: "chrome-offscreen-document", conclusion: "offscreen timeout", error: { message: "no reply" } }]), 240000);',
  '    chrome.runtime.onMessage.addListener(function h(m) {',
  '      if (m && m.type === "s04a-offscreen-results") { clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.results); }',
  '    });',
  '    chrome.runtime.sendMessage({ type: "s04a-go", configs: configs }).catch(() => {});',
  '  });',
  '  all.push.apply(all, off);',
  '  try {',
  '    await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contexts: all }) });',
  '  } catch (e) {}',
  '  return all;',
  '};',
].join("\n"));

// ---- Firefox MV3: event page ---------------------------------------------------------
fs.writeFileSync(path.join(OUT_FIREFOX, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "PratiBimb S-04a real-model lifecycle probe (Firefox)",
  version: "1.0.0",
  description: "Throwaway spike harness. Creates and runs a real ONNX Runtime Web session in a Firefox MV3 event page.",
  browser_specific_settings: { gecko: { id: "pratibimb-s04a@example.invalid", strict_min_version: "128.0" } },
  background: { scripts: ["ort.all.min.js", "probe.js", "ff-background.js"] },
  // "tabs" is REQUIRED, not a host permission, so Firefox MV3 grants it at install rather
  // than gating it behind user origin controls -- which is what makes tabs.get().url
  // readable and therefore makes per-chunk delivery confirmation possible at all.
  permissions: ["tabs"],
  host_permissions: ["http://127.0.0.1:8908/*"],
  content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'" },
}, null, 2));

fs.writeFileSync(path.join(OUT_FIREFOX, "ff-background.js"), [
  '// Firefox MV3 event page. Reports through a tab beacon as well as fetch, because',
  '// Firefox MV3 gates host_permissions behind user-granted origin controls (S-02a-2).',
  'const api = typeof browser !== "undefined" ? browser : chrome;',
  'const BASE = "http://127.0.0.1:8908";',
  'const CONFIGS = ' + JSON.stringify(CONFIGS) + ';',
  '',
  'function beacon(q) { try { return api.tabs.create({ url: BASE + q, active: false }); } catch (e) { return Promise.resolve(); } }',
  '',
  '// Chunked report delivery. A full-lifecycle report is ~80 KB URL-encoded; a single',
  '// beacon URL that long is rejected somewhere in the chain (it overflowed the Node',
  '// collector request line) and the report was lost with no error anywhere. Chunks are',
  '// sent through ONE reused tab, strictly in order, each confirmed loaded before the',
  '// next -- so a lost chunk fails loudly instead of producing a silent empty result.',
  'let sinkTabId = null;',
  'async function beaconOnce(url, seq) {',
  '  if (sinkTabId === null) { const t = await api.tabs.create({ url: url, active: false }); sinkTabId = t.id; }',
  '  else { await api.tabs.update(sinkTabId, { url: url }); }',
  '  // Confirm the chunk actually loaded. If tab.url is not readable (no "tabs"',
  '  // permission), degrade to a paced send rather than stalling -- the COLLECTOR still',
  '  // verifies completeness, so a dropped chunk is reported, never silently ignored.',
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
  '    try { results.push(await globalThis.runS04aProbe("firefox-mv3-event-page", Object.assign({}, cfg, { wasmPaths: base }))); }',
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
console.log("model bytes:", fs.readFileSync(MODEL).length, "base64 len:", modelB64.length);
