/**
 * QG-03a-B3-1 Chromium runner. One realm and one backend per browser launch.
 *
 *   node .../harness/run-b3-chrome.mjs --realm=document|worker --backend=wasm|webgpu [--headless]
 *
 * REFUSES TO START unless: the extension was built from the current harness files; the model,
 * ORT version and fixture set match; and THIS machine's native reference exists, reports
 * onnxruntime 1.29.0, and matches the fixture tensors (run-b3-native.mjs first).
 *
 * Browser: Playwright's unbranded Chromium (CHROME_PATH overrides). Branded Chrome refuses
 * --load-extension, which would make the extension silently absent (QG-03, S-01); the run aborts
 * if the extension's service worker never appears. One backend per launch, fresh profile in the
 * OS temp directory (S-04a: a second backend in one realm inherits the first one's arena).
 *
 * The run FAILS (exit 1) if any guard in b3-guards.mjs verifyCellLog fails: extension context,
 * realm, ORT version and pin, model identity, backend proof, adapter identity, network, fixture
 * identity, input tensor, output shape, finiteness, determinism, raw dumps. Loopback only.
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  BACKENDS, DETERMINISM_RUNS, EXPERIMENT, MODEL, ORT_VERSION, REALMS,
  cellName, evidenceClassFor, machineInfo, selectPngFixtures, sha256Hex, verifyCellLog, verifyNativeLog,
} from "./b3-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = join(HERE, "..");
const ROOT = join(HERE, "..", "..", "..", "..");
const EXT = join(HERE, "ext-chrome");
const PORT = 8971;
const COLLECTOR = `http://127.0.0.1:${PORT}`;
const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const realm = arg("realm");
const backend = arg("backend");
const headless = process.argv.includes("--headless");
const refuse = (msg, code = 2) => { console.error(`REFUSING: ${msg}`); process.exit(code); };
if (!REALMS.includes(realm) || !BACKENDS.includes(backend)) refuse("usage: --realm=document|worker --backend=wasm|webgpu [--headless]");

const cell = cellName(realm, backend, headless);
const ev = evidenceClassFor(os.hostname());
const LOGDIR = join(EXP, "logs", ev.logDir);
const GENDIR = join(HERE, "generated", ev.logDir);
const fixtures = selectPngFixtures(JSON.parse(readFileSync(join(ROOT, "artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/fixtures.json"), "utf8")));

// ── preconditions ─────────────────────────────────────────────────────────────────────────
const bmPath = join(EXT, "build-manifest.json");
if (!existsSync(bmPath)) refuse("ext-chrome not built (run build-b3-extension.mjs)");
const bm = JSON.parse(readFileSync(bmPath, "utf8"));
if (bm.model.sha256 !== MODEL.sha256 || bm.ortPackageVersion !== ORT_VERSION || bm.fixtures.length !== fixtures.length) refuse("ext-chrome was built for a different model, ORT version or fixture set");
for (const [f, s] of Object.entries(bm.harnessFiles)) if (sha256Hex(readFileSync(join(HERE, f))) !== s) refuse(`ext-chrome is stale: ${f} changed since the build`);
if (bm.collector !== COLLECTOR) refuse(`ext-chrome targets ${bm.collector}, runner listens on ${COLLECTOR}`);

const nativePath = join(LOGDIR, "b3-native-cpu.json");
if (!existsSync(nativePath)) refuse(`no native reference for this machine at ${nativePath} (run run-b3-native.mjs first)`);
const native = JSON.parse(readFileSync(nativePath, "utf8"));
const ng = verifyNativeLog(native, fixtures);
if (!ng.ok) refuse(`native reference rejected: ${ng.failures.slice(0, 3).join("; ")}`);

const CHROME = process.env.CHROME_PATH || chromium.executablePath();
if (!existsSync(CHROME)) refuse(`no Chromium at ${CHROME} (run: npx playwright install chromium)`);
let fileVersion = null;
if (process.platform === "win32") {
  try { fileVersion = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${CHROME.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: "utf8" }).trim(); } catch { /* recorded as null */ }
}

