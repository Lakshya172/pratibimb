#!/usr/bin/env node
/**
 * M10.8 — THE FINAL SANITIZED-ARTIFACT VERIFICATION, ON THE REAL GESTURE ROUTE. **HUMAN-IN-THE-LOOP.**
 *
 * The whole of M10.7 runs unchanged in every window (its checks are this unit's regression):
 *   click → tab stream → UI head → TR-01 → fail-closed plan → fill → WebP q62 → MASK_VERIFIED
 *   → egress choke point → test-only sink → independent decode
 * and then, on what the SINK RECEIVED, the frozen verifier's steps 3–6 as the owner set them for M10.8
 * (`tests/browser/support/artifact-verifier.mjs`):
 *   identity (received = attested, a still WebP of the attested size) → decode → differential TR-01
 *   re-read (1920, box threshold 0.3; `verifier-runtime.mjs`, a plain page, not the extension)
 *   → survivors (re-detected text inside a visual-only region) → 12 px re-dilation, at most 3 rounds,
 *   on a verifier copy → PASS (DETECTOR_VERIFIED) or BLOCK.
 * Steps 4–5 as frozen (D2/D3 over recovered text, vault value check) have no input without OCR, and
 * are recorded as NOT RUN.
 *
 * Also, per window: the normal artifact is verified 3 times (determinism, latency); the timeout
 * artifact is verified; a MUTATED copy and a STALE pairing (one artifact's bytes, another's attestation)
 * must BLOCK; REFUSED must give the verifier no input at all. At DPR 1 only, a NEGATIVE CONTROL: an
 * UNMASKED screenshot of the fixture (never through the extension) must BLOCK, so a PASS means
 * something.
 *
 * Usage: CHROME_PATH="<chrome for testing>" [M108_DPRS=1,1.25,1.5,2] [M108_RUN=n] node tests/browser/extension/run-artifact-verifier.mjs
 *        M108_DRY_RUN=1 for the degraded-route rehearsal (never gesture evidence).
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { startFrameSink } from "../support/frame-sink.mjs";
import { readWebpRiff } from "../support/webp-riff.mjs";
import { NOT_RUN, mayHandOff, verifyArtifact } from "../support/artifact-verifier.mjs";
import { VERIFIER_CONFIG, startVerifierRuntime } from "../support/verifier-runtime.mjs";
import { connectSrcOf, manifestRouteSha } from "../support/build-route.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const APP = join(ROOT, "apps", "extension");
const EXT = join(APP, ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const DPRS = (process.env.M108_DPRS ?? "1,1.25,1.5,2").split(",").map(Number);
const WAIT_MS = Number(process.env.M108_GESTURE_WAIT_MS ?? 30 * 60_000);
const BENCH_N = 10;
const DRY = process.env.M108_DRY_RUN === "1";
/** A later formal run is written under its own name: an earlier formal record is never overwritten. */
const RUN = Number(process.env.M108_RUN ?? 1);
const SINK_PORT = 8995;
const GATES = { deadlineMs: 2_000, wasmBudgetBytes: 200 * 1024 * 1024 };
/**
 * The SINK's tolerance, in 8-bit levels: the same value as the producer's `WEBP_MASK_TOLERANCE`, set
 * by the same W1 measurement (q62 decoded the fixture's ink to ≤ 1 level; unmasked text sits on 255).
 * Restated here rather than imported, so the sink does not take its numbers from the producer.
 */
const SINK_TOLERANCE = 8;
const SWATCH = [0x3a, 0x7b, 0xd5];
const PAGE_BG = [0xf4, 0xf1, 0xea];
/** A part of the fixture with nothing drawn on it, in CSS px. */
const BLANK_CSS = { x: 980, y: 580, w: 280, h: 120 };
const FIXTURE_TEXT = ["SYNTH", "Public heading", "data:image", "<html", "iVBORw0KGgo"];

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
const TARGET = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, DRY ? "cft-artifact-verifier-dryrun.json" : RUN > 1 ? `cft-artifact-verifier-run${RUN}.json` : "cft-artifact-verifier.json")), WS);
// The pinned WASM artifact (the file also pins the JS bundle, first; that is not the one executed).
const ORT_WASM_PIN = /artifact:\s*\{[\s\S]*?sha256:\s*"([0-9a-f]{64})"/.exec(readFileSync(join(ROOT, "packages", "security", "src", "generated", "ortPin.ts"), "utf8"))?.[1] ?? null;
const VERIFY_RUNS = 3;
if (!DRY && existsSync(TARGET)) refuse(`${TARGET} already exists; a formal run does not overwrite an earlier record`);
const M106 = JSON.parse(readFileSync(join(OUT, evidenceFileName(WS, "cft-gesture-redaction.json")), "utf8"));

const machineState = (() => {
  if (process.platform !== "win32") return null;
  try {
    const ps = (c) => execSync(`powershell -NoProfile -Command "${c}"`, { encoding: "utf8", timeout: 20_000 }).trim();
    return {
      at: new Date().toISOString(),
      acPower: ps("(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue | Select-Object -First 1).PowerOnline"),
      powerScheme: ps("powercfg /getactivescheme"),
      cpuLoadPercent: ps("(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"),
    };
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200) };
  }
})();

