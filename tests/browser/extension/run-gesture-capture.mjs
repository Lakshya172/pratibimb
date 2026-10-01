#!/usr/bin/env node
/**
 * M4 — THE REAL GESTURE CAPTURE ROUTE. **HUMAN-IN-THE-LOOP.**
 *
 * M3.1 built this route and could not run it. Every automated way of producing the invocation
 * Chrome requires was measured and refused: `<all_urls>` does not substitute for `activeTab`, a real
 * click inside an extension page does not, and a keyboard command dispatched over CDP never reaches
 * Chrome's accelerator table. So the route was implemented, unit-tested with the browser faked, and
 * recorded as NOT YET VERIFIED.
 *
 * This harness closes that by asking a person. It is not automated and does not pretend to be: it
 * launches the browser, opens a page, and then **stops** until someone clicks the extension's
 * toolbar button. Nothing here injects a message, dispatches a synthetic event, or sets a flag that
 * stands in for a grant — the whole point is to exercise the browser's own security boundary, and a
 * boundary you talked your way around is not one you tested.
 *
 * WHAT IT RUNS ON. The **product build**: `host_permissions: ["http://127.0.0.1/*"]`, no
 * `<all_urls>`, and no `captureVisibleTab` anywhere in the bundle. It refuses to start otherwise, so
 * this evidence cannot accidentally be taken on the degraded build.
 *
 * WHAT IT PROVES, IF IT PASSES. That a person's click produces an `activeTab` grant; that the grant
 * mints an opaque handle; that the handle reaches the offscreen realm as a STRING; that
 * `getUserMedia` and `ImageCapture.grabFrame` turn it into an `ImageBitmap` in that realm; and that
 * the worker's own recording of everything it saw contains no pixels.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-gesture-capture.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M4-gesture-text-perception", "logs");

/** How long the operator has. Generous: a person is being waited for, not a timeout being tuned. */
const WAIT_MS = Number(process.env.M4_GESTURE_WAIT_MS ?? 300_000);

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

/**
 * THIS EVIDENCE IS ABOUT THE PRODUCT BUILD, SO IT CHECKS THAT IT HAS ONE.
 *
 * A gesture-route run taken on the degraded build would be worth nothing and would look identical
 * in the log. Both halves are checked: the manifest must not carry `<all_urls>`, and the bundle
 * must contain no call to `captureVisibleTab`.
 */
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const workerSource = readFileSync(join(EXT, "background.js"), "utf8");
const hostPermissions = manifest.host_permissions ?? [];
if (hostPermissions.includes("<all_urls>")) {
  refuse("this build carries <all_urls>; rebuild WITHOUT M3_WORKER_FRAME=1 before taking gesture evidence");
}
if (workerSource.includes("tabs.captureVisibleTab")) {
  refuse("this build contains a captureVisibleTab call; it is the degraded build, not the product one");
}
const buildHash = createHash("sha256").update(workerSource).digest("hex");

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

let context = null;
let stopServer = null;
let failure = null;
const steps = {};

