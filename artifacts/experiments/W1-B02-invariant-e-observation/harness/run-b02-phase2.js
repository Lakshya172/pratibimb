/**
 * B-02 phase 2 — target-discovery race, deterministic attachment, failure-to-attach,
 * repeatability, and the bundled-Chromium cell.
 *
 * Every mechanism/scenario pair is classified into exactly one of FIVE states, because
 * conflating them is the defect this whole blocker exists to prevent:
 *
 *   OBSERVED            mechanism saw the request
 *   NOT_OBSERVED        mechanism did not see it, BUT it reached the wire  <-- FALSE GREEN
 *   BLOCKED_CONFIRMED   mechanism blocked it AND the collector confirms nothing arrived
 *   DID_NOT_OCCUR       the sender never attempted, and nothing arrived
 *   NOT_OBSERVABLE      the mechanism could not attach at all  <-- NOT the same as silence
 *
 * Throwaway spike code. Loopback only. No product code.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { start: startCollector } = require("./collector");
const { CDP } = require("./cdp");

const PORT = 8902, CDP_PORT = 9445;
const EXT_RACE = path.join(__dirname, "extension-race");
const MATCH = "127.0.0.1:8902";
const RUNS = Number(process.env.RUNS || 5);
const CFT = "C:\\Users\\OMEN\\cft\\chrome.exe";

async function browserWs() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  return (await r.json()).webSocketDebuggerUrl;
}

function classify({ senderAttempted, mechanismObserved, mechanismBlocked, arrived, attachable }) {
  if (!attachable) return "NOT_OBSERVABLE";
  if (!senderAttempted && !arrived) return "DID_NOT_OCCUR";
  if (mechanismBlocked && !arrived) return "BLOCKED_CONFIRMED";
  if (mechanismObserved) return "OBSERVED";
  if (!mechanismObserved && arrived) return "NOT_OBSERVED";
  return "INDETERMINATE";
}

async function oneRun({ mode, browser, run }, arrivals) {
  const before = arrivals.length;
  const udd = fs.mkdtempSync(path.join(os.tmpdir(), "pratibimb-b02p2-"));
  const observed = [], blocked = [];
  const r = { run, mode, browser, attachable: mode !== "no-attach", attachError: null,
              autoAttachedTargets: [], senderAttempted: false };

  const launch = { headless: false,
    args: [`--disable-extensions-except=${EXT_RACE}`, `--load-extension=${EXT_RACE}`,
           `--remote-debugging-port=${CDP_PORT}`] };
  if (browser === "msedge") launch.channel = "msedge";
  else launch.executablePath = CFT;

  const ctx = await chromium.launchPersistentContext(udd, launch);
  let cdp = null;
  try {
    let sw = ctx.serviceWorkers().find((w) => w.url().startsWith("chrome-extension://"));
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 25000 });

    const wire = (sessionId) => {
      cdp.on(async (msg) => {
        if (msg.method === "Fetch.requestPaused" && msg.sessionId === sessionId) {
          const { requestId, request } = msg.params;
          if (request.url.includes(MATCH)) {
            observed.push(request.url);
            blocked.push(request.url);
            return cdp.send("Fetch.failRequest", { requestId, errorReason: "Failed" }, sessionId).catch(() => {});
          }
          return cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
        }
      });
    };

    if (mode !== "no-attach") {
      try {
        cdp = await CDP.connect(await browserWs());

        if (mode === "auto-attach") {
          // Arm BEFORE the offscreen document exists. New targets start paused, so
          // Fetch is enabled before a single byte can leave.
          cdp.on(async (msg) => {
            if (msg.method !== "Target.attachedToTarget") return;
            const { sessionId, targetInfo } = msg.params;
            r.autoAttachedTargets.push({ type: targetInfo.type, url: targetInfo.url });
            try {
              wire(sessionId);
              await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
            } finally {
              await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
            }
          });
          await cdp.send("Target.setAutoAttach", {
            autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
        }

        const probe = await sw.evaluate(() => globalThis.__b02_race());
        r.senderAttempted = probe.senderAttempted;
        r.sendAttempt = probe.sendAttempt;

        if (mode === "late-attach") {
          // The naive approach: discover the target after the fact.
          await cdp.send("Target.setDiscoverTargets", { discover: true });
          let t = null;
          for (let i = 0; i < 20 && !t; i++) {
            const { targetInfos } = await cdp.send("Target.getTargets");
            t = targetInfos.find((x) => x.url.includes("offscreen.html"));
            if (!t) await new Promise((z) => setTimeout(z, 150));
          }
          if (t) {
            const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
            wire(sessionId);
            await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);
          } else {
            r.attachError = "offscreen target never appeared";
            r.attachable = false;
          }
        }
      } catch (e) {
        r.attachError = String(e).slice(0, 200);
        r.attachable = false;
      }
    } else {
      const probe = await sw.evaluate(() => globalThis.__b02_race());
      r.senderAttempted = probe.senderAttempted;
      r.sendAttempt = probe.sendAttempt;
    }

    await new Promise((z) => setTimeout(z, 2000));
  } catch (e) {
    r.runError = String(e).slice(0, 250);
  } finally {
    const arrived = arrivals.slice(before);
    r.mechanismObserved = observed.length > 0;
    r.mechanismBlocked = blocked.length > 0;
    r.arrivedOnWire = arrived.length;
    r.arrivals = arrived.map((a) => a.url);
    r.classification = classify({
      senderAttempted: r.senderAttempted, mechanismObserved: r.mechanismObserved,
      mechanismBlocked: r.mechanismBlocked, arrived: arrived.length > 0, attachable: r.attachable });
    if (cdp) cdp.close();
    try { await ctx.close(); } catch {}
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch {}
  }
  return r;
}

(async () => {
  const { server, arrivals } = await startCollector(PORT);
  const browsers = process.env.BROWSERS ? process.env.BROWSERS.split(",") : ["msedge", "chromium-bundled"];
  const modes = ["no-attach", "late-attach", "auto-attach"];
  const out = { experiment: "W1-B02-phase2", startedAt: new Date().toISOString(), runs: [] };

  for (const browser of browsers) {
    for (const mode of modes) {
      for (let run = 1; run <= RUNS; run++) {
        process.stderr.write(`\n--- ${browser} / ${mode} / run ${run} ---\n`);
        let r;
        try { r = await oneRun({ mode, browser, run }, arrivals); }
        catch (e) { r = { browser, mode, run, fatal: String(e).slice(0, 220) }; }
        out.runs.push(r);
        process.stderr.write(JSON.stringify({
          cls: r.classification, attempted: r.senderAttempted, observed: r.mechanismObserved,
          blocked: r.mechanismBlocked, arrived: r.arrivedOnWire,
          autoAttached: (r.autoAttachedTargets || []).length, err: r.attachError || r.runError || r.fatal
        }) + "\n");
      }
    }
  }
  out.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, "results-phase2.json"), JSON.stringify(out, null, 2));
  server.close();
  process.stderr.write("\nwrote results-phase2.json\n");
})();
