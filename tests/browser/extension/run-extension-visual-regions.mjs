#!/usr/bin/env node
/**
 * M10.3 — visual-only region enumeration through the REAL extension, at DPR 1, 1.25, 1.5 and 2.
 *
 * WHAT IT PROVES. That the built MV3 host's OBSERVE — offscreen document → service worker → content
 * script → back, the unchanged `observePage` path — carries `visualRegions` for a real page: exactly
 * the rendered canvases and images, with the CSS rectangles the live DOM reports, positional ids, and
 * no pixel, URL or text. And that the ordinary element graph still arrives beside it.
 *
 * WHAT IT DOES NOT PROVE. Nothing is captured: no stream, no screenshot, no detector, no mask, no
 * encode, no egress. No gesture is needed because no frame is taken. Region→capture-pixel mapping is
 * unit-tested (`visualRegions.test.ts`), not measured here. One fixture, one browser cell.
 *
 * Usage: CHROME_PATH="<chrome for testing>" node tests/browser/extension/run-extension-visual-regions.mjs
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cpus, release, tmpdir } from "node:os";

import { ROOT, startDemoServer } from "../demo/server.mjs";
import { assertOwnEvidencePath, evidenceFileName, provenanceOf, resolveWorkstation } from "../support/workstation.mjs";

const WS = resolveWorkstation();
const EXT = join(ROOT, "apps", "extension", ".output", "chrome-mv3");
const OUT = join(ROOT, "artifacts", "experiments", "M10-visual-redaction-integration", "logs");
const DPRS = [1, 1.25, 1.5, 2];
const VIEWPORT = { width: 1280, height: 720 };

/** Region id → the fixture element it must be (the harness's control uses the fixture's own ids). */
const EXPECTED = { "canvas:0": "#chart", "canvas:3": "#frac", "img:0": "#photo", "img:2": "#edge" };
const EXCLUDED = { "canvas:1": "#hidden (display:none)", "canvas:2": "#invisible (visibility:hidden)", "img:1": "#empty (zero size)" };
/** Synthetic strings the fixture paints, sets or carries. Their ABSENCE is asserted. */
const FIXTURE_STRINGS = ["SYNTH-CANVAS-7712", "SYNTH-IMG-4401", "SYNTH-ALT-5521", "SYNTH-INPUT-9000"];

const refuse = (message) => {
  console.error(`REFUSING: ${message}`);
  process.exit(2);
};

const require2 = createRequire(import.meta.url);
const { chromium } = require2("playwright");
const executablePath = process.env.CHROME_PATH;
if (!executablePath || !existsSync(executablePath)) refuse("set CHROME_PATH to the Chrome for Testing binary");
if (!existsSync(join(EXT, "manifest.json"))) refuse(`no built host at ${EXT} (run: npm run build -w @pratibimb/extension)`);

async function runAt(dpr, fixtureUrl) {
  const userDataDir = mkdtempSync(join(tmpdir(), "pratibimb-m10-regions-"));
  let context = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      executablePath,
      viewport: VIEWPORT,
      deviceScaleFactor: dpr,
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 30_000 }));
    const page = await context.newPage();
    await page.goto(fixtureUrl, { waitUntil: "load" });
    await page.waitForSelector("#submit");
    await page.waitForTimeout(500);

    const identity = await worker.evaluate(async () => {
      const h = globalThis.__host;
      await h.ensureOffscreen();
      const last = [...h.hellos].reverse()[0];
      return last ? last.identity : null;
    });
    if (!identity || typeof identity.tabId !== "number") throw new Error("no attested content-script identity was recorded");

    const reply = await worker.evaluate(
      async ({ tabId, frameId }) => globalThis.__host.toOffscreen({ kind: "TRANSPORT_OBSERVE", tabId, frameId }),
      { tabId: identity.tabId, frameId: identity.frameId }
    );
    if (!reply?.ok) throw new Error(`TRANSPORT_OBSERVE refused: ${reply?.refused ?? "no response"}`);

    // The control: the same API, read directly in the page, for the fixture's own elements.
    const domTruth = await page.evaluate((selectors) => {
      const out = {};
      for (const [id, selector] of Object.entries(selectors)) {
        const r = document.querySelector(selector).getBoundingClientRect();
        out[id] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      return { rects: out, dpr: window.devicePixelRatio };
    }, EXPECTED);

    return { observation: reply.observation, identity, domTruth, failure: null };
  } catch (error) {
    return { observation: null, identity: null, domTruth: null, failure: `${error.name}: ${String(error.message).slice(0, 300)}` };
  } finally {
    if (context) await context.close();
  }
}

const { server, origin } = await startDemoServer(8975);
const runs = [];
try {
  for (const dpr of DPRS) runs.push({ dpr, ...(await runAt(dpr, `${origin}/regions/`)) });
} finally {
  await new Promise((ok) => server.close(ok));
}

const same = (a, b) => a !== undefined && b !== undefined && ["x", "y", "w", "h"].every((k) => a[k] === b[k]);