try {
  const { server, origin } = await startDemoServer(8975);
  stopServer = () => new Promise((ok) => server.close(ok));

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m4-gesture-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await worker.evaluate(() => globalThis.__host.ensureOffscreen());
  const extensionId = await worker.evaluate(() => chrome.runtime.id);

  const page = await context.newPage();
  await page.goto(`${origin}/visual/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__fixtureReady === true);
  await page.bringToFront();
  await wait(1_500);

  const identity = await worker.evaluate(() => {
    const last = [...globalThis.__host.hellos].reverse()[0];
    return last ? last.identity : null;
  });
  if (!identity) throw new Error("the content script never attached to the fixture");

  // Baseline: before any gesture, the authority must refuse and the browser must agree.
  steps.beforeGesture = {
    captureState: await worker.evaluate(() => globalThis.__host.captureState()),
    ticket: await worker.evaluate((t) => globalThis.__host.ticketProbe(t), identity.tabId),
  };

  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────────────────────┐");
  console.log("  │  HUMAN-IN-THE-LOOP.  This step cannot be automated, by design.           │");
  console.log("  ├──────────────────────────────────────────────────────────────────────────┤");
  console.log("  │  In the Chrome window that just opened:                                  │");
  console.log("  │                                                                          │");
  console.log("  │    1. make sure the fixture tab (127.0.0.1:8975/visual/) is the active   │");
  console.log("  │       one — it should already be in front;                               │");
  console.log("  │    2. click the extension's toolbar button.  If you do not see it, open  │");
  console.log("  │       the puzzle-piece (Extensions) menu and click                       │");
  console.log('  │       "PratiBimb: perceive this tab".                                    │');
  console.log("  │                                                                          │");
  console.log("  │  That click is the whole experiment: it is the only thing Chrome accepts │");
  console.log("  │  as an activeTab grant, and nothing this process can do substitutes.     │");
  console.log("  └──────────────────────────────────────────────────────────────────────────┘");
  console.log(`\n  extension id: ${extensionId}`);
  console.log(`  waiting up to ${Math.round(WAIT_MS / 1000)}s for the click…\n`);

  const startedWaiting = Date.now();
  let grant = null;
  while (Date.now() - startedWaiting < WAIT_MS) {
    const state = await worker.evaluate(() => globalThis.__host.captureState());
    const found = state.grants.find((g) => g.tabId === identity.tabId);
    if (found) {
      grant = found;
      break;
    }
    await wait(500);
  }
  if (!grant) throw new Error(`no invocation arrived within ${WAIT_MS} ms — the route cannot be verified without one`);

  console.log(`  ✓ invocation recorded for tab ${grant.tabId} after ${Date.now() - startedWaiting} ms\n`);
  steps.gesture = { tabId: grant.tabId, at: grant.at, waitedMs: Date.now() - startedWaiting };

  // ── the route, one step at a time, so a failure names which step ────────────────────────────
  steps.mint = await worker.evaluate((t) => globalThis.__host.mintStreamId(t), identity.tabId);
  console.log(`  mint:    ${JSON.stringify(steps.mint)}`);

  steps.consume = await worker.evaluate(() => globalThis.__host.consumeProbe());
  console.log(`  consume: ${JSON.stringify(steps.consume)}`);

  steps.perceive = await worker.evaluate(
    ({ tabId, frameId }) => globalThis.__host.perceiveOnce(tabId, frameId),
    { tabId: identity.tabId, frameId: identity.frameId }
  );
  const p = steps.perceive;
  console.log(
    p?.refused
      ? `  perceive: route=${p.route} REFUSED ${p.refused.code} — ${p.refused.detail}`
      : `  perceive: route=${p?.route} ${p?.capture?.w}x${p?.capture?.h} ${p?.capture?.bytes}B ` +
        `-> ${p?.afterFiltering} detections, fused ${p?.fusion?.matched} matched / ${p?.fusion?.visionOnly} vision-only`
  );
  console.log(`  ms: ${JSON.stringify(p?.ms)}`);

  // ── did any pixel reach the worker? Asked of the worker's own recording, inside the worker ──
  steps.workerTraffic = await worker.evaluate(() => {
    const seen = globalThis.__host.seen;
    const text = JSON.stringify(seen);
    const kinds = {};
    for (const entry of seen) {
      const kind = `${entry.way}:${entry.message?.kind ?? entry.message?.body?.kind ?? entry.message?.op ?? "?"}`;
      kinds[kind] = (kinds[kind] ?? 0) + 1;
    }
    return {
      messages: seen.length,
      bytes: text.length,
      kinds,
      pngSignature: text.includes("iVBORw0KGgo"),
      dataImageUrl: text.includes("data:image"),
      longestBase64Run: (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0),
    };
  });
  console.log(
    `  worker:  ${steps.workerTraffic.messages} messages, ${steps.workerTraffic.bytes} bytes, ` +
      `png=${steps.workerTraffic.pngSignature} dataurl=${steps.workerTraffic.dataImageUrl} ` +
      `longestBase64=${steps.workerTraffic.longestBase64Run}`
  );
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
  console.error(`\n  FAILED: ${failure}`);
} finally {
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

const p = steps.perceive ?? null;
const checks = {
  // Before the click, both the authority and the browser must say no.
  refusedBeforeTheGesture: steps.beforeGesture?.ticket?.ok === false && steps.beforeGesture?.ticket?.refused === "NO_ACTIVE_TAB_GRANT",
  noGrantsBeforeTheGesture: (steps.beforeGesture?.captureState?.grants?.length ?? -1) === 0,
  theBuildHasNoWorkerCapturePath: steps.beforeGesture?.captureState?.workerFrameEnabled === false,

  // The click, and what it unlocked.
  aRealInvocationWasRecorded: typeof steps.gesture?.tabId === "number",
  theGrantMintedAnOpaqueHandle: steps.mint?.ok === true && (steps.mint?.length ?? 0) > 0,

  // The handle became pixels, in the realm that owns them.
  theOffscreenRealmConsumedTheHandle: steps.consume?.ok === true,
  aRealFrameArrivedInThePerceptionRealm: (steps.consume?.w ?? 0) > 0 && (steps.consume?.h ?? 0) > 0,

  // And the whole loop ran on it.
  perceptionRanOnTheStreamRoute: p?.route === "GESTURE_STREAM" && !p?.refused,
  theDetectorRanOnThePinnedArtifact: (p?.afterFiltering ?? -1) >= 0 && (p?.anchors ?? 0) > 0,
  fusionJoinedDomAndVision: (p?.fusion?.matched ?? 0) > 0,

  // What the worker saw.
  theWorkerCarriedTheHandle: (steps.workerTraffic?.kinds?.["to-tab:CAPTURE_TICKET"] ?? 0) > 0,
  noPixelsAnywhereInTheWorkersRecording:
    steps.workerTraffic?.pngSignature === false &&
    steps.workerTraffic?.dataImageUrl === false &&
    (steps.workerTraffic?.longestBase64Run ?? 1) < 200,
};

const failed = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
const passed = failure === null && failed.length === 0;

const record = {
  experiment: "M4-gesture-text-perception / real gesture capture",
  status: passed ? "EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)" : "NOT VERIFIED",
  humanInTheLoop: true,
  invocationMethod:
    "a person clicked the extension's toolbar action on the active tab; nothing in this process " +
    "produced, simulated or substituted for that click",
  claim:
    "a real browser user action granted activeTab, the worker minted an opaque stream handle and " +
    "carried only that, and the offscreen perception realm turned the handle into an ImageBitmap " +
    "itself — with no pixels anywhere in the worker's own recording of everything it saw",
  notAClaim: [
    "not automated, and not claimed to be: the invocation cannot be produced by a harness",
    "one operator, one click, one page, one browser cell",
    "no claim about detection quality; the detector numbers here are CONDITIONAL as in M3.1",
    "no claim of production readiness",
  ],
  build: { hostPermissions, backgroundSha256: buildHash, workerFrameEnabled: false },
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${osRelease()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    headless: false,
    extensionPath: EXT,
    fixture: "tests/browser/extension/fixture/visual.html",
  },
  verdict: passed ? "PASS" : "FAIL",
  failure,
  failedChecks: failed,
  checks,
  steps,
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, evidenceFileName(WS, "cft153-gesture-capture.json"));
assertOwnEvidencePath(file, WS);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${passed ? "PASS" : "FAIL"}  the real gesture capture route  on ${WS.host} (${WS.id})  [HUMAN-IN-THE-LOOP]`);
for (const [name, value] of Object.entries(checks)) console.log(`  ${value === true ? "PASS" : "FAIL"}  ${name}`);
console.log(`\nwritten: ${file}`);
process.exit(passed ? 0 : 1);
