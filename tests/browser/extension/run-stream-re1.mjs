#!/usr/bin/env node
/**
 * M12 Part Q — RE-1 ON REAL PRODUCT STREAM FRAMES (ADR-0012 §9, BLOCKER B5, M9 J7). **HUMAN-IN-THE-LOOP.**
 *
 *   a person's toolbar click → activeTab → getMediaStreamId → offscreen getUserMedia → stream frame
 *     → UI head → TR-01 (full frame, the frozen pin) → fail-closed plan → canonical geometry
 *
 * The frozen held-out set H1–H6 (1280×720 screenshots, never written) is shown 1:1 at (0,0) in the
 * granted document; each is captured through the gesture stream THREE times; TR-01's boxes are scored
 * by the frozen RE-1 scorer (`scoreImage`, the M8.1 code) against the held-out ground truth. Four
 * windows, one click each, at device scale 1, 1.25, 1.5 and 2.
 *
 * NOTHING IS TUNED: TR-01's preprocessing, thresholds, post-processing, the canonical geometry and the
 * RE-1 thresholds are the committed ones; this harness only reads and scores.
 *
 * MEASURED per window and image: G1 exposed sensitive glyphs, G2 over-mask ratio, G3 largest box share,
 * G4 determinism (boxes byte-identical across the three passes), box deviation from M8.1's recorded
 * screenshot boxes, the page's devicePixelRatio, the capture's dimensions and its scaleToCss.
 *
 * THE VERDICT IS RE-1's OWN. J7/B5 is reported CLOSED only if, in every window, every image passes
 * G1, G2 and G3 and its three passes are identical (G4). Otherwise OPEN. G5 (WASM validity vs native)
 * and G6 (no plaintext output) are not properties of a capture route and are carried over, not re-run.
 *
 * DRY RUN (M12_DRY_RUN=1): the degraded `M3_WORKER_FRAME` route, no click; mechanics only, written under
 * its own name, never stream evidence and never a closure.
 *
 * Usage: CHROME_PATH="<chrome for testing>" [M12_DPRS=1,1.25,1.5,2] node tests/browser/extension/run-stream-re1.mjs
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { scoreImage } from "../support/redaction-metrics.mjs";
import { connectSrcOf, manifestRouteSha } from "../support/build-route.mjs";
import { baselinePath, fixturesDir, loadBaseline } from "../support/m82-baseline.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const APP = join(ROOT, "apps", "extension");
const EXT = join(APP, ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M12-qg04-enforcement", "logs");
const DPRS = (process.env.M12_DPRS ?? "1,1.25,1.5,2").split(",").map(Number);
const WAIT_MS = Number(process.env.M12_GESTURE_WAIT_MS ?? 30 * 60_000);
const PASSES = 3;
const DRY = process.env.M12_DRY_RUN === "1";
const HELD_OUT_DIR = join(fixturesDir(resolveWorkstation()), "screenshots");
const HELD_OUT = JSON.parse(readFileSync(join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"), "utf8"));
/** This workstation's baseline: M8.2's native reference is machine-local. See support/m82-baseline.mjs. */
const BASELINE = loadBaseline("TR-01", resolveWorkstation());
const TR01_SHA256 = /onnx:[\s\S]*?sha256:\s*"([0-9a-f]{64})"/.exec(readFileSync(join(APP, "host-lib", "tr01-pin.ts"), "utf8"))?.[1] ?? null;

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
/** A later formal run is written under its own name: an earlier formal record is never overwritten. */
const RUN = Number(process.env.M12_RUN ?? 1);
const TARGET = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, DRY ? "cft-stream-re1-dryrun.json" : RUN > 1 ? `cft-stream-re1-run${RUN}.json` : "cft-stream-re1.json")), WS);
if (!DRY && existsSync(TARGET)) refuse(`${TARGET} already exists; a formal run does not overwrite an earlier record`);
const heldOutSha = Object.fromEntries(HELD_OUT.images.map((i) => [i.image, createHash("sha256").update(readFileSync(join(HELD_OUT_DIR, `${i.image}.png`))).digest("hex")]));

