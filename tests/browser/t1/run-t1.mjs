/**
 * T1 perception end-to-end — capture → DOM graph → detector → fusion → PerceptionState.
 *
 * Asserts against the TYPED STATE, not against screenshots. A screenshot comparison would
 * tell us the page rendered; it would say nothing about whether provenance survived
 * fusion, which is the property this layer exists to provide.
 *
 * Runs the SHIPPED compiled package, for the same reason the QG-02 gate does: a harness
 * that re-implements the logic tests the re-implementation.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * THE DETECTOR HAS NO WEIGHTS, AND THIS GATE DOES NOT PRETEND OTHERWISE
 *
 * Two configurations are exercised against the same real frame:
 *
 *   FLOOR    the admissible production configuration today - option C, DOM-only.
 *            The detector reports MODEL_ASSET_UNAVAILABLE and fusion records
 *            NO_DETECTOR, distinguishable from a detector that ran and found nothing.
 *
 *   SYNTHETIC  detections DERIVED FROM THE MEASURED DOM BOXES, so the fusion path,
 *            provenance, and the model->capture->CSS chain are exercised end to end on
 *            real geometry. These are NOT a detector and are never described as one; no
 *            accuracy claim is made or possible from them.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PORT = 8950;

const arg = (n, d) => {
  const m = process.argv.find((a) => a.startsWith(`--${n}=`));
  return m ? m.split("=")[1] : d;
};
const BROWSER = arg("browser", "chromium");

function resolveTool(spec) {
  for (const base of [
    join(ROOT, "node_modules"),
    join(ROOT, "artifacts/experiments/W1-S02a2a4-connect-src-provenance/harness/node_modules"),
  ]) {
    try {
      createRequire(join(base, "noop.js")).resolve(spec);
      return base;
    } catch {
      /* next */
    }
  }
  return null;
}

const DIST = join(ROOT, "packages/perception/dist/src/index.js");
if (!existsSync(DIST)) {
  console.error(`T1: compiled package missing at\n  ${DIST}\nRun \`npm run typecheck\` first.`);
  process.exit(1);
}
const P = await import(`file://${DIST.replace(/\\/g, "/")}`);

function serve() {
  const html = readFileSync(join(HERE, "fixture", "controls.html"));
  const s = createServer((_q, r) => {
    r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    r.end(html);
  });
  s.listen(PORT, "127.0.0.1");
  return s;
}

/** PNG intrinsic size from the IHDR chunk. Measured, never assumed. */
function pngSize(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

function chromeExecutable() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const p = join(process.env.LOCALAPPDATA || "", "ms-playwright", "chromium-1234", "chrome-win64", "chrome.exe");
  return existsSync(p) ? p : null;
}

const findings = [];
const check = (cond, label) => {
  if (!cond) findings.push(label);
  return cond;
};

