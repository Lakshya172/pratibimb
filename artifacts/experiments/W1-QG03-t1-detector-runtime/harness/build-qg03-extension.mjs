/**
 * Assemble the throwaway QG-03 probe extensions.
 *
 *   node artifacts/experiments/W1-QG03-t1-detector-runtime/harness/build-qg03-extension.mjs
 *
 * Prerequisites, both of which this script REFUSES to work around:
 *   npm run typecheck                       compiles packages/{perception,security} to dist/
 *   python tools/detector/qg03_reference.py generates the artifact + reference fixtures
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHAT IS COPIED, AND WHY IT IS COPIED RATHER THAN REBUILT
 *
 * The compiled `dist/` output of @pratibimb/perception and @pratibimb/security goes in
 * VERBATIM — no bundler, no transform, no shim. Those packages compile to plain ES modules
 * with only relative imports (guarded by their own tests), so a browser can load them as
 * they are. Anything that reshaped them would mean the browser was executing something the
 * project does not ship, and the whole gate is about what the shipped code does.
 *
 * The detector weights are INLINED AS BASE64 rather than packaged as a web-accessible
 * resource. Packaging would be fine on its own terms — it is a same-origin extension read,
 * not egress — but inlining makes "no runtime model download" observable at the strongest
 * possible setting: the network log should contain the ORT artifact and NOTHING ELSE.
 *
 * Nothing here is product code and no manifest here is a product manifest. The CSP below
 * is ADR-0001's approved string, used because ORT cannot compile WebAssembly without it
 * (measured, S-02a-2b) — it is built by the shipped buildExtensionPagesCsp so a harness
 * cannot quietly diverge from the approved policy. connect-src is pinned to the loopback
 * collector, which is the harness's only legitimate destination — so a probe that tried to
 * reach anywhere else would be blocked at the network layer, not merely logged.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const GEN = join(HERE, "generated");
const EXP = join(HERE, "..");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const OUT_CHROME = join(HERE, "ext-chrome");
const OUT_FIREFOX = join(HERE, "ext-firefox");
const PORT = 8912;

function must(path, hint) {
  if (!existsSync(path)) {
    console.error(`missing: ${path}\n  ${hint}`);
    process.exit(1);
  }
  return path;
}

must(join(ROOT, "packages/perception/dist/src/index.js"), "run: npm run typecheck");
must(join(ROOT, "packages/security/dist/src/index.js"), "run: npm run typecheck");
must(join(EXP, "reference-summary.json"), "run: python tools/detector/qg03_reference.py");
must(ORT_DIST, "run: npm install");

const reference = JSON.parse(readFileSync(join(EXP, "reference-summary.json"), "utf8"));

// The CSP is not hand-written here. It is produced by the SHIPPED builder, so this harness
// cannot run under a policy the product would reject.
const { buildExtensionPagesCsp } = await import(
  pathToFileURL(join(ROOT, "packages/security/dist/src/index.js")).href
);
const CSP = buildExtensionPagesCsp(`http://127.0.0.1:${PORT}`);

// ORT 1.29.0 `ort.all.min.js` carries both backends. The .wasm it actually loads is the
// jsep one — measured in S-02a-2a-3, and that measurement is what ORT_PIN encodes.
const ORT_FILES = [
  "ort.all.min.js",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

// ---- fixtures ------------------------------------------------------------------------
const modelPath = must(
  join(ROOT, "artifacts", "models", "t1-ui-head", "t1-ui-head.onnx"),
  "run: python tools/detector/train.py"
);
const modelBytes = readFileSync(modelPath);

const fixtures = {
  model: {
    modelId: reference.artifact.modelId,
    revision: reference.artifact.revision,
    sha256: reference.artifact.sha256,
    bytes: reference.artifact.bytes,
    b64: modelBytes.toString("base64"),
  },
  reference: {
    criterion: reference.criterion,
    cases: reference.cases.map((c) => ({
      name: c.name,
      kind: c.kind,
      inputSha256: c.inputSha256,
      outputShape: c.outputShape,
      outputSha256: c.outputSha256,
      geometry: c.geometry,
      shippedDecode: c.shippedDecode,
      sampleId: c.sampleId ?? null,
    })),
  },
  expected: {},
  letterboxed: {},
  png: {},
};

for (const c of reference.cases) {
  fixtures.expected[c.name] = readFileSync(must(join(GEN, `expected-${c.name}.f32`), "regenerate the reference")).toString("base64");
  if (c.sampleId) {
    fixtures.letterboxed[c.name] = readFileSync(join(GEN, `letterboxed-${c.sampleId}.u8`)).toString("base64");
    fixtures.png[c.name] = readFileSync(join(GEN, `frame-${c.sampleId}.png`)).toString("base64");
  }
}

const fixturesJs = `// GENERATED by build-qg03-extension.mjs — do not edit.
globalThis.QG03_FIXTURES = ${JSON.stringify(fixtures)};
`;

// ---- assemble both extensions --------------------------------------------------------
for (const out of [OUT_CHROME, OUT_FIREFOX]) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of ORT_FILES) copyFileSync(must(join(ORT_DIST, f), "npm install onnxruntime-web"), join(out, f));
  cpSync(join(ROOT, "packages/perception/dist/src"), join(out, "perception"), { recursive: true });
  cpSync(join(ROOT, "packages/security/dist/src"), join(out, "security"), { recursive: true });
  copyFileSync(join(HERE, "qg03-instrument.js"), join(out, "qg03-instrument.js"));
  copyFileSync(join(HERE, "qg03-probe.js"), join(out, "qg03-probe.js"));
  writeFileSync(join(out, "qg03-fixtures.js"), fixturesJs);
}

// The declaration files are 40% of the copied bytes and mean nothing to a browser.
for (const out of [OUT_CHROME, OUT_FIREFOX]) {
  for (const sub of ["perception", "security", "security/generated"]) {
    const d = join(out, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".d.ts")) rmSync(join(d, f));
  }
}

// ---- Chrome MV3: service worker -> offscreen document -------------------------------
// ORT cannot run in an MV3 service worker at all: it loads its WASM glue with a dynamic
// import(), which the HTML specification forbids there. That is a SPEC-level result from
// S-03, not a configuration problem, and it is why the offscreen document exists.
writeFileSync(
  join(OUT_CHROME, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: 3,
      name: "PratiBimb QG-03 T1 detector runtime probe (Chrome)",
      version: "1.0.0",
      description:
        "Throwaway QG-03 harness. Runs the real trained T1 UIElementDetector ONNX artifact through ADR-0001's pinned ORT path.",
      minimum_chrome_version: "116",
      background: { service_worker: "background.js" },
      permissions: ["offscreen"],
      host_permissions: [`http://127.0.0.1:${PORT}/*`],
      content_security_policy: { extension_pages: CSP },
    },
    null,
    2
  )
);

writeFileSync(
  join(OUT_CHROME, "offscreen.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>qg03 offscreen</title>' +
    // ORDER IS LOAD-BEARING: instrumentation wraps WebAssembly.Memory and GPUQueue.submit,
    // and anything ORT allocates before those wrappers exist is invisible to the report.
    '<script src="qg03-instrument.js"></script>' +
    '<script src="ort.all.min.js"></script>' +
    '<script src="qg03-fixtures.js"></script>' +
    '<script src="qg03-probe.js"></script>' +
    '<script src="offscreen.js"></script>' +
    "</head><body></body></html>"
);

writeFileSync(
  join(OUT_CHROME, "offscreen.js"),
  [
    "chrome.runtime.onMessage.addListener((msg) => {",
    '  if (!msg || msg.type !== "qg03-go") return;',
    "  (async () => {",
    '    const base = chrome.runtime.getURL("");',
    "    let r;",
    "    try {",
    '      r = await globalThis.runQg03Probe("chrome-offscreen-document", Object.assign({ base: base }, msg.config));',
    "    } catch (e) {",
    '      r = { context: "chrome-offscreen-document", conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 400) } };',
    "    }",
    '    chrome.runtime.sendMessage({ type: "qg03-offscreen-result", result: r });',
    "  })();",
    "});",
  ].join("\n")
);

writeFileSync(
  join(OUT_CHROME, "background.js"),
  [
    "// MV3 service worker. Drives the offscreen document; it does NOT run ORT itself.",
    `const BASE = "http://127.0.0.1:${PORT}";`,
    "async function ensureOffscreen() {",
    '  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });',
    "  if (has.length) return;",
    '  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "QG-03 detector runtime probe" });',
    "}",
    "globalThis.__qg03_run = async function (config) {",
    "  await ensureOffscreen();",
    "  const r = await new Promise((resolve) => {",
    '    const t = setTimeout(() => resolve({ context: "chrome-offscreen-document", conclusion: "offscreen timeout", error: { message: "no reply" } }), 300000);',
    "    chrome.runtime.onMessage.addListener(function h(m) {",
    '      if (m && m.type === "qg03-offscreen-result") { clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.result); }',
    "    });",
    '    chrome.runtime.sendMessage({ type: "qg03-go", config: config }).catch(() => {});',
    "  });",
    "  try { await fetch(BASE + \"/result\", { method: \"POST\", headers: { \"content-type\": \"application/json\" }, body: JSON.stringify({ contexts: [r] }) }); } catch (e) {}",
    "  return r;",
    "};",
  ].join("\n")
);

// ---- Firefox MV3: event page ---------------------------------------------------------
// Firefox's MV3 background is a document with a DOM, so ORT runs there directly — no
// offscreen equivalent is needed, and none is invented.
writeFileSync(
  join(OUT_FIREFOX, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: 3,
      name: "PratiBimb QG-03 T1 detector runtime probe (Firefox)",
      version: "1.0.0",
      description:
        "Throwaway QG-03 harness. Runs the real trained T1 UIElementDetector ONNX artifact through ADR-0001's pinned ORT path.",
      browser_specific_settings: { gecko: { id: "pratibimb-qg03@example.invalid", strict_min_version: "128.0" } },
      background: {
        scripts: ["qg03-instrument.js", "ort.all.min.js", "qg03-fixtures.js", "qg03-probe.js", "ff-background.js"],
      },
      permissions: ["tabs"],
      host_permissions: [`http://127.0.0.1:${PORT}/*`],
      content_security_policy: { extension_pages: CSP },
    },
    null,
    2
  )
);

writeFileSync(
  join(OUT_FIREFOX, "ff-background.js"),
  [
    "// Firefox MV3 event page. Reports over fetch, and falls back to chunked tab beacons",
    "// because Firefox MV3 gates host_permissions behind user-granted origin controls",
    "// (measured, S-02a-2). A report that cannot be delivered looks exactly like a crash.",
    "const api = typeof browser !== \"undefined\" ? browser : chrome;",
    `const BASE = "http://127.0.0.1:${PORT}";`,
    "const CONFIG = __CONFIG__;",
    "function beacon(q) { try { return api.tabs.create({ url: BASE + q, active: false }); } catch (e) { return Promise.resolve(); } }",
    "async function deliver(payload) {",
    "  const body = JSON.stringify(payload);",
    "  try {",
    '    const res = await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: body });',
    "    if (res && res.ok) return;",
    "  } catch (e) {}",
    "  const enc = encodeURIComponent(body);",
    "  const CH = 6000;",
    "  const n = Math.ceil(enc.length / CH);",
    '  const id = "qg03-" + Date.now();',
    "  for (let i = 0; i < n; i++) {",
    '    await beacon("/chunk?id=" + id + "&i=" + i + "&n=" + n + "&d=" + enc.slice(i * CH, (i + 1) * CH));',
    "  }",
    "}",
    "(async () => {",
    '  await beacon("/alive?stage=start");',
    '  const base = api.runtime.getURL("");',
    "  let r;",
    "  try {",
    '    r = await globalThis.runQg03Probe("firefox-mv3-event-page", Object.assign({ base: base }, CONFIG));',
    "  } catch (e) {",
    '    r = { context: "firefox-mv3-event-page", requestedBackend: CONFIG.backend, conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 400) } };',
    "  }",
    "  await deliver({ contexts: [r] });",
    "})();",
  ].join("\n")
);

const bytes = (p) => readdirSync(p, { withFileTypes: true }).reduce((n, e) => {
  const full = join(p, e.name);
  return n + (e.isDirectory() ? bytes(full) : readFileSync(full).length);
}, 0);

console.log("built ext-chrome and ext-firefox");
console.log(`  CSP (from the shipped builder): ${CSP}`);
console.log(`  model inlined: ${modelBytes.length} bytes, sha256 ${reference.artifact.sha256.slice(0, 16)}…`);
console.log(`  reference cases: ${reference.cases.map((c) => c.name).join(", ")}`);
console.log(`  ext-chrome ${(bytes(OUT_CHROME) / 1048576).toFixed(1)} MB`);