// ── builds ──────────────────────────────────────────────────────────────────────────────────────
const shaFile = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const routeFiles = () => ({ background: shaFile(join(EXT, "background.js")), content: shaFile(join(EXT, "content-scripts", "content.js")), manifest: manifestRouteSha(EXT), connectSrc: connectSrcOf(EXT) });
const bundleText = () => [join(EXT, "background.js"), join(EXT, "content-scripts", "content.js"), ...readdirSync(join(EXT, "chunks")).map((f) => join(EXT, "chunks", f))].map((f) => readFileSync(f, "utf8")).join("\n");
const build = (env) => execSync("npm run build", { cwd: APP, env: { ...process.env, TR01_PROBE: "", M3_WORKER_FRAME: "", STRUCTURAL_PROBE: "", E6_PROBE: "", ...env }, stdio: "pipe" });
console.log("building the PRODUCT extension…");
build({});
const productRoute = routeFiles();
const productBundle = bundleText();
const productManifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
console.log(`building the EVIDENCE extension (TR01_PROBE=1${DRY ? ", M3_WORKER_FRAME=1 — DRY RUN" : ""})…`);
build(DRY ? { TR01_PROBE: "1", M3_WORKER_FRAME: "1" } : { TR01_PROBE: "1" });
const evidenceRoute = routeFiles();
const evidenceBundle = bundleText();
const buildFacts = {
  productRoute,
  evidenceRoute,
  routeIdenticalToProduct: JSON.stringify({ ...productRoute, connectSrc: null }) === JSON.stringify({ ...evidenceRoute, connectSrc: null }),
  // ADR-0013: the one permitted difference — the evidence build widens the reasoner endpoint to the collector origin.
  connectSrcDiffersOnlyByCollector: productRoute.connectSrc === "'self' http://127.0.0.1:8995/v1/chat/completions" && evidenceRoute.connectSrc === "'self' http://127.0.0.1:8995",
  permissions: productManifest.permissions ?? [],
  hostPermissions: productManifest.host_permissions ?? [],
  csp: productManifest.content_security_policy ?? null,
  productBundleCarriesFrameEgress: productBundle.includes("FRAME_NOT_MASK_VERIFIED"),
  productBundleCarriesSinkPath: productBundle.includes("/m10/frame"),
  evidenceBundleCarriesFrameEgress: evidenceBundle.includes("FRAME_NOT_MASK_VERIFIED"),
  noCaptureVisibleTab: !readFileSync(join(EXT, "background.js"), "utf8").includes("captureVisibleTab"),
};
if (!DRY && !buildFacts.connectSrcDiffersOnlyByCollector) refuse(`the evidence build's connect-src is not the product's widened to the collector origin: ${JSON.stringify(buildFacts)}`);
if (!DRY && !buildFacts.routeIdenticalToProduct) refuse(`the evidence build's capture route differs from the product's: ${JSON.stringify(buildFacts)}`);
if (!DRY && !buildFacts.noCaptureVisibleTab) refuse("this is not the product capture route");
if (buildFacts.productBundleCarriesFrameEgress || buildFacts.productBundleCarriesSinkPath) refuse("the PRODUCT bundle carries frame egress");
if (!buildFacts.evidenceBundleCarriesFrameEgress) refuse("the evidence build carries no frame egress probe");

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const stats = (xs) => {
  const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, min: s[0], median: s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2, p90: q(0.9), max: s[s.length - 1] };
};
const carriesPixels = (x) => {
  const t = typeof x === "string" ? x : JSON.stringify(x ?? null);
  return t.includes("iVBORw0KGgo") || t.includes("data:image") || /[A-Za-z0-9+/]{200,}/.test(t);
};
const banner = (page, text) =>
  page.evaluate((t) => {
    let b = document.getElementById("__m107_banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "__m107_banner";
      b.style.cssText = "position:absolute;left:20px;top:600px;width:560px;padding:10px 14px;background:#fff3b0;border:2px solid #c08a00;font:bold 18px Arial;color:#222;";
      document.body.appendChild(b);
    }
    b.textContent = t;
  }, text);
/** CSS rect → the capture pixels WHOLLY inside it. */
const innerPx = (r, s, W, H, inset = 0) => {
  const x0 = Math.max(0, Math.ceil(r.x * s) + inset);
  const y0 = Math.max(0, Math.ceil(r.y * s) + inset);
  const x1 = Math.min(W, Math.floor((r.x + r.w) * s) - inset);
  const y1 = Math.min(H, Math.floor((r.y + r.h) * s) - inset);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
};
const maxChannel = (img, r) => {
  let m = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const o = (y * img.width + x) * 4; m = Math.max(m, img.rgba[o], img.rgba[o + 1], img.rgba[o + 2]); }
  return m;
};
const maxDistance = (img, r, rgb) => {
  let m = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const o = (y * img.width + x) * 4; m = Math.max(m, Math.abs(img.rgba[o] - rgb[0]), Math.abs(img.rgba[o + 1] - rgb[1]), Math.abs(img.rgba[o + 2] - rgb[2])); }
  return m;
};

// ── the sink (refuses to start if the port is taken) ────────────────────────────────────────────
let sink;
try {
  sink = await startFrameSink({ port: SINK_PORT });
} catch (e) {
  refuse(`the sink could not bind 127.0.0.1:${SINK_PORT}: ${e.message}`);
}

