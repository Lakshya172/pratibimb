/**
 * B-02-1 — does the CDP-auto-attach + independent-collector model hold on LINUX?
 *
 * Runs the same questions the Windows phases answered, in WSL2 Ubuntu, headful and
 * headless, against Chrome for Testing 153.0.8010.12 (the build Playwright names for
 * chromium v1243).
 *
 * TWO INDEPENDENT VERDICTS PER RUN, never collapsed:
 *
 *   mechanismState  what the INSTRUMENTATION saw
 *     OBSERVED            it saw the request
 *     NOT_OBSERVED        it did not see it
 *     NOT_OBSERVABLE      it could not attach at all
 *     BLOCKED_CONFIRMED   it blocked, AND ground truth agrees nothing arrived
 *
 *   groundTruth     what actually reached the wire, decided by the collector alone
 *     GROUND_TRUTH_ARRIVED
 *     GROUND_TRUTH_NO_ARRIVAL
 *
 * Lack of instrumentation is NEVER evidence that traffic did not occur. That is why the
 * collector is a separate process-external judge and why the two fields are separate.
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { start: startCollector } = require("./collector");
const { CDP } = require("./cdp");

const PORT = 8902, CDP_PORT = 9446;
const MATCH = "127.0.0.1:8902";
const EXT_MECH = path.join(__dirname, "extension");        // message-driven senders
const EXT_RACE = path.join(__dirname, "extension-race");   // sends immediately on load
const CHROME = process.env.CHROME_PATH || "/opt/chrome-linux64/chrome";
const RUNS = Number(process.env.RUNS || 5);

const now = () => Number(process.hrtime.bigint() / 1000000n);

async function browserWs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  return (await r.json()).webSocketDebuggerUrl;
}

function classify({ attachable, observed, blocked, arrived, senderAttempted }) {
  const groundTruth = arrived ? "GROUND_TRUTH_ARRIVED" : "GROUND_TRUTH_NO_ARRIVAL";
  let mechanismState;
  if (!attachable) mechanismState = "NOT_OBSERVABLE";
  else if (blocked && !arrived) mechanismState = "BLOCKED_CONFIRMED";
  else if (observed) mechanismState = "OBSERVED";
  else mechanismState = "NOT_OBSERVED";
  const falseGreen = mechanismState === "NOT_OBSERVED" && arrived;
  const didNotOccur = !senderAttempted && !arrived;
  return { mechanismState, groundTruth, falseGreen, didNotOccur };
}

async function oneRun(cfg, arrivals) {
  const { mode, headless, scenario, enforcement, ext, run, injectFailure } = cfg;
  const before = arrivals.length;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-b02linux-"));
  const observed = [], blocked = [];
  const t = { start: now() };
  const r = {
    run, mode, headless, enforcement, scenario: scenario || null,
    extension: path.basename(ext), injectFailure: injectFailure || null,
    // The mechanism UNDER TEST is Playwright when enforcement is 'playwright', and CDP
    // otherwise. Playwright's route handler always attaches, so a Playwright case must
    // never be labelled NOT_OBSERVABLE -- that would hide its false green as an
    // instrumentation failure.
    attachable: enforcement === "playwright" ? true : mode !== "no-attach",
    attachError: null, senderAttempted: false,
    autoAttachedTargets: [], timings: {},
  };

  const args = [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
                `--remote-debugging-port=${CDP_PORT}`, "--no-sandbox"];
  const ctx = await chromium.launchPersistentContext(udd, {
    headless, executablePath: CHROME, args,
  });

  let cdp = null;
  try {
    if (enforcement === "playwright") {
      await ctx.route("**/*", async (route) => {
        const u = route.request().url();
        if (u.includes(MATCH)) { observed.push(u); blocked.push(u); return route.abort("failed"); }
        return route.continue();
      });
    } else {
      ctx.on("request", (q) => { if (q.url().includes(MATCH)) observed.push(q.url()); });
    }

    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 30000 });
    r.extensionLoaded = true;
    t.swReady = now();

    const wire = (sessionId) => {
      cdp.on(async (msg) => {
        if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== sessionId) return;
        const { requestId, request } = msg.params;
        if (!request.url.includes(MATCH)) {
          return cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
        }
        if (!t.firstPaused) t.firstPaused = now();
        observed.push(request.url);
        if (enforcement === "cdp") {
          blocked.push(request.url);
          return cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sessionId).catch(() => {});
        }
        return cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
      });
    };

    if (mode !== "no-attach") {
      try {
        if (injectFailure === "bad-cdp-endpoint") throw new Error("injected: CDP endpoint unreachable");
        cdp = await CDP.connect(await browserWs());
        t.cdpConnected = now();

        if (mode === "auto-attach") {
          cdp.on(async (msg) => {
            if (msg.method !== "Target.attachedToTarget") return;
            const { sessionId, targetInfo } = msg.params;
            r.autoAttachedTargets.push({ type: targetInfo.type, url: targetInfo.url.slice(0, 90) });
            if (targetInfo.url.includes("offscreen.html") && !t.offscreenAttached) t.offscreenAttached = now();
            try {
              wire(sessionId);
              if (injectFailure !== "fetch-enable-fails") {
                await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
                if (targetInfo.url.includes("offscreen.html")) t.fetchEnabled = now();
              }
            } finally {
              await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
            }
          });
          await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
          t.armed = now();
        }

        // trigger the sender
        if (ext === EXT_RACE) {
          const p = await sw.evaluate(() => globalThis.__b02_race());
          r.senderAttempted = p.senderAttempted;
        } else {
          const p = await sw.evaluate((s) => globalThis.__b02_run(s), { ...scenario, correlationId: `lin-${run}` });
          r.senderAttempted = Array.isArray(p.sends) && p.sends.length > 0;
          r.probe = p;
        }
        t.senderReturned = now();

        if (mode === "late-attach") {
          await cdp.send("Target.setDiscoverTargets", { discover: true });
          let tgt = null;
          const deadline = now() + 4000;
          while (!tgt && now() < deadline) {
            const { targetInfos } = await cdp.send("Target.getTargets");
            tgt = targetInfos.find((x) => x.url.includes("offscreen.html"));
            if (!tgt) await new Promise((z) => setTimeout(z, 120));
          }
          t.targetDiscovered = tgt ? now() : null;
          if (tgt) {
            const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tgt.targetId, flatten: true });
            t.offscreenAttached = now();
            wire(sessionId);
            await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
            t.fetchEnabled = now();
          } else {
            r.attachError = "offscreen target never discovered";
            r.attachable = false;
          }
        }
      } catch (e) {
        r.attachError = String(e).slice(0, 200);
        if (enforcement !== "playwright") r.attachable = false;
      }
    } else {
      if (ext === EXT_RACE) {
        const p = await sw.evaluate(() => globalThis.__b02_race());
        r.senderAttempted = p.senderAttempted;
      } else {
        const p = await sw.evaluate((s) => globalThis.__b02_run(s), { ...scenario, correlationId: `lin-${run}` });
        r.senderAttempted = Array.isArray(p.sends) && p.sends.length > 0;
        r.probe = p;
      }
    }

    await new Promise((z) => setTimeout(z, 2500));
  } catch (e) {
    r.runError = String(e).slice(0, 250);
    r.extensionLoaded = r.extensionLoaded || false;
  } finally {
    const arrived = arrivals.slice(before).filter((a) => !String(a.url).includes("warmup"));
    t.firstArrival = arrived.length ? arrived[0].at : null;
    r.arrivals = arrived.map((a) => ({ url: a.url, bytes: a.bytes, declared: a.declaredAtAll, hashMatches: a.hashMatches }));
    r.observedCount = observed.length;
    r.blockedCount = blocked.length;
    Object.assign(r, classify({
      attachable: r.attachable, observed: observed.length > 0, blocked: blocked.length > 0,
      arrived: arrived.length > 0, senderAttempted: r.senderAttempted }));
    r.timings = {
      swReadyMs: t.swReady ? t.swReady - t.start : null,
      armedMs: t.armed ? t.armed - t.start : null,
      offscreenAttachedMs: t.offscreenAttached ? t.offscreenAttached - t.start : null,
      fetchEnabledMs: t.fetchEnabled ? t.fetchEnabled - t.start : null,
      firstPausedMs: t.firstPaused ? t.firstPaused - t.start : null,
      targetDiscoveredMs: t.targetDiscovered ? t.targetDiscovered - t.start : null,
      instrumentationBeforeSend:
        t.fetchEnabled && t.firstArrival ? t.fetchEnabled <= t.firstArrival
        : t.fetchEnabled && t.firstPaused ? true : null,
    };
    if (cdp) cdp.close();
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  return r;
}

