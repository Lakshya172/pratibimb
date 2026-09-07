/**
 * S-01b decisive test — can Playwright BLOCK an outbound request issued from an
 * MV3 offscreen document, as the Invariant E egress interception suite requires?
 *
 * A route handler aborts every request to the collector. Anything that still
 * arrives at the collector was NOT interceptable, and would make the suite's
 * "zero outbound requests" assertion pass vacuously.
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const PORT = 8901;
const EXT = path.join(__dirname, "extension");

function startCollector() {
  const received = [];
  const server = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url });
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, received })));
}

async function oneRun(runIndex, received) {
  const before = received.length;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s01b-block-"));
  const observed = [];
  const aborted = [];
  const out = { run: runIndex, extensionLoaded: false, extensionId: null };

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "msedge",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    ctx.on("request", (r) => { if (r.url().includes("127.0.0.1:8901")) observed.push(r.url()); });
    // Abort EVERYTHING aimed at the collector, from every context.
    await ctx.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.includes("127.0.0.1:8901")) { aborted.push(u); return route.abort("failed"); }
      return route.continue();
    });

    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => null);
    if (sw) { out.extensionLoaded = true; out.extensionId = new URL(sw.url()).host; }

    if (sw) out.probe = await sw.evaluate(() => globalThis.__s01b_run()).catch((e) => ({ evaluateError: String(e).slice(0, 200) }));
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    out.playwrightObserved = observed;
    out.playwrightAborted = aborted;
    out.collectorReceived = received.slice(before).map((r) => `${r.method} ${r.url}`);
    try { await ctx.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
  return out;
}

(async () => {
  const { server, received } = await startCollector();
  const runs = [];
  for (let i = 1; i <= 3; i++) {
    process.stderr.write(`\n=== block run ${i} ===\n`);
    const r = await oneRun(i, received);
    runs.push(r);
    process.stderr.write(JSON.stringify({
      extensionLoaded: r.extensionLoaded,
      observed: r.playwrightObserved,
      aborted: r.playwrightAborted,
      LEAKED_TO_COLLECTOR: r.collectorReceived,
      probe: r.probe,
    }, null, 1) + "\n");
  }
  fs.writeFileSync("results-block.json", JSON.stringify({ experiment: "W1-S01b-block", runs }, null, 2));
  server.close();
})();
