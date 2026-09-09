/**
 * S-02a-2a-3 build step. Assembles throwaway probe extensions from node_modules.
 *
 * Derived from W1-S03's build-extension.js rather than reinvented.
 *
 * THE CRITICAL PACKAGING DECISION, and why:
 *
 *   The Emscripten JS glue (`ort-wasm-simd-threaded.mjs`) IS packaged into the extension.
 *   The WebAssembly artifact (`ort-wasm-simd-threaded.wasm`) is deliberately NOT.
 *
 * The .wasm is served ONLY by an arrival-logged loopback origin. That is what makes the
 * binding provable: if ORT ever loads WebAssembly without our buffer, it MUST fetch, and
 * that fetch MUST appear in the arrival log. If the artifact were also packaged, "zero
 * arrivals" would be ambiguous - it could mean ORT used our bytes, or that it quietly
 * loaded the packaged copy instead. Removing the local copy removes the ambiguity.
 *
 * ORT artifacts are 14-28 MB and are NEVER committed; CI blocks files over 5 MB.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const DIST = path.join(HERE, "node_modules", "onnxruntime-web", "dist");
const SERVE = path.join(HERE, "served");          // what the loopback origin serves
const WASM_FILE = "ort-wasm-simd-threaded.jsep.wasm";
const MJS_FILE = "ort-wasm-simd-threaded.jsep.mjs";

const COLLECTOR = "http://127.0.0.1:8910";
const FOREIGN = "http://127.0.0.1:8911";

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function main() {
  fs.rmSync(SERVE, { recursive: true, force: true });
  fs.mkdirSync(SERVE, { recursive: true });

  // --- the artifact under test -------------------------------------------------
  const wasmSrc = path.join(DIST, WASM_FILE);
  if (!fs.existsSync(wasmSrc)) { console.error("MISSING in dist:", WASM_FILE); process.exit(1); }
  const wasmBytes = fs.readFileSync(wasmSrc);
  const wasmSha = sha256(wasmBytes);
  fs.writeFileSync(path.join(SERVE, WASM_FILE), wasmBytes);

  // A tampered copy for the negative controls. One byte, deep inside the code section,
  // so it is a real corruption rather than a header change ORT might reject early for a
  // different reason.
  const tampered = Buffer.from(wasmBytes);
  const off = Math.floor(tampered.length * 0.6);
  tampered[off] = tampered[off] ^ 0xff;
  fs.writeFileSync(path.join(SERVE, "tampered.wasm"), tampered);

  const manifestPin = {
    ortVersion: require(path.join(HERE, "node_modules", "onnxruntime-web", "package.json")).version,
    artifact: WASM_FILE,
    bytes: wasmBytes.length,
    sha256: wasmSha,
    tamperedSha256: sha256(tampered),
    tamperedByteOffset: off,
    plainArtifact: {
      name: "ort-wasm-simd-threaded.wasm",
      bytes: fs.statSync(path.join(DIST, "ort-wasm-simd-threaded.wasm")).size,
      sha256: sha256(fs.readFileSync(path.join(DIST, "ort-wasm-simd-threaded.wasm"))),
      note: "The NON-jsep artifact. ort.all.min.js does NOT load this one - measured. A " +
            "different ORT bundle would load it, and would need its own pin."
    }
  };
  fs.writeFileSync(path.join(HERE, "pin.json"), JSON.stringify(manifestPin, null, 2));

  const modelB64 = fs.readFileSync(path.join(HERE, "model.b64"), "utf8").trim();
  const probe = fs.readFileSync(path.join(HERE, "ort-probe.js"), "utf8")
    .replace("__MODEL_B64__", modelB64)
    .replace("__PINNED_SHA256__", wasmSha)
    .replace("__WASM_FILE__", WASM_FILE)
    .replace("__MJS_FILE__", MJS_FILE)
    .replace("__COLLECTOR__", COLLECTOR)
    .replace("__FOREIGN__", FOREIGN);

  // ---------------- Chrome MV3 ----------------
  const ch = path.join(HERE, "ext-chrome");
  fs.rmSync(ch, { recursive: true, force: true });
  fs.mkdirSync(ch, { recursive: true });
  for (const f of ["ort.all.min.js", MJS_FILE]) {
    const src = path.join(DIST, f);
    if (!fs.existsSync(src)) { console.error("MISSING in dist:", f); process.exit(1); }
    fs.copyFileSync(src, path.join(ch, f));
  }
  fs.writeFileSync(path.join(ch, "probe.js"), probe);
  fs.writeFileSync(path.join(ch, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "PratiBimb S-02a-2a-3 ORT wasm pin (chrome)",
    version: "1.0.0",
    minimum_chrome_version: "116",
    background: { service_worker: "background.js" },
    permissions: ["offscreen"],
    // BOTH origins permitted, so a block is attributable to connect-src (S-02a-2a-4 control).
    host_permissions: [COLLECTOR + "/*", FOREIGN + "/*"],
    // S-02a-2b-1: 'wasm-unsafe-eval' is the only token Chrome MV3 accepts. THROWAWAY
    // HARNESS ONLY - this is not, and does not become, a production manifest.
    // connect-src pinned to the collector so the foreign-origin negative control is real.
    content_security_policy: {
      extension_pages:
        `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${COLLECTOR}`
    }
  }, null, 2) + "\n");

  fs.writeFileSync(path.join(ch, "offscreen.html"),
    '<!doctype html><meta charset="utf-8"><body>' +
    '<script src="ort.all.min.js"></script><script src="probe.js"></script>' +
    '<script src="offscreen.js"></script></body>');

  fs.writeFileSync(path.join(ch, "offscreen.js"), [
    '// One scenario per FRESH dedicated worker. ORT caches its WebAssembly module per JS',
    '// realm, so reusing a realm would silently measure the first scenario for all of them.',
    'async function runInFreshWorker(scenario) {',
    '  const w = new Worker("worker.js");',
    '  const out = await new Promise((res) => {',
    '    w.onmessage = (e) => res(e.data);',
    '    w.onerror = (e) => res({ scenario, context: "chrome-offscreen-dedicated-worker",',
    '      fatal: { via: "onerror", message: String(e.message || "(empty)"),',
    '               filename: String(e.filename || ""), lineno: e.lineno } });',
    '    w.postMessage({ scenario });',
    '    setTimeout(() => res({ scenario, context: "chrome-offscreen-dedicated-worker",',
    '                           fatal: "timeout" }), 240000);',
    '  });',
    '  w.terminate();',
    '  return out;',
    '}',
    '(async () => {',
    '  const out = [];',
    '  for (const s of globalThis.PIN_SCENARIOS) out.push(await runInFreshWorker(s));',
    '  // The offscreen DOCUMENT realm can host exactly one ORT init, so it runs the one',
    '  // scenario that matters most for context coverage: the binding itself.',
    '  out.push(await globalThis.runPinScenario("s2_pinned_wasmBinary", "chrome-offscreen-document"));',
    '  await fetch("' + COLLECTOR + '/results", { method: "POST",',
    '    headers: { "content-type": "application/json", "x-pratibimb-probe": "report" },',
    '    body: JSON.stringify(out) });',
    '  await fetch("' + COLLECTOR + '/done", { method: "POST", headers: { "x-pratibimb-probe": "done" } });',
    '})();'
  ].join("\n"));

  fs.writeFileSync(path.join(ch, "worker.js"), [
    '// Load ORT defensively and REPORT our own failure. A worker that dies silently is',
    '// indistinguishable from a scenario that failed, and the two must not be confused.',
    'let loadStage = "start";',
    'let loadError = null;',
    'try { importScripts("ort.all.min.js"); loadStage = "ort-loaded";',
    '      importScripts("probe.js");        loadStage = "probe-loaded"; }',
    'catch (e) { loadError = { stage: loadStage, name: String(e && e.name),',
    '                          message: String((e && e.message) || e).slice(0, 300) }; }',
    'self.onmessage = async (e) => {',
    '  const scenario = e.data && e.data.scenario;',
    '  if (!scenario) return;',
    '  if (loadError || typeof globalThis.runPinScenario !== "function") {',
    '    return self.postMessage({ scenario, context: "chrome-offscreen-dedicated-worker",',
    '      fatal: loadError || { stage: loadStage, message: "runPinScenario missing" } });',
    '  }',
    '  try {',
    '    self.postMessage(await globalThis.runPinScenario(scenario, "chrome-offscreen-dedicated-worker"));',
    '  } catch (err) {',
    '    self.postMessage({ scenario, context: "chrome-offscreen-dedicated-worker",',
    '      fatal: { stage: "run", name: String(err && err.name),',
    '               message: String((err && err.message) || err).slice(0, 300) } });',
    '  }',
    '};',
  ].join("\n"));

  fs.writeFileSync(path.join(ch, "background.js"), [
    '// Liveness first: "never ran" and "ran and everything failed" are different results.',
    'async function beacon(stage, detail) {',
    '  try { await fetch("' + COLLECTOR + '/log", { method: "POST",',
    '    headers: { "content-type": "application/json", "x-pratibimb-probe": "log" },',
    '    body: JSON.stringify({ stage, detail, at: new Date().toISOString() }) }); } catch (_) {}',
    '}',
    'let started = false;',
    'async function main() {',
    '  if (started) return; started = true;',
    '  await beacon("alive", { id: chrome.runtime.id });',
    '  if (!(await chrome.offscreen.hasDocument?.())) {',
    '    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"],',
    '      justification: "Host a dedicated worker for local inference (S-02a-2a-3)." });',
    '  }',
    '}',
    'chrome.runtime.onInstalled.addListener(main);',
    'chrome.runtime.onStartup.addListener(main);',
    'main();'
  ].join("\n"));

  // ---------------- Firefox MV3 ----------------
  const ff = path.join(HERE, "ext-firefox");
  fs.rmSync(ff, { recursive: true, force: true });
  fs.mkdirSync(ff, { recursive: true });
  for (const f of ["ort.all.min.js", MJS_FILE]) fs.copyFileSync(path.join(DIST, f), path.join(ff, f));
  fs.writeFileSync(path.join(ff, "probe.js"), probe);
  fs.writeFileSync(path.join(ff, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "PratiBimb S-02a-2a-3 ORT wasm pin (firefox)",
    version: "1.0.0",
    browser_specific_settings: { gecko: { id: "pratibimb-s02a2a3@example.invalid", strict_min_version: "128.0" } },
    background: { scripts: ["ort.all.min.js", "probe.js", "ff-background.js"] },
    permissions: ["tabs"],
    host_permissions: [COLLECTOR + "/*", FOREIGN + "/*"],
    content_security_policy: {
      extension_pages:
        `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' ${COLLECTOR}`
    }
  }, null, 2) + "\n");

  fs.writeFileSync(path.join(ff, "ff-background.js"), [
    'const api = typeof browser !== "undefined" ? browser : chrome;',
    'function beacon(p) { try { return api.tabs.create({ url: "' + COLLECTOR + '" + p, active: false }); }',
    '  catch (e) { return Promise.resolve(); } }',
    '',
    '// One scenario per FRESH dedicated worker, matching the Chrome harness. ORT caches its',
    '// WebAssembly module per JS realm, so a shared realm would silently measure the first',
    '// scenario for all of them.',
    'async function runInFreshWorker(scenario) {',
    '  return await new Promise((res) => {',
    '    let w;',
    '    try { w = new Worker("worker.js"); }',
    '    catch (e) {',
    '      return res({ scenario, context: "firefox-event-page-dedicated-worker",',
    '                   fatal: { stage: "construct", message: String(e && e.message || e).slice(0, 200) } });',
    '    }',
    '    w.onmessage = (e) => { w.terminate(); res(e.data); };',
    '    w.onerror = (e) => res({ scenario, context: "firefox-event-page-dedicated-worker",',
    '                             fatal: { stage: "onerror", message: String(e.message || "(empty)"),',
    '                                      filename: String(e.filename || "") } });',
    '    w.postMessage({ scenario });',
    '    setTimeout(() => res({ scenario, context: "firefox-event-page-dedicated-worker",',
    '                           fatal: { stage: "timeout" } }), 240000);',
    '  });',
    '}',
    '',
    '(async () => {',
    '  await beacon("/log?stage=alive");',
    '  const out = [];',
    '  try {',
    '    for (const s of globalThis.PIN_SCENARIOS) out.push(await runInFreshWorker(s));',
    '    // The event-page realm can host exactly one ORT init, so it runs the scenario that',
    '    // matters most for context coverage: the binding itself.',
    '    out.push(await globalThis.runPinScenario("s2_pinned_wasmBinary", "firefox-mv3-event-page"));',
    '  } catch (e) {',
    '    // Never let the page die silently - an empty report is indistinguishable from',
    '    // "ORT cannot run here", and that would be a fabricated limitation.',
    '    out.push({ context: "firefox-mv3-event-page",',
    '               fatal: { stage: "driver", name: String(e && e.name),',
    '                        message: String(e && e.message || e).slice(0, 300) } });',
    '  }',
    '  try {',
    '    await fetch("' + COLLECTOR + '/results", { method: "POST",',
    '      headers: { "content-type": "application/json", "x-pratibimb-probe": "report" },',
    '      body: JSON.stringify(out) });',
    '  } catch (e) {',
    '    await beacon("/sink?d=" + encodeURIComponent(JSON.stringify(out)));',
    '  }',
    '  await beacon("/done");',
    '})();',
  ].join("\n"));

  fs.writeFileSync(path.join(ff, "worker.js"), [
    'let loadStage = "start";',
    'let loadError = null;',
    'try { importScripts("ort.all.min.js"); loadStage = "ort-loaded";',
    '      importScripts("probe.js");        loadStage = "probe-loaded"; }',
    'catch (e) { loadError = { stage: loadStage, name: String(e && e.name),',
    '                          message: String((e && e.message) || e).slice(0, 300) }; }',
    'self.onmessage = async (e) => {',
    '  const scenario = e.data && e.data.scenario;',
    '  if (!scenario) return;',
    '  if (loadError || typeof globalThis.runPinScenario !== "function") {',
    '    return self.postMessage({ scenario, context: "firefox-event-page-dedicated-worker",',
    '      fatal: loadError || { stage: loadStage, message: "runPinScenario missing" } });',
    '  }',
    '  try {',
    '    self.postMessage(await globalThis.runPinScenario(scenario, "firefox-event-page-dedicated-worker"));',
    '  } catch (err) {',
    '    self.postMessage({ scenario, context: "firefox-event-page-dedicated-worker",',
    '      fatal: { stage: "run", message: String((err && err.message) || err).slice(0, 300) } });',
    '  }',
    '};',
  ].join("\n"));

  console.log("ORT version :", manifestPin.ortVersion);
  console.log("artifact    :", WASM_FILE, manifestPin.bytes, "bytes");
  console.log("sha256      :", wasmSha);
  console.log("tampered    :", manifestPin.tamperedSha256, `(byte ${off} flipped)`);
  console.log("plain wasm  :", manifestPin.plainArtifact.sha256, "<- NOT loaded by ort.all.min.js");
  console.log("");
  console.log("PACKAGED into the extension : ort.all.min.js,", MJS_FILE);
  console.log("NOT packaged (served only)  :", WASM_FILE, "<- this is what makes the binding provable");
}

main();
