/**
 * QG-03b-2a phase 1 — capture the fixtures with the REAL Chromium encoder.
 *
 *   CHROME_PATH=... node artifacts/experiments/W1-QG03b2a-chromium-jpeg-capture/harness/capture-chromium.mjs
 *
 * Writes `captured/<page>.<display>.<format>` plus `captured/manifest.json`, which records
 * for every file: the SHA-256 of the exact returned bytes, the MIME the data URL declared,
 * the capture size, the wall time of the call, and how many throttle refusals preceded it.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THE WINDOW SIZE IS CALIBRATED RATHER THAN COMPUTED
 *
 * `captureVisibleTab` captures the rendered viewport of the real window. Measured here:
 * it IGNORES CDP device-metrics emulation entirely — a page told it was 1023x641 by
 * `Emulation.setDeviceMetricsOverride` still captured at 1264x805, the true content area.
 * Playwright's `setViewportSize` is that override, so it is useless for choosing a capture
 * size and using it would have silently produced ten fixtures at one identical dimension
 * while the manifest claimed ten different ones.
 *
 * So the window itself is resized, and because the frame decoration is a platform property
 * rather than a constant, the runner measures the achieved size and corrects, up to a few
 * times. If a target is still unreachable the ACTUAL size is recorded and the fixture is
 * flagged — never relabelled to match the target.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * HEADFUL AND HEADLESS ARE SEPARATE CELLS
 *
 * They composite differently, so they may encode differently. Both are captured and they
 * are never averaged; if their bytes agree that is a finding, and if they disagree that is
 * a larger one.
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { PAGES } from "./pages.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = join(HERE, "capture-ext");
const OUT = join(HERE, "captured");
const PORT = 8931;
const CHROME = process.env.CHROME_PATH;
const LABEL = process.env.PLATFORM_LABEL || "windows";
const REPEAT = Number(process.env.REPEAT || 2); // a second capture proves determinism

if (!CHROME) {
  console.error("CHROME_PATH must point at an unbranded Chromium — branded Chrome ignores --load-extension.");
  process.exit(1);
}

const byPath = new Map(PAGES.map((p) => [`/${p.name}`, p.html]));
const server = createServer((req, res) => {
  const html = byPath.get((req.url || "").split("?")[0]);
  if (!html) {
    res.writeHead(404);
    res.end();
    return;
  }
  // no-store so a repeat capture re-renders rather than replaying a cached paint
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(html);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const sha = (b) => createHash("sha256").update(b).digest("hex");

/**
 * Resize the real window until the captured content area is the size wanted.
 *
 * `Browser.setWindowBounds` is the only lever that moves the actual surface. The loop
 * converges in one or two steps because the decoration is constant per display mode; it is
 * a loop rather than a constant because that is a platform detail nobody should hard-code.
 */
async function fitWindow(page, session, windowId, target) {
  let bounds = { width: target.w + 16, height: target.h + 100 };
  let achieved = null;
  const attempts = [];
  for (let i = 0; i < 5; i++) {
    await session.send("Browser.setWindowBounds", { windowId, bounds: { ...bounds, windowState: "normal" } });
    await page.waitForTimeout(220);
    achieved = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
    attempts.push({ requested: { ...bounds }, achieved: { ...achieved } });
    if (achieved.w === target.w && achieved.h === target.h) break;
    bounds = { width: bounds.width + (target.w - achieved.w), height: bounds.height + (target.h - achieved.h) };
  }
  return { achieved, attempts, hit: achieved.w === target.w && achieved.h === target.h };
}

