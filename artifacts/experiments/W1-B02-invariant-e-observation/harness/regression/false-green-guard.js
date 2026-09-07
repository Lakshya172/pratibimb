/**
 * REGRESSION GUARD — the false-green Invariant E test.
 *
 * Preserves the exact failure mode S-01b discovered, so it cannot silently return:
 *
 *     Playwright says : "no offscreen request observed"   (and blocks nothing)
 *     the wire says   : "the request arrived"
 *
 * A suite that asserted zero outbound requests using Playwright alone would have
 * gone GREEN here while the payload left the machine.
 *
 * PASS  = the independent arrival check DETECTED egress that a Playwright-only
 *         assertion reported as absent. The ground truth still works.
 * FAIL  = the independent arrival check missed it. The methodology has regressed and
 *         Invariant E has no trustworthy enforcement.
 *
 * Note on Playwright: if Playwright later gains offscreen coverage, this test still
 * PASSES and reports it. The guard is on OUR methodology, not on a third-party bug.
 *
 * Throwaway spike code, but written to be promotable into the real suite.
 * Loopback only. No product code. Exit code is the assertion.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { start: startCollector } = require("../collector");

const PORT = 8902;
const EXT = path.join(__dirname, "..", "extension");
const MATCH = "127.0.0.1:8902";
const RUNS = Number(process.env.RUNS || 3);

async function oneRun(i, arrivals) {
  const before = arrivals.length;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-guard-"));
  const observed = [], blocked = [];
  const ctx = await chromium.launchPersistentContext(udd, {
    headless: false, channel: "msedge",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  try {
    ctx.on("request", (r) => { if (r.url().includes(MATCH)) observed.push(r.url()); });
    // The suite as originally planned: intercept and abort everything.
    await ctx.route("**/*", async (route) => {
      const u = route.request().url();
      if (u.includes(MATCH)) { blocked.push(u); return route.abort("failed"); }
      return route.continue();
    });
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 20000 });
    await sw.evaluate((s) => globalThis.__b02_run(s), { egress: true, correlationId: `guard-${i}` });
    await new Promise((r) => setTimeout(r, 2000));
  } finally {
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  const arrived = arrivals.slice(before);
  return {
    run: i,
    playwrightObserved: observed.length,
    playwrightBlocked: blocked.length,
    playwrightWouldReportZeroRequests: observed.length === 0,
    actuallyArrivedOnTheWire: arrived.length,
    arrivalDetail: arrived.map((a) => ({ url: a.url, bytes: a.bytes, hashMatches: a.hashMatches })),
  };
}

(async () => {
  const { server, arrivals } = await startCollector(PORT);
  const runs = [];
  for (let i = 1; i <= RUNS; i++) runs.push(await oneRun(i, arrivals));
  server.close();

  const falseGreenReproduced = runs.filter((r) => r.playwrightWouldReportZeroRequests && r.actuallyArrivedOnTheWire > 0).length;
  const groundTruthDetected  = runs.filter((r) => r.actuallyArrivedOnTheWire > 0).length;
  const playwrightNowSeesIt  = runs.filter((r) => r.playwrightObserved > 0).length;

  const verdict = groundTruthDetected === runs.length ? "PASS" : "FAIL";
  const report = { test: "invariant-e-false-green-guard", runs, summary: {
    total: runs.length, groundTruthDetected, falseGreenReproduced, playwrightNowSeesIt, verdict } };

  fs.writeFileSync(path.join(__dirname, "guard-result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 1));
  for (const r of runs) {
    console.log(`  run ${r.run}: playwright observed=${r.playwrightObserved} blocked=${r.playwrightBlocked}` +
                `  |  actually arrived=${r.actuallyArrivedOnTheWire}`);
  }
  if (playwrightNowSeesIt > 0) {
    console.log("\nNOTE: Playwright observed offscreen traffic in " + playwrightNowSeesIt + " run(s).");
    console.log("      That is a CHANGE from the S-01b baseline. Re-evaluate B-02; do not");
    console.log("      assume it now blocks as well as observes.");
  }
  if (verdict !== "PASS") {
    console.error("\nFAIL: the independent arrival check did not detect offscreen egress.");
    console.error("      Invariant E has no trustworthy enforcement until this is fixed.");
    process.exit(1);
  }
  console.log("\nPASS: independent arrival check detected egress that a Playwright-only");
  console.log("      assertion reported as absent, in " + falseGreenReproduced + "/" + runs.length + " runs.");
})();
