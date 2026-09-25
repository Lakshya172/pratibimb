#!/usr/bin/env node
/**
 * THE VISUAL-TEXT GATE-0 SCREEN — can a detector localise text the DOM cannot describe?
 *
 * Runs the criteria pre-registered in `docs/perception/text-region-acceptance.md` against whatever
 * detector the built extension carries. Every threshold here is read from that document; none is
 * defined in this file, so a harness edit cannot move a bar.
 *
 * WHAT IT IS. A cheap screen, not an evaluation. The acceptance document says so in terms: one
 * synthetic page establishes that a candidate is *not worth QG-03*, and nothing more. A candidate
 * that passes has earned the right to a held-out set, not a place in the product.
 *
 * WHY IT EXISTS NOW, WITH NO CANDIDATE. The only text-region candidate in the repository is blocked,
 * so the model this runs against today is the **UI head**, which has no text class at all. That
 * makes this the FLOOR: a measured statement of what the shipped configuration can do about
 * visually rendered text, against geometry the page measured of itself. A floor recorded before a
 * candidate exists cannot be adjusted to flatter one later.
 *
 * TWO READINGS, BECAUSE ONE WOULD BE UNFAIR. The strict reading counts only detections whose class
 * is a text class — of which the UI head has none, so the set is empty by construction. The
 * generous reading treats EVERY detection as a text candidate, which is the most favourable
 * interpretation the current model could possibly be given. Both are reported. If the generous
 * reading fails too, the conclusion does not depend on the choice.
 *
 * NOTHING IS TUNED. No threshold moved, no class filtered, no box dropped.
 *
 * Usage:
 *   M3_WORKER_FRAME=1 npm run build -w @pratibimb/extension
 *   CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-text-region-eval.mjs
 *
 * The degraded build is required for the same reason `run-detector-eval.mjs` requires it: a frame
 * is needed and no harness can produce the human invocation `activeTab` wants. This screen is about
 * the detector, not about the capture route, and the route is recorded with the result.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";

const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M7-visual-text", "logs");

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT}`);

/**
 * THE PRE-REGISTERED THRESHOLDS, quoted from `docs/perception/text-region-acceptance.md`.
 *
 * Reproduced rather than re-derived, and named after the criterion they come from, so a reader can
 * check them against the frozen document in one pass.
 */
const CRITERIA = Object.freeze({
  localisationIou: 0.5, // criterion 2, quoted from constitution §7
  secretContainment: 0.95, // criterion 3
  floodAreaRatio: 3, // criterion 4
  wholeCanvasShare: 0.9, // criterion 4, second clause
});

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const area = (b) => Math.max(0, b.w) * Math.max(0, b.h);
const intersect = (a, b) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
};
const iou = (a, b) => {
  const i = intersect(a, b);
  return i === 0 ? 0 : i / (area(a) + area(b) - i);
};
const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;

/**
 * How much of `region` the UNION of `boxes` covers — criterion 3.
 *
 * By scanline over the region rather than by summing per-box overlaps, because overlapping
 * predictions would otherwise be counted twice and a flood would "cover" more than 100%. One CSS
 * pixel per row and column: the regions here are tens of pixels tall, so exactness costs nothing.
 */
function unionContainment(region, boxes) {
  if (area(region) === 0) return 0;
  const clipped = boxes.map((b) => ({
    x0: Math.max(b.x, region.x),
    x1: Math.min(b.x + b.w, region.x + region.w),
    y0: Math.max(b.y, region.y),
    y1: Math.min(b.y + b.h, region.y + region.h),
  })).filter((c) => c.x1 > c.x0 && c.y1 > c.y0);
  if (clipped.length === 0) return 0;
  let covered = 0;
  for (let y = region.y; y < region.y + region.h; y += 1) {
    const spans = clipped.filter((c) => y >= c.y0 && y < c.y1).map((c) => [c.x0, c.x1]).sort((a, b) => a[0] - b[0]);
    let reach = -Infinity;
    for (const [x0, x1] of spans) {
      const from = Math.max(x0, reach);
      if (x1 > from) {
        covered += x1 - from;
        reach = x1;
      }
    }
  }
  return covered / area(region);
}

