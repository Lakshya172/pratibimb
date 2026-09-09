/**
 * S-02a-2a-4 runner. THROWAWAY SPIKE CODE.
 *
 * TWO independent origins, each with its own ARRIVAL LOG:
 *   ALLOWED  127.0.0.1:8907  collector + /allowed.wasm   (in connect-src for both variants)
 *   FOREIGN  127.0.0.1:8908  /foreign.wasm               (in connect-src for NEITHER variant)
 *
 * Different ports are different origins, so `connect-src ... http://127.0.0.1:8907` permits
 * the first and not the second while host_permissions permits BOTH. Any difference is
 * therefore attributable to connect-src rather than to host permissions.
 *
 * GROUND TRUTH (B-02 discipline): the foreign server's arrival log is authoritative.
 *   - Probe says blocked AND server logged 0 arrivals  -> genuinely blocked before the wire
 *   - Probe says blocked BUT server logged an arrival  -> NOT a provenance control. The
 *     bytes left the machine. This is the false-green case and it is asserted against.
 *   - `ext-unpinned` is the POSITIVE CONTROL: it proves the foreign server can record
 *     arrivals at all. Without it, "zero arrivals" could just mean the detector is broken.
 *
 * Both servers serve BYTE-IDENTICAL WASM, so origin is the only variable.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const ALLOWED_PORT = 8907;
const FOREIGN_PORT = 8908;
const RUNS = Number(process.env.RUNS || 3);
const PLATFORM = process.env.PLATFORM_LABEL || "unknown";
const CHANNEL = process.env.CHANNEL || undefined;
const CHROME = process.env.CHROME_PATH || undefined;
const BROWSER_LABEL = process.env.BROWSER_LABEL || CHANNEL || "chromium";
const HERE = __dirname;
const OUT = path.join(HERE, "..");

const VARIANTS = ["ext-pinned", "ext-unpinned"];
const EXPECTED = ["mv3-service-worker", "offscreen-document", "offscreen-dedicated-worker"];

const WASM = fs.readFileSync(path.join(HERE, "fixtures", "add.wasm"));
const WASM_SHA = crypto.createHash("sha256").update(WASM).digest("hex");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-pratibimb-probe");
}

/** The foreign origin. Serves byte-identical WASM and logs EVERY arrival. */
function startForeign() {
  const arrivals = [];
  const server = http.createServer((req, res) => {
    arrivals.push({
      at: new Date().toISOString(),
      method: req.method,
      url: req.url,
      probeTag: req.headers["x-pratibimb-probe"] || null,
      origin: req.headers["origin"] || null,
      sec_fetch_mode: req.headers["sec-fetch-mode"] || null
    });
    cors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.url.startsWith("/foreign.wasm")) {
      res.writeHead(200, { "Content-Type": "application/wasm", "Content-Length": WASM.length });
      return res.end(WASM);
    }
    res.writeHead(404); res.end();
  });
  server.listen(FOREIGN_PORT, "127.0.0.1");
  return { server, arrivals };
}

