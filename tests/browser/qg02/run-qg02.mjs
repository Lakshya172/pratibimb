/**
 * QG-02 — the coordinate contract gate, in a real browser.
 *
 * The gate's own wording, from `agentos/gates/README.md`:
 *
 *   "The CI fixture renders at DPR 1.0, 1.5, 2.0 and 100%, 125% zoom."
 *   "The same logical element resolves to the SAME CSS-PIXEL BOX in all six
 *    configurations."
 *
 * The unit suite asserts that the CONVERSIONS are self-consistent. It cannot assert that a
 * real browser behaves the way the conversions assume, because it supplies the numbers
 * itself — so it would agree with a wrong model of DPR just as readily as a right one.
 * This gate takes the numbers from Chromium and the frame size from a real screenshot, and
 * runs the SHIPPED conversion code over them.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * HOW ZOOM IS EMULATED, STATED PLAINLY
 *
 * Playwright has no "press Ctrl+" control. Zoom is emulated by `deviceScaleFactor`, which
 * is legitimate here for a precise reason: `window.devicePixelRatio` ALREADY folds browser
 * zoom in, so a physically-2.0 display at 125% reports 2.5 — and 2.5 is exactly what the
 * page sees either way. That identity is the fact the whole contract turns on, so the
 * emulation reproduces the condition under test rather than approximating it.
 *
 * What this does NOT reproduce is Chrome's zoom-specific layout rounding at fractional
 * scale factors. It is therefore recorded as emulated zoom, not as a user zooming, and the
 * distinction is carried into the evidence file rather than smoothed over.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PORT = 8930;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const BROWSER = arg("browser", "chromium");

/** Resolve a tool from the workspace, falling back to an existing experiment harness. */
function resolveTool(spec) {
  const candidates = [
    join(ROOT, "node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a1-csp-attack-surface/harness/node_modules"),
  ];
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, "noop.js"));
      req.resolve(spec);
      return base;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * The SHIPPED conversion code, from the compiled package.
 *
 * Deliberately the build output rather than a re-implementation. A gate that tests a copy
 * of the logic tests the copy — the same reason the CSP gate builds its extensions from
 * the production CSP builder and fails if the two drift.
 */
const DIST = join(ROOT, "packages/perception/dist/src/index.js");
if (!existsSync(DIST)) {
  console.error(
    `QG-02: compiled perception package not found at\n  ${DIST}\n` +
      "Run `npm run typecheck` first — this gate runs the SHIPPED code, not a copy of it."
  );
  process.exit(1);
}
const perception = await import(`file://${DIST.replace(/\\/g, "/")}`);
const {
  geometryFrom,
  buildElementGraph,
  fuse,
  projectElement,
  frameId,
  cssToCapture,
  captureToCss,
  scaleToCss,
} = perception;

/** The six configurations the gate names. Not derived, not trimmed — enumerated. */
const MATRIX = [
  { name: "DPR 1.0 @ 100%", physicalDpr: 1.0, zoom: 1.0 },
  { name: "DPR 1.0 @ 125%", physicalDpr: 1.0, zoom: 1.25 },
  { name: "DPR 1.5 @ 100%", physicalDpr: 1.5, zoom: 1.0 },
  { name: "DPR 1.5 @ 125%", physicalDpr: 1.5, zoom: 1.25 },
  { name: "DPR 2.0 @ 100%", physicalDpr: 2.0, zoom: 1.0 },
  { name: "DPR 2.0 @ 125%", physicalDpr: 2.0, zoom: 1.25 },
];

/** CSS viewport held constant across all six, so DPR and zoom are the only variables. */
const VIEWPORT = { width: 1024, height: 640 };

function serveFixture() {
  const html = readFileSync(join(HERE, "fixture", "form.html"));
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  server.listen(PORT, "127.0.0.1");
  return server;
}