/** Score one reading of the detections against the pre-registered criteria. */
function screen(name, boxes, textRegions, canvas) {
  const sensitive = textRegions.filter((r) => r.sensitive);
  const perRegion = sensitive.map((region) => {
    const bestIou = boxes.reduce((acc, b) => Math.max(acc, iou(b, region)), 0);
    const containment = unionContainment(region, boxes);
    return {
      id: region.id,
      chars: region.chars,
      box: region,
      bestIou: round(bestIou),
      containment: round(containment),
      localised: bestIou >= CRITERIA.localisationIou,
      covered: containment >= CRITERIA.secretContainment,
    };
  });

  const insideCanvas = boxes.filter((b) => intersect(b, canvas) > 0);
  const predictedTextArea = insideCanvas.reduce((sum, b) => sum + intersect(b, canvas), 0);
  const trueTextArea = textRegions.reduce((sum, r) => sum + area(r), 0);
  const ratio = trueTextArea === 0 ? Infinity : predictedTextArea / trueTextArea;
  const widest = boxes.reduce((acc, b) => Math.max(acc, intersect(b, canvas) / area(canvas)), 0);

  return {
    reading: name,
    boxes: boxes.length,
    perRegion,
    flood: {
      predictionsInsideCanvas: insideCanvas.length,
      predictedAreaPx: Math.round(predictedTextArea),
      trueTextAreaPx: Math.round(trueTextArea),
      ratio: Number.isFinite(ratio) ? round(ratio, 2) : null,
      widestShareOfCanvas: round(widest),
    },
    criteria: {
      /** Criterion 2 — every sensitive region localised at IoU >= 0.5. */
      localisation: perRegion.every((r) => r.localised),
      /** Criterion 3 — every sensitive region >= 95% covered by the union. */
      secretCoverage: perRegion.every((r) => r.covered),
      /** Criterion 4 — predicted text area bounded, and nothing swallows the canvas. */
      noFlood: Number.isFinite(ratio) && ratio <= CRITERIA.floodAreaRatio && widest < CRITERIA.wholeCanvasShare,
    },
  };
}

/**
 * The artifact this build actually carries: the identity the source pins, and the digest of the
 * weights that shipped. Read once, before the browser is launched.
 */
const bundleModel = (() => {
  const src = readFileSync(join(ROOT, "apps", "extension", "host", "offscreen", "main.ts"), "utf8");
  const weights = readFileSync(join(EXT, "t1-ui-head.onnx"));
  return {
    modelId: /const MODEL_ID = "([^"]+)"/.exec(src)?.[1] ?? null,
    revision: /const MODEL_REVISION = "([^"]+)"/.exec(src)?.[1] ?? null,
    weightsSha256: createHash("sha256").update(weights).digest("hex"),
    weightsBytes: weights.length,
  };
})();

let failure = null;
let context = null;
let stopServer = null;
let result = null;

