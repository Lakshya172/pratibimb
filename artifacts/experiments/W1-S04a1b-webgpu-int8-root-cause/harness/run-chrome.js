/**
 * S-03 Chrome runner — drives the ORT Web probe through the MV3 service worker, the
 * offscreen document, and the dedicated worker inside it, on the wasm and webgpu backends.
 *
 * Throwaway spike code. Loopback only.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const PORT = 8909;
const RUNS = Number(process.env.RUNS || 2);
const CHROME = process.env.CHROME_PATH || "/opt/chrome-linux64/chrome";
const PLATFORM = process.env.PLATFORM_LABEL || "unknown";
const EXT = path.join(__dirname, "ext-chrome");

// Both backends run in the SAME context, wasm first, so the webgpu cell inherits an arena
// the wasm cell already grew. That confound is real: set COLD_START_BACKEND=webgpu to run
// webgpu alone from a cold heap, which is what the 19.3 MB figure in the README comes from.
// First pass is WASM only. Four different models totalling ~116 MB of weights make each
// cell far heavier than S-04a's single 232 KB model, so webgpu is run separately via
// COLD_START_BACKEND rather than sharing a context (which confounded S-04a's webgpu cell).
// The Chrome path takes its configs from HERE, not from build-extension.js (that one only
// feeds the Firefox event page). Both must honour the same env vars or a "cold start" run
// silently re-runs the full phase -- which is exactly what happened on the first attempt.
const CONFIGS = [{
  backend: process.env.BACKEND || process.env.COLD_START_BACKEND || "wasm",
  numThreads: 1,
  cycles: Number(process.env.CYCLES === undefined ? 3 : process.env.CYCLES),
  phase: process.env.PHASE || "full",
  only: process.env.ONLY ? process.env.ONLY.split(",") : undefined,
}];

function startCollector() {
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { received.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch {}
        res.writeHead(200); res.end("{}");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, received })));
}

async function oneRun({ headless, run }, received) {
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s03-"));
  const out = { headless, run, platform: PLATFORM, extensionLoaded: false };
  const ctx = await chromium.launchPersistentContext(udd, {
    headless, executablePath: CHROME,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox"],
  });
  try {
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
    out.extensionLoaded = true;
    out.contexts = await sw.evaluate((c) => globalThis.__s04a1b_run(c), CONFIGS)
      .catch((e) => [{ context: "evaluate-failed", error: { message: String(e).slice(0, 400) } }]);
  } catch (e) {
    out.runError = String(e).slice(0, 400);
  } finally {
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  return out;
}

(async () => {
  const { server } = await startCollector();
  const out = { experiment: "W1-S04a1b-webgpu-int8-root-cause", browser: "chrome", startedAt: new Date().toISOString(),
                platform: PLATFORM, chrome: CHROME, runs: [] };
  for (const headless of [false, true]) {
    for (let run = 1; run <= RUNS; run++) {
      let r;
      try { r = await oneRun({ headless, run }, []); }
      catch (e) { r = { headless, run, fatal: String(e).slice(0, 300) }; }
      out.runs.push(r);
      process.stderr.write(`\n--- chrome ${headless ? "headless" : "headful "} run ${run} loaded=${r.extensionLoaded} ---\n`);
      for (const c of r.contexts || []) {
        process.stderr.write(`   ${String(c.context).padEnd(34)} ${String(c.requestedBackend).padEnd(7)} ${String(c.conclusion).slice(0, 96)}\n`);
      }
    }
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, `results-s04a1b-chrome-${PLATFORM}.json`), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write(`\nwrote results-s04a1b-chrome-${PLATFORM}.json\n`);
  process.exit(0);
})();