// ── builds: the evidence build's capture route must be the product's, byte for byte ────────────
const shaFile = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const routeFiles = () => ({ background: shaFile(join(EXT, "background.js")), content: shaFile(join(EXT, "content-scripts", "content.js")), manifest: manifestRouteSha(EXT), connectSrc: connectSrcOf(EXT) });
const build = (env) => execSync("npm run build", { cwd: APP, env: { ...process.env, TR01_PROBE: "", M3_WORKER_FRAME: "", STRUCTURAL_PROBE: "", E6_PROBE: "", EGRESS_EVIDENCE_PROBE: "", ...env }, stdio: "pipe" });
console.log("building the PRODUCT extension…");
build({});
const productRoute = routeFiles();
console.log(`building the EVIDENCE extension (TR01_PROBE=1${DRY ? ", M3_WORKER_FRAME=1 — DRY RUN" : ""})…`);
build(DRY ? { TR01_PROBE: "1", M3_WORKER_FRAME: "1" } : { TR01_PROBE: "1" });
const evidenceRoute = routeFiles();
const buildFacts = {
  productRoute,
  evidenceRoute,
  routeIdenticalToProduct: JSON.stringify({ ...productRoute, connectSrc: null }) === JSON.stringify({ ...evidenceRoute, connectSrc: null }),
  // ADR-0013: the one permitted difference — the evidence build widens the reasoner endpoint to the collector origin.
  connectSrcDiffersOnlyByCollector: productRoute.connectSrc === "'self' http://127.0.0.1:8995/v1/chat/completions" && evidenceRoute.connectSrc === "'self' http://127.0.0.1:8995",
  noCaptureVisibleTab: !readFileSync(join(EXT, "background.js"), "utf8").includes("captureVisibleTab"),
  tr01Sha256: TR01_SHA256,
};
if (!DRY && !buildFacts.connectSrcDiffersOnlyByCollector) refuse(`the evidence build's connect-src is not the product's widened to the collector origin: ${JSON.stringify(buildFacts)}`);
if (!DRY && !buildFacts.routeIdenticalToProduct) refuse(`the evidence build's capture route differs from the product's: ${JSON.stringify(buildFacts)}`);
if (!DRY && !buildFacts.noCaptureVisibleTab) refuse("this is not the product capture route");

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const banner = (page, text) =>
  page.evaluate((t) => {
    let b = document.getElementById("__m12_banner");
    if (!b) {
      b = document.createElement("div");
      b.id = "__m12_banner";
      b.style.cssText = "position:absolute;left:20px;top:600px;width:560px;padding:10px 14px;background:#fff3b0;border:2px solid #c08a00;font:bold 18px Arial;color:#222;z-index:9;";
      document.body.appendChild(b);
    }
    b.textContent = t;
  }, text);

