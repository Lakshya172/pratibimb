#!/usr/bin/env node
/**
 * M10.6 — THE REAL PRODUCT PERCEPTION PASS ON THE REAL GESTURE ROUTE. **HUMAN-IN-THE-LOOP.**
 *
 *   a person's toolbar click → activeTab → getMediaStreamId → offscreen getUserMedia → ImageBitmap
 *     → UI head → TR-01 (full frame, worker) → UNREAD_REGION → fail-closed plan → canonical geometry
 *     → opaque fill in place → the sanitized RGBA frame, kept in the offscreen document
 *
 * Nothing here produces, simulates or substitutes for the click. Every step that CAN be automated
 * runs first; the harness then stops and waits for one real click per browser window.
 *
 * BUILDS, done here so the evidence says what it ran:
 *   1. the PRODUCT build — its background.js, content.js and manifest are hashed;
 *   2. the EVIDENCE build (TR01_PROBE=1), which adds only the offscreen probe and the worker's
 *      measurement instrument. The run REFUSES unless its background.js, content.js and manifest are
 *      byte-identical to the product build's: the capture route, the permissions and the page side are
 *      the product's, exactly. No `<all_urls>`, no captureVisibleTab.
 *   3. After the run, the product build is restored in `.output`.
 *
 * PER WINDOW (one per device scale; Chrome is launched with --force-device-scale-factor):
 *   preflight — fresh profile, extension loaded, fixture ready, content script attested, tab active,
 *   action present, no grant, capture refused by the authority AND by the browser (getMediaStreamId),
 *   probe and instrument answering, product TR-01 host not yet created, no sanitized frame held;
 *   WAIT for the click (a person's; nothing here calls `noteGrant` or dispatches a command);
 *   click evidence — the grant appears, and every pass's ticket is a GESTURE_STREAM handle the
 *   browser minted (it refused before the click);
 *   passes through the offscreen document's own `perceiveTab` (the PERCEIVE_ONCE path):
 *     cold, then N warm (latency); a pass with TR-01's deadline tightened to 50 ms (timeout → whole
 *     regions) and a recovery pass; two passes with a region corrupted INSIDE the realm (REFUSED);
 *     one plain product PERCEIVE_ONCE, whose reply is what the service worker received;
 *   the pass TIMELINE — the realm's stage seam and the worker's DETECT post, in order, with the
 *   DETECT's dimensions (the full frame);
 *   RE-1 ON STREAM FRAMES (the DPR-1 window only; M9 J7): each frozen held-out screenshot is shown
 *   1:1 in the SAME document (no navigation, so the grant still holds), captured through the gesture
 *   stream, and its TR-01 boxes are compared with M8.1's and scored by the frozen RE-1 scorer;
 *   audits — the worker's received-message shapes, WASM memory in both realms, network arrivals in
 *   both realms, and the service worker's own recording of everything it saw.
 *
 * Verification needs no raw copy: the realm's pre-fill seam records the mask and DIGESTS of what must
 * stay unchanged; the sanitized frame is then checked against them.
 *
 * Usage: CHROME_PATH="<chrome for testing>" [M106_DPRS=1,1.25,1.5,2] node tests/browser/extension/run-gesture-redaction.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { redactionMask } from "../../../packages/privacy/src/redactionGeometry.ts";
import { ROOT, startDemoServer } from "../demo/server.mjs";
import { scoreImage } from "../support/redaction-metrics.mjs";
import { connectSrcOf, manifestRouteSha } from "../support/build-route.mjs";
import { fixturesDir, loadBaseline } from "../support/m82-baseline.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const APP = join(ROOT, "apps", "extension");
const EXT = join(APP, ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const DPRS = (process.env.M106_DPRS ?? "1,1.25,1.5,2").split(",").map(Number);
const WAIT_MS = Number(process.env.M106_GESTURE_WAIT_MS ?? 30 * 60_000);
/** The window whose frames are CSS-sized AND device-sized, so M8.1's 1280×720 frames map 1:1. */
const RE1_DPR = Number(process.env.M106_RE1_DPR ?? 1);
const HELD_OUT_DIR = join(fixturesDir(resolveWorkstation()), "screenshots");
const HELD_OUT = JSON.parse(readFileSync(join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"), "utf8"));
/** This workstation's baseline: M8.2's native reference is machine-local. See support/m82-baseline.mjs. */
const BASELINE = loadBaseline("TR-01", resolveWorkstation());
const M105 = JSON.parse(execSync("git show HEAD:artifacts/experiments/M10-visual-redaction-integration/logs/w1-cft-visual-mask.json", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 }));
// The CONVERTED ONNX the product runs (not the upstream `source` weights, which the file names first).
const TR01_SHA256 = /onnx:[\s\S]*?sha256:\s*"([0-9a-f]{64})"/.exec(readFileSync(join(APP, "host-lib", "tr01-pin.ts"), "utf8"))?.[1] ?? null;
const WARM = 10;
/**
 * DRY RUN (M106_DRY_RUN=1): the same passes and audits on the DEGRADED evidence route
 * (M3_WORKER_FRAME=1, captureVisibleTab in the worker, no click). It exists so every step after the
 * click is proven mechanically BEFORE a person is asked to click. Its record is written under a
 * different name and is NEVER gesture evidence: the route differs, and the checks say so.
 */
const DRY = process.env.M106_DRY_RUN === "1";
const GATES = { deadlineMs: 2_000, wasmBudgetBytes: 200 * 1024 * 1024 };

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!TR01_SHA256) refuse("could not read TR-01's pinned SHA-256");
for (const img of HELD_OUT.images) if (!existsSync(join(HELD_OUT_DIR, `${img.image}.png`))) refuse(`missing held-out frame ${img.image}.png`);
// A formal run never overwrites an earlier formal record: this run's output must not exist yet.
const TARGET = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, DRY ? "cft-gesture-redaction-dryrun.json" : "cft-gesture-redaction.json")), WS);
if (!DRY && existsSync(TARGET)) refuse(`${TARGET} already exists; a formal run does not overwrite an earlier record`);

