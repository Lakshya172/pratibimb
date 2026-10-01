#!/usr/bin/env node
/**
 * M13 — CSP NEGATIVE TESTS (ADR-0013), IN THE REAL EXTENSION. No click is needed or requested.
 *
 * WHAT IS ATTACKED: code injected (raw DevTools `Runtime.evaluate`) into the extension's realms — the
 * offscreen document, the service worker and, in the evidence build, the TR-01 dedicated worker —
 * trying every way it can find to put a request on the wire to a place the build does not name.
 *
 * WHERE ARRIVALS ARE COUNTED, independently of the browser:
 *   · 127.0.0.1:8996, TCP — an HTTP server that records every request and every WebSocket upgrade;
 *   · 127.0.0.1:8996, UDP — a socket that records every datagram (WebRTC/STUN);
 *   · 127.0.0.1:8995 — the frame sink, which records every arrival at the collector origin, any path.
 * Each attempt carries its own path tag, so an arrival names its channel.
 *
 * PHASE A — PRODUCT BUILD. Every channel to 8996 must produce 0 arrivals; the sink path on 8995 must
 *   produce 0 (ADR-0013 pins the product to the reasoner endpoint exactly). Positive controls: the
 *   reasoner endpoint itself IS reachable; the offscreen document reloads with no CSP violation; ORT
 *   and the packaged model load (ORT_SMOKE); the side panel renders with its hashed style applied.
 * PHASE B — EVIDENCE BUILD (TR01_PROBE=1 M3_WORKER_FRAME=1). The test sink IS reachable; every
 *   channel to 8996 still produces 0; one degraded perception pass runs (TR-01 worker, ORT, UI head)
 *   with no CSP violation. The two built policies must differ in one connect-src source only.
 *
 * An attempt that could not be executed is recorded as NOT_RUN and is never a pass.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-csp-negative.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { Cdp } from "../support/cdp-offscreen.mjs";
import { startFrameSink } from "../support/frame-sink.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const APP = join(ROOT, "apps", "extension");
const EXT = join(APP, ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M13-csp-and-stream-determinism", "logs");
const FOREIGN_PORT = 8996;
const CDP_PORT = 9336;
const FOREIGN = `http://127.0.0.1:${FOREIGN_PORT}`;
const REASONER_PATH = "/v1/chat/completions";

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
const TARGET = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-csp-negative.json")), WS);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const build = (env) => execSync("npm run build", { cwd: APP, env: { ...process.env, TR01_PROBE: "", M3_WORKER_FRAME: "", STRUCTURAL_PROBE: "", E6_PROBE: "", EGRESS_EVIDENCE_PROBE: "", ...env }, stdio: "pipe" });
const manifestCsp = () => JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).content_security_policy?.extension_pages ?? null;
const builtStyleHash = () => {
  const t = /<style>([\s\S]*?)<\/style>/.exec(readFileSync(join(EXT, "sidepanel.html"), "utf8"))?.[1];
  return t === undefined ? null : `'sha256-${createHash("sha256").update(t, "utf8").digest("base64")}'`;
};

// ── independent arrival points ────────────────────────────────────────────────────────────────
const foreignArrivals = [];
const foreign = createServer((req, res) => {
  foreignArrivals.push({ at: new Date().toISOString(), proto: "http", method: req.method, path: req.url, origin: req.headers.origin ?? null });
  req.resume();
  res.writeHead(200, { "content-type": "text/plain", "access-control-allow-origin": "*" });
  res.end("ok");
});
foreign.on("upgrade", (req, socket) => {
  foreignArrivals.push({ at: new Date().toISOString(), proto: "upgrade", method: req.method, path: req.url, origin: req.headers.origin ?? null });
  socket.destroy();
});
const udp = createSocket("udp4");
udp.on("message", (msg, rinfo) => foreignArrivals.push({ at: new Date().toISOString(), proto: "udp", bytes: msg.length, from: `${rinfo.address}:${rinfo.port}` }));
const listen = (srv, ...a) => new Promise((ok, fail) => (srv.once("error", fail), srv.listen(...a, ok)));
try {
  await listen(foreign, FOREIGN_PORT, "127.0.0.1");
  await new Promise((ok, fail) => (udp.once("error", fail), udp.bind(FOREIGN_PORT, "127.0.0.1", ok)));
} catch (e) {
  refuse(`could not bind ${FOREIGN} (tcp+udp): ${e.message}`);
}
let sink;
try {
  sink = await startFrameSink({ port: 8995 });
} catch (e) {
  refuse(`the sink could not bind 127.0.0.1:8995: ${e.message}`);
}
const { server, origin } = await startDemoServer(8983);

/**
 * Every channel injected code might use, each aimed at `${base}/${realm}/${channel}`. Document-only
 * channels are skipped (NOT_APPLICABLE) in workers. Navigation-type channels run last and separately.
 */