async function runDisplayMode(headless) {
  const display = headless ? "headless" : "headful";
  const udd = mkdtempSync(join(tmpdir(), "pratibimb-qg03b2a-"));
  const results = [];
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(udd, {
      headless,
      executablePath: CHROME,
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        "--no-sandbox",
        "--window-position=0,0",
        // DPR 1 so the capture size is the CSS size and the letterbox geometry under test
        // is the geometry the fixture names. A DPR of 1.25 would silently change every one.
        "--force-device-scale-factor=1",
      ],
      viewport: null,
      // Playwright hides scrollbars by default, which changes the rendered content area.
      // The production capture sees whatever the real page shows.
      ignoreDefaultArgs: ["--hide-scrollbars"],
    });
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 60000 }));
    const page = ctx.pages()[0] || (await ctx.newPage());
    const session = await ctx.newCDPSession(page);
    const { windowId } = await session.send("Browser.getWindowForTarget");
    const version = ctx.browser()?.version() ?? null;

    for (const [index, p] of PAGES.entries()) {
      await page.goto(`http://127.0.0.1:${PORT}/${p.name}`, { waitUntil: "load" });
      const fit = await fitWindow(page, session, windowId, p.size);
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(400);

      for (let rep = 1; rep <= REPEAT; rep++) {
        const r = await sw.evaluate(
          (c) => globalThis.__qg03b2a_capture(c),
          // The API-surface probe costs seven extra captures, so it runs once per display
          // mode on the first page only.
          { formats: ["png", "jpeg"], surfaceProbe: index === 0 && rep === 1 }
        );
        const rec = {
          page: p.name,
          category: p.category,
          display,
          repeat: rep,
          browserVersion: version,
          userAgent: r.userAgent,
          apiBinding: r.apiBinding,
          capturedTabUrl: r.capturedTabUrl,
          permissions: r.permissions,
          targetSize: p.size,
          achievedCssSize: fit.achieved,
          windowFitHitTarget: fit.hit,
          windowFitAttempts: fit.attempts.length,
          files: [],
          error: r.error ?? null,
        };
        if (index === 0 && rep === 1 && r.apiSurface) rec.apiSurface = r.apiSurface;

        for (const c of r.captures ?? []) {
          if (!c.ok) {
            rec.files.push({ requested: c.requested, error: c.error, throttleRetries: c.throttleRetries });
            continue;
          }
          const bytes = Buffer.from(c.b64, "base64");
          const ext = c.mime === "image/png" ? "png" : c.mime === "image/jpeg" ? "jpg" : "bin";
          const file = `${p.name}.${display}.r${rep}.${ext}`;
          writeFileSync(join(OUT, file), bytes);
          // The digest is recomputed HERE, from the file on disk, and checked against the
          // one the browser computed on the bytes it held. If they ever disagree the
          // transport corrupted something and nothing downstream is worth reading.
          const local = sha(bytes);
          rec.files.push({
            file,
            requested: c.requested,
            mime: c.mime,
            dataUrlHeader: c.dataUrlHeader,
            magic: c.magic,
            bytes: bytes.length,
            sha256: local,
            sha256AgreesWithBrowser: local === c.sha256,
            captureMs: c.captureMs,
            throttleRetries: c.throttleRetries,
          });
        }
        results.push(rec);
        process.stderr.write(
          `  ${display} ${p.name.padEnd(21)} rep${rep} ` +
            `${fit.achieved.w}x${fit.achieved.h}${fit.hit ? "" : " (TARGET MISSED)"} ` +
            rec.files.map((f) => `${f.mime ?? "ERR"}:${f.bytes ?? f.error}`).join("  ") +
            "\n"
        );
      }
    }
  } finally {
    try {
      await ctx?.close();
    } catch {
      /* disposable profile */
    }
    try {
      rmSync(udd, { recursive: true, force: true });
    } catch {
      /* Windows may hold the profile briefly */
    }
  }
  return results;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = {
  experiment: "W1-QG03b2a-chromium-jpeg-capture",
  phase: "1-capture",
  note:
    "Every file here came out of chrome.tabs.captureVisibleTab. Nothing in this harness " +
    "encodes an image.",
  platform: LABEL,
  chromePath: CHROME,
  startedAt: new Date().toISOString(),
  captures: [],
};

for (const headless of [false, true]) {
  process.stderr.write(`\n=== ${headless ? "headless" : "headful"} ===\n`);
  manifest.captures.push(...(await runDisplayMode(headless)));
}

manifest.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
server.close();
process.stderr.write(`\nwrote ${join(OUT, "manifest.json")}\n`);
process.exit(0);