const cells = runs.map(({ dpr, observation, identity, domTruth, failure }) => {
  const regions = observation?.visualRegions ?? [];
  const ids = regions.map((r) => r.id);
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));
  const nodes = observation?.graph?.nodes ?? [];
  const selectors = new Set(nodes.map((n) => n.domRef?.selector));
  const serialised = JSON.stringify(observation ?? {});
  const checks = {
    observationReturned: observation !== null,
    regionsBoundToAttestedDocument: observation?.binding?.document?.documentId === identity?.documentId,
    exactlyTheEligibleRegions: JSON.stringify([...ids].sort()) === JSON.stringify(Object.keys(EXPECTED).sort()),
    idsUnique: new Set(ids).size === ids.length,
    idsPositional: ids.every((id) => /^(canvas|img):(0|[1-9][0-9]*)$/.test(id)),
    hiddenAndZeroSizeExcluded: Object.keys(EXCLUDED).every((id) => !ids.includes(id)),
    geometryEqualsLiveDom: Object.keys(EXPECTED).every((id) => same(byId[id]?.rect, domTruth?.rects?.[id])),
    partialImageKeepsFullRect: byId["img:2"]?.rect?.x === -50 && byId["img:2"]?.rect?.w === 200,
    fractionalPreserved: same(byId["canvas:3"]?.rect, { x: 40.5, y: 260.25, w: 100.75, h: 50.5 }),
    regionsAreGeometryOnly: regions.every(
      (r) => JSON.stringify(Object.keys(r).sort()) === '["id","kind","rect"]' && JSON.stringify(Object.keys(r.rect).sort()) === '["h","w","x","y"]'
    ),
    noPixelUrlOrTextInObservation:
      FIXTURE_STRINGS.every((s) => !serialised.includes(s)) && !/data:image|base64|svg\+xml|<svg/i.test(serialised),
    elementGraphStillPresent: selectors.has("#submit") && selectors.has("#name"),
    // Verbatim: the observation carries the page's own devicePixelRatio. Under emulation Chrome
    // reports it with float32 noise (1.5 arrives as 1.5000000596…), so the requested factor is
    // compared within 1e-6 and the page's value is compared exactly.
    viewportReportsTheDpr:
      typeof domTruth?.dpr === "number" && observation?.viewport?.dpr === domTruth.dpr && Math.abs(domTruth.dpr - dpr) < 1e-6,
  };
  return {
    dpr,
    passed: failure === null && Object.values(checks).every(Boolean),
    checks,
    failure,
    observedViewport: observation?.viewport ?? null,
    pageDevicePixelRatio: domTruth?.dpr ?? null,
    regions,
    domTruth: domTruth?.rects ?? null,
  };
});

const dprInvariant = cells.every((c) => JSON.stringify(c.regions) === JSON.stringify(cells[0].regions));
const passed = cells.every((c) => c.passed) && dprInvariant;

const record = {
  experiment: "M10.3 — visual-only region enumeration through the real MV3 extension",
  verdict: passed ? "PASS" : "FAIL",
  status: passed ? "EXPERIMENTALLY VERIFIED (one fixture, one browser cell, four DPRs, single run each)" : "FAIL",
  claim:
    "OBSERVE through offscreen -> service worker -> content script returns exactly the rendered canvas and img " +
    "elements as positional ids and CSS rectangles equal to the live DOM, at DPR 1/1.25/1.5/2, with no pixel, URL or text",
  notAClaim: [
    "nothing was captured: no stream, screenshot, detector, mask, encode or egress took part",
    "TR-01 was not called",
    "capture-pixel mapping of these rectangles is unit-tested, not measured here",
    "one fixture in one browser cell is not a coverage claim over real pages",
  ],
  expected: { enumerated: EXPECTED, excluded: EXCLUDED },
  dprInvariant,
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
    viewport: VIEWPORT,
    extensionPath: EXT,
    manifestPermissions: JSON.parse(readFileSync(join(EXT, "manifest.json"), "utf8")).permissions ?? [],
  },
};

mkdirSync(OUT, { recursive: true });
const target = assertOwnEvidencePath(join(OUT, evidenceFileName(WS, "cft-visual-regions.json")), WS);
writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, "utf8");

console.log(`\n${record.verdict}  visual-only regions through the extension  on ${record.provenance.host} (${WS.id})`);
for (const c of cells) {
  console.log(`  DPR ${c.dpr}: ${c.passed ? "PASS" : "FAIL"}  regions ${c.regions.map((r) => r.id).join(", ") || "(none)"}`);
  for (const [name, ok] of Object.entries(c.checks)) if (!ok) console.log(`    FAIL  ${name}`);
  if (c.failure) console.log(`    failure: ${c.failure}`);
}
console.log(`  rectangles identical across DPRs: ${dprInvariant}`);
console.log(`written: ${target}`);
process.exit(passed ? 0 : 1);