const { server, origin } = await startDemoServer(8983);
const cells = [];
try {
  for (const [index, dpr] of DPRS.entries()) {
    const cell = { dpr, window: `${index + 1} of ${DPRS.length}`, realGesture: DRY ? "NOT APPLICABLE (dry run)" : "NOT RECORDED", failure: null };
    let context = null;
    try {
      const profile = mkdtempSync(join(tmpdir(), "pratibimb-m12-re1-"));
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        executablePath,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
        args: [`--force-device-scale-factor=${dpr}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
      await sw.evaluate(() => globalThis.__host.ensureOffscreen());
      const page = await context.newPage();
      const served = await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__maskReady === true);
      const cssWidth = await page.evaluate(() => document.documentElement.clientWidth);
      const pageDpr = await page.evaluate(() => window.devicePixelRatio);
      await banner(page, `Window ${index + 1} of ${DPRS.length} (device scale ${dpr}): click the PratiBimb toolbar button once.`);
      await page.bringToFront();
      await wait(1_000);

      const identity = await sw.evaluate(() => [...globalThis.__host.hellos].reverse()[0]?.identity ?? null);
      if (!identity) throw new Error("preflight: the content script never attached");
      const probeNow = (args) => sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
      const productState = await probeNow({ op: "product-state" });
      cell.preflight = {
        fixturePageServed: served?.status() === 200,
        contentScriptAttested: typeof identity.tabId === "number",
        noGrantYet: (await sw.evaluate(() => globalThis.__host.captureState())).grants.length === 0,
        captureRefusedBeforeGesture: DRY ? "n/a (dry run: degraded route)" : (await sw.evaluate((t) => globalThis.__host.ticketProbe(t), identity.tabId))?.refused === "NO_ACTIVE_TAB_GRANT",
        productTr01HostNotYetCreated: productState?.tr01 === null,
        pageDevicePixelRatio: pageDpr,
      };
      if (!Object.entries(cell.preflight).filter(([k]) => k !== "pageDevicePixelRatio").every(([, v]) => v === true || typeof v === "string")) throw new Error(`preflight failed: ${JSON.stringify(cell.preflight)}`);

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
      cell.gesture = DRY ? { dryRun: true } : { tabId: grant.tabId, observedAt: new Date().toISOString(), waitedMs: Date.now() - t0 };

      const probe = async (args) => {
        if (DRY) await wait(700);
        const r = await probeNow(args);
        if (r?.error) throw new Error(`${args.op}: ${r.error}`);
        return r;
      };

      // ── H1–H6, each shown 1:1 at (0,0) in the granted document, captured PASSES times ──
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
          await new Promise((ok, no) => {
            el.onload = ok;
            el.onerror = no;
            el.src = u;
          });
          await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
          return { naturalWidth: el.naturalWidth, naturalHeight: el.naturalHeight, scrollX, scrollY, innerWidth, innerHeight, devicePixelRatio };
        }, src);
        await wait(300);
        const passes = [];
        for (let p = 0; p < PASSES; p++) {
          const r = await probe({ op: "pass", tabId: identity.tabId, frameId: identity.frameId, cssWidth, inkRects: [], controlRects: [] });
          const detections = r.summary.redaction.detail?.detections ?? [];
          passes.push({ route: r.summary.route, capture: r.summary.capture, detectorRan: r.summary.redaction.detector.ran, detectorCode: r.summary.redaction.detector.code ?? null, failClosed: r.summary.redaction.failClosed, detections });
        }
        const first = passes[0];
        // Detections are in CAPTURE px; the held-out truth is in the image's own px, which is CSS px here
        // (shown 1:1 at 1280×720 CSS). The frozen coordinate contract maps capture → CSS by × scaleToCss
        // (identity on the gesture route, which is CSS-capped). Nothing else about a box changes.
        const s = first.capture.scaleToCss;
        const cssDetections = first.detections.map((d) => ({ ...d, x: d.x * s, y: d.y * s, w: d.w * s, h: d.h * s }));
        const boxes = cssDetections.map(({ x, y, w, h }) => ({ x, y, w, h }));
        const score = scoreImage({ boxes }, { region: img.region, strings: img.strings });
        const baseBoxes = BASELINE.inputs[img.image].boxes;
        const baseScore = BASELINE.heldOut.perImage.find((q) => q.image === img.image);
        let coord = null;
        let scoreDiff = null;
        if (cssDetections.length === baseBoxes.length) {
          coord = 0;
          scoreDiff = 0;
          cssDetections.forEach((a, k) => {
            const b = baseBoxes[k];
            coord = Math.max(coord, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h));
            scoreDiff = Math.max(scoreDiff, Math.abs(a.score - b.score));
          });
        }
        images.push({
          image: img.image,
          heldOutPngSha256: heldOutSha[img.image],
          shown,
          passes: passes.map(({ route, capture, detectorRan, detectorCode, failClosed, detections }) => ({ route, capture, detectorRan, detectorCode, failClosed, detections: detections.length })),
          scaleToCss: s,
          boxes: first.detections,
          cssBoxes: cssDetections,
          // G4 on the stream: every pass's boxes and scores byte-identical to the first.
          deterministicAcrossPasses: passes.every((p) => isDeepStrictEqual(p.detections, first.detections)),
          // Added after formal run 1, which kept only the first pass's boxes: how far later passes moved.
          laterPassBoxes: passes.slice(1).map((p) => (isDeepStrictEqual(p.detections, first.detections) ? "IDENTICAL" : p.detections)),
          maxPassDeviationPx: passes.slice(1).reduce((m, p) => (p.detections.length !== first.detections.length ? Infinity : Math.max(m, ...p.detections.map((d, k) => Math.max(Math.abs(d.x - first.detections[k].x), Math.abs(d.y - first.detections[k].y), Math.abs(d.w - first.detections[k].w), Math.abs(d.h - first.detections[k].h))))), 0),
          everyPassRanTheDetector: passes.every((p) => p.detectorRan === true && p.failClosed === false),
          score,
          g1ExposedSensitiveGlyphs: score.exposedSensitiveGlyphs,
          g2OverMaskRatio: score.overMaskRatio,
          g3LargestBoxShare: score.largestSingleBoxRegionShare,
          gates: score.gates,
          sensitiveGlyphs: score.sensitiveGlyphs,
          vsBaseline: { baseline: baselinePath("TR-01", resolveWorkstation()), detections: cssDetections.length, baselineDetections: baseBoxes.length, boxesExactlyEqual: isDeepStrictEqual(cssDetections, baseBoxes), maxCoordinateDifferencePx: coord, maxScoreDifference: scoreDiff, re1ScoreEqual: isDeepStrictEqual({ image: img.image, ...score }, baseScore) },
        });
        console.log(`    ${img.image}: ${first.detections.length} boxes, exposed ${score.exposedSensitiveGlyphs}/${score.sensitiveGlyphs}, gates ${Object.values(score.gates).every(Boolean) ? "PASS" : "FAIL"}, deterministic ${images.at(-1).deterministicAcrossPasses}, max Δ vs baseline ${coord?.toFixed(3) ?? "n/a"} px`);
      }
      const captures = images.flatMap((i) => i.passes.map((p) => p.capture));
      cell.stream = {
        route: [...new Set(images.flatMap((i) => i.passes.map((p) => p.route)))],
        captureDims: [...new Set(captures.map((c) => `${c.w}x${c.h}`))],
        scaleToCss: [...new Set(captures.map((c) => c.scaleToCss))],
        captureDpr: [...new Set(captures.map((c) => c.dpr))],
        pageDevicePixelRatio: pageDpr,
        requestedDeviceScale: dpr,
      };
      cell.images = images;
      cell.checks = {
        [DRY ? "dryRunProceededWithoutGesture" : "realGestureRecorded"]: DRY ? cell.gesture.dryRun === true : typeof cell.gesture.tabId === "number",
        [DRY ? "degradedWorkerFrameRoute" : "gestureStreamRoute"]: cell.stream.route.length === 1 && cell.stream.route[0] === (DRY ? "WORKER_FRAME" : "GESTURE_STREAM"),
        heldOutShownOneToOne: images.every((i) => i.shown.naturalWidth === 1280 && i.shown.naturalHeight === 720 && i.shown.scrollX === 0 && i.shown.scrollY === 0),
        everyPassRanTheDetector: images.every((i) => i.everyPassRanTheDetector),
        g1ZeroExposedSensitiveGlyphs: images.every((i) => i.gates.noExposedSensitiveGlyph === true && i.g1ExposedSensitiveGlyphs === 0),
        g2OverMaskWithinBudget: images.every((i) => i.gates.overMaskWithinBudget === true),
        g3NoBlanketBox: images.every((i) => i.gates.noBlanketBox === true),
        g4DeterministicAcrossPasses: images.every((i) => i.deterministicAcrossPasses),
      };
      if (!DRY && cell.checks.realGestureRecorded) cell.realGesture = "RECORDED";
      console.log(`>>> WINDOW_DONE ${index + 1}/${DPRS.length}: ${Object.values(cell.checks).every(Boolean) ? "RE-1 PASS" : "RE-1 FAIL " + Object.entries(cell.checks).filter(([, v]) => !v).map(([k]) => k).join(",")}  capture ${cell.stream.captureDims.join(",")} scaleToCss ${cell.stream.scaleToCss.join(",")}`);
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

const allPass = cells.length === DPRS.length && cells.every((c) => c.failure === null && Object.values(c.checks ?? {}).every(Boolean));
// Across windows: are the boxes for an image the same at every device scale?
const acrossWindows = HELD_OUT.images.map(({ image }) => {
  const per = cells.map((c) => c.images?.find((i) => i.image === image)?.cssBoxes ?? null);
  return { image, identicalAcrossWindows: per.every((b) => b !== null && isDeepStrictEqual(b, per[0])) };
});
const scaleToCssSeen = [...new Set(cells.flatMap((c) => c.stream?.scaleToCss ?? []))];
const record = {
  experiment: DRY ? "M12 Part Q — DRY RUN of the stream RE-1 harness on the DEGRADED route (not stream evidence)" : "M12 Part Q — RE-1 on real product gesture-stream frames, four device scales, three passes each",
  verdict: allPass ? "PASS" : "FAIL",
  j7: DRY ? "NOT ASSESSED (dry run)" : allPass ? "RE-1 CRITERIA MET ON STREAM FRAMES" : "OPEN",
  dryRun: DRY,
  humanInTheLoop: !DRY,
  invocationMethod: DRY ? "no gesture: the degraded M3_WORKER_FRAME route; not stream evidence" : "a person clicked the extension's toolbar action once per window; nothing in this process produced, simulated or substituted for the click",
  realGesturePerWindow: cells.map((c) => ({ dpr: c.dpr, realGesture: c.realGesture })),
  frozen: { tr01Sha256: TR01_SHA256, heldOut: { set: HELD_OUT.set, version: HELD_OUT.version, totals: HELD_OUT.totals }, re1Scorer: "tests/browser/support/redaction-metrics.mjs (unchanged)", passesPerImage: PASSES },
  carriedOver: { G5: "WASM validity vs native: a property of the runtime, not the capture route; not re-run", G6: "no plaintext output: structural, unchanged" },
  acrossWindows,
  scaleToCssObserved: scaleToCssSeen,
  notAClaim: [
    "six images, one workstation, one operator; RE-1 bounds exposure on this set only, no recall claim beyond it",
    "the product route caps the stream to CSS size, so scaleToCss was observed, not chosen; a frame with scaleToCss ≠ 1 is not produced by this route",
  ],
  build: buildFacts,
  cells,
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), os: `${process.platform} ${osRelease()}`, cpu: cpus()[0]?.model ?? "unknown", node: process.version, playwright: require2("playwright/package.json").version, browserBinary: executablePath, headless: false },
};
mkdirSync(OUT, { recursive: true });
writeFileSync(TARGET, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  ${DRY ? "DRY RUN (degraded route, NOT stream evidence)" : "real gesture"} → RE-1 on stream frames  (${cells.length} window(s))  J7: ${record.j7}`);
console.log(`  scaleToCss observed: ${scaleToCssSeen.join(",")}; boxes identical across windows: ${acrossWindows.filter((a) => a.identicalAcrossWindows).length}/${acrossWindows.length}`);
console.log(`written: ${TARGET}`);
process.exit(allPass ? 0 : 1);
