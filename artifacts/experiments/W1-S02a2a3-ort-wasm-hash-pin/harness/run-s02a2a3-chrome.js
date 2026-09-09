/**
 * S-02a-2a-3 Chrome runner. THROWAWAY SPIKE CODE.
 *
 * TWO arrival-logged origins:
 *   COLLECTOR 127.0.0.1:8910  serves the .wasm + tampered.wasm, receives results
 *   FOREIGN   127.0.0.1:8911  serves the same .wasm; NOT in connect-src
 *
 * Every request is logged with its `x-pratibimb-probe` header. OUR fetches carry that
 * header; ORT's do not. So an UNTAGGED artifact request is, by construction, ORT's — and
 * that is the ground truth for "did ORT fetch WebAssembly on its own?".
 *
 * The .wasm is NOT packaged in the extension, so ORT has no local copy to fall back to.
 * That is what turns "zero untagged arrivals" into a real binding rather than an absence
 * of evidence.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const COLLECTOR_PORT = 8910;
const FOREIGN_PORT = 8911;
const RUNS = Number(process.env.RUNS || 2);
const CHANNEL = process.env.CHANNEL || undefined;
const CHROME = process.env.CHROME_PATH || undefined;
const BROWSER_LABEL = process.env.BROWSER_LABEL || CHANNEL || "chromium";
const PLATFORM = process.env.PLATFORM_LABEL || "windows-ws1";
const HERE = __dirname;
const OUT = path.join(HERE, "..");
const SERVE = path.join(HERE, "served");

function serveFile(res, file, cors) {
  const p = path.join(SERVE, file);
  if (!fs.existsSync(p)) { res.writeHead(404, cors); return res.end("not found"); }
  const b = fs.readFileSync(p);
  res.writeHead(200, { ...cors, "Content-Type": "application/wasm", "Content-Length": b.length });
  res.end(b);
}

function makeServer(port, label, state) {
  const cors = { "Access-Control-Allow-Origin": "*",
                 "Access-Control-Allow-Headers": "content-type, x-pratibimb-probe" };
  const server = http.createServer((req, res) => {
    const tag = req.headers["x-pratibimb-probe"] || null;
    const url = req.url.split("?")[0];
    state.arrivals.push({ origin: label, at: new Date().toISOString(),
                          method: req.method, url, probeTag: tag,
                          isOurs: tag !== null });
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    if (url.endsWith(".wasm")) return serveFile(res, path.basename(url), cors);

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url === "/results") {
        try { state.results.push(...JSON.parse(body)); }
        catch (e) { state.results.push({ context: "PARSE_ERROR", raw: body.slice(0, 500) }); }
        state.resultsSeen = true;
      } else if (url === "/log") {
        try { state.logs.push(JSON.parse(body)); } catch (_) { state.logs.push({ raw: body }); }
      } else if (url === "/done") {
        state.done = true;
      }
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function oneRun(runIndex) {
  const state = { arrivals: [], results: [], logs: [], done: false, resultsSeen: false };
  const s1 = makeServer(COLLECTOR_PORT, "collector", state);
  const s2 = makeServer(FOREIGN_PORT, "foreign", state);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `pratibimb-s02a2a3-${runIndex}-`));
  const ext = path.join(HERE, "ext-chrome");
  const rec = { run: runIndex, browser: BROWSER_LABEL, extensionLoaded: null };
  let ctx;

  try {
    ctx = await chromium.launchPersistentContext(profile, {
      headless: false,
      ...(CHANNEL ? { channel: CHANNEL } : {}),
      ...(CHROME ? { executablePath: CHROME } : {}),
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
             "--no-first-run", "--no-default-browser-check"]
    });
    try {
      let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
      if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
      rec.extensionLoaded = true;
    } catch (e) {
      rec.extensionLoaded = false; rec.loadError = String(e.message).slice(0, 200);
    }
    if (rec.extensionLoaded) {
      const deadline = Date.now() + 300000;   // ORT sessions over a 14 MB artifact are slow
      while (Date.now() < deadline && !state.done) await new Promise((r) => setTimeout(r, 500));
      await new Promise((r) => setTimeout(r, 3000));   // grace: a late fetch still counts
    }
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    s1.close(); s2.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }

  rec.aliveBeacon = state.logs.some((l) => l.stage === "alive");
  rec.results = state.results;
  rec.contexts = [...new Set(state.results.map((r) => r.context))].sort();

  const wasmArrivals = state.arrivals.filter((a) => a.url.endsWith(".wasm"));
  rec.groundTruth = {
    totalArrivals: state.arrivals.length,
    wasmArrivals: wasmArrivals.length,
    wasmArrivals_ours: wasmArrivals.filter((a) => a.isOurs).length,
    wasmArrivals_ORT: wasmArrivals.filter((a) => !a.isOurs).length,
    foreignOriginArrivals: state.arrivals.filter((a) => a.origin === "foreign").length,
    untaggedDetail: wasmArrivals.filter((a) => !a.isOurs)
      .map((a) => ({ origin: a.origin, url: a.url, method: a.method, at: a.at })),
    // A CORS preflight carries no custom header, so the header rule counts it as ORT's.
    // Separating by METHOD is what distinguishes a real ORT GET from a preflight of our
    // own tagged fetch - without it, "ORT re-fetched" and "the browser preflighted" are
    // indistinguishable, and the binding claim would rest on an ambiguity.
    untaggedGET: wasmArrivals.filter((a) => !a.isOurs && a.method === "GET").length,
    untaggedOPTIONS: wasmArrivals.filter((a) => !a.isOurs && a.method === "OPTIONS").length
  };
  return rec;
}

(async () => {
  const pin = JSON.parse(fs.readFileSync(path.join(HERE, "pin.json"), "utf8"));
  console.log(`ORT ${pin.ortVersion} | ${pin.artifact} ${pin.bytes} bytes`);
  console.log(`pinned sha256 ${pin.sha256}`);
  const records = [];
  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n[run ${i}]`);
    const r = await oneRun(i);
    console.log(`  loaded=${r.extensionLoaded} alive=${r.aliveBeacon} contexts=${r.contexts.length}`);
    console.log(`  wasm arrivals: total=${r.groundTruth.wasmArrivals}` +
                ` ours=${r.groundTruth.wasmArrivals_ours}` +
                ` ORT=${r.groundTruth.wasmArrivals_ORT}` +
                ` | foreign-origin arrivals=${r.groundTruth.foreignOriginArrivals}`);
    records.push(r);
  }
  const outFile = path.join(OUT, "logs", `results-s02a2a3-${PLATFORM}-${BROWSER_LABEL}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    experiment: "W1-S02a-2a-3", platform: PLATFORM, browserLabel: BROWSER_LABEL,
    ort: pin, runs: RUNS, collectedAt: new Date().toISOString(), records
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
})();
