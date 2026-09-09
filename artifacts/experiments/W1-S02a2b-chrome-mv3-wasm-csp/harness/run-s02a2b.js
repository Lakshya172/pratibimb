/**
 * S-02a-2b — does Chrome MV3's extension CSP block WebAssembly, as Firefox's does?
 *
 * S-02a-2 found WebAssembly.compile() blocked by CSP in the Firefox MV3 event page. If
 * Chrome behaves the same way, this is not a Firefox problem — it is a cross-browser
 * architecture issue affecting the whole perception tier, and the CSP decision (S-02a-2a)
 * becomes unavoidable rather than Firefox-specific.
 *
 * Probes THREE contexts, because the constitution names a specific one:
 *   - the MV3 service worker
 *   - the chrome.offscreen document
 *   - a DEDICATED WORKER inside the offscreen document  <- PratiBimb's real inference target
 *
 * Two extension variants differing in exactly one line: default CSP, and one declaring
 * 'wasm-unsafe-eval'. Measuring a remedy is not adopting it.
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const PORT = 8905;
const RUNS = Number(process.env.RUNS || 3);
const CHROME = process.env.CHROME_PATH || "/opt/chrome-linux64/chrome";
const PLATFORM = process.env.PLATFORM_LABEL || "unknown";

function startCollector() {
  const received = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/result") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        try { received.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch {}
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r({ server, received })));
}

async function oneRun({ variant, extDir, headless, run }, received) {
  const before = received.length;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-s02a2b-"));
  const ext = path.join(__dirname, extDir);
  const out = { variant, extDir, headless, run, platform: PLATFORM, extensionLoaded: false };

  const ctx = await chromium.launchPersistentContext(udd, {
    headless, executablePath: CHROME,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
  });
  try {
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
    out.extensionLoaded = true;
    out.contexts = await sw.evaluate(() => globalThis.__s02a2b_run())
      .catch((e) => [{ context: "evaluate-failed", error: { message: String(e).slice(0, 300) } }]);
    await new Promise((r) => setTimeout(r, 1200));
  } catch (e) {
    out.runError = String(e).slice(0, 300);
  } finally {
    out.collectorReceived = received.slice(before).length;
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  return out;
}

(async () => {
  const { server, received } = await startCollector();
  const out = {
    experiment: "W1-S02a-2b-chrome-mv3-wasm-csp",
    startedAt: new Date().toISOString(),
    platform: PLATFORM, chrome: CHROME, runs: [],
  };

  const plan = [
    { variant: "default-csp-headful",       extDir: "ext-default",   headless: false },
    { variant: "default-csp-headless",      extDir: "ext-default",   headless: true },
    { variant: "wasm-unsafe-eval-headful",  extDir: "ext-wasm-csp",  headless: false },
    { variant: "wasm-unsafe-eval-headless", extDir: "ext-wasm-csp",  headless: true },
    // S-02a-2b-1: is a NARROWER directive accepted and sufficient? Chrome's own error
    // names 'wasm-eval'. Choosing more privilege than needed, in the manifest that also
    // pins connect-src, would be a poor default.
    { variant: "wasm-eval-headless",        extDir: "ext-wasm-eval", headless: true },
    { variant: "unsafe-eval-headless",      extDir: "ext-unsafe-eval", headless: true },
  ];

  for (const v of plan) {
    for (let run = 1; run <= RUNS; run++) {
      let r;
      try { r = await oneRun({ ...v, run }, received); }
      catch (e) { r = { ...v, run, fatal: String(e).slice(0, 250) }; }
      out.runs.push(r);
      const summary = (r.contexts || []).map((c) =>
        `${c.context}=${c.conclusion ? c.conclusion.slice(0, 46) : "?"}`);
      process.stderr.write(`${v.variant.padEnd(26)} #${run} loaded=${r.extensionLoaded}\n`);
      for (const s of summary) process.stderr.write(`      ${s}\n`);
    }
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, `results-${PLATFORM}.json`), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write(`\nwrote results-${PLATFORM}.json\n`);
  process.exit(0);
})();