const ATTEMPTS = (base, realm, sinkUrl) => `(async () => {
  const B = ${JSON.stringify(base)}, R = ${JSON.stringify(realm)}, SINK = ${JSON.stringify(sinkUrl)};
  const u = (c) => B + "/" + R + "/" + c;
  const within = (p, ms = 2500) => Promise.race([Promise.resolve(p), new Promise((r) => setTimeout(() => r("NO_EVENT"), ms))]);
  const doc = typeof document !== "undefined";
  const violations = [];
  (doc ? document : self).addEventListener("securitypolicyviolation", (e) => violations.push({ directive: e.effectiveDirective, blocked: e.blockedURI }));
  const elementLoad = (tag, attr, url, extra) => within(new Promise((r) => { const el = document.createElement(tag); if (extra) extra(el); el.onload = () => r("LOADED"); el.onerror = () => r("ERROR"); el[attr] = url; document.body.appendChild(el); }));
  const t = {};
  const run = async (name, fn) => { try { t[name] = await fn(); } catch (e) { t[name] = "THREW " + (e && e.name); } };
  await run("fetch", () => within(fetch(u("fetch"), { method: "POST", body: "x" }).then((r) => "RESPONSE " + r.status, (e) => "REJECTED " + e.name)));
  await run("xhr", () => typeof XMLHttpRequest === "undefined" ? "NOT_APPLICABLE" : within(new Promise((r) => { const x = new XMLHttpRequest(); x.onload = () => r("RESPONSE " + x.status); x.onerror = () => r("ERROR"); x.open("POST", u("xhr")); x.send("x"); })));
  await run("webSocket", () => within(new Promise((r) => { const w = new WebSocket(u("ws").replace("http", "ws")); w.onopen = () => r("OPEN"); w.onerror = () => r("ERROR"); })));
  await run("eventSource", () => typeof EventSource === "undefined" ? "NOT_APPLICABLE" : within(new Promise((r) => { const s = new EventSource(u("es")); s.onopen = () => { s.close(); r("OPEN"); }; s.onerror = () => { s.close(); r("ERROR"); }; })));
  await run("sendBeacon", () => typeof navigator.sendBeacon !== "function" ? "NOT_APPLICABLE" : (navigator.sendBeacon(u("beacon"), "x") ? "QUEUED" : "REFUSED"));
  await run("importScripts", () => typeof importScripts !== "function" ? "NOT_APPLICABLE" : (importScripts(u("importscripts")), "LOADED"));
  await run("dynamicImport", () => within(import(u("import.js")).then(() => "LOADED", (e) => "REJECTED " + e.name)));
  await run("webRtcStun", () => typeof RTCPeerConnection === "undefined" ? "NOT_APPLICABLE" : within(new Promise(async (r) => { const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:127.0.0.1:${FOREIGN_PORT}" }] }); pc.createDataChannel("x"); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { pc.close(); r("GATHERED"); } }; await pc.setLocalDescription(await pc.createOffer()); }), 4000));
  if (doc) {
    await run("img", () => elementLoad("img", "src", u("img")));
    await run("iframe", () => elementLoad("iframe", "src", u("iframe")));
    await run("object", () => elementLoad("object", "data", u("object")));
    await run("embed", () => elementLoad("embed", "src", u("embed")));
    await run("script", () => elementLoad("script", "src", u("script.js")));
    await run("stylesheet", () => elementLoad("link", "href", u("style.css"), (el) => { el.rel = "stylesheet"; }));
    await run("prefetch", () => elementLoad("link", "href", u("prefetch"), (el) => { el.rel = "prefetch"; }));
    await run("video", () => elementLoad("video", "src", u("video")));
    await run("audio", () => elementLoad("audio", "src", u("audio")));
    await run("cssBackgroundImage", async () => { const d = document.createElement("div"); d.style.cssText = "width:10px;height:10px"; d.style.backgroundImage = "url(" + u("cssbg") + ")"; document.body.appendChild(d); getComputedStyle(d).backgroundImage; await new Promise((r) => setTimeout(r, 800)); return "APPLIED"; });
    await run("font", () => within(new FontFace("m13x", "url(" + u("font") + ")").load().then(() => "LOADED", (e) => "REJECTED " + e.name)));
    await run("worker", () => within(new Promise((r) => { try { const w = new Worker(u("worker.js")); w.onerror = () => r("ERROR"); setTimeout(() => r("NO_ERROR"), 1500); } catch (e) { r("THREW " + e.name); } })));
    await run("windowOpen", () => { const w = window.open(u("open")); return w ? "OPENED" : "NULL"; });
    await run("formSubmit", async () => { const f = document.createElement("form"); f.method = "POST"; f.action = u("form"); f.target = "_blank"; document.body.appendChild(f); f.submit(); await new Promise((r) => setTimeout(r, 800)); return "SUBMITTED"; });
    await run("anchorBlank", async () => { const a = document.createElement("a"); a.href = u("anchorblank"); a.target = "_blank"; document.body.appendChild(a); a.click(); await new Promise((r) => setTimeout(r, 800)); return "CLICKED"; });
    await run("blankIframeOpen", async () => { const f = document.createElement("iframe"); document.body.appendChild(f); const w = f.contentWindow && f.contentWindow.open(u("iframeopen")); await new Promise((r) => setTimeout(r, 800)); return w ? "OPENED" : "NULL"; });
    await run("anchorPing", async () => { const a = document.createElement("a"); a.href = "#x"; a.ping = u("ping"); document.body.appendChild(a); a.click(); await new Promise((r) => setTimeout(r, 500)); return "CLICKED"; });
  }
  if (!doc && typeof chrome !== "undefined" && chrome.tabs) {
    await run("tabsCreate", async () => { const tab = await chrome.tabs.create({ url: u("tabscreate"), active: false }); await new Promise((r) => setTimeout(r, 1200)); return tab ? "CREATED" : "NULL"; });
    await run("windowsCreate", async () => { if (!chrome.windows) return "NOT_APPLICABLE"; const w = await chrome.windows.create({ url: u("windowscreate"), focused: false }); await new Promise((r) => setTimeout(r, 1200)); return w ? "CREATED" : "NULL"; });
  }
  if (!doc && typeof clients !== "undefined" && clients.openWindow) await run("clientsOpenWindow", () => within(clients.openWindow(u("openwindow")).then((c) => (c ? "OPENED" : "NULL"), (e) => "REJECTED " + e.name)));
  if (SINK) await run("sinkFramePath", () => within(fetch(SINK, { method: "POST", headers: { "content-type": "image/webp" }, body: new Uint8Array(16) }).then((r) => "RESPONSE " + r.status, (e) => "REJECTED " + e.name)));
  await new Promise((r) => setTimeout(r, 1500));
  return { results: t, violations };
})()`;
/** Navigation of the realm itself, run LAST: it may destroy the document. */
const NAVIGATE = (base, realm) => `(() => { try { location.href = ${JSON.stringify(base)} + "/" + ${JSON.stringify(realm)} + "/navigate"; return "ASSIGNED"; } catch (e) { return "THREW " + e.name; } })()`;

