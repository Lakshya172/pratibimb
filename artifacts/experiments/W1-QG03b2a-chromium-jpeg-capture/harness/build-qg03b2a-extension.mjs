/**
 * Assemble the QG-03b-2a conformance extension (Chromium only).
 *
 *   node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/build-qg03b2a-extension.mjs
 *
 * Prerequisites:
 *   npm run typecheck                          compiles packages/{perception,security}
 *   node  .../harness/capture-chromium.mjs     captures with the real API
 *   python tools/detector/qg03b2a_fixtures.py  builds the reference from those captures
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CHROMIUM ONLY, ON PURPOSE
 *
 * The question is what Chromium's capture encoder produces and whether Chromium's decoder
 * reads it back conformantly. Firefox has no `captureVisibleTab` output to test — it would
 * be decoding a file another browser wrote, which is a different and later question. No
 * Firefox build is produced here, so no Firefox cell can be accidentally claimed.
 *
 * The blobs are the CAPTURED files, inlined as base64. The decoded reference dumps are
 * fetched from the extension's own origin instead: 40 decoded RGB images is over 100 MB,
 * which as base64 in a JS file would have to be parsed before the probe could start. Same
 * mechanism ADR-0001 already uses for the pinned ORT artifact — no network, no host
 * permission, nothing that could be mistaken for egress.
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
const CAPTURED = join(HERE, "captured");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const OUT = join(HERE, "ext-chrome");
const PORT = 8932;

function must(p, hint) {
  if (!existsSync(p)) {
    console.error(`missing: ${p}\n  ${hint}`);
    process.exit(1);
  }
  return p;
}

must(join(ROOT, "packages/perception/dist/src/index.js"), "run: npm run typecheck");
must(join(ROOT, "packages/security/dist/src/index.js"), "run: npm run typecheck");
must(join(EXP, "fixtures.json"), "run: python tools/detector/qg03b2a_fixtures.py");

const fx = JSON.parse(readFileSync(join(EXP, "fixtures.json"), "utf8"));
const { buildExtensionPagesCsp } = await import(pathToFileURL(join(ROOT, "packages/security/dist/src/index.js")).href);
const CSP = buildExtensionPagesCsp(`http://127.0.0.1:${PORT}`);

const payload = {
  criterion: fx.criterion,
  reference: fx.reference,
  scope: fx.scope,
  capturePhase: fx.capturePhase,
  fixtures: [],
  blobs: {},
  model: null,
};
const refFiles = [];

for (const f of fx.fixtures) {
  const blob = join(CAPTURED, f.file);
  const dec = join(GEN, `${f.source}.${f.encoding}.decoded.u8`);
  const lb = join(GEN, `${f.source}.${f.encoding}.letterboxed.u8`);
  if (!existsSync(blob) || !existsSync(dec) || !existsSync(lb)) {
    console.error(`skipping ${f.source}/${f.encoding}: a required file is missing`);
    continue;
  }
  payload.fixtures.push({
    source: f.source,
    page: f.page,
    category: f.category,
    display: f.display,
    encoding: f.encoding,
    lossless: f.lossless,
    file: f.file,
    mime: f.mime,
    sourceSize: f.sourceSize,
    decodedSize: f.decodedSize,
    decodedMode: f.decodedMode,
    encodedSha256: f.encodedSha256,
    geometry: f.geometry,
    digests: f.digests,
    viewportCss: f.viewportCss,
    captureSize: f.captureSize,
    referenceBoxesThisEncoding: f.referenceBoxesThisEncoding,
    referenceBoxesPng: f.referenceBoxesPng,
    refDecoded: `refs/${f.source}.${f.encoding}.decoded.u8`,
    refLetterboxed: `refs/${f.source}.${f.encoding}.letterboxed.u8`,
  });
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

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "refs"), { recursive: true });
if (payload.model) for (const f of ORT_FILES) copyFileSync(must(join(ORT_DIST, f), "npm install"), join(OUT, f));
cpSync(join(ROOT, "packages/perception/dist/src"), join(OUT, "perception"), { recursive: true });
cpSync(join(ROOT, "packages/security/dist/src"), join(OUT, "security"), { recursive: true });
copyFileSync(join(HERE, "qg03b2a-probe.js"), join(OUT, "qg03b2a-probe.js"));
for (const [src, name] of refFiles) copyFileSync(src, join(OUT, "refs", name));
writeFileSync(
  join(OUT, "qg03b2a-fixtures.js"),
  `// GENERATED by build-qg03b2a-extension.mjs — do not edit.\nglobalThis.QG03B2A_FIXTURES = ${JSON.stringify(payload)};\n`
);
for (const sub of ["perception", "security", "security/generated"]) {
  const d = join(OUT, sub);
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d)) if (f.endsWith(".d.ts")) rmSync(join(d, f));
}

const ortTags = payload.model ? '<script src="ort.all.min.js"></script>' : "";

writeFileSync(
  join(OUT, "manifest.json"),
  JSON.stringify(
    {
      manifest_version: 3,
      name: "PratiBimb QG-03b-2a real-capture conformance (Chrome)",
      version: "1.0.0",
      description: "Throwaway harness. Compares Chromium's decode of its own captureVisibleTab output against the Python reference.",
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
  join(OUT, "offscreen.html"),
  '<!doctype html><html><head><meta charset="utf-8"><title>qg03b2a</title>' +
    ortTags +
    '<script src="qg03b2a-fixtures.js"></script><script src="qg03b2a-probe.js"></script><script src="offscreen.js"></script>' +
    "</head><body></body></html>"
);

writeFileSync(
  join(OUT, "offscreen.js"),
  [
    "chrome.runtime.onMessage.addListener((msg) => {",
    '  if (!msg || msg.type !== "qg03b2a-go") return;',
    "  (async () => {",
    '    const base = chrome.runtime.getURL("");',
    "    let r;",
    "    try {",
    '      r = await globalThis.runQg03b2aProbe("chrome-offscreen-document", Object.assign({ base: base }, msg.config));',
    "    } catch (e) {",
    '      r = { context: "chrome-offscreen-document", conclusion: "probe threw", error: { message: String((e && e.message) || e).slice(0, 400) } };',
    "    }",
    '    chrome.runtime.sendMessage({ type: "qg03b2a-result", result: r });',
    "  })();",
    "});",
  ].join("\n")
);

writeFileSync(
  join(OUT, "background.js"),
  [
    `const BASE = "http://127.0.0.1:${PORT}";`,
    "async function ensureOffscreen() {",
    '  const has = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });',
    "  if (has.length) return;",
    '  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "QG-03b-2a conformance" });',
    "}",
    "globalThis.__qg03b2a_run = async function (config) {",
    "  await ensureOffscreen();",
    "  const r = await new Promise((resolve) => {",
    '    const t = setTimeout(() => resolve({ context: "chrome-offscreen-document", conclusion: "offscreen timeout" }), 900000);',
    "    chrome.runtime.onMessage.addListener(function h(m) {",
    '      if (m && m.type === "qg03b2a-result") { clearTimeout(t); chrome.runtime.onMessage.removeListener(h); resolve(m.result); }',
    "    });",
    '    chrome.runtime.sendMessage({ type: "qg03b2a-go", config: config }).catch(() => {});',
    "  });",
    '  try { await fetch(BASE + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contexts: [r] }) }); } catch (e) {}',
    "  return r;",
    "};",
  ].join("\n")
);

console.log("built ext-chrome");
console.log(`  CSP: ${CSP}`);
console.log(`  fixtures: ${payload.fixtures.length}`);
console.log(`  captured blobs inlined: ${(Object.values(payload.blobs).reduce((n, b) => n + b.length, 0) / 1048576).toFixed(1)} MB base64`);
console.log(`  reference dumps as files: ${refFiles.length}`);
console.log(`  model: ${payload.model ? `${payload.model.bytes} bytes, ${payload.model.revision}` : "ABSENT"}`);
