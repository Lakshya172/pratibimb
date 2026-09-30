#!/usr/bin/env node
/**
 * M10.5 — REAL FRAME → FULL-FRAME TR-01 → FAIL-CLOSED PLAN → CANONICAL GEOMETRY → OPAQUE PIXELS.
 *
 * Requires the evidence build: the TR-01 probe, and the existing no-gesture capture route.
 *   M3_WORKER_FRAME=1 TR01_PROBE=1 npm run build -w @pratibimb/extension
 *
 * Per DPR cell (1 gates; 1.25, 1.5 and 2 are recorded as they come), on `/mask/`:
 *   1. the existing UI head is loaded and run once in the offscreen realm (combined memory);
 *   2. `mask`: OBSERVE → visualRegions; ONE real frame via CAPTURE_FRAME; TR-01 on the FULL frame;
 *      reportFromFullFrame → sanitizeFrame, in place. Checked: every fixture ink pixel is the fill,
 *      every control pixel is unchanged, every mask pixel is the fill, nothing outside the mask
 *      changed. At DPR 1 the raw and sanitized buffers come back and are re-checked HERE,
 *      independently of the probe;
 *   3. `mask` with the TR-01 deadline tightened to 50 ms: DETECTOR_TIMEOUT → every region masked whole;
 *   4. `mask` with a region corrupted inside the realm (NaN width; duplicate id): REFUSED, no frame,
 *      buffer wiped;
 *   5. `mask-bench`: 50 mask-only runs on the frame from step 2 (no detector in the number);
 *   6. WASM linear memory in both realms, and the frame buffers' sizes.
 *
 * Nothing is encoded and nothing is sent. Usage:
 *   CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-visual-mask.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const DPRS = [1, 1.25, 1.5, 2];
const BENCH_N = 50;
const GATE_WASM_BYTES = 200 * 1024 * 1024;

const refuse = (m) => {
  console.error(`REFUSING: ${m}`);
  process.exit(2);
};
const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT}`);
const chunks = readdirSync(join(EXT, "chunks")).map((f) => readFileSync(join(EXT, "chunks", f), "utf8")).join("");
if (!chunks.includes("TR01_PROBE_ONLY_FROM_SERVICE_WORKER")) refuse("no TR-01 probe in this build. Build: M3_WORKER_FRAME=1 TR01_PROBE=1 npm run build -w @pratibimb/extension");
const manifest = JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8"));
if (!(manifest.host_permissions ?? []).includes("<all_urls>")) refuse("this build has no evidence capture route. Build with M3_WORKER_FRAME=1 as well");

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const median = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median, p90: q(0.9), max: s[s.length - 1] };
};

/** Independent re-check of a DPR 1 cell from the raw buffers. */
function recheck(before, after, width, height, pixelRects) {
  const masked = new Uint8Array(width * height);
  for (const r of pixelRects) for (let y = Math.max(0, r.y); y < Math.min(height, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(width, r.x + r.w); x++) masked[y * width + x] = 1;
  let notCovered = 0, accidental = 0, changed = 0, maskedPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const same = before[o] === after[o] && before[o + 1] === after[o + 1] && before[o + 2] === after[o + 2] && before[o + 3] === after[o + 3];
    if (!same) changed++;
    if (masked[i]) {
      maskedPixels++;
      if (!(after[o] === 0 && after[o + 1] === 0 && after[o + 2] === 0 && after[o + 3] === 255)) notCovered++;
    } else if (!same) accidental++;
  }
  return { maskedPixels, notCovered, accidental, changed };
}