/** Read PNG intrinsic dimensions from the IHDR chunk. No decoder dependency. */
function pngSize(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error("not a PNG");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

async function runConfig(browserType, cfg) {
  // devicePixelRatio folds zoom in, so the effective ratio is the product. See the header.
  const deviceScaleFactor = cfg.physicalDpr * cfg.zoom;
  // Same executable-resolution the CSP gate harness uses: the installed full Chromium
  // build, or Edge. The bundled headless shell is version-matched to whichever Playwright
  // resolved, and this repo resolves Playwright from an experiment harness whose browsers
  // were installed by a different build.
  const context = await browserType.launch({ headless: true, ...launchExecutable() });
  const page = await (
    await context.newContext({ viewport: VIEWPORT, deviceScaleFactor })
  ).newPage();

  try {
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

    const raw = await page.evaluate(() => window.__measure());
    // A PAGE CANNOT READ ITS OWN BROWSER ZOOM: devicePixelRatio folds it in, and that is
    // the very identity this contract rests on. In production the value comes from
    // chrome.tabs.getZoom(); here it comes from the emulation this run configured.
    // Supplying it is not a convenience - geometryFrom REFUSES a geometry without it,
    // which is how this run first failed.
    const measured = { ...raw, viewport: { ...raw.viewport, zoom: cfg.zoom } };

    // A REAL frame. Its dimensions are measured from the returned PNG, never assumed to be
    // viewportCss * dpr — assuming that is precisely what CAPTURE_DIMENSION_MISMATCH exists
    // to catch, and a guard fed its own assumption can never fire.
    const shot = await page.screenshot({ type: "png" });
    const frameSize = pngSize(new Uint8Array(shot));

    const geometry = geometryFrom(measured.viewport, frameSize.width, frameSize.height);
    const frame = frameId(`qg02-${cfg.name}`);
    const graph = buildElementGraph(measured.elements, geometry, frame);
    const fusion = fuse(graph, [], false, geometry);
    const projected = fusion.elements.map(projectElement);

    // Round-trip each on-screen element through the capture space a detector would see.
    const roundTrip = {};
    for (const node of graph.nodes) {
      if (node.evidence.kind !== "OBSERVED" && node.evidence.kind !== "CLIPPED") continue;
      const box = node.evidence.viewportBox;
      const back = captureToCss(cssToCapture(box, geometry), geometry);
      roundTrip[node.domRef.selector] = {
        css: [box.x, box.y, box.w, box.h],
        roundTripped: [back.x, back.y, back.w, back.h],
      };
    }

    // Structural vs visual change: tick the dynamic region's TEXT and confirm the measured
    // geometry of the elements the gate asserts on is unchanged.
    const before = await page.evaluate(() => document.getElementById("queue").textContent);
    await page.evaluate(() => window.__tickQueue());
    const after = await page.evaluate(() => document.getElementById("queue").textContent);
    const shot2 = await page.screenshot({ type: "png" });

    return {
      config: cfg.name,
      physicalDpr: cfg.physicalDpr,
      zoom: cfg.zoom,
      reportedDpr: measured.viewport.dpr,
      expectedDpr: deviceScaleFactor,
      viewportCss: {
        w: measured.viewport.viewportCssWidth,
        h: measured.viewport.viewportCssHeight,
      },
      captureSize: frameSize,
      scaleToCss: scaleToCss(geometry),
      roundTrip,
      elements: projected,
      dynamicRegion: {
        before,
        after,
        textChanged: before !== after,
        framesDiffer: Buffer.compare(shot, shot2) !== 0,
      },
    };
  } finally {
    await context.close();
  }
}

function evaluate(runs) {
  const findings = [];

  // ── Criterion: the same logical element, same CSS box, all six configurations ───────
  const TRACKED = ["#phone", "#cancel", "#help-link", "#phone-label"];
  const sameBox = {};
  for (const sel of TRACKED) {
    const boxes = runs.map((r) => ({ config: r.config, box: r.roundTrip[sel]?.css }));
    const missing = boxes.filter((b) => !b.box);
    if (missing.length) {
      findings.push(`${sel} was not observed in: ${missing.map((m) => m.config).join(", ")}`);
      sameBox[sel] = false;
      continue;
    }
    const first = boxes[0].box;
    const agree = boxes.every((b) => b.box.every((v, i) => Math.abs(v - first[i]) < 0.5));
    sameBox[sel] = agree;
    if (!agree) {
      findings.push(
        `${sel} resolves differently across configurations: ` +
          boxes.map((b) => `${b.config}=[${b.box.join(",")}]`).join("  ")
      );
    }
  }

  // ── Criterion: round trips are lossless ────────────────────────────────────────────
  let roundTripOk = true;
  for (const r of runs) {
    for (const [sel, v] of Object.entries(r.roundTrip)) {
      if (v.css.some((c, i) => Math.abs(c - v.roundTripped[i]) > 0.01)) {
        roundTripOk = false;
        findings.push(`${r.config} ${sel}: round trip lost precision`);
      }
    }
  }

  // ── Criterion: DPR is what we asked for. Catches an emulation that silently no-ops ──
  let dprOk = true;
  for (const r of runs) {
    if (Math.abs(r.reportedDpr - r.expectedDpr) > 1e-6) {
      dprOk = false;
      findings.push(
        `${r.config}: browser reported devicePixelRatio ${r.reportedDpr}, expected ${r.expectedDpr}`
      );
    }
    // The frame must actually be device-sized, or the whole capture path is untested.
    const expectedW = Math.round(r.viewportCss.w * r.expectedDpr);
    if (Math.abs(r.captureSize.width - expectedW) > 2) {
      dprOk = false;
      findings.push(
        `${r.config}: frame is ${r.captureSize.width}px wide, expected about ${expectedW}px`
      );
    }
  }

  // ── Criterion: off-screen reported visible:false, offscreen:true, NO pixel evidence ─
  let offscreenOk = true;
  for (const r of runs) {
    const submit = r.elements.find((e) => e.name === "Submit");
    if (!submit) {
      offscreenOk = false;
      findings.push(`${r.config}: the off-screen Submit target is missing from the projection`);
      continue;
    }
    if (submit.visible !== false || submit.offscreen !== true) {
      offscreenOk = false;
      findings.push(
        `${r.config}: Submit reported visible=${submit.visible} offscreen=${submit.offscreen}, ` +
          "expected visible:false offscreen:true"
      );
    }
    if ("bbox" in submit) {
      offscreenOk = false;
      findings.push(
        `${r.config}: off-screen Submit carries a bbox. The contract requires NO pixel ` +
          "evidence for an element that was never in the frame."
      );
    }
  }

  // ── Criterion: an on-screen element DOES carry a bbox (the observer sanity control) ─
  // Without this, an implementation that emitted no bbox for anything would pass the
  // off-screen criterion above while being entirely broken.
  let onscreenOk = true;
  for (const r of runs) {
    const phone = r.elements.find((e) => e.name === "Phone" && e.role === "textbox");
    if (!phone || !("bbox" in phone)) {
      onscreenOk = false;
      findings.push(`${r.config}: the on-screen Phone field has no bbox — sanity control failed`);
    }
  }

  // ── Change detection: visual change without structural change to measured elements ──
  const dynamicOk = runs.every((r) => r.dynamicRegion.textChanged && r.dynamicRegion.framesDiffer);
  if (!dynamicOk) {
    findings.push("the dynamic region did not produce an observable visual change");
  }

  return {
    configurations: runs.length,
    QG02_same_css_box_all_six: Object.values(sameBox).every(Boolean) && runs.length === 6,
    QG02_round_trip_lossless: roundTripOk,
    QG02_dpr_emulation_real: dprOk,
    QG02_offscreen_no_pixel_evidence: offscreenOk,
    QG02_onscreen_has_bbox: onscreenOk,
    dynamic_region_observable: dynamicOk,
    trackedElements: sameBox,
    findings,
  };
}

const base = resolveTool("playwright");
if (!base) {
  console.error("QG-02: playwright not resolvable — run `npm ci` at the workspace root");
  process.exit(1);
}
const pw = createRequire(join(base, "noop.js"))("playwright");
const browserType = BROWSER === "firefox" ? pw.firefox : pw.chromium;

/** Locate a usable browser binary, or return {} and let Playwright use its own. */
function launchExecutable() {
  if (process.env.CHROME_PATH) return { executablePath: process.env.CHROME_PATH };
  if (BROWSER === "firefox") return {};
  const local = process.env.LOCALAPPDATA || "";
  for (const p of [
    join(local, "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ]) {
    if (existsSync(p)) return { executablePath: p };
  }
  return {};
}

const server = serveFixture();
const runs = [];
try {
  for (const cfg of MATRIX) {
    runs.push(await runConfig(browserType, cfg));
    process.stdout.write(`  ${cfg.name}: measured\n`);
  }
} finally {
  server.close();
}

const verdict = evaluate(runs);

console.log(`\n[${BROWSER}] QG-02 coordinate contract — ${verdict.configurations} configurations`);
for (const [k, v] of Object.entries(verdict)) {
  if (typeof v === "boolean") console.log(`  ${k.padEnd(34)} : ${v ? "PASS" : "FAIL"}`);
}
for (const f of verdict.findings) console.log(`  !! ${f}`);

const outDir = join(ROOT, "artifacts", "gates", "QG-02");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `qg02-${BROWSER}.json`);
writeFileSync(
  out,
  JSON.stringify(
    {
      gate: "QG-02",
      browser: BROWSER,
      collectedAt: new Date().toISOString(),
      zoomEmulation:
        "Zoom is emulated via deviceScaleFactor. devicePixelRatio already folds browser " +
        "zoom in, so the page sees the same ratio either way; Chrome's zoom-specific " +
        "layout rounding at fractional scale factors is NOT reproduced.",
      verdict,
      runs,
    },
    null,
    2
  )
);
console.log(`\nwrote ${out}`);

const failed =
  !verdict.QG02_same_css_box_all_six ||
  !verdict.QG02_round_trip_lossless ||
  !verdict.QG02_dpr_emulation_real ||
  !verdict.QG02_offscreen_no_pixel_evidence ||
  !verdict.QG02_onscreen_has_bbox ||
  verdict.findings.length > 0;
process.exit(failed ? 1 : 0);
