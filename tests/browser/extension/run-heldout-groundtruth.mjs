#!/usr/bin/env node
/**
 * FREEZE THE HELD-OUT GROUND TRUTH (RE-1) — no model is involved at any point.
 *
 * Loads each held-out page in Chrome, reads the geometry its renderer measured of itself, checks the
 * invariants RE-1's scoring depends on, and writes `fixture/heldout/groundtruth.json` with the
 * SHA-256 of every file that produced it. That record is committed BEFORE any candidate is scored,
 * so a later evaluation can prove it scored the same set:
 *
 *   - it recomputes the ground truth and requires it to equal the frozen one (font or layout drift
 *     on another machine shows up here, instead of silently moving the targets), and
 *   - it requires the page and renderer hashes to match.
 *
 * Any change to a held-out page is a NEW VERSION of the set, which re-opens pre-registration.
 *
 * Usage: CHROME_PATH=<chrome for testing> node tests/browser/extension/run-heldout-groundtruth.mjs [--check]
 *   default   write groundtruth.json (only when creating the set)
 *   --check   recompute and compare against the frozen file; write nothing
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { REDACTION_CRITERIA } from "../support/redaction-metrics.mjs";

const DIR = join(ROOT, "tests", "browser", "extension", "fixture", "heldout");
const FROZEN = join(DIR, "groundtruth.json");
const VIEWPORT = { width: 1280, height: 720 };
const CHECK = process.argv.includes("--check");

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) {
  console.error("REFUSING: set CHROME_PATH to the Chrome for Testing binary");
  process.exit(1);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const pages = readdirSync(DIR).filter((f) => /^h\d+\.html$/.test(f)).sort();
const files = Object.fromEntries(
  [...pages, "render.js"].map((f) => [f, sha256(readFileSync(join(DIR, f)))])
);

/** Expected sensitive glyph counts, straight from each page's spec: every non-space character. */
function expectedFromSpec(file) {
  const html = readFileSync(join(DIR, file), "utf8");
  const spec = JSON.parse(/window\.__spec = (\{.*\});<\/script>/.exec(html)[1]);
  const runs = spec.lines.flatMap((l) => l.runs);
  return {
    sensitive: runs.filter((r) => r.sensitive).map((r) => ({ id: r.id, glyphs: r.text.replace(/\s/g, "").length })),
  };
}

const inside = (a, b, tol = 0) =>
  a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const dilate = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

const problems = [];
const images = [];
let browserVersion = null;
const { server, origin } = await startDemoServer(8981);
const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-heldout-")), {
  headless: false,
  executablePath,
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
});
try {
  browserVersion = context.browser()?.version() ?? null;
  for (const file of pages) {
    const reads = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await context.newPage();
      await page.goto(`${origin}/heldout/${file}`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__fixtureReady === true);
      reads.push(await page.evaluate(() => window.__groundTruth));
      await page.close();
    }
    const gt = reads[0];
    if (JSON.stringify(reads[0]) !== JSON.stringify(reads[1])) problems.push(`${file}: two loads measured different geometry`);

    const vp = { x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height };
    if (!inside(gt.region, vp)) problems.push(`${file}: the visual-only region leaves the viewport`);
    const expected = expectedFromSpec(file);
    for (const want of expected.sensitive) {
      const got = gt.strings.find((s) => s.id === want.id);
      if (!got) problems.push(`${file}: sensitive run ${want.id} produced no ground truth`);
      else if (got.glyphCount !== want.glyphs) problems.push(`${file}: ${want.id} has ${got.glyphCount} inked glyphs, spec has ${want.glyphs}`);
    }
    for (const s of gt.strings) {
      for (const g of s.glyphs) if (!inside(g, gt.region)) problems.push(`${file}: a glyph of ${s.id} lies outside the region`);
      // A perfectly tight detector must never be charged for over-masking, so every ink box must sit
      // inside its line box plus the frozen 4 px dilation — the zone RE-1 treats as free.
      if (!inside(s.ink, dilate(s.line, REDACTION_CRITERIA.unionDilationPx))) {
        problems.push(`${file}: ${s.id}'s ink extends past its line box + ${REDACTION_CRITERIA.unionDilationPx} px`);
      }
    }
    for (let i = 0; i < gt.strings.length; i += 1) {
      for (let j = i + 1; j < gt.strings.length; j += 1) {
        if (overlaps(gt.strings[i].ink, gt.strings[j].ink)) problems.push(`${file}: ink of ${gt.strings[i].id} and ${gt.strings[j].id} overlap`);
      }
    }
    images.push(gt);
  }
} finally {
  await context.close();
  server.close();
}

const sensitive = images.flatMap((g) => g.strings.filter((s) => s.sensitive));
const totals = {
  images: images.length,
  strings: images.reduce((n, g) => n + g.strings.length, 0),
  sensitiveStrings: sensitive.length,
  sensitiveGlyphs: sensitive.reduce((n, s) => n + s.glyphCount, 0),
  nonSensitiveStrings: images.reduce((n, g) => n + g.strings.filter((s) => !s.sensitive).length, 0),
};
if (totals.images < REDACTION_CRITERIA.minImages) problems.push(`only ${totals.images} images`);
if (totals.sensitiveStrings < REDACTION_CRITERIA.minSensitiveStrings) problems.push(`only ${totals.sensitiveStrings} sensitive strings`);
if (totals.sensitiveGlyphs < REDACTION_CRITERIA.minSensitiveGlyphs) problems.push(`only ${totals.sensitiveGlyphs} sensitive glyphs`);

const record = {
  set: "RE-1 held-out visual-text set",
  version: 1,
  criterion: REDACTION_CRITERIA.version,
  note: "Geometry only. No characters. Frozen before any candidate was scored. Any change is a new version.",
  measuredWith: { browser: `Chrome for Testing ${browserVersion}`, viewport: VIEWPORT, dpr: 1, workstation: "W1" },
  files,
  totals,
  images,
};

if (CHECK) {
  const frozen = JSON.parse(readFileSync(FROZEN, "utf8"));
  const sameFiles = JSON.stringify(frozen.files) === JSON.stringify(files);
  const sameGeometry = JSON.stringify(frozen.images) === JSON.stringify(images);
  console.log(`files match frozen: ${sameFiles}  geometry matches frozen: ${sameGeometry}`);
  if (!sameFiles || !sameGeometry) problems.push("the held-out set differs from its frozen record");
} else if (problems.length === 0) {
  writeFileSync(FROZEN, JSON.stringify(record, null, 2) + "\n");
  console.log(`written: ${FROZEN}`);
}

console.log(`images ${totals.images} · strings ${totals.strings} · sensitive strings ${totals.sensitiveStrings} · sensitive glyphs ${totals.sensitiveGlyphs} · non-sensitive strings ${totals.nonSensitiveStrings}`);
for (const g of images) {
  const s = g.strings.filter((x) => x.sensitive);
  console.log(`  ${g.image}: region ${Math.round(g.region.w)}x${Math.round(g.region.h)} · ${g.strings.length} strings · ${s.length} sensitive · ${s.reduce((n, x) => n + x.glyphCount, 0)} sensitive glyphs`);
}
for (const p of problems) console.log(`PROBLEM: ${p}`);
process.exit(problems.length === 0 ? 0 : 1);
