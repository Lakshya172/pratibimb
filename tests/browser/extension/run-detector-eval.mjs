#!/usr/bin/env node
/**
 * M3.1 — WHAT THE DETECTOR ACTUALLY SEES, ON A FIXTURE WITH KNOWN GROUND TRUTH.
 *
 * M3 recorded "100 detections" and asserted nothing about them, which was the right thing to do
 * with no ground truth to compare against. This adds the ground truth, and it comes from the page
 * itself: `visual.html` writes `window.__groundTruth` from its own `getBoundingClientRect`, so a
 * layout that shifted is a changed number rather than a silent mismatch.
 *
 * WHAT THIS IS AND IS NOT. It is a local feasibility cell on ONE synthetic page, and it is labelled
 * CONDITIONAL / EXPERIMENTAL wherever it appears. It is not an accuracy claim, not a benchmark, and
 * not a substitute for QG-05 — whose held-out numbers on the model's own synthetic test set are the
 * standing measurement and are reproduced here for context rather than re-derived:
 *
 *     mAP@0.5 0.796 · element recall 0.923 · **grounding accuracy 0.055**
 *     button: 202 ground truth, 3947 predictions, 165 true positives, 3782 false positives
 *
 * That last line is the important one, and it was measured long before this milestone: the head has
 * high recall and roughly four percent precision. It floods. Anything this harness reports about
 * false positives is confirming a known property on a new page, not discovering one.
 *
 * NOTHING HERE IS TUNED. No threshold is adjusted, no class is filtered, no box is dropped. The
 * point is to report what the shipped configuration produces, because tuning against the output you
 * are measuring and calling the result accuracy is the exact failure the brief names.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-detector-eval.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release as osRelease, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M3.1-visual-evidence", "logs");

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Intersection over union of two `{x,y,w,h}` boxes, in CSS pixels. */
const iou = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  const inter = (x2 - x1) * (y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
};

