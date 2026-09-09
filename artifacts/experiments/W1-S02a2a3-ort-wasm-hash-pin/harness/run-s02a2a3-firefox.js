/**
 * S-02a-2a-3 Firefox runner. THROWAWAY SPIKE CODE.
 *
 * Reuses the W1-S02a-2 / W1-S02a-2a-2 Firefox pattern: web-ext installs a temporary MV3
 * add-on into a throwaway profile, and a loopback collector receives results with a
 * belt-and-braces fallback, because Firefox MV3 gates host_permissions behind origin
 * controls.
 *
 * Same two arrival-logged origins and the same attribution rule as the Chrome runner:
 * our fetches carry `x-pratibimb-probe`, ORT's do not, so an UNTAGGED artifact request is
 * ORT's. The .wasm is NOT packaged, so ORT has no local copy to fall back to.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const COLLECTOR_PORT = 8910;
const FOREIGN_PORT = 8911;
const RUNS = Number(process.env.RUNS || 3);
const FIREFOX = process.env.FIREFOX_PATH || "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
const PLATFORM = process.env.PLATFORM_LABEL || "windows-ws1";
const HERE = __dirname;
const OUT = path.join(HERE, "..");
const SERVE = path.join(HERE, "served");

function makeServer(port, label, state) {
  const cors = { "Access-Control-Allow-Origin": "*",
                 "Access-Control-Allow-Headers": "content-type, x-pratibimb-probe" };
  const server = http.createServer((req, res) => {
    const tag = req.headers["x-pratibimb-probe"] || null;
    const url = req.url.split("?")[0];
    state.arrivals.push({ origin: label, at: new Date().toISOString(),
                          method: req.method, url, probeTag: tag, isOurs: tag !== null });
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }

    if (url.endsWith(".wasm")) {
      const p = path.join(SERVE, path.basename(url));
      if (!fs.existsSync(p)) { res.writeHead(404, cors); return res.end("nf"); }
      const b = fs.readFileSync(p);
      res.writeHead(200, { ...cors, "Content-Type": "application/wasm", "Content-Length": b.length });
      return res.end(b);
    }
    if (url === "/log") { state.logs.push({ at: new Date().toISOString(), q: req.url });
                          res.writeHead(200, cors); return res.end("ok"); }
    if (url === "/sink") {
      try { state.results.push(...JSON.parse(new URL(req.url, "http://x").searchParams.get("d"))); }
      catch (e) { state.results.push({ context: "SINK_PARSE_ERROR" }); }
      state.done = true;
      res.writeHead(200, cors); return res.end("ok");
    }
    if (url === "/done") { state.done = true; res.writeHead(200, cors); return res.end("ok"); }

    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (url === "/results") {
        try { state.results.push(...JSON.parse(body)); }
        catch (e) { state.results.push({ context: "PARSE_ERROR", raw: body.slice(0, 400) }); }
      }
      res.writeHead(200, { ...cors, "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

function oneRun(runIndex) {
  return new Promise((resolve) => {
    const state = { arrivals: [], results: [], logs: [], done: false };
    const s1 = makeServer(COLLECTOR_PORT, "collector", state);
    const s2 = makeServer(FOREIGN_PORT, "foreign", state);
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s02a2a3-ff-"));
    const args = [
      path.join(HERE, "node_modules", "web-ext", "bin", "web-ext.js"), "run",
      "--source-dir", path.join(HERE, "ext-firefox"),
      "--firefox", FIREFOX,
      "--start-url", `http://127.0.0.1:${COLLECTOR_PORT}/control`,
      "--firefox-profile", profileDir,
      "--profile-create-if-missing", "--no-input", "--no-reload",
      "--pref", "extensions.originControls.grantByDefault=true"
    ];
    const child = spawn(process.execPath, args, { cwd: HERE, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => { log += d.toString(); });
    child.stderr.on("data", (d) => { log += d.toString(); });

    const deadline = Date.now() + 300000;
    const tick = setInterval(() => {
      if (state.done || Date.now() > deadline) {
        clearInterval(tick);
        try { child.kill(); } catch (_) {}
        // web-ext spawns Firefox as a GRANDCHILD; killing the wrapper leaves it running.
        // Without this, instances accumulate across runs until the machine runs out of
        // memory - observed at 189 live processes before this was added.
        try {
          require("child_process").execSync(
            'taskkill /F /IM firefox.exe /T', { stdio: "ignore" });
        } catch (_) { /* none running */ }
        setTimeout(() => {
          s1.close(); s2.close();
          try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
          const wasmArrivals = state.arrivals.filter((a) => a.url.endsWith(".wasm"));
          resolve({
            run: runIndex, browser: "firefox-155.0.1",
            aliveBeacon: state.logs.length > 0,
            results: state.results,
            contexts: [...new Set(state.results.map((r) => r.context))].sort(),
            groundTruth: {
              totalArrivals: state.arrivals.length,
              wasmArrivals: wasmArrivals.length,
              wasmArrivals_ours: wasmArrivals.filter((a) => a.isOurs).length,
              wasmArrivals_ORT: wasmArrivals.filter((a) => !a.isOurs).length,
              foreignOriginArrivals: state.arrivals.filter((a) => a.origin === "foreign").length,
              untaggedDetail: wasmArrivals.filter((a) => !a.isOurs)
                .map((a) => ({ origin: a.origin, url: a.url, method: a.method, at: a.at })),
              // A CORS preflight carries no custom header, so the header rule counts it
              // as ORT's. Separating by METHOD is what distinguishes a real ORT GET from a
              // preflight of our own tagged fetch - without it, "ORT re-fetched" and "the
              // browser preflighted" are indistinguishable and the binding claim would
              // rest on an ambiguity.
              untaggedGET: wasmArrivals.filter((a) => !a.isOurs && a.method === "GET").length,
              untaggedOPTIONS: wasmArrivals.filter((a) => !a.isOurs && a.method === "OPTIONS").length
            },
            webExtLogTail: log.slice(-1200)
          });
        }, 3000);
      }
    }, 500);
  });
}

(async () => {
  const pin = JSON.parse(fs.readFileSync(path.join(HERE, "pin.json"), "utf8"));
  console.log(`Firefox: ${FIREFOX}`);
  console.log(`ORT ${pin.ortVersion} | ${pin.artifact} | pinned sha256 ${pin.sha256}`);
  const records = [];
  for (let i = 1; i <= RUNS; i++) {
    console.log(`\n[run ${i}]`);
    const r = await oneRun(i);
    console.log(`  alive=${r.aliveBeacon} contexts=${r.contexts.length}` +
      ` | wasm arrivals total=${r.groundTruth.wasmArrivals}` +
      ` ours=${r.groundTruth.wasmArrivals_ours} ORT=${r.groundTruth.wasmArrivals_ORT}` +
      ` | foreign=${r.groundTruth.foreignOriginArrivals}`);
    records.push(r);
  }
  const outFile = path.join(OUT, "logs", `results-s02a2a3-${PLATFORM}-firefox-155.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({
    experiment: "W1-S02a-2a-3", platform: PLATFORM, browserLabel: "firefox-155.0.1",
    firefox: FIREFOX, ort: pin, runs: RUNS,
    collectedAt: new Date().toISOString(), records
  }, null, 2));
  console.log(`\nwrote ${outFile}`);
})();
