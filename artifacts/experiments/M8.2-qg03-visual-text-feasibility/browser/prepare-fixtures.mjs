#!/usr/bin/env node
/**
 * M8.2 — prepare the frozen inputs, and refuse unless they are THIS WORKSTATION'S inputs byte for byte.
 *
 *   1. Screenshot the development fixture and the six held-out pages (Chrome for Testing 153,
 *      1280x720, DPR 1 — M8.1's conditions) and require every held-out page to re-measure its
 *      frozen geometry exactly.
 *   2. For each candidate, run M8.1's prep-native.py UNCHANGED: the candidate's own preprocessing
 *      and the native onnxruntime 1.29.0 reference.
 *   3. Require every input tensor's sha256 and every native output's sha256 to equal this
 *      workstation's baseline. A single differing byte stops M8.2 before any cell runs.
 *
 * WHY "THIS WORKSTATION'S" AND NOT "M8.1'S". This script used to compare against M8.1's W1 record and
 * to stamp every result `workstation: "W1"` whatever machine it ran on. On W2 that comparison fails
 * for two INDEPENDENT measured reasons, and neither is a defect:
 *
 *   - rasterisation: the same browser, viewport and DPR render the same DOM to different glyph pixels
 *     on a different GPU, so the screenshots and every tensor derived from them differ;
 *   - CPU floating-point kernels: onnxruntime 1.29.0 handed the BYTE-IDENTICAL synthetic tensor and
 *     the BYTE-IDENTICAL model returns a different output on W1 and W2 (`min` and `max` identical,
 *     summations diverging at ~1e-7, each machine deterministic). No screenshot is involved.
 *
 * So the native reference is MACHINE-LOCAL by construction. Equality is still exact, and it is still
 * mandatory — it is now exact against the baseline of the machine doing the measuring. An unknown
 * machine REFUSES; it does not borrow another's baseline. See
 * `../logs/baseline-divergence-w1-vs-w2.md` and `tests/browser/support/m82-baseline.mjs`.
 *
 * Writes git-ignored tensors to ../models/fixtures/<workstation>/<candidate>/ and the committed
 * integrity record ../logs/<ws>-fixture-integrity.json (hashes and geometry-free facts only).
 * W1's historical ../logs/fixture-integrity.json is never written by this script.
 *
 * Usage:
 *   CHROME_PATH=<cft chrome.exe> REF_PYTHON=<measurement venv python> node prepare-fixtures.mjs
 *   ... --establish-baseline     on a machine that has no baseline yet. Writes
 *                               ../logs/<ws>-baseline-<candidate>.json and EXITS NON-ZERO, so an
 *                               establishment run can never be read as a passing verification.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startDemoServer } from "../../../../tests/browser/demo/server.mjs";
import { dbPostprocess } from "../../../../tests/browser/support/text-detector-screening.mjs";
import { scoreImage } from "../../../../tests/browser/support/redaction-metrics.mjs";
import {
  baselinePath,
  fixturesDir,
  hasBaseline,
  inputShaOf,
  integrityRecordPath,
  loadBaseline,
  nativeOutputShaOf,
} from "../../../../tests/browser/support/m82-baseline.mjs";
import { assertOwnEvidencePath, provenanceOf, resolveWorkstation } from "../../../../tests/browser/support/workstation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXP = dirname(HERE);
const ROOT = join(EXP, "..", "..", "..");
const M81 = join(ROOT, "artifacts", "experiments", "M8.1-visual-text-screening");
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

/** Establishment is a deliberate act, named on the command line, never inferred from an absent file. */
const ESTABLISH = process.argv.includes("--establish-baseline");

const WS = resolveWorkstation();
const OUT = fixturesDir(WS);
const SHOTS = join(OUT, "screenshots");