/** How much of `box` lies inside `region`. Used for false positives, where IoU is the wrong tool. */
const containment = (box, region) => {
  const x1 = Math.max(box.x, region.x);
  const y1 = Math.max(box.y, region.y);
  const x2 = Math.min(box.x + box.w, region.x + region.w);
  const y2 = Math.min(box.y + box.h, region.y + region.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return ((x2 - x1) * (y2 - y1)) / (box.w * box.h);
};

let context = null;
let stopServer = null;
let failure = null;
let result = null;

try {
  const { server, origin } = await startDemoServer(8975);
  stopServer = () => new Promise((ok) => server.close(ok));

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m31-eval-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await worker.evaluate(() => globalThis.__host.ensureOffscreen());

  const page = await context.newPage();
  await page.goto(`${origin}/visual/`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__fixtureReady === true);
  await wait(1_500);

  const identity = await worker.evaluate(() => {
    const last = [...globalThis.__host.hellos].reverse()[0];
    return last ? last.identity : null;
  });
  if (!identity) throw new Error("the content script never attached to the visual fixture");

  const groundTruth = await page.evaluate(() => window.__groundTruth);

  /**
   * One perception pass, through the product code, on this page.
   *
   * `perceiveOnce` drives the same realm the run loop drives — same capture authority, same
   * session, same head, same fusion — so what is measured is the shipped configuration rather than
   * a bench rig that happens to resemble it.
   */
  const pass = await worker.evaluate(
    ({ tabId, frameId }) => globalThis.__host.perceiveOnce(tabId, frameId),
    { tabId: identity.tabId, frameId: identity.frameId }
  );
  if (!pass || pass.refused) throw new Error(`perception refused: ${JSON.stringify(pass)}`);

  const detections = pass.detections ?? [];
  const targets = groundTruth.targets.map((target) => {
    const best = detections.reduce(
      (acc, d) => {
        const score = iou(d.box, target);
        return score > acc.iou ? { iou: score, label: d.label, detectorScore: d.score } : acc;
      },
      { iou: 0, label: null, detectorScore: null }
    );
    return { id: target.id, box: target, matched: best.iou >= 0.5, ...best };
  });

  const visualOnly = groundTruth.visualOnly.map((region) => {
    const overlapping = detections.filter((d) => containment(d.box, region) >= 0.5);
    const best = detections.reduce((acc, d) => Math.max(acc, iou(d.box, region)), 0);
    return { id: region.id, box: region, detectionsInside: overlapping.length, bestIou: Math.round(best * 1000) / 1000 };
  });

  const empty = groundTruth.empty.map((region) => ({
    id: region.id,
    box: region,
    falsePositives: detections.filter((d) => containment(d.box, region) >= 0.5).length,
  }));

  const scores = detections.map((d) => d.score).sort((a, b) => a - b);
  const quantile = (q) => (scores.length === 0 ? null : Math.round(scores[Math.floor(q * (scores.length - 1))] * 1000) / 1000);
  const areas = detections.map((d) => d.box.w * d.box.h).sort((a, b) => a - b);
  const viewportArea = pass.viewport.w * pass.viewport.h;

  result = {
    anchors: pass.anchors,
    afterFiltering: pass.afterFiltering,
    detections: detections.length,
    byClass: pass.byClass,
    scoreDistribution: {
      min: quantile(0),
      p25: quantile(0.25),
      median: quantile(0.5),
      p75: quantile(0.75),
      max: quantile(1),
      /** The shipped floor. Nothing here was tuned against this run. */
      threshold: pass.threshold,
    },
    boxArea: {
      medianPx: areas.length === 0 ? null : areas[Math.floor(areas.length / 2)],
      /** A box covering most of the viewport is not a control, whatever it is labelled. */
      overHalfTheViewport: areas.filter((a) => a > viewportArea / 2).length,
    },
    targets,
    visualOnly,
    empty,
    fusion: pass.fusion,
    viewport: pass.viewport,
    capture: pass.capture,
    route: pass.route,
    ms: pass.ms,
  };

  console.log(`M3.1 detector evaluation — ${WS.id}, CONDITIONAL / EXPERIMENTAL\n`);
  console.log(`  capture ${pass.capture.w}x${pass.capture.h} via ${pass.route}, scale ${pass.capture.scaleToCss}`);
  console.log(`  anchors ${pass.anchors} -> ${pass.afterFiltering} after the package’s filtering  ${JSON.stringify(pass.byClass)}`);
  console.log(`  scores  min ${result.scoreDistribution.min}  median ${result.scoreDistribution.median}  max ${result.scoreDistribution.max}  (floor ${pass.threshold})`);
  console.log(`  boxes   median area ${result.boxArea.medianPx}px²  over half the viewport: ${result.boxArea.overHalfTheViewport}`);
  console.log("  DOM-described targets:");
  for (const t of targets) console.log(`    ${t.matched ? "HIT " : "miss"} ${t.id.padEnd(14)} best IoU ${Math.round(t.iou * 1000) / 1000}${t.label ? ` as ${t.label} @${Math.round(t.detectorScore * 100) / 100}` : ""}`);
  console.log("  visual-only region (the canvas the DOM cannot describe):");
  for (const v of visualOnly) console.log(`    ${v.id}: ${v.detectionsInside} detections inside, best IoU ${v.bestIou}`);
  console.log("  regions with nothing interactable in them:");
  for (const e of empty) console.log(`    ${e.id}: ${e.falsePositives} detections`);
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
  console.error(failure);
} finally {
  if (context) await context.close();
  if (typeof stopServer === "function") await stopServer();
}

const record = {
  experiment: "M3.1-visual-evidence / detector evaluation",
  status: "CONDITIONAL / EXPERIMENTAL",
  claim:
    "what the shipped detector configuration produces on one synthetic page with ground truth the " +
    "page itself declares — staged counts, a score distribution, overlap with known targets, and " +
    "false positives in regions with nothing interactable in them",
  notAClaim: [
    "not an accuracy measurement: one page, one layout, one browser cell, no corpus",
    "nothing was tuned against this output; the thresholds are the shipped ones",
    "QG-05 remains the standing evaluation, and its held-out numbers are not re-derived here",
    "no claim that the detector can read anything: it emits boxes and class labels, never characters",
  ],
  standingEvaluation: {
    source: "artifacts/gates/T1-detector-training/qg05-detector-evaluation.json",
    note: "held-out synthetic test split; the model's own evaluation, not this fixture",
    mAP50: 0.7955363455302848,
    elementRecall: 0.9228723404255319,
    groundingAccuracy: 0.05472322977448352,
    buttonClass: { groundTruth: 202, predictions: 3947, truePositives: 165, falsePositives: 3782 },
  },
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
  failure,
  result,
};

mkdirSync(OUT, { recursive: true });
const file = join(OUT, evidenceFileName(WS, "cft153-detector-eval.json"));
assertOwnEvidencePath(file, WS);
writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\nwritten: ${file}`);
process.exit(failure === null ? 0 : 1);