const { server, origin } = await startDemoServer(8981);
const cells = [];
try {
  for (const dpr of DPRS) {
    const cell = { dpr, failure: null };
    let context = null;
    try {
      context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pratibimb-m105-")), {
        headless: false,
        executablePath,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: dpr,
        // Emulation alone does NOT change what captureVisibleTab returns (measured: every emulated
        // cell captured at this display's physical 1.25). Forcing the browser's own scale does.
        args: [`--force-device-scale-factor=${dpr}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
      });
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
      await sw.evaluate(() => globalThis.__host.ensureOffscreen());
      const page = await context.newPage();
      await page.goto(`${origin}/mask/`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__maskReady === true);
      await page.waitForTimeout(500);
      const truth = await page.evaluate(() => window.__maskTruth);
      const identity = await sw.evaluate(() => [...globalThis.__host.hellos].reverse()[0]?.identity ?? null);
      if (!identity) throw new Error("no attested content-script identity");
      const probe = async (args) => {
        const r = await sw.evaluate((a) => globalThis.__host.toOffscreen({ kind: "TR01_PROBE", ...a }), args);
        if (r?.error) throw new Error(`${args.op}: ${r.error}`);
        return r;
      };
      // captureVisibleTab is rate-limited by the browser (about 2 per second, W1-S05rate). Every
      // capturing step is spaced, so a refusal here is the product's and never the quota's.
      const paced = async (args) => {
        await page.waitForTimeout(1_100);
        return probe(args);
      };
      const base = { tabId: identity.tabId, frameId: identity.frameId, inkRects: truth.sensitiveInk.map((s) => s.rect), controlRects: truth.control.map((c) => c.rect) };

      const ui = await probe({ op: "uihead" });
      if (ui.error) throw new Error(`uihead: ${ui.error}`);

      const ok = await paced({ op: "mask", ...base, returnPixels: dpr === 1 });
      const timeout = await paced({ op: "mask", ...base, deadlineMs: 50 });
      const refusedNan = await paced({ op: "mask", ...base, corrupt: "nan-rect" });
      const refusedDup = await paced({ op: "mask", ...base, corrupt: "duplicate-id" });
      const bench = await probe({ op: "mask-bench", n: BENCH_N });
      const benchWorst = await probe({ op: "mask-bench", n: BENCH_N, mode: "failClosed" });
      const memory = await probe({ op: "instrument" });

      const pixelRects = ok.result.regions?.flatMap((r) => r.pixelRects) ?? [];
      const independent =
        ok.pixels?.before && ok.pixels?.after
          ? recheck(Buffer.from(ok.pixels.before, "base64"), Buffer.from(ok.pixels.after, "base64"), ok.capture.width, ok.capture.height, pixelRects)
          : null;
      const regionVisibleArea = (res) => (res.result.regions ?? []).reduce((n, r) => n + r.pixelRects.reduce((m, p) => m + p.w * p.h, 0), 0);

      Object.assign(cell, {
        truthCounts: { inkRects: truth.sensitiveInk.length, controls: truth.control.length },
        capture: ok.capture,
        geometry: ok.geometry,
        regions: ok.regions,
        detections: ok.outcome.ok ? ok.outcome.detections.length : null,
        detectorMs: ok.outcome.ms ?? null,
        report: ok.report,
        normal: { result: { ...ok.result, regions: ok.result.regions }, verification: ok.verification, truthCheck: ok.truthCheck, independent },
        timeout: { outcome: timeout.outcome, report: timeout.report, result: timeout.result?.outcome, failClosed: timeout.result?.failClosed, reason: timeout.result?.reason, verification: timeout.verification, maskedArea: timeout.result?.regions ? regionVisibleArea(timeout) : null, truthCheck: timeout.truthCheck },
        refused: { nanRect: refusedNan.result, duplicateId: refusedDup.result },
        bench: Object.fromEntries(Object.entries(bench.ms).map(([k, v]) => [k, stats(v)])),
        benchFailClosed: Object.fromEntries(Object.entries(benchWorst.ms).map(([k, v]) => [k, stats(v)])),
        timerNote: "performance.now() in the offscreen document is coarsened to 0.1 ms; stages below that read as 0 or 0.1",
        memory: {
          method: "WASM linear memory: WebAssembly.Memory wrapped before ORT created memory; read from buffer.byteLength. Frame buffers: exact byteLength of each allocation.",
          workerWasmBytes: memory.worker?.wasmBytes ?? null,
          offscreenWasmBytes: memory.offscreenWasmBytes ?? null,
          workerForeignArrivals: memory.worker?.foreignArrivals ?? null,
          frameBytes: ok.capture.rgbaBytes,
          workerCopyBytes: ok.capture.rgbaBytes,
          sanitizedExtraBytes: 0,
          maskRects: pixelRects.length,
          maskRectListJsonBytes: JSON.stringify(ok.result.regions ?? []).length,
        },
      });

      const inkOk = ok.truthCheck.ink.length === truth.sensitiveInk.length && ok.truthCheck.ink.every((i) => i.pixels > 0 && i.uncovered === 0);
      const controlOk = ok.truthCheck.control.every((c) => c.pixels > 0 && c.changed === 0);
      const wasm = (cell.memory.workerWasmBytes ?? NaN) + (cell.memory.offscreenWasmBytes ?? NaN);
      cell.checks = {
        regionsAreTheThreeVisualRegions: JSON.stringify(ok.regions.map((r) => r.id).sort()) === JSON.stringify(["canvas:0", "canvas:1", "img:0"]),
        captureIsViewportTimesDpr: ok.capture.width === Math.round(1280 * dpr) && ok.capture.height === Math.round(720 * dpr),
        fullFrameDetectorRan: ok.outcome.ok === true && cell.detections > 0,
        sanitized: ok.result.outcome === "SANITIZED" && ok.result.failClosed === false,
        everyFixtureInkPixelCovered: inkOk,
        controlsUnchanged: controlOk,
        everyMaskPixelIsFill: ok.verification?.notCovered === 0 && ok.verification?.covered > 0,
        nothingOutsideTheMaskChanged: ok.verification?.accidental === 0,
        independentRecheck: dpr !== 1 || (independent !== null && independent.notCovered === 0 && independent.accidental === 0 && independent.changed === ok.verification.changed),
        timeoutMasksEveryRegionWhole:
          timeout.outcome?.ok === false && timeout.outcome.code === "DETECTOR_TIMEOUT" && timeout.result?.outcome === "SANITIZED" && timeout.result.failClosed === true &&
          timeout.verification?.notCovered === 0 && timeout.verification?.accidental === 0 && timeout.verification?.maskedPixels === regionVisibleArea(timeout),
        refusedIsTerminal:
          [refusedNan, refusedDup].every((r) => r.result?.outcome === "REFUSED" && r.result.frameWiped === true && r.result.bufferIsAllFill === true && r.verification === null),
        wasmUnder200MB: Number.isFinite(wasm) && wasm <= GATE_WASM_BYTES,
        noForeignNetwork: cell.memory.workerForeignArrivals === 0,
      };
    } catch (e) {
      cell.failure = `${e.name}: ${String(e.message).slice(0, 400)}`;
    } finally {
      if (context) await context.close();
    }
    cells.push(cell);
  }
} finally {
  await new Promise((ok) => server.close(ok));
}

const gating = cells.find((c) => c.dpr === 1);
const passed = gating?.failure === null && Object.values(gating.checks ?? {}).every(Boolean);
const record = {
  experiment: "M10.5 — local pixel redaction on a real captured frame",
  verdict: passed ? "PASS" : "FAIL",
  gatingCell: "DPR 1 (the resolution TR-01 was screened at); other DPR cells are recorded, not gating",
  captureScale: "each cell launches Chrome with --force-device-scale-factor=<dpr>, so the captured frame is viewport x dpr",
  notAClaim: [
    "the frame came through the degraded evidence route (M3_WORKER_FRAME: captureVisibleTab in the worker), not the gesture stream",
    "nothing was encoded or sent; the output is an in-memory RGBA buffer",
    "one synthetic fixture on one workstation; detector recall at DPR != 1 is not screened",
  ],
  cells,
  recordedAt: new Date().toISOString(),
  provenance: {
    ...provenanceOf(WS),
    os: `${process.platform} ${release()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    node: process.version,
    playwright: require2("playwright/package.json").version,
    browserBinary: executablePath,
    headless: false,
    build: "M3_WORKER_FRAME=1 TR01_PROBE=1 (evidence build)",
  },
};
mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-visual-mask.json")), WS);
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${record.verdict}  pixel redaction on a real frame  on ${record.provenance.host} (${WS.id})`);
for (const c of cells) {
  const bad = Object.entries(c.checks ?? {}).filter(([, v]) => !v).map(([k]) => k);
  console.log(`  DPR ${c.dpr}: ${c.failure ? `FAILURE ${c.failure}` : bad.length ? `FAIL ${bad.join(", ")}` : "PASS"}  detections ${c.detections}  changed ${c.normal?.verification?.changed ?? "-"}  ink ${JSON.stringify(c.normal?.truthCheck?.ink ?? null)}`);
}
for (const c of cells) console.log(`  bench DPR ${c.dpr}: detected total ${JSON.stringify(c.bench?.total ?? null)}  failClosed fill ${JSON.stringify(c.benchFailClosed?.fill ?? null)} writes ${c.benchFailClosed?.pixelWrites?.max ?? "-"}`);
console.log(`  memory (DPR 1): ${JSON.stringify(gating?.memory ?? null)}`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