(async () => {
  const { server, arrivals } = await startCollector(PORT);
  const out = { experiment: "W1-B02-1-linux", startedAt: new Date().toISOString(),
                host: "WSL2 Ubuntu 26.04 guest on Windows 11 host", chrome: CHROME, runs: [] };

  const plan = [];
  // Section 3: the five mechanism cases, headful and headless, CDP auto-attach armed.
  for (const headless of [false, true]) {
    plan.push({ name: "A-authorised",   ext: EXT_MECH, scenario: { egress: true }, mode: "auto-attach", enforcement: "observe", headless });
    plan.push({ name: "B-unauthorised", ext: EXT_MECH, scenario: { rogue: true },  mode: "auto-attach", enforcement: "observe", headless });
    plan.push({ name: "C-tampered",     ext: EXT_MECH, scenario: { tamper: true }, mode: "auto-attach", enforcement: "observe", headless });
    plan.push({ name: "D-playwright-enforcing", ext: EXT_MECH, scenario: { egress: true }, mode: "no-attach", enforcement: "playwright", headless });
    plan.push({ name: "E-cdp-enforcing",        ext: EXT_MECH, scenario: { egress: true }, mode: "auto-attach", enforcement: "cdp", headless });
  }
  // Section 4: the race, all three attach modes, headful and headless.
  for (const headless of [false, true]) {
    for (const mode of ["no-attach", "late-attach", "auto-attach"]) {
      plan.push({ name: `race-${mode}`, ext: EXT_RACE, mode, enforcement: "cdp", headless });
    }
  }
  // Section 4: injected failure cases. Must fail CLOSED, i.e. never look like a clean pass.
  plan.push({ name: "fail-cdp-endpoint",   ext: EXT_RACE, mode: "auto-attach", enforcement: "cdp", headless: true, injectFailure: "bad-cdp-endpoint" });
  plan.push({ name: "fail-fetch-enable",   ext: EXT_RACE, mode: "auto-attach", enforcement: "cdp", headless: true, injectFailure: "fetch-enable-fails" });

  for (const c of plan) {
    const reps = c.name.startsWith("race-") ? RUNS : Math.min(RUNS, 3);
    for (let run = 1; run <= reps; run++) {
      let r;
      try { r = await oneRun({ ...c, run }, arrivals); }
      catch (e) { r = { ...c, run, fatal: String(e).slice(0, 220) }; }
      r.case = c.name;
      out.runs.push(r);
      process.stderr.write(`${c.name.padEnd(24)} ${c.headless ? "headless" : "headful "} #${run}  ` +
        `mech=${(r.mechanismState||"-").padEnd(18)} truth=${(r.groundTruth||"-").padEnd(24)} ` +
        `falseGreen=${r.falseGreen}  ${r.attachError || r.runError || r.fatal || ""}\n`);
    }
  }

  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results-linux.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results-linux.json\n");
  process.exit(0);
})();
