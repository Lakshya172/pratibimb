#!/usr/bin/env node
/**
 * M8.2 — prepare the frozen inputs, and refuse unless they are M8.1's inputs byte for byte.
 *
 *   1. Screenshot the development fixture and the six held-out pages (Chrome for Testing 153,
 *      1280x720, DPR 1 — M8.1's conditions) and require every held-out page to re-measure its
 *      frozen geometry exactly.
 *   2. For each candidate, run M8.1's prep-native.py UNCHANGED: the candidate's own preprocessing
 *      and the native onnxruntime 1.29.0 reference.
 *   3. Require every input tensor's sha256 to equal M8.1 run1's, and the native fixed-fixture
 *      output to equal M8.1's. A single differing byte stops M8.2 before any cell runs.
 *
 * Writes git-ignored tensors to ../models/fixtures/<candidate>/ and the committed integrity record
 * ../logs/fixture-integrity.json (hashes and geometry-free facts only).
 *
 * Usage: CHROME_PATH=<chromium-1243 chrome.exe> REF_PYTHON=<measurement venv python> node prepare-fixtures.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startDemoServer } from "../../../../tests/browser/demo/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const M81 = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening");
const OUT = join(EXP, "models", "fixtures");
const SHOTS = join(OUT, "screenshots");
const HELDOUT = join(ROOT, "tests", "browser", "extension", "fixture", "heldout", "groundtruth.json");
const CANDIDATES = {
  "TR-01": { stem: "tr01_ppocrv4_mobile_det", sha256: "18aaccf9c9cd27656becda13bc0ef31eaa0ea3aef4d45166839f2093561575e8" },
  "TR-02": { stem: "tr02_ppocrv3_mobile_det", sha256: "322c3e636b936e5bc695ed29ccf2e1588a827989b23e6f395ad7e7edbc236f55" },
};
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(1);
};
const CHROME = process.env.CHROME_PATH;
const PY = process.env.REF_PYTHON;
if (!CHROME || !existsSync(CHROME)) refuse("set CHROME_PATH");
if (!PY || !existsSync(PY)) refuse("set REF_PYTHON");
mkdirSync(SHOTS, { recursive: true });

const frozen = JSON.parse(readFileSync(HELDOUT, "utf8"));
const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");
const demo = await startDemoServer(8993);
const record = { at: new Date().toISOString(), workstation: "W1", heldOut: {}, candidates: {} };
const names = ["dev", ...frozen.images.map((i) => i.image)];
try {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m82-prep-")), {
    headless: false,
    executablePath: CHROME,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  record.browser = ctx.browser()?.version() ?? null;
  const dev = await ctx.newPage();
  await dev.goto(`${demo.origin}/visual/`, { waitUntil: "load" });
  await dev.waitForFunction(() => window.__fixtureReady === true);
  const devTruth = await dev.evaluate(() => {
    const t = window.__groundTruth.redactionTruth;
    return { region: t.region, strings: t.strings.map(({ id, sensitive, glyphCount, glyphs, ink, line }) => ({ id, sensitive, glyphCount, glyphs, ink, line })) };
  });
  writeFileSync(join(SHOTS, "dev.png"), await dev.screenshot({ type: "png" }));
  writeFileSync(join(OUT, "dev-truth.json"), JSON.stringify(devTruth));
  await dev.close();
  for (const img of frozen.images) {
    const page = await ctx.newPage();
    await page.goto(`${demo.origin}/heldout/${img.image.toLowerCase()}.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fixtureReady === true);
    const measured = await page.evaluate(() => window.__groundTruth);
    record.heldOut[img.image] = JSON.stringify(measured) === JSON.stringify(img);
    writeFileSync(join(SHOTS, `${img.image}.png`), await page.screenshot({ type: "png" }));
    await page.close();
  }
  await ctx.close();
} finally {
  demo.server.close();
}
if (!Object.values(record.heldOut).every(Boolean)) refuse(`a held-out page no longer measures its frozen geometry: ${JSON.stringify(record.heldOut)}`);
record.screenshots = Object.fromEntries(names.map((n) => [n, sha256(readFileSync(join(SHOTS, `${n}.png`)))]));

for (const [cid, c] of Object.entries(CANDIDATES)) {
  const model = join(M81, "models", `${c.stem}.onnx`);
  if (!existsSync(model) || sha256(readFileSync(model)) !== c.sha256) refuse(`${cid}: the model on disk is not the M8.1 conversion`);
  const dir = join(OUT, cid);
  mkdirSync(dir, { recursive: true });
  copyFileSync(model, join(dir, "model.onnx"));
  const run = spawnSync(PY, [join(M81, "harness", "prep-native.py"), "--candidate", cid, "--model", model, "--out-dir", dir, "--runs", "5", ...names.map((n) => `${n}=${join(SHOTS, `${n}.png`)}`)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) refuse(`${cid}: prep-native.py exited ${run.status}: ${String(run.stderr).slice(-400)}`);
  const ref = JSON.parse(readFileSync(join(dir, "native-reference.json"), "utf8"));
  const m81 = JSON.parse(readFileSync(join(M81, "results", `${cid.toLowerCase()}-run1.json`), "utf8"));
  const inputs = {};
  for (const n of ["synthetic", ...names]) {
    inputs[n] = {
      inputSha256: ref.inputs[n].input_sha256,
      equalsM81: ref.inputs[n].input_sha256 === m81.inputs[n].inputSha256,
      nativeOutputSha256: ref.inputs[n].native_output_sha256,
      nativeEqualsM81: ref.inputs[n].native_output_sha256 === m81.inputs[n].native.outputSha256,
      nativeDeterministic: ref.inputs[n].native_deterministic,
    };
  }
  record.candidates[cid] = { modelSha256: c.sha256, inputs };
  const bad = Object.entries(inputs).filter(([, v]) => !v.equalsM81 || !v.nativeEqualsM81 || !v.nativeDeterministic);
  if (bad.length) refuse(`${cid}: inputs or native outputs differ from M8.1: ${bad.map(([k]) => k).join(", ")}`);
}
record.allMatchM81 = true;
mkdirSync(join(EXP, "logs"), { recursive: true });
writeFileSync(join(EXP, "logs", "fixture-integrity.json"), JSON.stringify(record, null, 1));
console.log(JSON.stringify({ heldOut: record.heldOut, allMatchM81: true, browser: record.browser }, null, 1));