// The machine's state, READ, never changed: power source, plan, load (M10.6 performance note).
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
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const routeFiles = () => ({
  background: sha(join(EXT, "background.js")),
  content: sha(join(EXT, "content-scripts", "content.js")),
  manifest: manifestRouteSha(EXT), connectSrc: connectSrcOf(EXT),
});
const build = (env) => execSync("npm run build", { cwd: APP, env: { ...process.env, TR01_PROBE: "", M3_WORKER_FRAME: "", STRUCTURAL_PROBE: "", E6_PROBE: "", ...env }, stdio: "pipe" });
console.log("building the PRODUCT extension…");
build({});
const productRoute = routeFiles();
console.log(`building the EVIDENCE extension (TR01_PROBE=1${DRY ? ", M3_WORKER_FRAME=1 — DRY RUN" : ""})…`);
build(DRY ? { TR01_PROBE: "1", M3_WORKER_FRAME: "1" } : { TR01_PROBE: "1" });
const evidenceRoute = routeFiles();
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
const background = readFileSync(join(EXT, "background.js"), "utf8");
const offscreenChunks = readdirSync(join(EXT, "chunks")).filter((f) => f.startsWith("offscreen-")).map((f) => readFileSync(join(EXT, "chunks", f), "utf8")).join("");
const buildFacts = {
  productRoute,
  evidenceRoute,
  routeIdenticalToProduct: JSON.stringify({ ...productRoute, connectSrc: null }) === JSON.stringify({ ...evidenceRoute, connectSrc: null }),
  // ADR-0013: the one permitted difference — the evidence build widens the reasoner endpoint to the collector origin.
  connectSrcDiffersOnlyByCollector: productRoute.connectSrc === "'self' http://127.0.0.1:8995/v1/chat/completions" && evidenceRoute.connectSrc === "'self' http://127.0.0.1:8995",
  hostPermissions: manifest.host_permissions ?? [],
  permissions: manifest.permissions ?? [],
  noAllUrls: !(manifest.host_permissions ?? []).includes("<all_urls>"),
  noCaptureVisibleTab: !background.includes("captureVisibleTab"),
  probePresent: offscreenChunks.includes("TR01_PROBE_ONLY_FROM_SERVICE_WORKER"),
};
if (!DRY && !buildFacts.connectSrcDiffersOnlyByCollector) refuse(`the evidence build's connect-src is not the product's widened to the collector origin: ${JSON.stringify(buildFacts)}`);
if (!DRY && !buildFacts.routeIdenticalToProduct) refuse(`the evidence build's capture route differs from the product's: ${JSON.stringify(buildFacts)}`);
if (!DRY && (!buildFacts.noAllUrls || !buildFacts.noCaptureVisibleTab)) refuse("this is not the product capture route");
if (!buildFacts.probePresent) refuse("the evidence build carries no probe");

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
    let b = document.getElementById("__m106_banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "__m106_banner";
      b.style.cssText = "position:absolute;left:20px;top:600px;width:560px;padding:10px 14px;background:#fff3b0;border:2px solid #c08a00;font:bold 18px Arial;color:#222;";
      document.body.appendChild(b);
    }
    b.textContent = t;
  }, text);