async function run() {
  const base = resolveTool("playwright");
  if (!base) throw new Error("playwright not resolvable — run `npm ci`");
  const pw = createRequire(join(base, "noop.js"))("playwright");
  const type = BROWSER === "firefox" ? pw.firefox : pw.chromium;
  const exe = BROWSER === "firefox" ? null : chromeExecutable();

  const browser = await type.launch({
    headless: true,
    ...(exe ? { executablePath: exe } : {}),
  });
  try {
    const page = await (
      await browser.newContext({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 2 })
    ).newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });

    const raw = await page.evaluate(() => window.__measure());
    // A page cannot read its own browser zoom; devicePixelRatio folds it in. Supplied here
    // as the harness configured it, exactly as QG-02 does.
    const measured = { ...raw, viewport: { ...raw.viewport, zoom: 1.0 } };

    const shot = await page.screenshot({ type: "png" });
    const size = pngSize(new Uint8Array(shot));

    const geometry = P.geometryFrom(measured.viewport, size.width, size.height);
    const frame = {
      id: P.frameId("t1-frame-1"),
      capturedAt: Date.now(),
      pixels: new Uint8Array(shot),
      format: "png",
      geometry,
    };
    const graph = P.buildElementGraph(measured.elements, geometry, frame.id);

    // ── FLOOR: the admissible production configuration ──────────────────────────────
    const detector = P.createUiElementDetector(null);
    const attempt = await detector.detect(frame, "wasm");
    check(attempt.ok === false, "detector with no weights should refuse");
    check(
      attempt.ok === false && attempt.code === "MODEL_ASSET_UNAVAILABLE",
      `expected MODEL_ASSET_UNAVAILABLE, got ${attempt.ok ? "ok" : attempt.code}`
    );
    const floor = P.fuse(graph, [], false, geometry);

    // ── SYNTHETIC: detections derived from measured DOM boxes ───────────────────────
    // Round-tripped through model space so the full chain is exercised on real geometry.
    const transform = P.computeLetterbox(geometry.captureSize, P.HEAD_CONTRACT.inputSize);
    const targets = ["#save", "#email", "#consent", "#tos", "#card-1"];
    const synthetic = [];
    for (const node of graph.nodes) {
      if (!targets.includes(node.domRef.selector)) continue;
      if (node.evidence.kind !== "OBSERVED" && node.evidence.kind !== "CLIPPED") continue;
      const inModel = P.captureToModel(P.cssToCapture(node.evidence.viewportBox, geometry), transform);
      const backToCapture = P.modelToCapture(inModel, transform);
      synthetic.push({
        box: P.captureToCss(backToCapture, geometry),
        label: node.role,
        score: 0.9,
        role: "UIElementDetector",
        frameId: frame.id,
        modelId: "synthetic-from-dom",
        revision: "harness",
      });
    }
    const fused = P.fuse(graph, synthetic, true, geometry);

    // ── stale-frame refusal, on real data ───────────────────────────────────────────
    let staleRefused = false;
    let staleCode = null;
    try {
      P.fuse(graph, [{ ...synthetic[0], frameId: P.frameId("t1-frame-OLD") }], true, geometry);
    } catch (e) {
      staleRefused = true;
      staleCode = e.code;
    }

    const projected = fused.elements.map(P.projectElement);
    const bySelector = (sel) => graph.nodes.find((n) => n.domRef.selector === sel);
    const named = (name) => projected.find((e) => e.name === name);

    // ── assertions against the typed state ──────────────────────────────────────────
    const offscreen = named("Submit application");
    check(!!offscreen, "off-screen Submit missing from the projection");
    check(offscreen?.visible === false && offscreen?.offscreen === true,
      `off-screen Submit reported visible=${offscreen?.visible} offscreen=${offscreen?.offscreen}`);
    check(offscreen !== undefined && !("bbox" in offscreen),
      "off-screen Submit must carry NO bbox");

    const clipped = bySelector("#clipped");
    check(clipped?.evidence.kind === "CLIPPED",
      `#clipped should straddle the fold, got ${clipped?.evidence.kind}`);

    const consent = bySelector("#consent");
    check(consent?.parent !== null, "#consent should be nested inside its label");

    const matched = fused.elements.filter((e) => e.provenance.source === "dom+vision");
    check(matched.length === synthetic.length,
      `expected ${synthetic.length} dom+vision matches, got ${matched.length}`);
    check(matched.every((e) => e.provenance.detection.modelId === "synthetic-from-dom"),
      "model identity did not survive fusion");

    const floorDom = floor.elements.filter(
      (e) => e.provenance.source === "dom" && e.provenance.visualAbsence === "NO_DETECTOR"
    );
    check(floorDom.length > 0, "floor configuration should record NO_DETECTOR");
    const ranDom = fused.elements.filter(
      (e) => e.provenance.source === "dom" && e.provenance.visualAbsence === "NOT_DETECTED"
    );
    check(ranDom.length > 0, "detector-ran configuration should record NOT_DETECTED");

    check(staleRefused && staleCode === "STALE_FRAME",
      `stale frame should be refused with STALE_FRAME, got ${staleCode}`);

    // Determinism: the same inputs must produce the same graph.
    const again = P.fuse(graph, synthetic, true, geometry);
    check(
      JSON.stringify(again.elements.map((e) => [e.id, e.provenance.source])) ===
        JSON.stringify(fused.elements.map((e) => [e.id, e.provenance.source])),
      "fusion is not deterministic"
    );

    // No impossible geometry anywhere in the fused state.
    const bad = fused.elements.filter(
      (e) => e.box !== null && (!Number.isFinite(e.box.x) || e.box.w <= 0 || e.box.h <= 0)
    );
    check(bad.length === 0, `${bad.length} fused elements have impossible geometry`);

    return {
      browser: BROWSER,
      viewportCss: geometry.viewportCss,
      captureSize: geometry.captureSize,
      dpr: geometry.dpr,
      detectorRefusal: attempt.ok ? null : { code: attempt.code, detail: attempt.detail },
      floor: {
        elements: floor.elements.length,
        domOnly: floor.domOnlyCount,
        matched: floor.matchedCount,
        noDetector: floorDom.length,
      },
      synthetic: {
        detections: synthetic.length,
        matched: fused.matchedCount,
        visionOnly: fused.visionOnlyCount,
        overlaySuspects: fused.overlaySuspectCount,
      },
      staleFrame: { refused: staleRefused, code: staleCode },
      offscreen: offscreen ?? null,
      clippedKind: clipped?.evidence.kind ?? null,
      projected,
    };
  } finally {
    await browser.close();
  }
}

const server = serve();
let result;
try {
  result = await run();
} finally {
  server.close();
}

console.log(`\n[${result.browser}] T1 perception end-to-end`);
console.log(`  viewport ${result.viewportCss.w}x${result.viewportCss.h} CSS, capture ${result.captureSize.w}x${result.captureSize.h}, dpr ${result.dpr}`);
console.log(`  detector (no weights)      : ${result.detectorRefusal?.code ?? "UNEXPECTEDLY OK"}`);
console.log(`  floor  elements=${result.floor.elements} domOnly=${result.floor.domOnly} NO_DETECTOR=${result.floor.noDetector}`);
console.log(`  fused  detections=${result.synthetic.detections} matched=${result.synthetic.matched} visionOnly=${result.synthetic.visionOnly} overlaySuspects=${result.synthetic.overlaySuspects}`);
console.log(`  stale frame refused        : ${result.staleFrame.refused} (${result.staleFrame.code})`);
console.log(`  clipped element            : ${result.clippedKind}`);
console.log(`  off-screen Submit          : visible=${result.offscreen?.visible} offscreen=${result.offscreen?.offscreen} bbox=${"bbox" in (result.offscreen ?? {})}`);

for (const f of findings) console.log(`  !! ${f}`);

const outDir = join(ROOT, "artifacts", "gates", "T1-detector-fusion");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `t1-${BROWSER}.json`);
writeFileSync(
  out,
  JSON.stringify(
    {
      gate: "T1 detector + fusion",
      browser: BROWSER,
      collectedAt: new Date().toISOString(),
      note:
        "The detector has NO WEIGHTS. The 'synthetic' detections are derived from measured " +
        "DOM boxes to exercise the fusion path and the model->capture->CSS chain on real " +
        "geometry. They are NOT a detector and support NO accuracy claim.",
      findings,
      result,
    },
    null,
    2
  )
);
console.log(`\nwrote ${out}`);
process.exit(findings.length ? 1 : 0);
