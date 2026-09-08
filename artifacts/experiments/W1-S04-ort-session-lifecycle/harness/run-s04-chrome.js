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

const PORT = 8907;
const RUNS = Number(process.env.RUNS || 2);
const CHROME = process.env.CHROME_PATH || "/opt/chrome-linux64/chrome";
const PLATFORM = process.env.PLATFORM_LABEL || "unknown";
const EXT = path.join(__dirname, "ext-chrome");

const CONFIGS = [
  { backend: "wasm", numThreads: 1, cycles: 3 },
  { backend: "wasm", numThreads: 4, cycles: 3 },
];

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
    out.contexts = await sw.evaluate((c) => globalThis.__s04_run(c), CONFIGS)
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
  const out = { experiment: "W1-S04-ort-session-lifecycle", browser: "chrome", startedAt: new Date().toISOString(),
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
  fs.writeFileSync(path.join(__dirname, `results-s04-chrome-${PLATFORM}.json`), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write(`\nwrote results-s04-chrome-${PLATFORM}.json\n`);
  process.exit(0);
})();