try {
  const { server, origin } = await startDemoServer(8979);
  stopServer = () => new Promise((ok) => server.close(ok));

  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-textregion-")), {
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
  if (!Array.isArray(groundTruth.textRegions) || groundTruth.textRegions.length === 0) {
    throw new Error("the fixture carries no textRegions ground truth");
  }

  // The same perception pass the product runs, on the same realm, with the same head.
  const pass = await worker.evaluate(
    ({ tabId, frameId }) => globalThis.__host.perceiveOnce(tabId, frameId),
    { tabId: identity.tabId, frameId: identity.frameId }
  );
  if (!pass || pass.refused) throw new Error(`perception refused: ${JSON.stringify(pass).slice(0, 300)}`);

  const detections = pass.detections ?? [];
  const canvas = groundTruth.visualOnly[0];

  /**
   * A TEXT CLASS, IF THE MODEL HAS ONE.
   *
   * The UI head's eight classes are button, link, textbox, checkbox, radio, select, tab and icon.
   * None of them is text: `textbox` is an input control, not rendered characters, and treating it
   * as one would be the harness inventing a capability the model does not claim.
   */
  const TEXT_CLASSES = ["text", "text_region", "word", "line", "paragraph"];
  const textClassBoxes = detections.filter((d) => TEXT_CLASSES.includes(String(d.label))).map((d) => d.box);
  const everyBox = detections.map((d) => d.box);

  const strict = screen("TEXT_CLASS_ONLY", textClassBoxes, groundTruth.textRegions, canvas);
  const generous = screen("EVERY_DETECTION_AS_TEXT", everyBox, groundTruth.textRegions, canvas);

  result = {
    experiment: "M7-visual-text-screen",
    question: "Can the detector in this build localise text the DOM cannot describe?",
    criteriaSource: "docs/perception/text-region-acceptance.md (pre-registered 2026-09-25)",
    criteria: CRITERIA,
    workstation: "W1",
    cell: { browser: "Chrome for Testing", executablePath, headless: false },
    at: new Date().toISOString(),
    /**
     * Attribution, read from the built bundle rather than from the reply.
     *
     * `PERCEIVE_ONCE` does not report the model identity — it reports what the pass produced. So the
     * artifact is named by reading the constants the offscreen realm was built with and the digest
     * of the weights the bundle actually ships, which is stronger than a self-report anyway: it
     * describes the file that ran, not a string a message chose to carry.
     */
    model: {
      modelId: bundleModel.modelId,
      revision: bundleModel.revision,
      weightsSha256: bundleModel.weightsSha256,
      weightsBytes: bundleModel.weightsBytes,
      classesSeen: pass.byClass ?? null,
    },
    route: pass.route ?? null,
    capture: pass.capture ?? null,
    detections: detections.length,
    labelsPresent: [...new Set(detections.map((d) => String(d.label)))].sort(),
    textClassesLookedFor: TEXT_CLASSES,
    modelHasATextClass: textClassBoxes.length > 0,
    groundTruth: { canvas, textRegions: groundTruth.textRegions },
    readings: [strict, generous],
    ms: pass.ms ?? null,
    failure: null,
  };
} catch (error) {
  failure = `${error.name}: ${String(error.message).slice(0, 400)}`;
} finally {
  if (context) await context.close();
  if (stopServer) await stopServer();
}

const passed =
  failure === null && result !== null && result.readings.some((r) => Object.values(r.criteria).every((v) => v === true));

mkdirSync(OUT, { recursive: true });
const record = {
  ...(result ?? { experiment: "M7-visual-text-screen" }),
  failure,
  verdict: passed ? "SCREEN PASSED — proceed to QG-03; this is not an accuracy claim" : "SCREEN NOT PASSED",
};
const file = join(OUT, "w1-text-region-screen.json");
writeFileSync(file, JSON.stringify(record, null, 2));

if (failure) console.log(`  ERROR: ${failure}`);
if (result) {
  console.log(`  model: ${result.model.modelId}@${result.model.revision}  weights ${result.model.weightsSha256.slice(0, 12)} (${result.model.weightsBytes}B)  route ${result.route}`);
  console.log(`  detections: ${result.detections}  labels: ${result.labelsPresent.join(", ")}`);
  console.log(`  a text class among them: ${result.modelHasATextClass ? "yes" : "NO"}`);
  for (const r of result.readings) {
    console.log(`  reading ${r.reading} (${r.boxes} boxes):`);
    for (const g of r.perRegion) {
      console.log(
        `    ${g.id.padEnd(12)} chars ${String(g.chars).padStart(2)}  bestIoU ${String(g.bestIou).padEnd(5)}` +
          `  covered ${String(g.containment).padEnd(5)}  ${g.localised ? "LOCALISED" : "not localised"}` +
          `  ${g.covered ? "COVERED" : "not covered"}`
      );
    }
    console.log(
      `    flood: ${r.flood.predictionsInsideCanvas} boxes in canvas, area ${r.flood.predictedAreaPx}px2 ` +
        `vs true text ${r.flood.trueTextAreaPx}px2 = ${r.flood.ratio}x  widest ${r.flood.widestShareOfCanvas} of canvas`
    );
    console.log(
      `    criteria: localisation ${r.criteria.localisation} · secretCoverage ${r.criteria.secretCoverage} · noFlood ${r.criteria.noFlood}`
    );
  }
}
console.log(`  VERDICT: ${record.verdict}`);
console.log(`written: ${file}`);
process.exit(failure ? 1 : 0);
