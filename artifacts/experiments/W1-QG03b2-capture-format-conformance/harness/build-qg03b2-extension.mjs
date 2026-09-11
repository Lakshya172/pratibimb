/**
 * Assemble the QG-03b-2 capture-format conformance extensions.
 *
 *   node artifacts/experiments/W1-QG03b2-capture-format-conformance/harness/build-qg03b2-extension.mjs
 *
 * Prerequisites:
 *   npm run typecheck                         compiles packages/{perception,security}
 *   python tools/detector/qg03b2_fixtures.py  encodes the fixtures and the Python reference
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE REFERENCE DUMPS ARE FILES AND THE ENCODED IMAGES ARE INLINE
 *
 * The encoded fixtures are small — 45 files, a couple of megabytes — so they are inlined as
 * base64 and the probe performs no fetch to obtain the thing under test.
 *
 * The decoded REFERENCE dumps are not small: a 1152×800 RGB dump is 2.7 MB, and there are
 * 45 of them. Base64 in a JS file would mean ~180 MB of source for the engine to parse
 * before the probe runs. They are written as raw files and fetched from the extension's own
 * origin instead — a same-origin extension read, the same mechanism ADR-0001 uses for the
 * pinned ORT artifact. No network, no host permission, nothing that could be mistaken for
 * egress.
 *
 * The shipped compiled packages go in VERBATIM. No bundler.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const EXP = join(HERE, "..");
const GEN = join(HERE, "generated");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const OUT_CHROME = join(HERE, "ext-chrome");
const OUT_FIREFOX = join(HERE, "ext-firefox");
const PORT = 8916;

function must(p, hint) {
  if (!existsSync(p)) {
    console.error(`missing: ${p}\n  ${hint}`);
    process.exit(1);
  }
  return p;
}

must(join(ROOT, "packages/perception/dist/src/index.js"), "run: npm run typecheck");
must(join(ROOT, "packages/security/dist/src/index.js"), "run: npm run typecheck");
must(join(EXP, "fixtures.json"), "run: python tools/detector/qg03b2_fixtures.py");

const fx = JSON.parse(readFileSync(join(EXP, "fixtures.json"), "utf8"));
const { buildExtensionPagesCsp } = await import(pathToFileURL(join(ROOT, "packages/security/dist/src/index.js")).href);
const CSP = buildExtensionPagesCsp(`http://127.0.0.1:${PORT}`);

// Reference CSS boxes for the real frames, from the QG-03 reference. Optional.
const QG03_REF = join(ROOT, "artifacts/experiments/W1-QG03-t1-detector-runtime/reference-summary.json");
const refBoxes = new Map();
if (existsSync(QG03_REF)) {
  const r = JSON.parse(readFileSync(QG03_REF, "utf8"));
  for (const c of r.cases) if (c.sampleId) refBoxes.set(c.sampleId, c.shippedDecode.cssBoxes);
}

const payload = { criterion: fx.criterion, reference: fx.reference, scope: fx.scope, fixtures: [], blobs: {}, model: null };
const refFiles = [];

for (const f of fx.fixtures) {
  if (f.unavailable) continue;
  const blob = join(GEN, f.file);
  const dec = join(GEN, `${f.source}.${f.encoding}.decoded.u8`);
  const lb = join(GEN, `${f.source}.${f.encoding}.letterboxed.u8`);
  if (!existsSync(blob) || !existsSync(dec) || !existsSync(lb)) continue;

  const entry = {
    source: f.source,
    encoding: f.encoding,
    lossless: f.lossless,
    file: f.file,
    sourceSize: f.sourceSize,
    decodedSize: f.decodedSize,
    decodedMode: f.decodedMode,
    encodedSha256: f.encodedSha256,
    geometry: f.geometry,
    digests: f.digests,
    // Reference dumps are FETCHED, not inlined. Names, not contents.
    refDecoded: `refs/${f.source}.${f.encoding}.decoded.u8`,
    refLetterboxed: `refs/${f.source}.${f.encoding}.letterboxed.u8`,
  };
  if (f.sampleId) {
    entry.sampleId = f.sampleId;
    entry.viewportCss = f.viewportCss;
    entry.captureSize = f.captureSize;
    // CONFORMANCE reference: the Python detections for THIS encoding. Browser against the
    // reference decode of the SAME bytes -- the question QG-03b-2 actually asks.
    if (f.referenceBoxesThisEncoding) entry.referenceBoxesThisEncoding = f.referenceBoxesThisEncoding;
    // COMPRESSION reference: the Python detections for the LOSSLESS frame. Comparing against
    // this measures how much the detector minds being compressed -- a different and
    // separately interesting question. Never used to classify conformance.
    if (refBoxes.has(f.sampleId)) entry.referenceBoxesPng = refBoxes.get(f.sampleId);
  }
  payload.fixtures.push(entry);
  payload.blobs[f.file] = readFileSync(blob).toString("base64");
  refFiles.push([dec, `${f.source}.${f.encoding}.decoded.u8`], [lb, `${f.source}.${f.encoding}.letterboxed.u8`]);
}

const modelPath = join(ROOT, "artifacts/models/t1-ui-head/t1-ui-head.onnx");
const cardPath = join(ROOT, "artifacts/models/t1-ui-head/model-card.json");
if (existsSync(modelPath) && existsSync(cardPath)) {
  const card = JSON.parse(readFileSync(cardPath, "utf8"));
  payload.model = {
    modelId: card.modelId,
    revision: card.revision,
    sha256: card.artifact.sha256,
    bytes: card.artifact.bytes,
    b64: readFileSync(modelPath).toString("base64"),
  };
}

const ORT_FILES = [
  "ort.all.min.js",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

for (const out of [OUT_CHROME, OUT_FIREFOX]) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "refs"), { recursive: true });
  if (payload.model) for (const f of ORT_FILES) copyFileSync(must(join(ORT_DIST, f), "npm install"), join(out, f));
  cpSync(join(ROOT, "packages/perception/dist/src"), join(out, "perception"), { recursive: true });
  cpSync(join(ROOT, "packages/security/dist/src"), join(out, "security"), { recursive: true });
  copyFileSync(join(HERE, "qg03b2-probe.js"), join(out, "qg03b2-probe.js"));
  for (const [src, name] of refFiles) copyFileSync(src, join(out, "refs", name));
  writeFileSync(
    join(out, "qg03b2-fixtures.js"),
    `// GENERATED by build-qg03b2-extension.mjs — do not edit.\nglobalThis.QG03B2_FIXTURES = ${JSON.stringify(payload)};\n`
  );
  for (const sub of ["perception", "security", "security/generated"]) {
    const d = join(out, sub);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.endsWith(".d.ts")) rmSync(join(d, f));
  }
}

const ortTags = payload.model ? '<script src="ort.all.min.js"></script>' : "";

writeFileSync(
  join(OUT_CHROME, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: 3,
      name: "PratiBimb QG-03b-2 capture-format conformance (Chrome)",
      version: "1.0.0",
      description: "Throwaway harness. Compares browser JPEG/WebP decoding and preprocessing against the Python reference.",
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
  '<!doctype html><html><head><meta charset="utf-8"><title>qg03b2</title>' +
    ortTags +
    '<script src="qg03b2-fixtures.js"></script><script src="qg03b2-probe.js"></script><script src="offscreen.js"></script>' +
    "</head><body></body></html>"
);

writeFileSync(
  join(OUT_CHROME, "offscreen.js"),
  [
    'chrome.runtime.onMessage.addListener((msg) => {',
    '  if (!msg || msg.type !== "qg03b2-go") return;',
    "  (async () => {",
    '    const base = chrome.runtime.getURL("");',
    "    let r;",
    "    try {",
    '      r = await globalThis.runQg03b2Probe("chrome-offscreen-document", Object.assign({ base: base }, msg.config));',
    "    } catch (e) {",
    '      r = { context: "chrome-offscreen-document", conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 400) } };',
    "    }",
    '    chrome.runtime.sendMessage({ type: "qg03b2-result", result: r });',
    "  })();",
    "});",
  ].join("\n")
);

writeFileSync(
  join(OUT_CHROME, "background.js"),
  [
    `const BASE = "http://127.0.0.1:${PORT}";`,
    "async function ensureOffscreen() {",
    '  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });',
    "  if (has.length) return;",
    '  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "QG-03b-2 conformance" });',
    "}",
    "globalThis.__qg03b2_run = async function (config) {",
    "  await ensureOffscreen();",
    "  const r = await new Promise((resolve) => {",
    '    const t = setTimeout(() => resolve({ context: "chrome-offscreen-document", conclusion: "offscreen timeout" }), 600000);',
    "    chrome.runtime.onMessage.addListener(function h(m) {",
    '      if (m && m.type === "qg03b2-result") { clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.result); }',
    "    });",
    '    chrome.runtime.sendMessage({ type: "qg03b2-go", config: config }).catch(() => {});',
    "  });",
    '  try { await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contexts: [r] }) }); } catch (e) {}',
    "  return r;",
    "};",
  ].join("\n")
);

writeFileSync(
  join(OUT_FIREFOX, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: 3,
      name: "PratiBimb QG-03b-2 capture-format conformance (Firefox)",
      version: "1.0.0",
      description: "Throwaway harness. Compares browser JPEG/WebP decoding and preprocessing against the Python reference.",
      browser_specific_settings: { gecko: { id: "pratibimb-qg03b2@example.invalid", strict_min_version: "128.0" } },
      background: {
        scripts: [...(payload.model ? ["ort.all.min.js"] : []), "qg03b2-fixtures.js", "qg03b2-probe.js", "ff-background.js"],
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
    'const api = typeof browser !== "undefined" ? browser : chrome;',
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
    '  const id = "qg03b2-" + Date.now();',
    '  for (let i = 0; i < n; i++) await beacon("/chunk?id=" + id + "&i=" + i + "&n=" + n + "&d=" + enc.slice(i * CH, (i + 1) * CH));',
    "}",
    "(async () => {",
    '  await beacon("/alive?stage=start");',
    '  const base = api.runtime.getURL("");',
    "  let r;",
    "  try {",
    '    r = await globalThis.runQg03b2Probe("firefox-mv3-event-page", Object.assign({ base: base }, CONFIG));',
    "  } catch (e) {",
    '    r = { context: "firefox-mv3-event-page", conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 400) } };',
    "  }",
    "  await deliver({ contexts: [r] });",
    "})();",
  ].join("\n")
);

// Firefox MV3 needs web_accessible_resources for nothing here (same-origin extension pages
// read their own files freely), but the refs directory must exist in both builds.
console.log("built ext-chrome and ext-firefox");
console.log(`  CSP: ${CSP}`);
console.log(`  fixtures: ${payload.fixtures.length} (${payload.fixtures.filter((f) => f.referenceBoxes).length} with reference boxes)`);
console.log(`  encoded blobs inlined: ${(Object.values(payload.blobs).reduce((n, b) => n + b.length, 0) / 1048576).toFixed(1)} MB base64`);
console.log(`  reference dumps as files: ${refFiles.length}`);
console.log(`  model: ${payload.model ? `${payload.model.bytes} bytes, ${payload.model.revision}` : "ABSENT"}`);
