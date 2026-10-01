#!/usr/bin/env node
/**
 * M12 — QG-04 RUNTIME INTERCEPTION, IN THE REAL EXTENSION. No click is needed or requested.
 *
 * PHASE A — THE PRODUCT BUILD. What the shipped extension can send, observed three ways at once:
 *   the DevTools protocol's Network domain on the OFFSCREEN DOCUMENT and the SERVICE WORKER (raw CDP
 *   attach: Playwright does not surface the offscreen document), the test-only sink on 127.0.0.1:8995,
 *   and an independently instrumented FOREIGN origin on 127.0.0.1:8996 that counts every request it is
 *   sent, of any kind. Attempts:
 *     · the M10/M11 evidence messages CSP_PROBE and E4_EMIT — must be unknown to the product;
 *     · code injected into the offscreen document and the worker reaching the foreign origin by every
 *       connect-src primitive (fetch, XHR, WebSocket, sendBeacon, EventSource) — must not arrive;
 *     · the same injected code using channels OUTSIDE connect-src (an image, an iframe) and the
 *       loopback origin the product CSP pins — MEASURED AND RECORDED, whatever they show: the
 *       extension_pages CSP is ADR-0001's and this unit does not change it;
 *     · a bundle scan: no QG-04 sender, no evidence emitter, no frame-egress code in the product.
 *
 * PHASE B — THE EVIDENCE BUILD (TR01_PROBE=1, M3_WORKER_FRAME=1: the degraded route, no click; the
 *   frame is a real tab frame, sanitized in place by the real realm). The probe op `qg04-attempts`
 *   drives the production handoff code with the realm's real MASK_VERIFIED artifact and refuses every
 *   frame state, every forgery, the raw frame and a malformed payload; the structure-only fallback is
 *   checked for image bytes; then ONE explicitly permitted test send reaches the sink. The offscreen
 *   document's Network domain must show exactly that one request.
 *
 * The product build is restored at the end.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-qg04-interception.mjs
 */
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { Cdp } from "../support/cdp-offscreen.mjs";
import { startFrameSink } from "../support/frame-sink.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const APP = join(ROOT, "apps", "extension");
const EXT = join(APP, ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M12-qg04-enforcement", "logs");
const SINK_PORT = 8995;
const FOREIGN_PORT = 8996;
const CDP_PORT = 9335;
const FOREIGN = `http://127.0.0.1:${FOREIGN_PORT}`;

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
const TARGET = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-qg04-interception.json")), WS);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ── builds ──────────────────────────────────────────────────────────────────────────────────────
const bundleFiles = () => [join(EXT, "background.js"), join(EXT, "content-scripts", "content.js"), ...readdirSync(join(EXT, "chunks")).map((f) => join(EXT, "chunks", f))];
const bundleText = () => bundleFiles().map((f) => readFileSync(f, "utf8")).join("\n");
const build = (env) => execSync("npm run build", { cwd: APP, env: { ...process.env, TR01_PROBE: "", M3_WORKER_FRAME: "", STRUCTURAL_PROBE: "", E6_PROBE: "", EGRESS_EVIDENCE_PROBE: "", ...env }, stdio: "pipe" });

/** Strings whose presence in a bundle means a send path or an evidence emitter is compiled in. */
const SEND_PATH_MARKERS = {
  qg04Sender: "PRODUCTION_TRANSPORT_ABSENT",
  qg04Planner: "IMAGE_WITHHELD",
  frameEgress: "FRAME_NOT_MASK_VERIFIED",
  sinkPath: "/m10/frame",
  cspProbe: "host-csp-probe",
  e4Emit: "EMIT_ONLY_FROM_SERVICE_WORKER",
  e4Collector: "NOT_THE_E4_COLLECTOR",
  qg04Protocol: "pratibimb-qg04/1",
};
const scan = (text) => Object.fromEntries(Object.entries(SEND_PATH_MARKERS).map(([k, s]) => [k, text.includes(s)]));

// ── the independently instrumented foreign origin ─────────────────────────────────────────────
const foreignArrivals = [];
const foreign = createServer((req, res) => {
  foreignArrivals.push({ at: new Date().toISOString(), method: req.method, path: req.url, origin: req.headers.origin ?? null, kind: "http" });
  req.resume();
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  res.end("ok");
});
foreign.on("upgrade", (req, socket) => {
  foreignArrivals.push({ at: new Date().toISOString(), method: req.method, path: req.url, origin: req.headers.origin ?? null, kind: "upgrade" });
  socket.destroy();
});
await new Promise((ok, fail) => {
  foreign.once("error", fail);
  foreign.listen(FOREIGN_PORT, "127.0.0.1", ok);
}).catch((e) => refuse(`the foreign origin could not bind ${FOREIGN}: ${e.message}`));

let sink;
try {
  sink = await startFrameSink({ port: SINK_PORT });
} catch (e) {
  refuse(`the sink could not bind 127.0.0.1:${SINK_PORT}: ${e.message}`);
}
const { server, origin } = await startDemoServer(8983);

/** Every connect-src primitive, then the channels outside connect-src, aimed at `base`. */
const channelAttempts = (base, tag) => `(async () => {
  const B = ${JSON.stringify(base)}, T = ${JSON.stringify(tag)};
  const within = (p, ms = 3000) => Promise.race([p, new Promise((r) => setTimeout(() => r("NO_EVENT"), ms))]);
  const out = {};
  out.fetch = await within(fetch(B + "/" + T + "/fetch", { method: "POST", body: "x" }).then((r) => "RESPONSE " + r.status, (e) => "REJECTED " + e.name));
  out.xhr = typeof XMLHttpRequest === "undefined" ? "ABSENT" : await within(new Promise((r) => { const x = new XMLHttpRequest(); x.onload = () => r("RESPONSE " + x.status); x.onerror = () => r("ERROR"); try { x.open("POST", B + "/" + T + "/xhr"); x.send("x"); } catch (e) { r("THREW " + e.name); } }));
  out.webSocket = await within(new Promise((r) => { try { const w = new WebSocket(B.replace("http", "ws") + "/" + T + "/ws"); w.onopen = () => r("OPEN"); w.onerror = () => r("ERROR"); } catch (e) { r("THREW " + e.name); } }));
  out.sendBeacon = typeof navigator.sendBeacon !== "function" ? "ABSENT" : (() => { try { return navigator.sendBeacon(B + "/" + T + "/beacon", "x") ? "QUEUED" : "REFUSED"; } catch (e) { return "THREW " + e.name; } })();
  out.eventSource = typeof EventSource === "undefined" ? "ABSENT" : await within(new Promise((r) => { try { const s = new EventSource(B + "/" + T + "/es"); s.onopen = () => { s.close(); r("OPEN"); }; s.onerror = () => { s.close(); r("ERROR"); }; } catch (e) { r("THREW " + e.name); } }));
  if (typeof document !== "undefined") {
    out.image = await within(new Promise((r) => { const i = new Image(); i.onload = () => r("LOADED"); i.onerror = () => r("ERROR"); i.src = B + "/" + T + "/img?q=1"; }));
    out.iframe = await within(new Promise((r) => { const f = document.createElement("iframe"); f.onload = () => r("LOADED"); f.onerror = () => r("ERROR"); f.src = B + "/" + T + "/iframe"; document.body.appendChild(f); }));
  }
  await new Promise((r) => setTimeout(r, 1000));
  return out;
})()`;

const record = { experiment: "M12 — QG-04 runtime interception in the real extension (no click)", phases: {} };
try {
  // ══ PHASE A: the product build ══════════════════════════════════════════════════════════════
  console.log("building the PRODUCT extension…");
  build({});
  const productManifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
  const productScan = scan(bundleText());
  {
    const A = { build: { csp: productManifest.content_security_policy ?? null, permissions: productManifest.permissions, hostPermissions: productManifest.host_permissions, markers: productScan } };
    const profile = mkdtempSync(join(tmpdir(), "pratibimb-m12a-"));
    const context = await chromium.launchPersistentContext(profile, { headless: false, executablePath, viewport: { width: 1280, height: 720 }, args: [`--remote-debugging-port=${CDP_PORT}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
    let cdp = null;
    try {
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
      const extensionOrigin = `chrome-extension://${new URL(sw.url()).host}`;
      sink.expect({ origin: extensionOrigin });
      await sw.evaluate(() => globalThis.__host.ensureOffscreen());
      cdp = await Cdp.connect(CDP_PORT);
      let off = null;
      for (let i = 0; i < 30 && !off; i++) {
        off = await cdp.attach((t) => t.url.startsWith(extensionOrigin) && t.url.includes("offscreen.html"));
        if (!off) await wait(300);
      }
      const swT = await cdp.attach((t) => t.type === "service_worker" && t.url.startsWith(extensionOrigin));
      if (!off || !swT) throw new Error(`could not attach: offscreen ${!!off}, worker ${!!swT}`);
      const offNet = await cdp.recordNetwork(off.sessionId);
      const swNet = await cdp.recordNetwork(swT.sessionId);
      await cdp.send("Runtime.enable", {}, off.sessionId);
      await cdp.send("Runtime.enable", {}, swT.sessionId);

      // 1. The evidence messages, through the product's own control plane.
      const sinkBefore = sink.arrivals.length;
      const foreignBefore = foreignArrivals.length;
      const offBefore = offNet.all().length;
      A.evidenceMessages = {
        CSP_PROBE: await sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "CSP_PROBE" })),
        E4_EMIT: await sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "E4_EMIT" })),
      };
      await wait(1_000);
      A.evidenceMessages.offscreenRequests = offNet.since(offBefore);
      A.evidenceMessages.sinkArrivals = sink.arrivals.length - sinkBefore;
      A.evidenceMessages.foreignArrivals = foreignArrivals.length - foreignBefore;

      // 2. Injected code, connect-src primitives and others, from the offscreen document and the worker.
      const fBefore = foreignArrivals.length;
      const oBefore = offNet.all().length;
      const wBefore = swNet.all().length;
      A.injectedForeign = {
        offscreen: await cdp.evaluate(off.sessionId, channelAttempts(FOREIGN, "offscreen")),
        worker: await cdp.evaluate(swT.sessionId, channelAttempts(FOREIGN, "worker")),
      };
      await wait(1_500);
      A.injectedForeign.arrivals = foreignArrivals.slice(fBefore);
      A.injectedForeign.offscreenRequests = offNet.since(oBefore);
      A.injectedForeign.workerRequests = swNet.since(wBefore);

      // 3. Injected code aimed at the loopback origin the product CSP pins (measured, not changed).
      const sBefore = sink.arrivals.length;
      A.injectedLoopback = { offscreen: await cdp.evaluate(off.sessionId, `fetch(${JSON.stringify(sink.url)}, { method: "POST", headers: { "content-type": "image/webp" }, body: new Uint8Array(16) }).then((r) => "RESPONSE " + r.status, (e) => "REJECTED " + e.name)`) };
      await wait(500);
      A.injectedLoopback.sinkArrivals = sink.arrivals.slice(sBefore).map(({ path, origin: o, contentType, bytes, accepted, reason }) => ({ path, origin: o, contentType, bytes, accepted, reason }));

      const connectSrc = ["fetch", "xhr", "webSocket", "sendBeacon", "eventSource"];
      const arrivedVia = (realm, ch) => A.injectedForeign.arrivals.some((a) => a.path.startsWith(`/${realm}/${ch === "image" ? "img" : ch === "webSocket" ? "ws" : ch === "eventSource" ? "es" : ch === "sendBeacon" ? "beacon" : ch}`));
      A.connectSrcArrivals = Object.fromEntries(["offscreen", "worker"].map((realm) => [realm, connectSrc.filter((ch) => arrivedVia(realm, ch))]));
      A.outsideConnectSrcArrivals = { offscreen: ["image", "iframe"].filter((ch) => arrivedVia("offscreen", ch)) };
      A.checks = {
        productBundleCarriesNoSendPathOrEmitter: Object.values(productScan).every((v) => v === false),
        cspProbeUnknownToProduct: A.evidenceMessages.CSP_PROBE?.refused === "UNKNOWN_KIND",
        e4EmitUnknownToProduct: A.evidenceMessages.E4_EMIT?.refused === "UNKNOWN_KIND",
        evidenceMessagesCausedNoRequest: A.evidenceMessages.offscreenRequests.length === 0 && A.evidenceMessages.sinkArrivals === 0 && A.evidenceMessages.foreignArrivals === 0,
        injectedConnectSrcPrimitivesNeverArrive: A.connectSrcArrivals.offscreen.length === 0 && A.connectSrcArrivals.worker.length === 0,
      };
      A.findings = {
        channelsOutsideConnectSrcReachedForeignOrigin: A.outsideConnectSrcArrivals.offscreen,
        injectedCodeReachesPinnedLoopback: A.injectedLoopback.sinkArrivals.length > 0,
        note: "recorded, not gated: ADR-0001's extension_pages CSP pins connect-src only; this unit measures it and does not change it",
      };
    } finally {
      cdp?.close();
      await context.close();
    }
    record.phases.productBuild = A;
    console.log(`>>> PHASE A (product): ${Object.values(A.checks ?? {}).every(Boolean) ? "PASS" : "FAIL"} ${JSON.stringify(A.checks ?? {})}`);
    console.log(`    findings: ${JSON.stringify(A.findings ?? {})}`);
  }

  // ══ PHASE B: the evidence build, degraded route, no click ═══════════════════════════════════
  console.log("building the EVIDENCE extension (TR01_PROBE=1, M3_WORKER_FRAME=1 — degraded route, no click)…");
  build({ TR01_PROBE: "1", M3_WORKER_FRAME: "1" });
  const evidenceScan = scan(bundleText());
  {
    const B = { build: { markers: evidenceScan } };
    const profile = mkdtempSync(join(tmpdir(), "pratibimb-m12b-"));
    const context = await chromium.launchPersistentContext(profile, { headless: false, executablePath, viewport: { width: 1280, height: 720 }, args: [`--remote-debugging-port=${CDP_PORT}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
    let cdp = null;
    try {
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
      const extensionOrigin = `chrome-extension://${new URL(sw.url()).host}`;
      await sw.evaluate(() => globalThis.__host.ensureOffscreen());
      cdp = await Cdp.connect(CDP_PORT);
      let off = null;
      for (let i = 0; i < 30 && !off; i++) {
        off = await cdp.attach((t) => t.url.startsWith(extensionOrigin) && t.url.includes("offscreen.html"));
        if (!off) await wait(300);
      }
      if (!off) throw new Error("could not attach to the offscreen document");
      const offNet = await cdp.recordNetwork(off.sessionId);
      const page = await context.newPage();
      await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__maskReady === true);
      const truth = await page.evaluate(() => ({ ...window.__maskTruth, cssWidth: document.documentElement.clientWidth }));
      await page.bringToFront();
      await wait(1_000);
      const identity = await sw.evaluate(() => [...globalThis.__host.hellos].reverse()[0]?.identity ?? null);
      if (!identity) throw new Error("the content script never attached");
      const probe = async (args) => {
        const r = await sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
        if (r?.error) throw new Error(`${args.op}: ${r.error}`);
        return r;
      };
      await wait(700);
      const pass = await probe({ op: "pass", tabId: identity.tabId, frameId: identity.frameId, cssWidth: truth.cssWidth, inkRects: truth.sensitiveInk.map((s) => s.rect), controlRects: truth.control.map((c) => c.rect) });
      B.pass = { route: pass.summary.route, outcome: pass.summary.redaction.outcome, capture: pass.summary.capture, frameHeld: pass.frameHeld };
      sink.expect({ origin: extensionOrigin, width: pass.summary.capture.w, height: pass.summary.capture.h });

      const sinkBefore = sink.arrivals.length;
      const foreignBefore = foreignArrivals.length;
      const netBefore = offNet.all().length;
      const q = await probe({ op: "qg04-attempts", sinkUrl: sink.url });
      await wait(1_000);
      B.attempts = q;
      B.offscreenRequests = offNet.since(netBefore);
      B.sinkArrivals = sink.arrivals.slice(sinkBefore).map(({ path, origin: o, contentType, bytes, sha256, accepted, reason }) => ({ path, origin: o, contentType, bytes, sha256, accepted, reason }));
      B.foreignArrivals = foreignArrivals.length - foreignBefore;

      const plans = Object.values(q.plans ?? {});
      B.checks = {
        realFrameSanitizedInTheRealm: B.pass.outcome === "SANITIZED" && B.pass.frameHeld === true,
        evidenceBuildCarriesTheSender: evidenceScan.qg04Sender === true && evidenceScan.frameEgress === true,
        maskVerifiedAttestedButNotAdmissible: q.frameBodyAttested?.state === "MASK_VERIFIED" && q.maskVerifiedProduction?.sent === false && q.maskVerifiedProduction?.cause === "STATE_NOT_ADMISSIBLE" && q.maskVerifiedTestConfig?.cause === "STATE_NOT_ADMISSIBLE",
        everyForgedStateRefused: ["DETECTOR_VERIFIED", "MASK_VERIFIED", "MASKED_LOCAL", "VERIFIED"].every((s) => q.forged?.[s] === "NOT_ATTESTED"),
        rawFrameNeverAttested: typeof q.rawFrameAttest === "string" && q.rawFrameAttest !== "ATTESTED (WRONG)",
        malformedPayloadRefusedByServerCheck: q.malformedServerCheck?.ok === false,
        frameBodyParsesWithItsFramePart: q.parsedFramePart?.ok === true && q.parsedFramePart.frameBytes > 0,
        everyFallbackStructureOnlyWithoutImage: plans.length === 5 && plans.every((p) => p.mode === "STRUCTURE_ONLY" && p.imageBytes === false && p.productionSend === "CONFIGURATION_MISSING"),
        noRequestBeforeThePermittedSend: q.fetchesBeforePermittedSend === 0,
        exactlyOnePermittedTestSend: q.permittedTestSend?.sent === true && q.permittedTestSend.status === 200 && q.fetchesTotal === 1,
        networkSawExactlyThatOneRequest: B.offscreenRequests.length === 1 && B.offscreenRequests[0].url === sink.url,
        sinkReceivedOnlyThePermittedFrame: B.sinkArrivals.length === 1 && B.sinkArrivals[0].accepted === true && B.sinkArrivals[0].sha256 === q.permittedTestSend?.sha256,
        foreignOriginReceivedNothing: B.foreignArrivals === 0,
      };
    } finally {
      cdp?.close();
      await context.close();
    }
    record.phases.evidenceBuild = B;
    console.log(`>>> PHASE B (evidence): ${Object.values(B.checks ?? {}).every(Boolean) ? "PASS" : "FAIL"} ${JSON.stringify(B.checks ?? {})}`);
  }
} catch (e) {
  record.failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
  console.log(`>>> FAILED: ${record.failure}`);
} finally {
  await new Promise((ok) => server.close(ok));
  await new Promise((ok) => foreign.close(ok));
  await sink.close();
  console.log("restoring the PRODUCT build…");
  build({});
}

const allChecks = Object.values(record.phases).flatMap((p) => Object.values(p.checks ?? {}));
const passed = !record.failure && Object.keys(record.phases).length === 2 && allChecks.length > 0 && allChecks.every(Boolean);
Object.assign(record, {
  verdict: passed ? "PASS" : "FAIL",
  /** Measured, not gated, and NOT closed by this run: they keep B7 open. */
  openFindings: record.phases.productBuild?.findings ?? null,
  notAClaim: [
    "phase B ran on the degraded M3_WORKER_FRAME route with no click; its frame is a real tab frame sanitized in the realm, but the route is not the gesture route",
    "the extension's production QG-04 sender has no origin, no authentication and no transport; nothing here sent a frame off this machine",
    "the foreign origin is a second loopback port standing in for 'anywhere not pinned'; it is not a production server",
  ],
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), os: `${process.platform} ${osRelease()}`, cpu: cpus()[0]?.model ?? "unknown", node: process.version, playwright: require2("playwright/package.json").version, browserBinary: executablePath, headless: false },
});
mkdirSync(OUT, { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  QG-04 runtime interception`);
console.log(`written: ${TARGET}`);
process.exit(passed ? 0 : 1);
