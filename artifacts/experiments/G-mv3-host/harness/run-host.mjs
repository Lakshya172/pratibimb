/**
 * Track G — can PratiBimb's runtime architecture physically run in a real MV3 extension?
 *
 * Builds nothing itself: run `npm run build -w @pratibimb/extension` first. Loads
 * apps/extension/.output/chrome-mv3 unpacked in each cell and measures, through the DevTools
 * protocol (a test-only control plane no web page can reach):
 *   load · offscreen document · ORT in the offscreen document (ADR-0001 pinned path) · sender
 *   identity incl. documentId · content-script ↔ SW ↔ offscreen round-trip latency · connect-src
 *   against a pinned and a foreign loopback origin (B-02 collectors) · service-worker termination,
 *   natural and forced, and whether the offscreen document survives it · side panel renders ·
 *   whether a page can reach the extension at all.
 *
 * 127.0.0.1 only. Synthetic page. No values, no real site.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hostname, tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..", "..", "..");
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const LOGS = join(HERE, "..", "logs");
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const collector = require2(join(ROOT, "artifacts/experiments/W1-B02-invariant-e-observation/harness/collector.js"));
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const PINNED_PORT = 8995; // the manifest's connect-src origin
const FOREIGN_PORT = 8998; // not in connect-src
const PAGE_PORT = 8999;
const IDLE_WAIT_MS = 45_000;
const ROUNDTRIP_SAMPLES = 50;
const ROUNDTRIP_BATCHES = 3;

const pinned = await collector.start(PINNED_PORT);
const foreign = await collector.start(FOREIGN_PORT);
const pageServer = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!DOCTYPE html><html><body><h1>Host fixture</h1><button id="go">Next</button>
<script>window.__pageSees = { chromeRuntime: typeof (window.chrome && window.chrome.runtime && window.chrome.runtime.sendMessage) };</script></body></html>`);
});
await new Promise((ok) => pageServer.listen(PAGE_PORT, "127.0.0.1", ok));

const CELLS = [
  { name: "chrome-for-testing-153", launch: { executablePath: process.env.CHROME_PATH } },
  { name: "edge-branded", launch: { channel: "msedge" } },
];

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};

async function currentWorker(ctx, previous) {
  const live = ctx.serviceWorkers().filter((w) => w.url().startsWith("chrome-extension://"));
  const fresh = live.find((w) => w !== previous) ?? live[live.length - 1];
  if (fresh) return fresh;
  return ctx.waitForEvent("serviceworker", { timeout: 15_000 });
}

async function readState(ctx, sw) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sw.evaluate(async () => {
        const h = globalThis.__host;
        const offscreen = await h.toOffscreen({ kind: "STATE" });
        return { bootId: h.bootId, bootedAt: h.bootedAt, offscreen, offscreenContexts: await h.offscreenContexts() };
      });
    } catch {
      sw = await currentWorker(ctx, sw);
    }
  }
  return { error: "service worker unreachable" };
}

const results = [];
for (const cell of CELLS) {
  if (cell.launch.executablePath === undefined && !cell.launch.channel) continue;
  const r = { cell: cell.name };
  const udd = mkdtempSync(join(tmpdir(), "pb-host-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(udd, {
      headless: false,
      ...cell.launch,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    r.browserVersion = ctx.browser()?.version?.() ?? null;
    let sw = await currentWorker(ctx, null);
    r.load = { serviceWorkerUrl: sw.url(), extensionId: sw.url().split("/")[2] };

    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PAGE_PORT}/`, { waitUntil: "load" });
    for (let i = 0; i < 50; i += 1) {
      const n = await sw.evaluate(() => globalThis.__host.hellos.length);
      if (n > 0) break;
      await page.waitForTimeout(100);
    }
    const hello = await sw.evaluate(() => globalThis.__host.hellos.at(-1));
    r.senderIdentity = hello?.identity ?? null;
    r.pageReachability = await page.evaluate(() => window.__pageSees);

    r.offscreen = { contextsAfterEnsure: await sw.evaluate(() => globalThis.__host.ensureOffscreen()) };
    r.ort = await sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "ORT_SMOKE" }));

    const tabId = r.senderIdentity?.tabId;
    const batches = [];
    for (let b = 0; b < ROUNDTRIP_BATCHES; b += 1) {
      batches.push(await sw.evaluate(({ tabId, n }) => globalThis.__host.toTab(tabId, { kind: "ROUNDTRIP", samples: n }), { tabId, n: ROUNDTRIP_SAMPLES }));
    }
    const samples = batches.flatMap((x) => x?.samples ?? []);
    r.roundtrip = {
      path: "content script → service worker → offscreen document → back",
      samples: samples.length,
      p50ms: samples.length ? pct(samples, 50) : null,
      p95ms: samples.length ? pct(samples, 95) : null,
      maxMs: samples.length ? Math.round(Math.max(...samples) * 100) / 100 : null,
      lastEcho: batches.at(-1)?.last ?? null,
    };

    const beforePinned = pinned.arrivals.length;
    const beforeForeign = foreign.arrivals.length;
    const probe = await sw.evaluate(
      ({ a, f }) => globalThis.__host.toOffscreen({ kind: "CSP_PROBE", allowed: a, foreign: f }),
      { a: `http://127.0.0.1:${PINNED_PORT}/csp`, f: `http://127.0.0.1:${FOREIGN_PORT}/csp` }
    );
    await page.waitForTimeout(500);
    r.csp = { probe, pinnedArrivals: pinned.arrivals.length - beforePinned, foreignArrivals: foreign.arrivals.length - beforeForeign };

    // ── termination: natural idle, then forced ──
    const baseline = await readState(ctx, sw);
    await page.waitForTimeout(IDLE_WAIT_MS);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    sw = await currentWorker(ctx, sw);
    const afterIdle = await readState(ctx, sw);

    const cdp = await ctx.newCDPSession(page);
    let forced = { attempted: true };
    try {
      await cdp.send("ServiceWorker.enable");
      await cdp.send("ServiceWorker.stopAllWorkers");
      forced.stopAllWorkers = "sent";
    } catch (e) {
      forced.stopAllWorkers = `failed: ${String(e.message).split("\n")[0]}`;
    }
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    sw = await currentWorker(ctx, sw);
    const afterForced = await readState(ctx, sw);
    r.termination = {
      idleWaitMs: IDLE_WAIT_MS,
      baseline,
      afterIdle,
      afterForced,
      forced,
      swRestartedAfterIdle: Boolean(baseline.bootId && afterIdle.bootId && baseline.bootId !== afterIdle.bootId),
      swRestartedAfterForced: Boolean(afterIdle.bootId && afterForced.bootId && afterIdle.bootId !== afterForced.bootId),
      offscreenSurvivedIdle: Boolean(baseline.offscreen?.instanceId && baseline.offscreen.instanceId === afterIdle.offscreen?.instanceId),
      offscreenSurvivedForced: Boolean(baseline.offscreen?.instanceId && baseline.offscreen.instanceId === afterForced.offscreen?.instanceId),
    };

    const panel = await ctx.newPage();
    await panel.goto(`chrome-extension://${r.load.extensionId}/sidepanel.html`, { waitUntil: "load" });
    await panel.waitForFunction(() => document.documentElement.dataset.hostStatus, null, { timeout: 10_000 }).catch(() => null);
    r.sidePanel = {
      openedAs: "extension page in a tab (the Side Panel API needs a user gesture to open)",
      status: await panel.evaluate(() => document.documentElement.dataset.hostStatus ?? null),
      text: (await panel.evaluate(() => document.getElementById("status")?.textContent ?? "")).slice(0, 400),
    };
  } catch (e) {
    r.error = String(e && e.message ? e.message : e).split("\n")[0];
  } finally {
    if (ctx) await ctx.close().catch(() => undefined);
  }
  results.push(r);
  console.log(JSON.stringify(r, null, 2));
}

pageServer.close();
pinned.server.close();
foreign.server.close();

const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const log = {
  experiment: "G-mv3-host",
  recordedAt: new Date().toISOString(),
  workstation: "W2",
  hostname: hostname(),
  node: process.version,
  controlPlane: "Playwright launchPersistentContext --load-extension, headful; measurements via service-worker evaluate (DevTools), not any page API",
  manifest,
  design: { idleWaitMs: IDLE_WAIT_MS, roundtripSamples: ROUNDTRIP_SAMPLES * ROUNDTRIP_BATCHES, pinnedPort: PINNED_PORT, foreignPort: FOREIGN_PORT },
  results,
};
mkdirSync(LOGS, { recursive: true });
writeFileSync(join(LOGS, "host.json"), JSON.stringify(log, null, 2) + "\n");