/** The allowed origin. Collector + byte-identical WASM. Also logs arrivals. */
function startAllowed() {
  const results = [], logs = [], arrivals = [];
  let doneResolve;
  const done = new Promise((r) => { doneResolve = r; });
  const server = http.createServer((req, res) => {
    arrivals.push({ at: new Date().toISOString(), method: req.method, url: req.url,
                    probeTag: req.headers["x-pratibimb-probe"] || null });
    cors(res);
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.url.startsWith("/allowed.wasm")) {
      res.writeHead(200, { "Content-Type": "application/wasm", "Content-Length": WASM.length });
      return res.end(WASM);
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.startsWith("/result")) {
        let p; try { p = JSON.parse(body); } catch (e) { p = { context: "UNPARSEABLE", raw: body.slice(0, 1000) }; }
        results.push(p);
        const a = p.a_allowedOrigin || {}, b = p.b_foreignOrigin || {};
        console.log(`    ${String(p.context).padEnd(28)}` +
          ` allowed[net=${a.networkRetrieval && a.networkRetrieval.resolved} inst=${a.instantiation && a.instantiation.computedValue}]` +
          ` foreign[net=${b.networkRetrieval && b.networkRetrieval.resolved}]`);
        if (new Set(results.map((r) => r.context)).size >= EXPECTED.length) doneResolve();
      } else if (req.url.startsWith("/log")) {
        try { logs.push(JSON.parse(body)); } catch (_) { logs.push({ raw: body }); }
      } else if (req.url.startsWith("/done")) {
        if (new Set(results.map((r) => r.context)).size >= EXPECTED.length) doneResolve();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  server.listen(ALLOWED_PORT, "127.0.0.1");
  return { server, results, logs, arrivals, done };
}

async function runVariant(variant, runIndex) {
  const allowed = startAllowed();
  const foreign = startForeign();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `pratibimb-s02a2a4-${runIndex}-`));
  const extPath = path.join(HERE, variant);
  const rec = { variant, run: runIndex, browser: BROWSER_LABEL, extensionLoaded: null };
  let ctx;

  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false, // the headless shell cannot load extensions at all
      ...(CHANNEL ? { channel: CHANNEL } : {}),
      ...(CHROME ? { executablePath: CHROME } : {}),
      args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`,
             "--no-first-run", "--no-default-browser-check"]
    });
    try {
      let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
      rec.extensionLoaded = true;
      rec.extensionOrigin = new URL(sw.url()).origin;
    } catch (e) {
      rec.extensionLoaded = false;
      rec.loadError = String(e.message).slice(0, 200);
    }
    if (rec.extensionLoaded) {
      await Promise.race([allowed.done, new Promise((r) => setTimeout(r, 60000))]);
      // Grace period: a request that leaves late still counts as an arrival. Closing the
      // servers immediately would manufacture a clean "zero arrivals" result.
      await new Promise((r) => setTimeout(r, 2500));
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    allowed.server.close(); foreign.server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  rec.results = allowed.results;
  rec.logs = allowed.logs;
  rec.aliveBeacon = allowed.logs.some((l) => l.stage === "alive");
  rec.contextsReporting = [...new Set(allowed.results.map((r) => r.context))].sort();

  // --- GROUND TRUTH ---------------------------------------------------------
  rec.groundTruth = {
    allowedOriginArrivals: allowed.arrivals.length,
    allowedWasmArrivals: allowed.arrivals.filter((a) => a.url.startsWith("/allowed.wasm")).length,
    foreignOriginArrivals: foreign.arrivals.length,
    foreignWasmArrivals: foreign.arrivals.filter((a) => a.url.startsWith("/foreign.wasm")).length,
    foreignArrivalDetail: foreign.arrivals
  };

  // Cross-check the probe's self-report against what the far end actually saw.
  const probeSaysForeignBlocked = rec.results.length > 0 && rec.results.every(
    (r) => r.b_foreignOrigin && r.b_foreignOrigin.networkRetrieval &&
           r.b_foreignOrigin.networkRetrieval.resolved === false);
  rec.crossCheck = {
    probeSaysForeignBlockedInEveryContext: probeSaysForeignBlocked,
    foreignServerSawRequests: foreign.arrivals.length > 0,
    verdict:
      rec.results.length === 0 ? "NO_RESULTS - cannot conclude"
      : probeSaysForeignBlocked && foreign.arrivals.length === 0
        ? "CONSISTENT_BLOCKED - refused before the wire"
      : probeSaysForeignBlocked && foreign.arrivals.length > 0
        ? "FALSE_GREEN - probe reported blocked but bytes reached the far end"
      : !probeSaysForeignBlocked && foreign.arrivals.length > 0
        ? "CONSISTENT_ALLOWED - request reached the far end, as reported"
        : "ANOMALY - probe reported success but nothing arrived"
  };
  return rec;
}

(async () => {
  console.log(`fixture sha256 ${WASM_SHA} (${WASM.length} bytes), served byte-identical by BOTH origins`);
  const runs = [];
  for (let i = 1; i <= RUNS; i++) {
    for (const v of VARIANTS) {
      console.log(`\n[run ${i}] ${v}`);
      const r = await runVariant(v, i);
      console.log(`  loaded=${r.extensionLoaded} alive=${r.aliveBeacon}` +
                  ` contexts=${r.contextsReporting.length}` +
                  ` | foreign arrivals=${r.groundTruth.foreignOriginArrivals}` +
                  ` | ${r.crossCheck.verdict}`);
      runs.push(r);
    }
  }
  const outFile = path.join(OUT, "logs", `results-s02a2a4-${PLATFORM}-${BROWSER_LABEL}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    experiment: "W1-S02a-2a-4", platform: PLATFORM, browserLabel: BROWSER_LABEL,
    chromeExecutable: CHROME || CHANNEL || "playwright default",
    allowedOrigin: `http://127.0.0.1:${ALLOWED_PORT}`,
    foreignOrigin: `http://127.0.0.1:${FOREIGN_PORT}`,
    wasmSha256: WASM_SHA, runs: RUNS, variants: VARIANTS,
    collectedAt: new Date().toISOString(), records: runs
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
})();