const { server, origin } = await startDemoServer(8983);
const cells = [];
try {
  for (const [index, dpr] of DPRS.entries()) {
    const cell = { dpr, window: `${index + 1} of ${DPRS.length}`, realGesture: DRY ? "NOT APPLICABLE (dry run)" : "NOT RECORDED", failure: null, steps: {} };
    let context = null;
    try {
      const profile = mkdtempSync(join(tmpdir(), "pratibimb-m106-"));
      const profileWasEmpty = readdirSync(profile).length === 0;
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        executablePath,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
        args: [`--force-device-scale-factor=${dpr}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
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
        extensionLoaded: typeof (await sw.evaluate(() => globalThis.__host.bootId)) === "string",
        fixturePageServed: fixtureResponse?.status() === 200,
        contentScriptAttested: typeof identity.tabId === "number",
        fixtureTabIsActive: activeTabs.includes(identity.tabId),
        actionPresent: await sw.evaluate(() => typeof chrome.action?.onClicked === "object"),
        noGrantYet: (await sw.evaluate(() => globalThis.__host.captureState())).grants.length === 0,
        captureRefusedBeforeGesture: DRY ? "n/a (dry run: degraded route)" : (await sw.evaluate((t) => globalThis.__host.ticketProbe(t), identity.tabId))?.refused === "NO_ACTIVE_TAB_GRANT",
        // The BROWSER's own gate: Chrome refuses a stream id until the action is invoked on this tab.
        browserRefusesStreamIdBeforeGesture: browserMintBefore?.ok === false,
        instrumentationReady: typeof arrivalsBefore?.arrivals === "number" && productState?.error === undefined,
        productTr01HostNotYetCreated: productState?.tr01 === null,
        noSanitizedFrameHeld: productState?.sanitizedFrameHeld === false,
        pageDevicePixelRatio: truth.dpr,
      };
      cell.preflightDetail = { browserMintBeforeError: browserMintBefore?.error ?? null };
      if (!Object.entries(cell.preflight).filter(([k]) => k !== "pageDevicePixelRatio").every(([, v]) => v === true || typeof v === "string")) {
        throw new Error(`preflight failed: ${JSON.stringify(cell.preflight)}`);
      }

      // ── the human step ──
      if (DRY) {
        console.log(`\n>>> DRY_RUN window=${index + 1}/${DPRS.length} dpr=${dpr}: no click requested (degraded route)`);
      } else {
        console.log(`\n>>> AWAITING_GESTURE window=${index + 1}/${DPRS.length} dpr=${dpr} url=${origin}/mask/`);
        console.log("    In the Chrome for Testing window that just opened, click the PratiBimb toolbar button once");
        console.log('    (puzzle-piece Extensions menu → "PratiBimb: perceive this tab" if it is not pinned).');
      }
      const t0 = Date.now();
      cell.steps.awaitingSince = new Date(t0).toISOString();
      let grant = DRY ? { tabId: identity.tabId, dryRun: true } : null;
      while (!DRY && Date.now() - t0 < WAIT_MS) {
        grant = (await sw.evaluate(() => globalThis.__host.captureState())).grants.find((g) => g.tabId === identity.tabId) ?? null;
        if (grant) break;
        await wait(500);
      }
      if (!grant) throw new Error(`no click arrived within ${WAIT_MS} ms`);
      console.log(DRY ? `>>> DRY_RUN_PROCEEDING window=${index + 1}/${DPRS.length} (no gesture)` : `>>> GESTURE_RECEIVED window=${index + 1}/${DPRS.length}`);
      await banner(page, `Window ${index + 1} of ${DPRS.length}: click received, thank you. Measuring, do not click again.`);
      // Then out of the frame: the banner is text TR-01 would see, and the fixture must match M10.5's.
      await wait(1_500);
      await page.evaluate(() => document.getElementById("__m106_banner")?.remove());
      await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
      cell.steps.gesture = DRY
        ? { dryRun: true, tabId: null, note: "no gesture: degraded route" }
        : { tabId: grant.tabId, grant: Object.fromEntries(Object.entries(grant).filter(([k]) => !/handle|stream/i.test(k))), observedAt: new Date().toISOString(), waitedMs: Date.now() - t0 };

      const probe = async (args) => {
        // The degraded route is rate-limited by the browser (about 2 captures per second).
        if (DRY && args.op === "pass") await wait(700);
        const r = await sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
        if (r?.error) throw new Error(`${args.op}: ${r.error}`);
        return r;
      };
      const base = { tabId: identity.tabId, frameId: identity.frameId, cssWidth: truth.cssWidth, inkRects: truth.sensitiveInk.map((s) => s.rect), controlRects: truth.control.map((c) => c.rect) };

      const cold = await probe({ op: "pass", ...base });
      const warm = [];
      for (let i = 0; i < WARM; i++) warm.push(await probe({ op: "pass", ...base }));
      const timeout = await probe({ op: "pass", ...base, deadlineMs: 50 });
      const recovery = await probe({ op: "pass", ...base });
      const refusedNan = await probe({ op: "pass", ...base, corrupt: "nan-rect" });
      const refusedDup = await probe({ op: "pass", ...base, corrupt: "duplicate-id" });

      // ── RE-1 on STREAM frames (one window): the frozen screenshots, shown 1:1 in this same document ──
      if (dpr === RE1_DPR) {
        const images = [];
        for (const img of HELD_OUT.images) {
          const src = `data:image/png;base64,${readFileSync(join(HELD_OUT_DIR, `${img.image}.png`)).toString("base64")}`;
          const shown = await page.evaluate(async (u) => {
            document.documentElement.style.cssText = "margin:0;padding:0;overflow:hidden;";
            document.body.style.cssText = "margin:0;padding:0;overflow:hidden;";
            document.body.innerHTML = "";
            const el = document.createElement("img");
            el.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;display:block;";
            document.body.appendChild(el);
            await new Promise((ok, no) => { el.onload = ok; el.onerror = no; el.src = u; });
            await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
            return { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, scrollX, scrollY, innerWidth, innerHeight };
          }, src);
          await wait(300);
          const r = await probe({ op: "pass", tabId: identity.tabId, frameId: identity.frameId, cssWidth: truth.cssWidth, inkRects: [], controlRects: [] });
          const detections = r.summary.redaction.detail?.detections ?? [];
          const boxes = detections.map(({ x, y, w, h }) => ({ x, y, w, h }));
          const score = scoreImage({ boxes }, { region: img.region, strings: img.strings });
          const baseScore = BASELINE.heldOut.perImage.find((q) => q.image === img.image);
          images.push({
            image: img.image,
            shown,
            route: r.summary.route,
            capture: r.summary.capture,
            detectorRan: r.summary.redaction.detector.ran,
            detections: detections.length,
            baselineDetections: BASELINE.inputs[img.image].boxes.length,
            boxesAndScoresEqualBaseline: isDeepStrictEqual(detections, BASELINE.inputs[img.image].boxes),
            boxes: detections,
            canonicalMaskForHeldOutRegion: redactionMask(boxes, img.region),
            score,
            // Deep equality, not JSON text: M8.1 stored its fields in its own key order. (The first formal
            // record, w1-cft-gesture-redaction.json, was written with a JSON-text comparison and so reports
            // a score mismatch on every image; recomputed with this comparison, five of six are equal.)
            scoreEqualsBaseline: isDeepStrictEqual({ image: img.image, ...score }, baseScore),
            exposedSensitiveGlyphs: score.exposedSensitiveGlyphs,
            baselineExposedSensitiveGlyphs: baseScore?.exposedSensitiveGlyphs ?? null,
            sensitiveGlyphs: score.sensitiveGlyphs,
          });
        }
        cell.re1Stream = {
          note: "frozen held-out screenshots displayed 1:1 at (0,0) in the granted document, captured through the gesture stream; boxes in capture px",
          images,
          allOnStreamRoute: images.every((i) => i.route === "GESTURE_STREAM" && i.capture?.w === 1280 && i.capture?.h === 720),
          boxesAndScoresEqualBaseline: images.every((i) => i.boxesAndScoresEqualBaseline),
          re1ScoresEqualBaseline: images.every((i) => i.scoreEqualsBaseline),
          zeroExposedSensitiveGlyphs: images.every((i) => i.exposedSensitiveGlyphs === 0),
        };
      }
      if (DRY) await wait(700);
      const plain = await sw.evaluate(({ tabId, frameId }) => globalThis.__host.perceiveOnce(tabId, frameId), { tabId: identity.tabId, frameId: identity.frameId });
      const instrument = await probe({ op: "instrument" });
      const offscreenNet = await probe({ op: "offscreen-arrivals" });
      const swAudit = await sw.evaluate(() => {
        const text = JSON.stringify(globalThis.__host.seen);
        return { messages: globalThis.__host.seen.length, bytes: text.length, png: text.includes("iVBORw0KGgo"), dataUrl: text.includes("data:image"), longestBase64: (text.match(/[A-Za-z0-9+/]{200,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0) };
      });

      const all = [cold, ...warm, recovery];
      // ── the pass timeline: the order the realm actually ran in, and what the worker was given ──
      const orderOf = (p) => {
        const ev = (p.timeline ?? []).map((e) => e.event);
        const at = (name) => ev.indexOf(name);
        const posted = at("worker:detect-posted");
        const reply = ev.findIndex((e, i) => i > posted && e.startsWith("worker:reply:"));
        const seq = [at("stage:frame"), at("stage:uihead:start"), at("stage:uihead:end"), at("stage:tr01:start"), posted, reply, at("stage:tr01:end"), at("stage:findings"), at("maskPlanned"), at("stage:mask:end")];
        const d = (p.timeline ?? []).find((e) => e.event === "worker:detect-posted");
        return {
          inOrder: seq.every((i) => i >= 0) && seq.every((i, k) => k === 0 || i > seq[k - 1]),
          tr01InputIsFullFrame: !!d && d.width === p.summary.capture.w && d.height === p.summary.capture.h && d.rgbaLength === p.summary.capture.w * p.summary.capture.h * 4,
          tr01RunId: d?.runId ?? null,
        };
      };
      const orders = all.map(orderOf);
      // ── click evidence: what the SERVICE WORKER recorded of each ticket (handles reduced to lengths) ──
      const tickets = await sw.evaluate(() => globalThis.__host.seen.filter((s) => s.message?.kind === "CAPTURE_TICKET").map((s) => ({ ok: s.message.ok, route: s.message.route, refused: s.message.refused, handleLength: typeof s.message.handle === "string" ? s.message.handle.length : 0 })));
      const regionArea = (p) => (p.summary.redaction.detail?.masks ?? []).reduce((n, m) => n + m.pixelRects.reduce((k, r) => k + r.w * r.h, 0), 0);
      const verified = (p) =>
        p.frameHeld === true && p.verification && p.verification.maskPixelsNotFill === 0 && p.verification.outsideMaskUnchanged === true &&
        p.verification.controlsUnchanged === true && p.verification.controlPixelsInsideMask === 0;
      const received = instrument.worker?.received ?? [];
      const workerShapesOk = received.length > 0 && received.every((m) =>
        (m.type === "TR01_INIT" && JSON.stringify(m.shape) === JSON.stringify({ protocol: "number", type: "string" })) ||
        (m.type === "TR01_DETECT" && Object.keys(m.shape).join(",") === "height,protocol,rgba,runId,type,width" && /^Uint8ClampedArray\(\d+\)$/.test(m.shape.rgba) && m.shape.height === "number" && m.shape.width === "number" && m.shape.runId === "number"));
      const wasm = (instrument.worker?.wasmBytes ?? NaN) + (instrument.offscreenWasmBytes ?? NaN);

      const m105 = M105.cells.find((c) => c.dpr === 1);
      const coldMasks = (cold.summary.redaction.detail?.masks ?? []).map((m) => ({ regionId: m.regionId, pixelRects: m.pixelRects }));
      const m105Masks = (m105?.normal?.result?.regions ?? []).map((r) => ({ regionId: r.regionId, pixelRects: r.pixelRects }));
      Object.assign(cell, {
        clickEvidence: DRY ? null : {
          clickObserved: typeof cell.steps.gesture?.tabId === "number",
          grantBoundToDocument: cell.steps.gesture?.grant?.documentId ?? "bound on first use",
          browserRefusedStreamIdBeforeClick: cell.preflight.browserRefusesStreamIdBeforeGesture,
          streamIdsMintedAfterClick: tickets.filter((t) => t.ok && t.route === "GESTURE_STREAM" && t.handleLength > 0).length,
          ticketsRefused: tickets.filter((t) => !t.ok).length,
          ticketsOnAnyOtherRoute: tickets.filter((t) => t.ok && t.route !== "GESTURE_STREAM").length,
          offscreenStreamAcquired: all.every((p) => p.summary.route === "GESTURE_STREAM" && p.summary.ran === true && p.summary.capture.format === "live-bitmap"),
          captureFrame: { w: cold.summary.capture.w, h: cold.summary.capture.h },
          perceptionRan: all.every((p) => p.summary.ran === true),
          tr01Ran: all.every((p) => p.summary.redaction.detector.ran === true),
          maskingRan: all.every((p) => p.summary.redaction.outcome === "SANITIZED" && p.summary.redaction.pixelWrites > 0),
        },
        order: { cold: orders[0], allInOrder: orders.every((o) => o.inOrder), allFullFrame: orders.every((o) => o.tr01InputIsFullFrame), tr01RunIds: orders.map((o) => o.tr01RunId), coldTimeline: cold.timeline },
        model: { sha256: cold.tr01?.lastInit?.model?.sha256 ?? null, bytes: cold.tr01?.lastInit?.model?.bytes ?? null, pinned: TR01_SHA256 },
        vsM105Dpr1: {
          note: "informational: M10.5's DPR-1 frame was captureVisibleTab (PNG), this is the tab stream; not a gate",
          m105Detections: m105?.detections ?? null,
          detections: cold.summary.redaction.detector.detections,
          m105Masks,
          masks: coldMasks,
          pixelRectsEqual: JSON.stringify(m105Masks) === JSON.stringify(coldMasks),
        },
        truth: { inkRects: truth.sensitiveInk.length, controls: truth.control.length, cssWidth: truth.cssWidth, pageDpr: truth.dpr },
        stream: { capture: cold.summary.capture, route: cold.summary.route, workerSawPixels: cold.summary.workerSawPixels, viewport: cold.viewport, requestedDeviceScale: dpr, pageDevicePixelRatio: truth.dpr },
        geometry: { visualRegions: cold.visualRegions, cold: cold.summary.redaction.detail ?? null, firstWarm: warm[0]?.summary.redaction.detail ?? null },
        cold: { summary: cold.summary, verification: cold.verification, tr01: cold.tr01, wallMs: cold.wallMs },
        warm: warm.map((w) => ({ detections: w.summary.redaction.detector.detections, maskRects: w.summary.redaction.maskRects, verification: w.verification, ms: w.summary.ms, redactionMs: w.summary.redaction.ms, wallMs: w.wallMs })),
        timeout: { redaction: timeout.summary.redaction, verification: timeout.verification, tr01: timeout.tr01, wholeRegionArea: regionArea(timeout) },
        recovery: { redaction: recovery.summary.redaction, verification: recovery.verification, tr01: recovery.tr01 },
        refused: [refusedNan, refusedDup].map((r) => ({ redaction: r.summary.redaction, frameHeld: r.frameHeld, verification: r.verification })),
        plainPerceiveOnce: { redaction: plain?.redaction ?? null, route: plain?.route ?? null, carriesPixels: carriesPixels(plain) },
        memory: { method: "WASM linear memory, WebAssembly.Memory wrapped before ORT created memory, read from buffer.byteLength", workerWasmBytes: instrument.worker?.wasmBytes ?? null, offscreenWasmBytes: instrument.offscreenWasmBytes ?? null },
        workerAudit: { received: received.length, shapes: [...new Set(received.map((m) => JSON.stringify(m)))].map((s) => JSON.parse(s)), foreignArrivals: instrument.worker?.foreignArrivals ?? null, origins: instrument.worker?.arrivalOrigins ?? null },
        offscreenNetwork: offscreenNet,
        serviceWorkerAudit: swAudit,
        latency: {
          uiHeadInfer: stats(warm.map((w) => w.summary.ms.infer)),
          uiHeadPreprocess: stats(warm.map((w) => w.summary.ms.preprocess)),
          capture: stats(warm.map((w) => w.summary.ms.capture)),
          tr01Warm: stats(warm.map((w) => w.summary.redaction.ms.detector)),
          mapping: stats(warm.map((w) => w.summary.redaction.ms.mapping)),
          plan: stats(warm.map((w) => w.summary.redaction.ms.plan)),
          pixelMapping: stats(warm.map((w) => w.summary.redaction.ms.pixelMapping)),
          fill: stats(warm.map((w) => w.summary.redaction.ms.fill)),
          passTotal: stats(warm.map((w) => w.summary.ms.total)),
          tr01Init: cold.tr01?.lastInit?.ms ?? null,
          coldPassTotal: cold.summary.ms.total,
        },
      });

      cell.checks = {
        // A dry run records no gesture and uses the degraded route, and its check names say so.
        [DRY ? "dryRunProceededWithoutGesture" : "realGestureRecorded"]: DRY ? cell.steps.gesture?.dryRun === true : typeof cell.steps.gesture?.tabId === "number",
        ...(DRY ? {} : {
          browserRefusedStreamIdBeforeClick: cell.clickEvidence.browserRefusedStreamIdBeforeClick,
          everyPassOnABrowserMintedStreamId: cell.clickEvidence.streamIdsMintedAfterClick >= all.length && cell.clickEvidence.ticketsOnAnyOtherRoute === 0,
        }),
        passRanInM9OrderWithFullFrameTr01: cell.order.allInOrder && cell.order.allFullFrame,
        tr01ModelHashVerifiedAtRuntime: cell.model.sha256 === TR01_SHA256,
        [DRY ? "degradedWorkerFrameRoute" : "gestureStreamRoute"]: all.every((p) => p.summary.route === (DRY ? "WORKER_FRAME" : "GESTURE_STREAM") && p.summary.workerSawPixels === DRY && p.summary.ran === true),
        uiHeadThenTr01Ran: all.every((p) => p.summary.detector.ran === true && p.summary.redaction.detector.ran === true),
        tr01FoundText: all.every((p) => p.summary.redaction.detector.detections > 0),
        sanitizedAndVerified: all.every((p) => p.summary.redaction.outcome === "SANITIZED" && p.summary.redaction.failClosed === false && verified(p)),
        everyFixtureInkPixelMasked: all.every((p) => p.verification.ink.length === truth.sensitiveInk.length && p.verification.ink.every((i) => i.pixels > 0 && i.uncovered === 0)),
        rawBitmapClosed: all.every((p) => p.summary.redaction.rawBitmapClosed === true),
        timeoutMasksRegionsWhole:
          timeout.summary.redaction.detector.code === "DETECTOR_TIMEOUT" && timeout.summary.redaction.failClosed === true && verified(timeout) &&
          timeout.verification.maskPixels === regionArea(timeout) && timeout.tr01?.terminations >= 1,
        timeoutRecoveredOnFreshWorker:
          recovery.summary.redaction.detector.ran === true && recovery.summary.redaction.failClosed === false && verified(recovery) &&
          recovery.tr01?.generation > timeout.tr01?.generation && recovery.tr01?.staleDropped === 0,
        refusedIsTerminal: [refusedNan, refusedDup].every((r) => r.summary.redaction.outcome === "REFUSED" && r.frameHeld === false && r.verification === null),
        deadlineEveryWarmTr01Under2000ms: warm.every((w) => w.summary.redaction.ms.detector < GATES.deadlineMs),
        wasmUnder200MB: Number.isFinite(wasm) && wasm <= GATES.wasmBudgetBytes,
        workerReceivedOnlyPixelsDimensionsAndRunIds: workerShapesOk,
        serviceWorkerSawNoPixels: !swAudit.png && !swAudit.dataUrl && swAudit.longestBase64 < 200 && plain?.route === (DRY ? "WORKER_FRAME" : "GESTURE_STREAM") && cell.plainPerceiveOnce.carriesPixels === false,
        noForeignNetwork: instrument.worker?.foreignArrivals === 0 && offscreenNet.foreign === 0,
      };
      if (!DRY && cell.checks.realGestureRecorded) cell.realGesture = "RECORDED";
      console.log(`>>> WINDOW_DONE ${index + 1}/${DPRS.length}: ${Object.values(cell.checks).every(Boolean) ? "PASS" : "FAIL " + Object.entries(cell.checks).filter(([, v]) => !v).map(([k]) => k).join(",")}`);
      if (cell.re1Stream) console.log(`>>> RE1_STREAM boxesEqualBaseline=${cell.re1Stream.boxesAndScoresEqualBaseline} scoresEqualBaseline=${cell.re1Stream.re1ScoresEqualBaseline} zeroExposed=${cell.re1Stream.zeroExposedSensitiveGlyphs}`);
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
  console.log("restoring the PRODUCT build…");
  build({});
}

const passed = cells.length > 0 && cells.every((c) => c.failure === null && Object.values(c.checks ?? {}).every(Boolean));
const record = {
  experiment: DRY ? "M10.6 — DRY RUN of the gesture-redaction harness on the DEGRADED route (not gesture evidence)" : "M10.6 — local redaction wired into the real gesture capture pass",
  verdict: passed ? "PASS" : "FAIL",
  status: DRY ? (passed ? "MECHANICS VERIFIED ON THE DEGRADED ROUTE — NOT GESTURE EVIDENCE" : "DRY RUN FAILED") : passed ? "EXPERIMENTALLY VERIFIED (HUMAN-IN-THE-LOOP)" : "NOT VERIFIED",
  dryRun: DRY,
  humanInTheLoop: !DRY,
  realGesturePerWindow: cells.map((c) => ({ dpr: c.dpr, realGesture: c.realGesture })),
  re1Stream: (() => {
    const r = cells.find((c) => c.re1Stream)?.re1Stream;
    if (!r) return "not run";
    const { images, ...verdicts } = r;
    return verdicts;
  })(),
  machine: machineState,
  invocationMethod: DRY ? "no gesture: the degraded M3_WORKER_FRAME route (captureVisibleTab in the service worker), paced; this record is not gesture evidence" : "a person clicked the extension's toolbar action once per window; nothing in this process produced, simulated or substituted for the click",
  notAClaim: [
    "one synthetic fixture, one workstation, one operator; no recall claim for arbitrary sites",
    "nothing was encoded or sent: the output is the sanitized RGBA frame held in the offscreen document",
    "detector recall is screened at 1280x720 only (M8.1); other cells show this fixture only",
  ],
  build: buildFacts,
  gates: GATES,
  cells,
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), os: `${process.platform} ${osRelease()}`, cpu: cpus()[0]?.model ?? "unknown", node: process.version, playwright: require2("playwright/package.json").version, browserBinary: executablePath, headless: false },
};
mkdirSync(OUT, { recursive: true });
const target = TARGET;
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  ${DRY ? "DRY RUN (degraded route, NOT gesture evidence)" : "real gesture"} → local redaction  (${cells.length} window(s))`);
for (const c of cells) console.log(`  DPR ${c.dpr}: ${c.failure ? `FAILURE ${c.failure}` : Object.values(c.checks).every(Boolean) ? "PASS" : "FAIL"}  stream ${c.stream?.capture?.w}x${c.stream?.capture?.h}`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