const { server, origin } = await startDemoServer(8983);
const cells = [];
try {
  for (const [index, dpr] of DPRS.entries()) {
    const cell = { dpr, window: `${index + 1} of ${DPRS.length}`, realGesture: DRY ? "NOT APPLICABLE (dry run)" : "NOT RECORDED", failure: null, steps: {} };
    const sinkStart = sink.arrivals.length;
    let context = null;
    try {
      const profile = mkdtempSync(join(tmpdir(), "pratibimb-m108-"));
      const profileWasEmpty = readdirSync(profile).length === 0;
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        executablePath,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
        args: [`--force-device-scale-factor=${dpr}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      const pageRequests = [];
      context.on("request", (r) => pageRequests.push(new URL(r.url()).origin));
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
      // Node reports a chrome-extension URL's origin as "null" (an opaque scheme), so it is built from the host.
      const extensionOrigin = `chrome-extension://${new URL(sw.url()).host}`;
      sink.expect({ origin: extensionOrigin });
      const offscreenBefore = await sw.evaluate(() => globalThis.__host.offscreenContexts());
      await sw.evaluate(() => globalThis.__host.ensureOffscreen());
      const page = await context.newPage();
      const fixtureResponse = await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__maskReady === true);
      const truth = await page.evaluate(() => ({ ...window.__maskTruth, cssWidth: document.documentElement.clientWidth, dpr: window.devicePixelRatio }));
      await banner(page, `Window ${index + 1} of ${DPRS.length} (device scale ${dpr}): click the PratiBimb toolbar button once.`);
      await page.bringToFront();
      await wait(1_000);

      // ── automated preflight ──
      const identity = await sw.evaluate(() => [...globalThis.__host.hellos].reverse()[0]?.identity ?? null);
      if (!identity) throw new Error("preflight: the content script never attached");
      const activeTabs = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true })).map((t) => t.id));
      const probeNow = (args) => sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
      const productState = await probeNow({ op: "product-state" });
      const arrivalsBefore = await probeNow({ op: "offscreen-arrivals" });
      const browserMintBefore = await sw.evaluate((t) => globalThis.__host.mintStreamId(t), identity.tabId);
      cell.preflight = {
        freshProfile: profileWasEmpty,
        noOffscreenBeforeThisRun: offscreenBefore === 0,
        fixturePageServed: fixtureResponse?.status() === 200,
        contentScriptAttested: typeof identity.tabId === "number",
        fixtureTabIsActive: activeTabs.includes(identity.tabId),
        actionPresent: await sw.evaluate(() => typeof chrome.action?.onClicked === "object"),
        noGrantYet: (await sw.evaluate(() => globalThis.__host.captureState())).grants.length === 0,
        captureRefusedBeforeGesture: DRY ? "n/a (dry run: degraded route)" : (await sw.evaluate((t) => globalThis.__host.ticketProbe(t), identity.tabId))?.refused === "NO_ACTIVE_TAB_GRANT",
        browserRefusesStreamIdBeforeGesture: browserMintBefore?.ok === false,
        instrumentationReady: typeof arrivalsBefore?.arrivals === "number" && productState?.error === undefined,
        productTr01HostNotYetCreated: productState?.tr01 === null,
        noSanitizedFrameHeld: productState?.sanitizedFrameHeld === false,
        sinkListeningAndIdle: sink.arrivals.length === sinkStart,
        pageDevicePixelRatio: truth.dpr,
      };
      if (!Object.entries(cell.preflight).filter(([k]) => k !== "pageDevicePixelRatio").every(([, v]) => v === true || typeof v === "string")) {
        throw new Error(`preflight failed: ${JSON.stringify(cell.preflight)}`);
      }

      // ── the human step ──
      if (DRY) console.log(`\n>>> DRY_RUN window=${index + 1}/${DPRS.length} dpr=${dpr}: no click requested (degraded route)`);
      else {
        console.log(`\n>>> AWAITING_GESTURE window=${index + 1}/${DPRS.length} dpr=${dpr} url=${origin}/mask/`);
        console.log("    In the Chrome for Testing window that just opened, click the PratiBimb toolbar button once.");
      }
      const t0 = Date.now();
      let grant = DRY ? { tabId: identity.tabId } : null;
      while (!DRY && Date.now() - t0 < WAIT_MS) {
        grant = (await sw.evaluate(() => globalThis.__host.captureState())).grants.find((g) => g.tabId === identity.tabId) ?? null;
        if (grant) break;
        await wait(500);
      }
      if (!grant) throw new Error(`no click arrived within ${WAIT_MS} ms`);
      console.log(DRY ? `>>> DRY_RUN_PROCEEDING window=${index + 1}/${DPRS.length} (no gesture)` : `>>> GESTURE_RECEIVED window=${index + 1}/${DPRS.length}`);
      await banner(page, `Window ${index + 1} of ${DPRS.length}: click received, thank you. Measuring, do not click again.`);
      await wait(1_500);
      await page.evaluate(() => document.getElementById("__m107_banner")?.remove());
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      cell.steps.gesture = DRY ? { dryRun: true, tabId: null } : { tabId: grant.tabId, observedAt: new Date().toISOString(), waitedMs: Date.now() - t0 };

      const probe = async (args) => {
        if (DRY && args.op === "pass") await wait(700);
        const r = await probeNow(args);
        if (r?.error) throw new Error(`${args.op}: ${r.error}`);
        return r;
      };
      const base = { tabId: identity.tabId, frameId: identity.frameId, cssWidth: truth.cssWidth, inkRects: truth.sensitiveInk.map((s) => s.rect), controlRects: truth.control.map((c) => c.rect) };

      // ── the normal pass, then its artifact through egress to the sink ──
      const normal = await probe({ op: "pass", ...base });
      const controlRect = (name) => truth.control.find((c) => c.element === name)?.rect;
      const encodedStats = async () => ({
        flat: (await probe({ op: "region-stats", cssWidth: truth.cssWidth, inset: 4, rects: [{ name: "swatch", rect: controlRect("swatch") }, { name: "blank", rect: BLANK_CSS }] })).stats,
        text: (await probe({ op: "region-stats", cssWidth: truth.cssWidth, inset: 0, rects: [{ name: "control", rect: controlRect("control") }] })).stats,
      });
      const normalStats = await encodedStats();
      const cap = normal.summary.capture;
      sink.expect({ origin: extensionOrigin, width: cap.w, height: cap.h });
      const sinkBeforeNormal = sink.arrivals.length;
      const artNormal = await probe({ op: "artifact", send: true, destination: sink.url, requestId: `w${index + 1}-normal` });
      const sinkAfterNormal = sink.arrivals.length;

      // ── WebP-only cost: encode + decode-back + attest of the kept frame, no detector ──
      const bench = await probe({ op: "artifact-bench", n: BENCH_N });

      // ── what egress must refuse ──
      const sinkBeforeAttempts = sink.arrivals.length;
      const attempts = await probe({ op: "egress-attempts", destination: sink.url });
      const sinkAfterAttempts = sink.arrivals.length;

      // ── timeout: regions masked whole, and the masked artifact continues ──
      const timeout = await probe({ op: "pass", ...base, deadlineMs: 50 });
      const timeoutStats = await encodedStats();
      const artTimeout = await probe({ op: "artifact", send: true, destination: sink.url, requestId: `w${index + 1}-timeout` });

      // ── REFUSED: no frame, so no WebP and no request ──
      const refused = await probe({ op: "pass", ...base, corrupt: "nan-rect" });
      const sinkBeforeRefused = sink.arrivals.length;
      const artRefused = await probe({ op: "artifact", send: true, destination: sink.url, requestId: `w${index + 1}-refused` });
      const sinkAfterRefused = sink.arrivals.length;

      if (DRY) await wait(700);
      const plain = await sw.evaluate(({ tabId, frameId }) => globalThis.__host.perceiveOnce(tabId, frameId), { tabId: identity.tabId, frameId: identity.frameId });
      const instrument = await probe({ op: "instrument" });
      const offscreenNet = await probe({ op: "offscreen-arrivals" });
      const swAudit = await sw.evaluate(() => {
        const text = JSON.stringify(globalThis.__host.seen);
        return { messages: globalThis.__host.seen.length, bytes: text.length, png: text.includes("iVBORw0KGgo"), webpMagic: text.includes("UklGR"), dataUrl: text.includes("data:image"), longestBase64: (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0) };
      });

      // ── INDEPENDENT verification of what the sink accepted, decoded in a page that is not the extension ──
      const decoder = await context.newPage();
      await decoder.goto("about:blank");
      console.log("... verifier runtime starting");
      const verifierRuntime = await startVerifierRuntime(context);
      console.log("... verifier runtime ready");
      /** The verifier's own decode and encode, in the plain decoder page (never the extension). */
      const decodeFrame = async (bytes) => {
        const d = await decoder.evaluate(async (b64) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bin], { type: "image/webp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d", { alpha: false });
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          let s = "";
          for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
          return { width: bmp.width, height: bmp.height, b64: btoa(s) };
        }, Buffer.from(bytes).toString("base64"));
        return { width: d.width, height: d.height, rgba: Buffer.from(d.b64, "base64") };
      };
      const encodeFrame = async (f) =>
        Buffer.from(
          await decoder.evaluate(async ({ b64, w, h }) => {
            const bin = atob(b64);
            const a = new Uint8ClampedArray(bin.length);
            for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
            const c = new OffscreenCanvas(w, h);
            c.getContext("2d", { alpha: false }).putImageData(new ImageData(a, w, h), 0, 0);
            const u = new Uint8Array(await (await c.convertToBlob({ type: "image/webp", quality: 0.62 })).arrayBuffer());
            let s = "";
            for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
            return btoa(s);
          }, { b64: Buffer.from(f.rgba).toString("base64"), w: f.width, h: f.height }),
          "base64"
        );
      let verifierInputs = 0;
      const verify = (bytes, attestation) => {
        verifierInputs++;
        return verifyArtifact({ bytes, attestation, visualRegions: normal.visualRegions, scaleToCss: cap.scaleToCss, decode: decodeFrame, encode: encodeFrame, reRead: (f) => verifierRuntime.detect(f, VERIFIER_CONFIG) });
      };
      const decode = (bytes) =>
        decoder.evaluate(async (b64) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bin], { type: "image/webp" }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d", { alpha: false });
          ctx.drawImage(bmp, 0, 0);
          const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          let s = "";
          for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
          return { width: bmp.width, height: bmp.height, b64: btoa(s) };
        }, Buffer.from(bytes).toString("base64"));
      const accepted = sink.accepted().filter((a) => a.id >= sinkStart);
      const s = cap.w / truth.cssWidth;
      /**
       * CONTROLS, AGAINST WHAT WAS ENCODED. The gate (owner decision, M10.7, after formal runs 1–2): each
       * control region's decoded MEAN within the tolerance of the encoded region's mean, per channel. The
       * worst single pixel — how far any decoded pixel strays outside the encoded region's own
       * [min, max] — is RECORDED with its position and its distance from the region's edge, never gated:
       * WebP q62 is lossy, and on real frames single pixels near high-contrast edges stray further than
       * the tolerance while the region's mean holds. The fixture's CSS colours are recorded beside them.
       */
      const throughWebp = (img, stats) =>
        stats.map((st) => {
          const r = st.px;
          let outOfBand = 0;
          let worstAt = null;
          const sum = [0, 0, 0];
          for (let y = r.y; y < r.y + r.h; y++)
            for (let x = r.x; x < r.x + r.w; x++) {
              const o = (y * img.width + x) * 4;
              for (let k = 0; k < 3; k++) {
                const v = img.rgba[o + k];
                sum[k] += v;
                const excess = Math.max(st.min[k] - v, v - st.max[k]);
                if (excess > outOfBand) {
                  outOfBand = excess;
                  worstAt = { x, y, channel: k, fromRegionEdgePx: Math.min(x - r.x, y - r.y, r.x + r.w - 1 - x, r.y + r.h - 1 - y) };
                }
              }
            }
          const n = r.w * r.h;
          const mean = sum.map((v) => (n ? v / n : null));
          return { name: st.name, px: r, encoded: { min: st.min, max: st.max, mean: st.mean }, decodedMean: mean, meanDelta: Math.max(...mean.map((m, k) => Math.abs(m - st.mean[k]))), worstPixelOutsideEncodedRange: Math.max(0, outOfBand), worstPixelAt: worstAt };
        });
      const verifyReceived = async (a, kind, sentRecord, manifest, rawSha, stats) => {
        const d = await decode(a.bytes);
        const img = { width: d.width, height: d.height, rgba: Buffer.from(d.b64, "base64") };
        const riff = readWebpRiff(a.bytes);
        const latin = a.bytes.toString("latin1");
        const ink = truth.sensitiveInk.map((t) => innerPx(t.rect, s, img.width, img.height)).filter(Boolean).map((r) => maxChannel(img, r));
        const swatchCss = truth.control.find((c) => c.element === "swatch")?.rect;
        const textCss = truth.control.find((c) => c.element === "control")?.rect;
        const swatchPx = swatchCss ? innerPx(swatchCss, s, img.width, img.height, 4) : null;
        const textPx = textCss ? innerPx(textCss, s, img.width, img.height) : null;
        const blankPx = innerPx(BLANK_CSS, s, img.width, img.height, 4);
        const producerInteriors = (manifest?.regions ?? []).flatMap((g) => g.pixelRects).map((r) => (r.w > 8 && r.h > 8 ? maxChannel(img, { x: r.x + 4, y: r.y + 4, w: r.w - 8, h: r.h - 8 }) : null)).filter((v) => v !== null);
        const regionsWhole = kind === "timeout" ? (normal.visualRegions ?? []).map((v) => innerPx(v.rect, s, img.width, img.height, 4)).filter(Boolean).map((r) => maxChannel(img, r)) : null;
        return {
          kind,
          sinkArrivalId: a.id,
          bytes: a.bytes.length,
          receivedSha256: a.sha256,
          sentSha256: sentRecord?.payloadSha256 ?? null,
          attestedSha256: manifest?.webpSha256 ?? null,
          hashChainEqual: a.sha256 === sentRecord?.payloadSha256 && a.sha256 === manifest?.webpSha256,
          peerReceiptAgrees: sentRecord?.peerReceipt?.agrees === true,
          container: riff.ok ? { chunks: riff.chunks.map((c) => c.id), width: riff.width, height: riff.height } : { error: riff.reason },
          decoded: { width: img.width, height: img.height, sha256: sha(img.rgba) },
          dimensionsEqualCapture: img.width === cap.w && img.height === cap.h && riff.width === cap.w && riff.height === cap.h,
          notRawFrame: rawSha !== null && a.sha256 !== rawSha && sha(img.rgba) !== rawSha && a.bytes.length !== cap.w * cap.h * 4,
          noFixtureText: FIXTURE_TEXT.every((t) => !latin.includes(t)),
          inkMaxChannel: ink,
          everyInkPixelDark: ink.length === truth.sensitiveInk.length && ink.every((v) => v <= SINK_TOLERANCE),
          // Against what was ENCODED (the gate):
          controlsThroughWebp: { flat: throughWebp(img, stats.flat), text: throughWebp(img, stats.text) },
          // Against the fixture's CSS colours (informational: includes the tab stream's own colour shift):
          swatchMaxDistanceFromCss: swatchPx ? maxDistance(img, swatchPx, SWATCH) : null,
          blankMaxDistanceFromCss: blankPx ? maxDistance(img, blankPx, PAGE_BG) : null,
          encodedSwatchMeanVsCss: stats.flat.find((x) => x.name === "swatch")?.mean.map((m, k) => m - SWATCH[k]) ?? null,
          encodedBlankMeanVsCss: stats.flat.find((x) => x.name === "blank")?.mean.map((m, k) => m - PAGE_BG[k]) ?? null,
          controlTextBrightest: textPx ? maxChannel(img, textPx) : null,
          producerMaskInteriorsMax: producerInteriors.length ? Math.max(...producerInteriors) : null,
          regionsWholeMax: regionsWhole,
        };
      };
      const sentNormal = artNormal.send?.record ?? null;
      const sentTimeout = artTimeout.send?.record ?? null;
      const receivedNormal = accepted.find((a) => a.sha256 === sentNormal?.payloadSha256) ?? null;
      const receivedTimeout = accepted.find((a) => a.sha256 === sentTimeout?.payloadSha256) ?? null;
      const vNormal = receivedNormal ? await verifyReceived(receivedNormal, "normal", sentNormal, artNormal.encode.manifest, normal.rawRgbaSha256, normalStats) : null;
      const vTimeout = receivedTimeout ? await verifyReceived(receivedTimeout, "timeout", sentTimeout, artTimeout.encode.manifest, timeout.rawRgbaSha256, timeoutStats) : null;
      // ── M10.8: the frozen verifier's steps 3–6 on what the sink received ──
      console.log("... verifying the received artifacts");
      const attestationOf = (enc) => (enc?.ok ? { sha256: enc.sha256, width: enc.width, height: enc.height } : null);
      const verifyNormal = [];
      if (receivedNormal) for (let i = 0; i < VERIFY_RUNS; i++) verifyNormal.push(await verify(receivedNormal.bytes, attestationOf(artNormal.encode)));
      const verifyTimeout = receivedTimeout ? await verify(receivedTimeout.bytes, attestationOf(artTimeout.encode)) : null;
      const mutated = receivedNormal ? Buffer.from(receivedNormal.bytes) : null;
      if (mutated) mutated[mutated.length - 1] ^= 0xff;
      const verifyMutated = mutated ? await verify(mutated, attestationOf(artNormal.encode)) : null;
      const verifyStale = receivedNormal && receivedTimeout ? await verify(receivedNormal.bytes, attestationOf(artTimeout.encode)) : null;
      // REFUSED produced no artifact: there is nothing for the verifier, and it is given nothing.
      const verifierInputsFromRefused = artRefused.encode.ok ? 1 : 0;
      console.log("... normal, timeout, mutated, stale verified");
      // NEGATIVE CONTROL (DPR 1): an UNMASKED screenshot of the fixture, never through the extension.
      let negativeControl = null;
      if (dpr === 1) {
        await page.reload({ waitUntil: "load" });
        await page.waitForFunction(() => window.__maskReady === true);
        const shot = await page.screenshot({ type: "png" });
        const raw = await decoder.evaluate(async (b64) => {
          const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bin], { type: "image/png" }));
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d", { alpha: false });
          ctx.drawImage(bmp, 0, 0);
          const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
          let s = "";
          for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
          return { width: bmp.width, height: bmp.height, b64: btoa(s) };
        }, shot.toString("base64"));
        const unmaskedWebp = await encodeFrame({ width: raw.width, height: raw.height, rgba: Buffer.from(raw.b64, "base64") });
        const riff = readWebpRiff(unmaskedWebp);
        negativeControl = await verifyArtifact({
          bytes: unmaskedWebp,
          attestation: { sha256: sha(unmaskedWebp), width: riff.width, height: riff.height },
          visualRegions: normal.visualRegions,
          scaleToCss: 1,
          decode: decodeFrame,
          encode: encodeFrame,
          reRead: (f) => verifierRuntime.detect(f, VERIFIER_CONFIG),
        });
      }
      console.log("... negative control done");
      const verifierModel = { ...verifierRuntime.model, ortWasmSha256: verifierRuntime.model.ortWasmSha256() };
      await verifierRuntime.close();
      await decoder.close();

      const verified = (p) =>
        p.frameHeld === true && p.verification && p.verification.maskPixelsNotFill === 0 && p.verification.outsideMaskUnchanged === true && p.verification.controlsUnchanged === true && p.verification.controlPixelsInsideMask === 0;
      const received = instrument.worker?.received ?? [];
      const wasm = (instrument.worker?.wasmBytes ?? NaN) + (instrument.offscreenWasmBytes ?? NaN);
      const sinkWindow = sink.arrivals.slice(sinkStart);
      const m106Cell = M106.cells.find((c) => c.dpr === dpr);
      const benchRuns = bench.runs.filter((r) => r.ok);

      const slim = (v) => v && { verdict: v.verdict, status: v.status, reason: v.reason, clearedAtRound: v.clearedAtRound ?? null, identity: v.identity, rounds: v.rounds, ms: v.ms };
      const stable = (v) => JSON.stringify({ verdict: v.verdict, reason: v.reason, rounds: v.rounds });
      Object.assign(cell, {
        verifier: {
          config: VERIFIER_CONFIG,
          model: verifierModel,
          notRun: NOT_RUN,
          normal: verifyNormal.map(slim),
          timeout: slim(verifyTimeout),
          mutated: slim(verifyMutated),
          stale: slim(verifyStale),
          negativeControl: slim(negativeControl),
          inputs: verifierInputs,
          inputsFromRefused: verifierInputsFromRefused,
          identity: {
            rawRgbaSha256: normal.rawRgbaSha256,
            sanitizedRgbaSha256: artNormal.encode.manifest?.sanitizedRgbaSha256 ?? null,
            attestedWebpSha256: artNormal.encode.sha256 ?? null,
            sentWebpSha256: sentNormal?.payloadSha256 ?? null,
            receivedWebpSha256: receivedNormal?.sha256 ?? null,
            producerDecodedRgbaSha256: artNormal.encode.manifest?.decodedRgbaSha256 ?? null,
            verifierDecodedRgbaSha256: verifyNormal[0]?.identity?.decodedSha256 ?? null,
          },
        },
        stream: { capture: cap, route: normal.summary.route, viewport: normal.viewport, requestedDeviceScale: dpr, pageDevicePixelRatio: truth.dpr },
        geometry: { visualRegions: normal.visualRegions, detections: normal.summary.redaction.detail?.detections ?? null, masks: normal.summary.redaction.detail?.masks ?? null },
        normal: { redaction: normal.summary.redaction, verification: normal.verification, rawRgbaSha256: normal.rawRgbaSha256 },
        artifacts: {
          normal: { encode: artNormal.encode, send: artNormal.send, fetchesDuringSend: artNormal.fetchesDuringSend, sinkArrivalsDuringSend: sinkAfterNormal - sinkBeforeNormal },
          timeout: { pass: { code: timeout.summary.redaction.detector.code, failClosed: timeout.summary.redaction.failClosed, verification: timeout.verification }, encode: artTimeout.encode, send: artTimeout.send, fetchesDuringSend: artTimeout.fetchesDuringSend },
          refused: { pass: { outcome: refused.summary.redaction.outcome, code: refused.summary.redaction.refusal?.code ?? null, frameHeld: refused.frameHeld }, encode: artRefused.encode, send: artRefused.send, fetchesDuringSend: artRefused.fetchesDuringSend, sinkArrivalsDuringSend: sinkAfterRefused - sinkBeforeRefused },
        },
        attempts: { ...attempts, sinkArrivalsDuringAttempts: sinkAfterAttempts - sinkBeforeAttempts },
        independent: { normal: vNormal, timeout: vTimeout, tolerance: SINK_TOLERANCE },
        vsM106: {
          note: "informational: the producer's mask rectangles for this window against M10.6's recorded cold-pass masks at the same scale",
          pixelRectsEqual: JSON.stringify((artNormal.encode.manifest?.regions ?? []).map((g) => [g.regionId, g.pixelRects])) === JSON.stringify((m106Cell?.geometry?.cold?.masks ?? []).map((m) => [m.regionId, m.pixelRects])),
        },
        bench: {
          n: bench.runs.length,
          encodeMs: stats(benchRuns.map((r) => r.ms.encode)),
          decodeMs: stats(benchRuns.map((r) => r.ms.decode)),
          checkMs: stats(benchRuns.map((r) => r.ms.check)),
          wallMs: stats(benchRuns.map((r) => r.wallMs)),
          payloadBytes: stats(benchRuns.map((r) => r.bytes)),
          bytesIdenticalAcrossRuns: new Set(benchRuns.map((r) => r.sha256)).size === 1,
          decodedIdenticalAcrossRuns: new Set(benchRuns.map((r) => r.decodedSha256)).size === 1,
          memory: benchRuns[0]?.memory ?? null,
          canvasBackingStoresNote: "two opaque canvases of capture size (encode, decode) are allocated by the browser per run and are not observable from JS; at 4 bytes per pixel that is 2 × w × h × 4 bytes, inferred, not measured",
        },
        sink: { arrivals: sinkWindow.map(({ id, at, method, path, origin: o, contentType, bytes, sha256, accepted: ok, reason }) => ({ id, at, method, path, origin: o, contentType, bytes, sha256, accepted: ok, reason })) },
        memory: { workerWasmBytes: instrument.worker?.wasmBytes ?? null, offscreenWasmBytes: instrument.offscreenWasmBytes ?? null },
        workerAudit: { received: received.length, shapes: [...new Set(received.map((m) => JSON.stringify(m)))].map((x) => JSON.parse(x)), foreignArrivals: instrument.worker?.foreignArrivals ?? null, origins: instrument.worker?.arrivalOrigins ?? null },
        offscreenNetwork: offscreenNet,
        pageRequestOrigins: [...new Set(pageRequests)],
        serviceWorkerAudit: swAudit,
        plainPerceiveOnce: { route: plain?.route ?? null, carriesPixels: carriesPixels(plain) },
      });

      const expectedRefusals = {
        "raw RGBA buffer, shaped like an artifact": "FRAME_NOT_MASK_VERIFIED",
        "the kept sanitized frame object itself": "FRAME_NOT_MASK_VERIFIED",
        "an ImageBitmap": "FRAME_NOT_MASK_VERIFIED",
        "arbitrary bytes": "FRAME_NOT_MASK_VERIFIED",
        "an UNATTESTED WebP of the sanitized frame": "FRAME_NOT_MASK_VERIFIED",
        "empty bytes": "FRAME_NOT_MASK_VERIFIED",
        "malformed WebP-like bytes": "FRAME_NOT_MASK_VERIFIED",
        "an attested frame mutated after attestation": "PAYLOAD_HASH_MISMATCH",
        "an attested frame to a non-loopback destination": "DESTINATION_NOT_LOOPBACK",
      };
      const nonSelf = Object.entries(offscreenNet.byOrigin ?? {}).filter(([o]) => o !== extensionOrigin);
      cell.checks = {
        [DRY ? "dryRunProceededWithoutGesture" : "realGestureRecorded"]: DRY ? cell.steps.gesture?.dryRun === true : typeof cell.steps.gesture?.tabId === "number",
        [DRY ? "degradedWorkerFrameRoute" : "gestureStreamRoute"]: [normal, timeout].every((p) => p.summary.route === (DRY ? "WORKER_FRAME" : "GESTURE_STREAM") && p.summary.ran === true),
        m106MaskVerifiedOnRealFrame: normal.summary.redaction.outcome === "SANITIZED" && verified(normal) && normal.verification.ink.every((i) => i.pixels > 0 && i.uncovered === 0),
        artifactAttestedFromSanitizedFrame: artNormal.encode.ok === true && artNormal.encode.manifest?.status === "MASK_VERIFIED" && artNormal.encode.manifest?.sanitizedRgbaSha256 !== normal.rawRgbaSha256,
        webpDimensionsEqualCapture: artNormal.encode.width === cap.w && artNormal.encode.height === cap.h,
        maskRectsCarriedToArtifact: JSON.stringify((artNormal.encode.manifest?.regions ?? []).map((g) => g.pixelRects)) === JSON.stringify((normal.summary.redaction.detail?.masks ?? []).map((m) => m.pixelRects)),
        sentThroughEgressAndAcceptedOnce: artNormal.send?.sent === true && artNormal.send.record.responseStatus === 200 && sinkAfterNormal - sinkBeforeNormal === 1 && artNormal.fetchesDuringSend === 1,
        hashSentEqualsReceivedEqualsAttested: vNormal?.hashChainEqual === true && vNormal?.peerReceiptAgrees === true,
        receivedIsNotTheRawFrame: vNormal?.notRawFrame === true,
        receivedDimensionsEqualCapture: vNormal?.dimensionsEqualCapture === true,
        receivedCarriesNoFixtureText: vNormal?.noFixtureText === true && vTimeout?.noFixtureText === true,
        independentlyEveryInkPixelMasked: vNormal?.everyInkPixelDark === true,
        independentlyProducerMaskHeld: vNormal?.producerMaskInteriorsMax !== null && vNormal.producerMaskInteriorsMax <= SINK_TOLERANCE,
        independentlyControlsPreservedThroughWebp: [vNormal, vTimeout].every(
          (v) =>
            v !== null &&
            v.controlsThroughWebp.flat.length === 2 &&
            v.controlsThroughWebp.flat.every((r) => r.px.w > 0 && r.px.h > 0 && r.meanDelta <= SINK_TOLERANCE) &&
            v.controlsThroughWebp.text.every((r) => r.px.w > 0 && r.meanDelta <= SINK_TOLERANCE)
        ),
        timeoutMaskedWholeAndSent: timeout.summary.redaction.detector.code === "DETECTOR_TIMEOUT" && timeout.summary.redaction.failClosed === true && artTimeout.send?.sent === true && vTimeout !== null && (vTimeout.regionsWholeMax ?? []).length > 0 && vTimeout.regionsWholeMax.every((v) => v <= SINK_TOLERANCE) && vTimeout.hashChainEqual === true,
        refusedNoWebpNoRequest: refused.summary.redaction.outcome === "REFUSED" && artRefused.encode.ok === false && artRefused.encode.code === "NO_SANITIZED_FRAME" && artRefused.send?.attempted === false && artRefused.fetchesDuringSend === 0 && sinkAfterRefused === sinkBeforeRefused,
        everyUnverifiedAttemptRefusedBeforeTheWire: attempts.results.length === Object.keys(expectedRefusals).length && attempts.results.every((r) => r.sent === false && r.cause === expectedRefusals[r.name]) && attempts.fetchesDuringAttempts === 0 && sinkAfterAttempts === sinkBeforeAttempts,
        sinkAcceptedOnlyTheTwoArtifacts: sinkWindow.length === 2 && sinkWindow.every((x) => x.accepted && x.origin === extensionOrigin && x.contentType === "image/webp"),
        networkOnlyToTheSink: nonSelf.length === 1 && nonSelf[0][0] === sink.origin && nonSelf[0][1] === 2 && instrument.worker?.foreignArrivals === 0,
        serviceWorkerSawNoPixels: !swAudit.png && !swAudit.webpMagic && !swAudit.dataUrl && swAudit.longestBase64 < 200 && cell.plainPerceiveOnce.carriesPixels === false,
        workerReceivedOnlyPixelsDimensionsAndRunIds: received.length > 0 && received.every((m) => (m.type === "TR01_INIT" && JSON.stringify(m.shape) === JSON.stringify({ protocol: "number", type: "string" })) || (m.type === "TR01_DETECT" && Object.keys(m.shape).join(",") === "height,protocol,rgba,runId,type,width")),
        wasmUnder200MB: Number.isFinite(wasm) && wasm <= GATES.wasmBudgetBytes,
        detectorUnder2000ms: normal.summary.redaction.ms.detector < GATES.deadlineMs,
        // ── M10.8 ──
        verifierRuntimePinned: verifierModel.sha256 === verifierModel.pinned && verifierModel.ortWasmSha256 === ORT_WASM_PIN,
        verifierPassesTheRealArtifact: verifyNormal.length === VERIFY_RUNS && verifyNormal.every((v) => v.verdict === "PASS" && mayHandOff(v)),
        verifierDeterministic: verifyNormal.length === VERIFY_RUNS && new Set(verifyNormal.map(stable)).size === 1,
        verifierPassesTheTimeoutArtifact: verifyTimeout?.verdict === "PASS",
        mutatedArtifactBlocked: verifyMutated?.verdict === "BLOCK" && verifyMutated.reason === "IDENTITY_MISMATCH" && !mayHandOff(verifyMutated),
        staleAttestationBlocked: verifyStale?.verdict === "BLOCK" && verifyStale.reason === "IDENTITY_MISMATCH",
        refusedGaveTheVerifierNothing: verifierInputsFromRefused === 0 && verifierInputs === VERIFY_RUNS + 3,
        artifactIdentityChain:
          !!normal.rawRgbaSha256 &&
          cell.verifier.identity.sanitizedRgbaSha256 !== normal.rawRgbaSha256 &&
          cell.verifier.identity.attestedWebpSha256 === cell.verifier.identity.sentWebpSha256 &&
          cell.verifier.identity.sentWebpSha256 === cell.verifier.identity.receivedWebpSha256 &&
          verifyNormal.every((v) => v.identity.receivedSha256 === cell.verifier.identity.attestedWebpSha256),
        ...(dpr === 1 ? { negativeControlBlocked: negativeControl?.verdict === "BLOCK" && /^SURVIVORS_/.test(negativeControl.reason ?? "") } : {}),
      };
      if (!DRY && cell.checks.realGestureRecorded) cell.realGesture = "RECORDED";
      console.log(`>>> WINDOW_DONE ${index + 1}/${DPRS.length}: ${Object.values(cell.checks).every(Boolean) ? "PASS" : "FAIL " + Object.entries(cell.checks).filter(([, v]) => !v).map(([k]) => k).join(",")}`);
    } catch (e) {
      cell.failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
      console.log(`>>> WINDOW_FAILED ${index + 1}/${DPRS.length}: ${cell.failure}`);
    } finally {
      if (context) await context.close();
    }
    cells.push(cell);
  }
} finally {
  await new Promise((ok) => server.close(ok));
  await sink.close();
  console.log("restoring the PRODUCT build…");
  build({});
}

