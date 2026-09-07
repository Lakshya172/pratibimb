/**
 * B-02 — how can this project INDEPENDENTLY establish that an outbound request
 * occurred, through which path, and with which bytes?
 *
 * Compares four candidate mechanisms against a ground truth that none of them
 * control, over three scenarios and three enforcement modes.
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { start: startCollector } = require("./collector");
const { CDP } = require("./cdp");

const PORT = 8902, CDP_PORT = 9444;
const EXT = path.join(__dirname, "extension");
const COLLECTOR_MATCH = "127.0.0.1:8902";

async function browserWsUrl() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  return (await r.json()).webSocketDebuggerUrl;
}

async function runCase({ name, scenario, block }, arrivals) {
  const before = arrivals.length;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-b02-"));
  const result = {
    case: name, scenario, block,
    m1_playwright: { observed: [], blocked: [], surfacesOffscreenTarget: false },
    m2_cdp: { attachedToOffscreen: false, observed: [], blocked: [], attachError: null },
    m3_collector: { arrivals: [] },
    m5_extension_audit: [],
    probe: null,
  };

  const ctx = await chromium.launchPersistentContext(udd, {
    headless: false, channel: "msedge",
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      `--remote-debugging-port=${CDP_PORT}`,
    ],
  });

  let cdp = null;
  try {
    // ---- M1: Playwright context-level interception -------------------------
    ctx.on("request", (r) => { if (r.url().includes(COLLECTOR_MATCH)) result.m1_playwright.observed.push(r.url()); });
    await ctx.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.includes(COLLECTOR_MATCH) && block === "m1") {
        result.m1_playwright.blocked.push(u);
        return route.abort("failed");
      }
      return route.continue();
    });

    // wait for the extension
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
    result.extensionId = new URL(sw.url()).host;

    // ---- M2: raw CDP attached to the OFFSCREEN target ----------------------
    // Playwright does not surface the offscreen document, so go to CDP directly.
    try {
      cdp = await CDP.connect(await browserWsUrl());
      await cdp.send("Target.setDiscoverTargets", { discover: true });

      // The offscreen document only exists once created, so nudge it into being.
      await sw.evaluate(() => globalThis.__b02_run({ correlationId: "warmup" })).catch(() => {});

      let offscreen = null;
      for (let i = 0; i < 30 && !offscreen; i++) {
        const { targetInfos } = await cdp.send("Target.getTargets");
        offscreen = targetInfos.find((t) => t.url.includes("offscreen.html"));
        if (!offscreen) await new Promise((r) => setTimeout(r, 300));
      }
      result.m2_cdp.offscreenTargetSeen = Boolean(offscreen);
      result.m2_cdp.offscreenTargetType = offscreen ? offscreen.type : null;

      if (offscreen) {
        const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: offscreen.targetId, flatten: true });
        result.m2_cdp.attachedToOffscreen = true;
        result.m2_cdp.sessionId = sessionId;

        cdp.on(async (msg) => {
          if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== sessionId) return;
          const { requestId, request } = msg.params;
          if (!request.url.includes(COLLECTOR_MATCH)) {
            return cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
          }
          result.m2_cdp.observed.push({
            url: request.url,
            method: request.method,
            correlationId: request.headers["x-pratibimb-correlation-id"] || null,
            declaredHash: request.headers["x-pratibimb-payload-sha256"] || null,
            hasPostData: Boolean(request.postData),
          });
          if (block === "m2") {
            result.m2_cdp.blocked.push(request.url);
            return cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sessionId).catch(() => {});
          }
          return cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
        });
        await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
      }
    } catch (e) {
      result.m2_cdp.attachError = String(e).slice(0, 240);
    }

    // Does Playwright surface the offscreen document at all?
    result.m1_playwright.surfacesOffscreenTarget =
      ctx.pages().some((p) => p.url().includes("offscreen.html")) ||
      (ctx.backgroundPages ? ctx.backgroundPages() : []).some((b) => b.url().includes("offscreen.html"));
    result.m1_playwright.pages = ctx.pages().map((p) => p.url());

    // ---- run the scenario --------------------------------------------------
    const cid = `cid-${name}-${Date.now()}`;
    result.probe = await sw.evaluate((s) => globalThis.__b02_run(s), { ...scenario, correlationId: cid })
      .catch((e) => ({ evaluateError: String(e).slice(0, 240) }));
    result.correlationId = cid;
    result.m5_extension_audit = (result.probe && result.probe.auditLog) || [];

    await new Promise((r) => setTimeout(r, 2500));
  } catch (e) {
    result.runError = String(e).slice(0, 300);
  } finally {
    result.m3_collector.arrivals = arrivals.slice(before).filter((a) => !String(a.url).includes("warmup"));
    if (cdp) cdp.close();
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  return result;
}

(async () => {
  const { server, arrivals } = await startCollector(PORT);
  const cases = [
    { name: "A-observe-authorised",   scenario: { egress: true },  block: null },
    { name: "B-observe-unauthorised", scenario: { rogue: true },   block: null },
    { name: "C-observe-tampered",     scenario: { tamper: true },  block: null },
    { name: "D-block-with-playwright", scenario: { egress: true }, block: "m1" },
    { name: "E-block-with-cdp",        scenario: { egress: true }, block: "m2" },
  ];
  const out = { experiment: "W1-B02-invariant-e-observation", startedAt: new Date().toISOString(), cases: [] };
  for (const c of cases) {
    process.stderr.write(`\n=== ${c.name} ===\n`);
    const r = await runCase(c, arrivals);
    out.cases.push(r);
    process.stderr.write(JSON.stringify({
      m1_observed: r.m1_playwright.observed.length,
      m1_blocked: r.m1_playwright.blocked.length,
      m1_surfacesOffscreen: r.m1_playwright.surfacesOffscreenTarget,
      m2_attached: r.m2_cdp.attachedToOffscreen,
      m2_targetType: r.m2_cdp.offscreenTargetType,
      m2_observed: r.m2_cdp.observed.length,
      m2_blocked: r.m2_cdp.blocked.length,
      m2_error: r.m2_cdp.attachError,
      m3_arrived: r.m3_collector.arrivals.map(a => `${a.url} hashMatches=${a.hashMatches} declared=${a.declaredAtAll}`),
      runError: r.runError,
    }, null, 1) + "\n");
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results.json\n");
})();