async function attachRealms(context, cdp, extensionOrigin) {
  let off = null;
  for (let i = 0; i < 30 && !off; i++) {
    off = await cdp.attach((t) => t.url.startsWith(extensionOrigin) && t.url.includes("offscreen.html"));
    if (!off) await wait(300);
  }
  const sw = await cdp.attach((t) => t.type === "service_worker" && t.url.startsWith(extensionOrigin));
  return { off, sw };
}

/** CSP violations reported by the browser for a session, from the Log and console domains. */
async function recordViolations(cdp, sessionId) {
  const out = [];
  cdp.on((m) => {
    if (m.sessionId !== sessionId) return;
    const text = m.method === "Log.entryAdded" ? m.params.entry.text : m.method === "Runtime.consoleAPICalled" ? m.params.args.map((a) => a.value ?? a.description ?? "").join(" ") : m.method === "Runtime.exceptionThrown" ? m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "" : null;
    if (text && /Content Security Policy|Refused to/i.test(text)) out.push(text.slice(0, 300));
  });
  await cdp.send("Log.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  return out;
}

/**
 * Top-level navigation: a new browsing context or the realm's own. No CSP directive governs these
 * (CSP's `navigate-to` was never shipped), so they are measured and reported as their own class.
 */
const NAVIGATION_CLASS = new Set(["open", "anchorblank", "iframeopen", "tabscreate", "windowscreate", "openwindow", "navigate", /* also outside CSP: */ "webRtcStun(udp)"]);
const arrivalsTagged = (from, realm) => foreignArrivals.slice(from).filter((a) => a.proto === "udp" || String(a.path ?? "").startsWith(`/${realm}/`));
const channelOf = (a) => (a.proto === "udp" ? "webRtcStun(udp)" : String(a.path).split("/")[2]);

async function attackPhase({ name, expectSinkReachable }) {
  const P = { name, csp: manifestCsp() };
  const profile = mkdtempSync(join(tmpdir(), `pratibimb-m13-${name}-`));
  const context = await chromium.launchPersistentContext(profile, { headless: false, executablePath, viewport: { width: 1280, height: 720 }, args: [`--remote-debugging-port=${CDP_PORT}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  let cdp = null;
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
    const extensionOrigin = `chrome-extension://${new URL(sw.url()).host}`;
    sink.expect({ origin: extensionOrigin });
    await sw.evaluate(() => globalThis.__host.ensureOffscreen());
    cdp = await Cdp.connect(CDP_PORT);
    const { off, sw: swT } = await attachRealms(context, cdp, extensionOrigin);
    if (!off || !swT) throw new Error(`attach failed: offscreen ${!!off} worker ${!!swT}`);

    // ── LEGITIMATE RESOURCES (positive controls) ──
    const offViolations = await recordViolations(cdp, off.sessionId);
    await cdp.send("Page.enable", {}, off.sessionId);
    await cdp.send("Page.reload", { ignoreCache: true }, off.sessionId);
    await wait(2_500);
    const ortSmoke = await sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "ORT_SMOKE" }));
    const realm = await sw.evaluate(() => globalThis.__host.toOffscreen({ kind: "REALM_PROBE" }));
    const panel = await context.newPage();
    const panelConsole = [];
    panel.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && panelConsole.push(m.text().slice(0, 300)));
    await panel.goto(`${extensionOrigin}/sidepanel.html`);
    await wait(1_000);
    const panelState = await panel.evaluate(() => ({ bodyMargin: getComputedStyle(document.body).marginTop, preBackground: getComputedStyle(document.querySelector("pre")).backgroundColor, hostStatus: document.documentElement.dataset.hostStatus ?? null }));
    await panel.close();
    P.legitimate = { offscreenReloadViolations: [...offViolations], ortSmoke, perceptionBoot: realm?.perceptionBoot ?? null, sidePanel: { ...panelState, violations: panelConsole } };
    offViolations.length = 0;

    // Dedicated workers are reachable only through auto-attach on their document's session.
    const autoAttached = [];
    cdp.on((m) => m.method === "Target.attachedToTarget" && m.sessionId === off.sessionId && autoAttached.push({ sessionId: m.params.sessionId, type: m.params.targetInfo.type, url: m.params.targetInfo.url }));
    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, off.sessionId);
    // ── evidence build only: one degraded perception pass (TR-01 worker, ORT, UI head) ──
    if (name === "evidence") {
      const page = await context.newPage();
      await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__maskReady === true);
      const truth = await page.evaluate(() => ({ ...window.__maskTruth, cssWidth: document.documentElement.clientWidth }));
      await page.bringToFront();
      await wait(1_200);
      const identity = await sw.evaluate(() => [...globalThis.__host.hellos].reverse()[0]?.identity ?? null);
      const pass = await sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", op: "pass", ...a }), { tabId: identity.tabId, frameId: identity.frameId, cssWidth: truth.cssWidth, inkRects: truth.sensitiveInk.map((s) => s.rect), controlRects: truth.control.map((c) => c.rect) });
      P.legitimate.perceptionPass = { error: pass?.error ?? null, route: pass?.summary?.route ?? null, detectorRan: pass?.summary?.redaction?.detector?.ran ?? null, outcome: pass?.summary?.redaction?.outcome ?? null, violationsDuringPass: [...offViolations] };
      offViolations.length = 0;
    }

    // ── ATTACKS ──
    const sinkUrl = sink.url; // /m10/frame on 8995
    const sinkBefore = sink.arrivals.length;
    P.attacks = {};
    const realms = [["offscreen", off.sessionId], ["serviceWorker", swT.sessionId]];
    const tr01Worker = name === "evidence" ? autoAttached.find((t) => t.type === "worker" && t.url.includes("tr01-worker")) ?? null : null;
    if (tr01Worker) {
      await cdp.send("Runtime.enable", {}, tr01Worker.sessionId);
      realms.push(["tr01Worker", tr01Worker.sessionId]);
    }
    P.tr01WorkerAttached = name === "evidence" ? tr01Worker !== null : "NOT_APPLICABLE";
    for (const [realmName, sessionId] of realms) {
      const from = foreignArrivals.length;
      const sinkFrom = sink.arrivals.length;
      const r = await cdp.evaluate(sessionId, ATTEMPTS(FOREIGN, realmName, sinkUrl));
      await wait(1_500);
      const arrived = arrivalsTagged(from, realmName);
      P.attacks[realmName] = {
        injected: r?.exception ? { exception: r.exception } : r.results,
        violationsSeenInRealm: r?.violations ?? null,
        foreignArrivals: arrived,
        foreignArrivalChannels: [...new Set(arrived.map(channelOf))],
        sinkArrivals: sink.arrivals.slice(sinkFrom).map(({ path, accepted, reason }) => ({ path, accepted, reason })),
      };
    }
    // WebRTC POSITIVE CONTROL: the same STUN attempt from an ordinary web page. If UDP arrives from the
    // page and not from the extension, the observer works and the extension result means something.
    if (name === "product") {
      const page = await context.newPage();
      await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      const uFrom = foreignArrivals.length;
      const r = await page.evaluate((port) => Promise.race([new Promise(async (ok) => { const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:127.0.0.1:${port}` }] }); pc.createDataChannel("x"); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === "complete") { pc.close(); ok("GATHERED"); } }; await pc.setLocalDescription(await pc.createOffer()); }), new Promise((ok) => setTimeout(() => ok("NO_EVENT"), 4000))]), FOREIGN_PORT);
      await wait(500);
      P.webRtcControl = { page: r, udpArrivals: foreignArrivals.slice(uFrom).filter((a) => a.proto === "udp").length };
      await page.close();
    }
    // Positive control for the authorised destination: the reasoner endpoint exactly.
    const rFrom = sink.arrivals.length;
    P.reasonerEndpointControl = { result: await cdp.evaluate(off.sessionId, `fetch(${JSON.stringify(`http://127.0.0.1:8995${REASONER_PATH}`)}, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => "RESPONSE " + r.status, (e) => "REJECTED " + e.name)`) };
    await wait(500);
    P.reasonerEndpointControl.arrivals = sink.arrivals.slice(rFrom).map(({ path }) => path);
    // Navigation of the offscreen document itself, last.
    const nFrom = foreignArrivals.length;
    P.navigation = { result: await cdp.evaluate(off.sessionId, NAVIGATE(FOREIGN, "offscreen")).catch((e) => `CDP ${e.message}`) };
    await wait(2_000);
    P.navigation.arrivals = arrivalsTagged(nFrom, "offscreen");
    P.sinkArrivalsTotal = sink.arrivals.slice(sinkBefore).map(({ path }) => path);
  } finally {
    cdp?.close();
    await context.close();
  }
  const channelArrivals = Object.fromEntries(Object.entries(P.attacks ?? {}).map(([k, v]) => [k, v.foreignArrivalChannels.filter((c) => !NAVIGATION_CLASS.has(c))]));
  const navigationArrivals = Object.fromEntries(Object.entries(P.attacks ?? {}).map(([k, v]) => [k, v.foreignArrivalChannels.filter((c) => NAVIGATION_CLASS.has(c))]));
  const notRun = Object.fromEntries(Object.entries(P.attacks ?? {}).map(([k, v]) => [k, v.injected?.exception ? ["ALL (exception)"] : Object.entries(v.injected).filter(([, s]) => typeof s === "string" && s.startsWith("THREW") && !/SecurityError|NotSupported|TypeError|NetworkError|SyntaxError/.test(s)).map(([c]) => c)]));
  P.checks = {
    everyRealmInjected: Object.values(P.attacks ?? {}).every((v) => !v.injected?.exception),
    // ADR-0013's scope: every channel a CSP directive governs.
    zeroForeignArrivalsThroughCspGovernedChannels: Object.values(channelArrivals).every((c) => c.length === 0),
    reasonerEndpointReachable: P.reasonerEndpointControl?.arrivals?.length === 1 && P.reasonerEndpointControl.arrivals[0] === REASONER_PATH,
    sinkFramePath: expectSinkReachable
      ? Object.values(P.attacks).some((v) => v.sinkArrivals.some((a) => a.path === "/m10/frame"))
      : Object.values(P.attacks).every((v) => v.sinkArrivals.length === 0),
    offscreenReloadsWithoutViolation: P.legitimate.offscreenReloadViolations.length === 0,
    ortAndModelLoad: P.legitimate.ortSmoke?.ok === true || P.legitimate.ortSmoke?.status === "OK" || P.legitimate.ortSmoke?.sessionCreated === true,
    sidePanelStyledAndRunning: P.legitimate.sidePanel.bodyMargin === "12px" && P.legitimate.sidePanel.hostStatus === "ok" && P.legitimate.sidePanel.violations.length === 0,
    ...(name === "evidence" ? { perceptionPassUnderNewCsp: P.legitimate.perceptionPass.error === null && P.legitimate.perceptionPass.detectorRan === true && P.legitimate.perceptionPass.violationsDuringPass.length === 0, tr01WorkerAttacked: P.tr01WorkerAttached === true } : {}),
  };
  P.foreignArrivalChannels = channelArrivals;
  // NOT a CSP check, and not folded into one: reported as its own finding.
  P.navigationClass = { arrivalsByRealm: navigationArrivals, selfNavigationArrivals: (P.navigation?.arrivals ?? []).length, closed: Object.values(navigationArrivals).every((c) => c.length === 0) && (P.navigation?.arrivals ?? []).length === 0 };
  P.unexpectedThrows = notRun;
  console.log(`>>> PHASE ${name}: ${Object.values(P.checks).every(Boolean) ? "PASS" : "FAIL " + Object.entries(P.checks).filter(([, v]) => !v).map(([k]) => k).join(",")}`);
  console.log(`    CSP-governed foreign arrivals by realm: ${JSON.stringify(channelArrivals)}`);
  console.log(`    NAVIGATION CLASS: ${JSON.stringify(navigationArrivals)} self-navigation ${(P.navigation?.arrivals ?? []).length} → ${P.navigationClass.closed ? "closed" : "OPEN"}`);
  if (P.webRtcControl) console.log(`    WebRTC control (a web page): ${JSON.stringify(P.webRtcControl)}`);
  return P;
}

const record = { experiment: "M13 — ADR-0013 CSP negative tests in the real extension (no click)", phases: {} };
try {
  console.log("building the PRODUCT extension…");
  build({});
  const productCsp = manifestCsp();
  const productStyleHash = builtStyleHash();
  record.phases.product = await attackPhase({ name: "product", expectSinkReachable: false });
  console.log("building the EVIDENCE extension (TR01_PROBE=1, M3_WORKER_FRAME=1)…");
  build({ TR01_PROBE: "1", M3_WORKER_FRAME: "1" });
  const evidenceCsp = manifestCsp();
  record.phases.evidence = await attackPhase({ name: "evidence", expectSinkReachable: true });
  const strip = (csp) => csp.replace(/connect-src [^;]*/, "connect-src <X>");
  record.policies = {
    product: productCsp,
    evidence: evidenceCsp,
    differOnlyInConnectSrc: strip(productCsp) === strip(evidenceCsp) && productCsp !== evidenceCsp,
    productConnectSrc: /connect-src ([^;]*)/.exec(productCsp)?.[1] ?? null,
    evidenceConnectSrc: /connect-src ([^;]*)/.exec(evidenceCsp)?.[1] ?? null,
    builtSidePanelStyleHashInPolicy: productStyleHash !== null && productCsp.includes(productStyleHash),
  };
} catch (e) {
  record.failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
  console.log(`>>> FAILED: ${record.failure}`);
} finally {
  await new Promise((ok) => server.close(ok));
  await new Promise((ok) => foreign.close(ok));
  udp.close();
  await sink.close();
  console.log("restoring the PRODUCT build…");
  build({});
}
const checks = [...Object.values(record.phases).flatMap((p) => Object.values(p.checks ?? {})), record.policies?.differOnlyInConnectSrc, record.policies?.builtSidePanelStyleHashInPolicy];
const passed = !record.failure && Object.keys(record.phases).length === 2 && checks.every((c) => c === true);
Object.assign(record, {
  /** ADR-0013's scope: every channel a CSP directive governs, plus the legitimate-resource controls. */
  verdict: passed ? "PASS" : "FAIL",
  /**
   * F-M13-1, reported beside the verdict and never folded into it: top-level navigation (window.open,
   * an anchor with target=_blank, open() from an about:blank frame, chrome.tabs/windows.create) is
   * governed by no CSP directive. OPEN here means injected code still reached the foreign origin.
   */
  navigationClass: Object.fromEntries(Object.entries(record.phases).map(([k, p]) => [k, p.navigationClass ?? null])),
  networkBoundaryClosed: passed && Object.values(record.phases).every((p) => p.navigationClass?.closed === true),
  notAClaim: [
    "the foreign origin is a second loopback port standing in for any unauthorised destination",
    "injection is through the DevTools protocol, i.e. code already running in the realm; this bounds what such code can reach, it does not show how it got there",
  ],
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), os: `${process.platform} ${osRelease()}`, cpu: cpus()[0]?.model ?? "unknown", node: process.version, playwright: require2("playwright/package.json").version, browserBinary: executablePath, headless: false },
});
mkdirSync(OUT, { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  ADR-0013 CSP negative tests (CSP-governed channels)`);
console.log(`network boundary closed against injected code: ${record.networkBoundaryClosed ? "YES" : "NO — navigation class open (F-M13-1)"}`);
console.log(`written: ${TARGET}`);
process.exit(passed ? 0 : 1);
