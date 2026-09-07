/**
 * S-01b — Can a Playwright-driven browser load an unpacked MV3 extension in the
 * manner the egress interception suite requires?
 *
 * The suite's requirement is NOT merely "the extension loads". It is:
 *   (1) the unpacked MV3 extension loads, AND
 *   (2) Playwright can OBSERVE a network request issued from the extension's
 *       background contexts (service worker and offscreen document), AND
 *   (3) Playwright can BLOCK such a request,
 * because Invariant E's Playwright mechanism asserts ZERO outbound requests under
 * injected failure. A suite that cannot see extension-origin traffic would pass
 * vacuously — a false negative on the project's central security claim.
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
    received.push({ method: req.method, url: req.url, at: Date.now() });
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true }));
  });
  return new Promise((resolve) =>
    server.listen(PORT, "127.0.0.1", () => resolve({ server, received }))
  );
}

async function variant(name, launchOpts, { blockRoute }) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s01b-"));
  const observed = [];
  const routed = [];
  const result = {
    variant: name,
    launchOptions: { ...launchOpts, args: launchOpts.args },
    blockRoute,
    userDataDir,
    launched: false,
    launchError: null,
    extensionLoaded: false,
    extensionId: null,
    serviceWorkerUrls: [],
    probeResult: null,
    playwrightObserved: [],
    playwrightRouted: [],
    collectorReceived: [],
    browserVersion: null,
  };

  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(userDataDir, launchOpts);
    result.launched = true;
  } catch (e) {
    result.launchError = String(e).split("\n")[0];
    return result;
  }

  try {
    result.browserVersion = ctx.browser() ? ctx.browser().version() : "n/a (persistent context)";

    ctx.on("request", (r) => observed.push({ url: r.url(), method: r.method(), resourceType: r.resourceType() }));
    if (blockRoute) {
      await ctx.route("**/127.0.0.1:8901/**", (route) => {
        routed.push({ url: route.request().url(), action: "aborted" });
        return route.abort("failed");
      });
    } else {
      await ctx.route("**/*", (route) => {
        const u = route.request().url();
        if (u.includes("127.0.0.1:8901")) routed.push({ url: u, action: "continued" });
        return route.continue();
      });
    }

    // Wait for the extension service worker to appear.
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) {
      sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 }).catch(() => null);
    }
    if (sw) {
      result.extensionLoaded = true;
      result.extensionId = new URL(sw.url()).host;
    }
    result.serviceWorkerUrls = ctx.serviceWorkers().map((w) => w.url());
    result.backgroundPageUrls = (ctx.backgroundPages ? ctx.backgroundPages() : []).map((b) => b.url());
    // Ask the browser itself what it thinks is installed.
    try {
      const p0 = await ctx.newPage();
      await p0.goto("chrome://extensions/", { timeout: 10000 });
      result.extensionsPageText = (await p0.evaluate(() => document.body.innerText)).slice(0, 600);
      await p0.close();
    } catch (e) {
      result.extensionsPageText = "unavailable: " + String(e).slice(0, 200);
    }

    if (sw) {
      result.probeResult = await sw.evaluate(() => globalThis.__s01b_run()).catch((e) => ({ evaluateError: String(e).split("\n")[0] }));
    }

    await new Promise((r) => setTimeout(r, 1500));
  } catch (e) {
    result.runError = String(e).split("\n")[0];
  } finally {
    result.playwrightObserved = observed.filter((o) => o.url.includes("127.0.0.1:8901"));
    result.playwrightRouted = routed;
    try { await ctx.close(); } catch {}
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
  return result;
}

(async () => {
  const { server, received } = await startCollector();
  const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`];
  const out = { experiment: "W1-S01b-playwright-chromium-extension-loading", startedAt: new Date().toISOString(), variants: [] };

  const plan = [
    ["A-bundled-chromium-headed-observe", { headless: false, args }, { blockRoute: false }],
    ["B-bundled-chromium-headed-block",   { headless: false, args }, { blockRoute: true }],
    ["C-bundled-chromium-headless-observe", { headless: true, args }, { blockRoute: false }],
    ["D-branded-chrome-stable-headed-observe", { headless: false, channel: "chrome", args }, { blockRoute: false }],
    ["E-branded-edge-stable-headed-observe", { headless: false, channel: "msedge", args }, { blockRoute: false }],
  ];

  for (const [name, opts, cfg] of plan) {
    const before = received.length;
    process.stderr.write(`\n=== ${name} ===\n`);
    const r = await variant(name, opts, cfg);
    r.collectorReceived = received.slice(before);
    out.variants.push(r);
    process.stderr.write(JSON.stringify({
      launched: r.launched, launchError: r.launchError, extensionLoaded: r.extensionLoaded,
      observedByPlaywright: r.playwrightObserved.length, routed: r.playwrightRouted.length,
      actuallyArrived: r.collectorReceived.length, probe: r.probeResult
    }, null, 1) + "\n");
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results.json\n");
})();