// ── loopback collector ────────────────────────────────────────────────────────────────────
const got = { swReport: null, result: null, dumps: new Map(), stray: [] };
let resolveResult;
const resultArrived = new Promise((r) => { resolveResult = r; });
const server = createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? "/", COLLECTOR);
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    if (req.method === "POST" && url.pathname === "/dump") {
      got.dumps.set(url.searchParams.get("fixture"), { buf: body, claimedSha: url.searchParams.get("sha"), cell: url.searchParams.get("cell") });
    } else if (req.method === "POST" && url.pathname === "/sw-report") {
      try { got.swReport = JSON.parse(body.toString("utf8")); } catch { got.stray.push("unparseable sw-report"); }
    } else if (req.method === "POST" && url.pathname === "/result") {
      try { got.result = JSON.parse(body.toString("utf8")); } catch { got.result = { error: "unparseable result" }; }
      resolveResult();
    } else {
      got.stray.push(`${req.method} ${url.pathname}`);
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

// ── one launch ────────────────────────────────────────────────────────────────────────────
const udd = mkdtempSync(join(os.tmpdir(), "pratibimb-qg03a-b3-"));
const run = { launchError: null, swUrl: null, swReturn: null };
let ctx;
try {
  ctx = await chromium.launchPersistentContext(udd, { headless, executablePath: CHROME, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
  if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 60000 });
  run.swUrl = sw.url();
  const cfg = { realm, backend, cell, runs: DETERMINISM_RUNS, collector: COLLECTOR };
  run.swReturn = await Promise.race([
    sw.evaluate((c) => globalThis.__b3_run(c), cfg),
    new Promise((_, rej) => setTimeout(() => rej(new Error("no result within 900 s")), 900000)),
  ]);
  await Promise.race([resultArrived, new Promise((r) => setTimeout(r, 10000))]);
} catch (e) {
  run.launchError = String((e && e.message) || e).slice(0, 400);
} finally {
  try { await ctx?.close(); } catch { /* disposable profile */ }
  try { rmSync(udd, { recursive: true, force: true }); } catch { /* Windows may hold it briefly */ }
  server.close();
}

// ── record ────────────────────────────────────────────────────────────────────────────────
const r = got.result || {};
const idMatch = /^chrome-extension:\/\/([a-p]{32})\//.exec(run.swUrl || "");
const dir = join(GENDIR, cell);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const row of r.rows || []) {
  const d = got.dumps.get(row.name);
  row.dumpVerified = !!d && d.cell === cell && d.claimedSha === row.outputSha256 && sha256Hex(d.buf) === row.outputSha256;
  if (d) writeFileSync(join(dir, `${row.name}.f32`), d.buf);
}
const log = {
  experiment: EXPERIMENT,
  evidenceClass: ev.evidenceClass,
  cell,
  realm,
  backend,
  headless,
  runAt: new Date().toISOString(),
  machine: machineInfo(),
  browser: { executablePath: CHROME, fileVersion, userAgent: got.swReport?.userAgent ?? null, fullVersionList: got.swReport?.fullVersionList ?? null, launcher: "playwright chromium.launchPersistentContext --load-extension" },
  extension: { id: idMatch ? idMatch[1] : null, serviceWorkerUrl: run.swUrl, offscreenContexts: got.swReport?.offscreenContexts ?? [], reportedId: got.swReport?.extensionId ?? null },
  collectorOrigin: COLLECTOR,
  build: { builtAt: bm.builtAt, csp: bm.csp, ortFiles: bm.ortFiles, harnessFiles: bm.harnessFiles },
  runtime: { ortPackageVersion: bm.ortPackageVersion, ...(r.runtime || {}) },
  model: { path: MODEL.path, sha256Expected: MODEL.sha256, ...(r.model || {}) },
  context: r.context ?? null,
  session: r.session ?? null,
  sessionCreateMs: r.sessionCreateMs ?? null,
  gpu: r.gpu ?? null,
  adapterFromOrt: r.adapterFromOrt ?? null,
  network: r.network ?? null,
  nativeReference: { log: `logs/${ev.logDir}/b3-native-cpu.json`, ortVersion: native.ortVersion },
  fixtures: fixtures.map(({ name, file, encodedSha256, tensorSha256, captureSize, viewportCss, dpr }) => ({ name, file, encodedSha256, tensorSha256, captureSize, viewportCss, dpr })),
  rows: r.rows ?? [],
  collector: { dumpsReceived: got.dumps.size, stray: got.stray },
  error: run.launchError || r.error || (run.swReturn && run.swReturn.error) || (got.result ? null : "no result reached the collector"),
};
if (log.extension.reportedId && log.extension.reportedId !== log.extension.id) log.error = log.error || "service worker reported a different extension id";
log.guard = verifyCellLog(log, fixtures);
mkdirSync(LOGDIR, { recursive: true });
writeFileSync(join(LOGDIR, `b3-${cell}.json`), JSON.stringify(log, null, 1));

const rows = log.rows;
console.log(`${cell} [${ev.evidenceClass}] ${log.browser.userAgent ?? "no user agent"}`);
console.log(`  extension ${log.extension.id ?? "NOT LOADED"}; realm ${log.context?.realmKind ?? "?"} at ${log.context?.href ?? "?"}`);
console.log(`  gpu submits during inference ${log.gpu?.submitsDuringInference ?? "?"} (hook ${log.gpu?.hookInstalled}); adapter ${JSON.stringify(log.gpu?.adapterFromRequestAdapter ?? null)}`);
console.log(`  rows ${rows.length}, errors ${rows.filter((x) => x.error).length}, deterministic ${rows.filter((x) => x.deterministic).length}, dumps verified ${rows.filter((x) => x.dumpVerified).length}, session ${log.sessionCreateMs ?? "?"} ms`);
if (log.error) console.log(`  ERROR ${log.error}`);
console.log(`  guard ${log.guard.ok ? "OK" : "FAILED"}`);
for (const f of log.guard.failures.slice(0, 20)) console.log(`    FAIL ${f}`);
process.exit(log.guard.ok ? 0 : 1);
