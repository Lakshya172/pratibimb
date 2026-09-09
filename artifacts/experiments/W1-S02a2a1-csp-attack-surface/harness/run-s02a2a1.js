/**
 * S-02a-2a-1 runner. THROWAWAY SPIKE CODE.
 *
 * Loads each extension variant into a Chromium build that still honours
 * --load-extension (branded Chrome 152 refuses it — see W1-S01), and collects probe
 * results from all three MV3 contexts over loopback.
 *
 * The collector also SERVES the WASM fixture over HTTP, which is how Q2 measures whether
 * network-origin bytes may be compiled. It serves it with Content-Type: application/wasm
 * so that instantiateStreaming is given a fair test rather than failing on MIME type.
 *
 * Loopback only. Synthetic fixtures only. No product code.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const PORT = 8907;
const RUNS = Number(process.env.RUNS || 3);
const PLATFORM = process.env.PLATFORM_LABEL || "unknown";
// Browser selection. Playwright's own CDN download fails on this machine (HTTP-level
// download failure, the same symptom S-01b recorded on workstation 2), so we drive
// browsers that are already installed rather than fetching one.
//   CHANNEL=msedge      -> branded Edge via Playwright channel
//   CHROME_PATH=<exe>   -> an explicit binary (unbranded Chromium build)
const CHANNEL = process.env.CHANNEL || undefined;
const CHROME = process.env.CHROME_PATH || undefined;
const BROWSER_LABEL = process.env.BROWSER_LABEL || CHANNEL || "chromium";
const HERE = __dirname;
const OUT = path.join(HERE, "..");

const VARIANTS = ["ext-default", "ext-wasm-unsafe-eval"];
const EXPECTED = new Set([
  "mv3-service-worker",
  "offscreen-document",
  "offscreen-dedicated-worker"
]);

function startCollector() {
  const results = [];
  const logs = [];
  const wasmPath = path.join(HERE, "fixtures", "add.wasm");
  const wasmBytes = fs.readFileSync(wasmPath);
  let doneResolve;
  const done = new Promise((r) => { doneResolve = r; });

  const server = http.createServer((req, res) => {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    if (req.method === "GET" && req.url.startsWith("/remote.wasm")) {
      // Correct MIME type on purpose: a 400 here would be a harness artefact, not a
      // CSP finding, and would make instantiateStreaming look blocked when it is not.
      res.writeHead(200, { ...cors, "Content-Type": "application/wasm",
                           "Content-Length": wasmBytes.length });
      return res.end(wasmBytes);
    }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.startsWith("/result")) {
        let p;
        try { p = JSON.parse(body); }
        catch (e) { p = { context: "UNPARSEABLE", raw: body.slice(0, 2000) }; }
        results.push(p);
        const q1 = p.q1_attack_surface || {};
        console.log(`    result <- ${p.context}` +
          `  eval=${q1.eval && q1.eval.allowed}` +
          `  newFunction=${q1.newFunction && q1.newFunction.allowed}` +
          `  wasmPackaged=${q1.wasmCompilePackaged && q1.wasmCompilePackaged.allowed}`);
        if (EXPECTED.size === new Set(results.map((r) => r.context)).size) doneResolve();
      } else if (req.url.startsWith("/log")) {
        try { logs.push(JSON.parse(body)); } catch (_) { logs.push({ raw: body }); }
      } else if (req.url.startsWith("/done")) {
        if (new Set(results.map((r) => r.context)).size >= EXPECTED.size) doneResolve();
      }
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  server.listen(PORT, "127.0.0.1");
  return { server, results, logs, done, wasmSha256: crypto.createHash("sha256").update(wasmBytes).digest("hex") };
}

async function runVariant(variant, runIndex) {
  const c = startCollector();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `pratibimb-s02a2a1-${runIndex}-`));
  const extPath = path.join(HERE, variant);
  let ctx;
  const record = { variant, run: runIndex, browser: BROWSER_LABEL,
                   extensionLoaded: null, results: [], logs: [] };

  try {
    ctx = await chromium.launchPersistentContext(profile, {
      // Headful on purpose: the headless *shell* cannot load extensions at all, so a
      // headless run would measure the shell's limitation rather than the CSP.
      headless: false,
      ...(CHANNEL ? { channel: CHANNEL } : {}),
      ...(CHROME ? { executablePath: CHROME } : {}),
      args: [
        `--disable-extensions-except=${extPath}`,
        `--load-extension=${extPath}`,
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });

    // An extension that never registers a service worker is indistinguishable, at the
    // collector, from one whose contexts are all blocked. Detect it explicitly.
    // The service worker often registers BEFORE we attach the listener, in which case
    // waitForEvent never fires and reports extensionLoaded=false for an extension that
    // loaded perfectly. Check the already-registered set first.
    try {
      let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
      record.extensionLoaded = true;
      record.extensionOrigin = new URL(sw.url()).origin;
    } catch (e) {
      record.extensionLoaded = false;
      record.loadError = String(e.message).slice(0, 200);
    }

    if (record.extensionLoaded) {
      await Promise.race([
        c.done,
        new Promise((r) => setTimeout(r, 60000))
      ]);
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    c.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  record.results = c.results;
  record.logs = c.logs;
  record.contextsReporting = [...new Set(c.results.map((r) => r.context))].sort();
  record.wasmFixtureSha256 = c.wasmSha256;
  return record;
}

(async () => {
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    for (const v of VARIANTS) {
      console.log(`\n[run ${i}] ${v}`);
      const rec = await runVariant(v, i);
      console.log(`  loaded=${rec.extensionLoaded} contexts=${rec.contextsReporting.length}`);
      runs.push(rec);
    }
  }
  const outFile = path.join(OUT, "logs", `results-s02a2a1-${PLATFORM}-${BROWSER_LABEL}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    experiment: "W1-S02a-2a-1",
    platform: PLATFORM,
    runs: RUNS,
    variants: VARIANTS,
    browserLabel: BROWSER_LABEL,
    chromeExecutable: CHROME || CHANNEL || "playwright default",
    collectedAt: new Date().toISOString(),
    records: runs
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
})();