const passed = cells.length > 0 && cells.every((c) => c.failure === null && Object.values(c.checks ?? {}).every(Boolean));
const record = {
  experiment: DRY ? "M10.8 — DRY RUN of the artifact-verifier harness on the DEGRADED route (not gesture evidence)" : "M10.8 — the frozen verifier's steps 3–6 (as set for M10.8) on the sanitized WebP the test sink received, on the real gesture route",
  verdict: passed ? "PASS" : "FAIL",
  status: DRY ? (passed ? "MECHANICS VERIFIED ON THE DEGRADED ROUTE — NOT GESTURE EVIDENCE" : "DRY RUN FAILED") : passed ? "EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)" : "NOT VERIFIED",
  dryRun: DRY,
  humanInTheLoop: !DRY,
  invocationMethod: DRY ? "no gesture: the degraded M3_WORKER_FRAME route, paced; not gesture evidence" : "a person clicked the extension's toolbar action once per window; nothing in this process produced, simulated or substituted for the click",
  realGesturePerWindow: cells.map((c) => ({ dpr: c.dpr, realGesture: c.realGesture })),
  notAClaim: [
    "MASK-VERIFIED is steps 1–2 of the frozen verifier (mask, then WebP q62 decoded back). OCR re-read, D2/D3 re-detection, the vault value check and the 12 px re-dilation loop did not run",
    "the sink is a test-only loopback collector; nothing was sent off this machine and no production egress exists",
    "one synthetic fixture, one workstation, one operator; the M10.6 stream-vs-screenshot detector finding is unchanged by this unit",
  ],
  sinkTolerance: SINK_TOLERANCE,
  verifier: { config: VERIFIER_CONFIG, notRun: NOT_RUN, runsPerNormalArtifact: VERIFY_RUNS },
  build: buildFacts,
  gates: GATES,
  machine: machineState,
  cells,
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), os: `${process.platform} ${osRelease()}`, cpu: cpus()[0]?.model ?? "unknown", node: process.version, playwright: require2("playwright/package.json").version, browserBinary: executablePath, headless: false },
};
mkdirSync(OUT, { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  ${DRY ? "DRY RUN (degraded route, NOT gesture evidence)" : "real gesture"} → sanitized WebP → loopback → final verifier  (${cells.length} window(s))`);
for (const c of cells) console.log(`  DPR ${c.dpr}: ${c.failure ? `FAILURE ${c.failure}` : Object.values(c.checks).every(Boolean) ? "PASS" : "FAIL"}  stream ${c.stream?.capture?.w}x${c.stream?.capture?.h}  webp ${c.artifacts?.normal?.encode?.bytes ?? "?"} B`);
console.log(`written: ${TARGET}`);
process.exit(passed ? 0 : 1);
