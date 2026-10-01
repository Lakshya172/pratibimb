#!/usr/bin/env node
/**
 * M10.6 — RE-1 ON THE PRODUCT PATH: the six frozen held-out frames through the product's TR-01 host
 * and the product's redaction path, scored by the frozen RE-1 scorer, compared with M8.1.
 *
 * Requires the evidence build (the probe carries the frames in; the product path does the work):
 *   TR01_PROBE=1 npm run build -w @pratibimb/extension
 *
 * For each of H1–H6 (M8.2's git-ignored copies of the frozen held-out screenshots, 1280×720, DPR 1):
 *   TR-01 in the real worker → reportFromFullFrame → sanitizeFrame, with the held-out visual region.
 * Required, EXACTLY:
 *   - boxes and scores equal M8.1's recorded run1 boxes (the screened TR-01);
 *   - the product's CSS mask equals the canonical `redactionMask(boxes, region)` the scorer uses;
 *   - `scoreImage` over the product's boxes equals M8.1's recorded per-image RE-1 score, field for field;
 *   - the RE-1 verdict (0 exposed sensitive glyphs) is unchanged.
 * A difference is reported and the run FAILS. Nothing is tuned, and the held-out set is read, never
 * written.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-re1-product.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";

import { redactionMask } from "../../../packages/privacy/src/redactionGeometry.ts";
import { ROOT } from "../demo/server.mjs";
import { decodePng } from "../support/png-decode.mjs";
import { scoreImage } from "../support/redaction-metrics.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const FIX = join(ROOT, "artifacts", "experiments", "M8.2-qg03-visual-text-feasibility", "models", "fixtures", "screenshots");
const M81 = JSON.parse(readFileSync(join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening", "results", "tr-01-run1.json"), "utf8"));
const HELD_OUT = JSON.parse(readFileSync(join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json"), "utf8"));

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
const chunks = readdirSync(join(EXT, "chunks")).map((f) => readFileSync(join(EXT, "chunks", f), "utf8")).join("");
if (!chunks.includes("TR01_PROBE_ONLY_FROM_SERVICE_WORKER")) refuse("no TR-01 probe in this build. Build: TR01_PROBE=1 npm run build -w @pratibimb/extension");
for (const img of HELD_OUT.images) if (!existsSync(join(FIX, `${img.image}.png`))) refuse(`missing held-out frame ${img.image}.png`);

const images = [];
let failure = null;
let context = null;
try {
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m106-re1-")), {
    headless: false,
    executablePath,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
  await sw.evaluate(() => globalThis.__host.ensureOffscreen());
  const probe = async (args) => {
    const r = await sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
    if (r?.error) throw new Error(`${args.op}: ${r.error}`);
    return r;
  };

  for (const img of HELD_OUT.images) {
    const px = decodePng(readFileSync(join(FIX, `${img.image}.png`)));
    await probe({ op: "frame", name: img.image, frame: { width: px.width, height: px.height, rgbaB64: Buffer.from(px.rgba.buffer, px.rgba.byteOffset, px.rgba.byteLength).toString("base64") } });
    const r = await probe({ op: "re1-frame", name: img.image, region: img.region });
    if (!r.outcome.ok) throw new Error(`${img.image}: detector refused ${r.outcome.code}`);
    const boxes = r.outcome.detections.map(({ x, y, w, h }) => ({ x, y, w, h }));
    const recorded = M81.inputs[img.image].boxes;
    const score = scoreImage({ boxes }, { region: img.region, strings: img.strings });
    const m81Score = M81.heldOut.perImage.find((p) => p.image === img.image);
    images.push({
      image: img.image,
      detections: boxes.length,
      boxesAndScoresEqualM81: JSON.stringify(r.outcome.detections) === JSON.stringify(recorded),
      productMaskEqualsCanonical: JSON.stringify(r.result.cssMask) === JSON.stringify(redactionMask(boxes, img.region)),
      productFailClosed: r.result.failClosed,
      // M8.1 stored each per-image score labelled with its image: `{ image, ...scoreImage(...) }`.
      scoreEqualsM81: isDeepStrictEqual({ image: img.image, ...score }, m81Score),
      exposedSensitiveGlyphs: score.exposedSensitiveGlyphs,
      m81ExposedSensitiveGlyphs: m81Score?.exposedSensitiveGlyphs ?? null,
      sensitiveGlyphs: score.sensitiveGlyphs,
    });
  }
} catch (e) {
  failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
} finally {
  if (context) await context.close();
}

const checks = {
  allSixImages: images.length === HELD_OUT.images.length,
  boxesAndScoresEqualScreenedTr01: images.every((i) => i.boxesAndScoresEqualM81),
  productMaskIsTheCanonicalGeometry: images.every((i) => i.productMaskEqualsCanonical && i.productFailClosed === false),
  re1ScoresEqualM81: images.every((i) => i.scoreEqualsM81),
  zeroExposedSensitiveGlyphs: images.every((i) => i.exposedSensitiveGlyphs === 0),
};
const passed = failure === null && Object.values(checks).every(Boolean);
const record = {
  experiment: "M10.6 — RE-1 through the product path, compared with the screened TR-01 (M8.1)",
  verdict: passed ? "PASS" : "FAIL",
  heldOut: { set: HELD_OUT.set, version: HELD_OUT.version, totals: HELD_OUT.totals },
  notAClaim: [
    "the frames are the frozen held-out SCREENSHOTS (M8.1's inputs), not tab-stream frames; stream-vs-screenshot pixel equivalence (G-3) is measured separately",
    "RE-1 bounds exposure on a small synthetic set; no recall claim beyond it",
  ],
  checks,
  images,
  failure,
  recordedAt: new Date().toISOString(),
  provenance: { ...provenanceOf(WS), browserBinary: executablePath, build: "TR01_PROBE=1 (evidence build)" },
};
mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-re1-product.json")), WS);
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");
console.log(`\n${record.verdict}  RE-1 through the product path`);
for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "PASS" : "FAIL"}  ${k}`);
for (const i of images) console.log(`  ${i.image}: ${i.detections} boxes, exposed ${i.exposedSensitiveGlyphs}/${i.sensitiveGlyphs} (M8.1 ${i.m81ExposedSensitiveGlyphs})`);
if (failure) console.log(`  failure: ${failure}`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