const CHROME = process.env.CHROME_PATH;
const PY = process.env.REF_PYTHON;
if (!CHROME || !existsSync(CHROME)) refuse("set CHROME_PATH");
if (!PY || !existsSync(PY)) refuse("set REF_PYTHON");
if (WS.id === "W1" && ESTABLISH) {
  refuse("W1's baseline is M8.1's historical run record. It is immutable and is never re-established.");
}
if (!ESTABLISH) {
  for (const cid of Object.keys(CANDIDATES)) {
    if (!hasBaseline(cid, WS)) {
      refuse(
        `no M8.2 baseline for ${cid} on ${WS.id} (${WS.host}); expected ${baselinePath(cid, WS)}.\n` +
          "  This machine does NOT fall back to another workstation's baseline. Establish it with\n" +
          "  --establish-baseline, then complete the WASM stage with run-tr01-worker.mjs."
      );
    }
  }
}
mkdirSync(SHOTS, { recursive: true });

const frozen = JSON.parse(readFileSync(HELDOUT, "utf8"));
const require2 = createRequire(join(ROOT, "package.json"));
const { chromium } = require2("playwright");
const demo = await startDemoServer(8993);
const record = { at: new Date().toISOString(), ...provenanceOf(WS), mode: ESTABLISH ? "ESTABLISH" : "VERIFY", heldOut: {}, candidates: {} };
const names = ["dev", ...frozen.images.map((i) => i.image)];
let devTruth = null;
try {
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m82-prep-")), {
    headless: false,
    executablePath: CHROME,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  record.browser = ctx.browser()?.version() ?? null;
  // The rasterisation environment is part of the evidence: it is WHY one machine's pixels are not
  // another's. Recorded, never used to decide anything.
  record.capture = { executablePath: CHROME, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
  const dev = await ctx.newPage();
  await dev.goto(`${demo.origin}/visual/`, { waitUntil: "load" });
  await dev.waitForFunction(() => window.__fixtureReady === true);
  record.capture.raster = await dev.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const d = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return {
      devicePixelRatio: window.devicePixelRatio,
      webglVendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : null,
      webglRenderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
      userAgent: navigator.userAgent,
    };
  });
  devTruth = await dev.evaluate(() => {
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

const established = [];
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

  if (ESTABLISH) {
    // The native-derived box geometry and the RE-1 score this machine's own map produces. These are
    // written as the baseline's NATIVE section; the authoritative `boxes` are the WASM ones, filled in
    // by run-tr01-worker.mjs. Nothing here is compared with another machine.
    const inputs = {};
    for (const n of ["synthetic", ...names]) {
      const e = ref.inputs[n];
      inputs[n] = { input: e.meta, inputSha256: e.input_sha256, nativeOutputSha256: e.native_output_sha256, nativeDeterministic: e.native_deterministic, native: { count: e.native_output.count, min: e.native_output.min, max: e.native_output.max, sum: e.native_output.sum, sumAbs: e.native_output.sumAbs, sumSq: e.native_output.sumSq, outputSha256: e.native_output_sha256 } };
      if (n === "synthetic") continue;
      const raw = readFileSync(join(dir, `native-${n}.f32`));
      const map = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
      const [H, W] = e.meta.resized_hw;
      const [srcH, srcW] = e.meta.source_hw;
      inputs[n].nativeBoxes = dbPostprocess(map, H, W, e.meta.ratio_h, e.meta.ratio_w, srcH, srcW).boxes;
      // Not yet comparable: the harnesses compare WASM detections, scores included.
      inputs[n].boxes = inputs[n].nativeBoxes;
    }
    const perImage = frozen.images.map((img) => ({
      image: img.image,
      ...scoreImage({ boxes: inputs[img.image].nativeBoxes.map(({ x, y, w, h }) => ({ x, y, w, h })) }, { region: img.region, strings: img.strings }),
    }));
    const baseline = {
      experiment: "M8.2 real-frame baseline",
      candidate: cid,
      ...provenanceOf(WS),
      establishedAt: new Date().toISOString(),
      establishment: {
        stage: "NATIVE",
        wasmStageComplete: false,
        wasmStageEstablishableHere: cid === "TR-01",
        note:
          "boxes are NATIVE-derived and are NOT yet the comparison target. The harnesses compare WASM " +
          "detections with their scores, exactly as M8.1's recorded boxes were WASM-derived. " +
          (cid === "TR-01"
            ? "Complete with `run-tr01-worker.mjs --establish-baseline`."
            : "TR-02 is the rollback candidate and NO product harness runs it through ORT WASM: the product " +
              "packages TR-01 only, and TR-02's W1 WASM reference came from M8.2's own browser cells. So this " +
              "candidate's WASM stage CANNOT be established by the TR-01 worker, and completing it means " +
              "re-running M8.2's browser cells on this machine. The native stage below stands on its own; " +
              "`loadBaseline` refuses to use these boxes for a WASM comparison."),
      },
      machineLocal:
        "M8.2's native reference is machine-local: onnxruntime returns a different output for a " +
        "byte-identical tensor and model on a different CPU. This record verifies THIS machine only.",
      browser: record.browser,
      capture: record.capture,
      model: { file: `${c.stem}.onnx`, sha256: c.sha256 },
      referenceRuntime: ref.reference_runtime,
      provider: ref.provider,
      heldOutGroundTruth: { set: frozen.set ?? null, version: frozen.version ?? null, verified: record.heldOut },
      devTruthSha256: sha256(JSON.stringify(devTruth)),
      screenshots: record.screenshots,
      inputs,
      heldOut: { perImage },
    };
    const path = baselinePath(cid, WS);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(baseline, null, 1));
    established.push({ candidate: cid, path });
    record.candidates[cid] = { modelSha256: c.sha256, establishedNativeStage: true, inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { inputSha256: v.inputSha256, nativeOutputSha256: v.nativeOutputSha256, nativeDeterministic: v.nativeDeterministic }])) };
    continue;
  }

  // Only the input tensor and the native output are measured here, so only those are required of
  // the baseline. The WASM stage is what the box-comparing consumers need, and they demand it.
  const baseline = loadBaseline(cid, WS, { requireBoxes: false });
  const inputs = {};
  for (const n of ["synthetic", ...names]) {
    inputs[n] = {
      inputSha256: ref.inputs[n].input_sha256,
      equalsBaseline: ref.inputs[n].input_sha256 === inputShaOf(baseline, n),
      nativeOutputSha256: ref.inputs[n].native_output_sha256,
      nativeEqualsBaseline: ref.inputs[n].native_output_sha256 === nativeOutputShaOf(baseline, n),
      nativeDeterministic: ref.inputs[n].native_deterministic,
    };
  }
  record.candidates[cid] = { modelSha256: c.sha256, baseline: baselinePath(cid, WS), inputs };
  const bad = Object.entries(inputs).filter(([, v]) => !v.equalsBaseline || !v.nativeEqualsBaseline || !v.nativeDeterministic);
  if (bad.length) refuse(`${cid}: inputs or native outputs differ from the ${WS.id} baseline: ${bad.map(([k]) => k).join(", ")}`);
}

if (ESTABLISH) {
  console.log(JSON.stringify({ workstation: WS.id, host: WS.host, browser: record.browser, raster: record.capture.raster, heldOut: record.heldOut, established }, null, 1));
  console.error(
    "\nESTABLISHED THE NATIVE STAGE ONLY — this is NOT a verification pass.\n" +
      "Next: TR01_PROBE=1 npm run build -w @pratibimb/extension\n" +
      "      CHROME_PATH=<cft> node tests/browser/extension/run-tr01-worker.mjs --establish-baseline\n" +
      "Then re-run this script WITHOUT --establish-baseline to verify against what was established."
  );
  process.exit(3);
}

record.allMatchBaseline = true;
const integrity = integrityRecordPath(WS);
mkdirSync(dirname(integrity), { recursive: true });
assertOwnEvidencePath(integrity, WS);
writeFileSync(integrity, JSON.stringify(record, null, 1));
console.log(JSON.stringify({ workstation: WS.id, heldOut: record.heldOut, allMatchBaseline: true, browser: record.browser, baselines: Object.fromEntries(Object.entries(record.candidates).map(([k, v]) => [k, v.baseline])) }, null, 1));
